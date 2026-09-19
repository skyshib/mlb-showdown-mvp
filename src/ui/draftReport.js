// Filing a finished local draft.
//
// An online room's draft is written down by the server, which replays every
// action anyway. A draft played on one screen touches the server exactly once —
// here — or it leaves nothing behind but the line in the visit log that says
// somebody dealt one. So when the last roster fills, the board goes up: the
// settings, every team, and what each card cost.
//
// Fire and forget, like the rest of the telemetry. Nothing here may throw into
// the page, and on the plain static server (no /api) it is a quiet 404.
import { draftRecord } from "../rules/draftRecord.js";

// One filing per draft per page load. Filing again is harmless — the archive
// keys on the draft, so a second copy rewrites the first rather than piling up —
// but the record only changes when the draft does, and the draft is finished.
const filed = new Set();

export function fileFinishedDraft(draft, { key, universe = null } = {}) {
  try {
    if (location.protocol === "file:") return;
    if (!draft?.complete || !key || filed.has(key)) return;
    filed.add(key);
    const body = JSON.stringify({
      key,
      ...draftRecord(draft, { source: "local", universe, page: location.pathname })
    });
    fetch("/api/drafts", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true
    }).catch(() => {});
  } catch {}
}
