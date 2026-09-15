// What a page tells the server about its visit: the device it is on when it
// opens, how long it stayed when it closes, and the handful of things worth
// knowing somebody did — a local draft dealt, a season simmed, a campaign begun.
// A draft played on one screen never touches the room server, so without this
// it leaves no trace at all.
//
// Beacons, fire and forget. Nothing here may throw into the page or wait on the
// network, and on the plain static server (no /api) every call is a quiet 404.

export function track(kind, data = {}) {
  try {
    if (location.protocol === "file:") return;
    const body = JSON.stringify({ kind, page: location.pathname, data });
    if (navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/events", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  } catch {}
}

// One "hello" on load with what only the browser knows, one "bye" when the page
// goes away with how long it was open and how long it was actually looked at.
export function trackSession() {
  const opened = Date.now();
  let visibleMs = 0;
  let visibleSince = document.visibilityState === "visible" ? opened : null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") visibleSince ??= Date.now();
    else if (visibleSince !== null) {
      visibleMs += Date.now() - visibleSince;
      visibleSince = null;
    }
  });
  try {
    track("hello", {
      referrer: document.referrer.slice(0, 300),
      screen: `${screen.width}x${screen.height}`,
      viewport: `${innerWidth}x${innerHeight}`,
      dpr: devicePixelRatio,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      languages: [...(navigator.languages ?? [])].slice(0, 4),
      touch: navigator.maxTouchPoints > 0,
      standalone: matchMedia("(display-mode: standalone)").matches,
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      connection: navigator.connection?.effectiveType ?? "",
      cores: navigator.hardwareConcurrency ?? 0,
      memoryGb: navigator.deviceMemory ?? 0,
      navigation: performance.getEntriesByType?.("navigation")?.[0]?.type ?? ""
    });
  } catch {}
  let said = false;
  addEventListener("pagehide", () => {
    if (said) return;
    said = true;
    if (visibleSince !== null) visibleMs += Date.now() - visibleSince;
    track("bye", { seconds: Math.round((Date.now() - opened) / 1000), visibleSeconds: Math.round(visibleMs / 1000) });
  });
}
