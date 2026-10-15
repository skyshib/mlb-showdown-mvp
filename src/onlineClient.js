const SEAT_STORAGE_PREFIX = "mlb-showdown-online-seat-";

// Every field the setup screen chose has to make the trip. A name left out of
// this list is silently dropped and the room quietly opens on the default —
// which is how a random-nomination room came out as a manual auction.
export async function createRoom({ seed, managers, universe, startingPitchers, bullpenSlots, bullpenMin, temperature, pickTimer, cpu, draftType, nomination, hidePoints, coaches, budget, auctionPricing, auctionTimer, snakeTimer, snakeReview, snakePicks, lobby }) {
  return request("POST", "/api/rooms", {
    lobby,
    seed,
    managers,
    universe,
    startingPitchers,
    bullpenSlots,
    bullpenMin,
    temperature,
    pickTimer,
    snakeTimer,
    snakeReview,
    snakePicks,
    cpu,
    draftType,
    nomination,
    hidePoints,
    coaches,
    budget,
    auctionPricing,
    auctionTimer
  });
}

// The token says which seat this browser holds (a lobby can move it); the host
// token unlocks the seed, which the host is still allowed to change.
export async function fetchRoom(roomId, viewer = {}) {
  const query = new URLSearchParams();
  if (viewer.token) query.set("token", viewer.token);
  if (viewer.host) query.set("host", viewer.host);
  const suffix = query.size ? `?${query}` : "";
  return request("GET", `/api/rooms/${encodeURIComponent(roomId)}${suffix}`);
}

// The host setting up a lobby room: `settings` is a createRoom body, and
// `start` locks them and opens the room to the draft.
export async function configureRoom(roomId, hostToken, { settings, start } = {}) {
  return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/configure`, { hostToken, settings, start });
}

export async function joinRoom(roomId, managerId, hostToken) {
  return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/join`, { managerId, hostToken });
}

export async function sendRoomAction(roomId, token, action) {
  return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/actions`, { token, action });
}

// ---- the shared sim ----------------------------------------------------------
//
// One browser plays the season and the room reads it off the server. These are
// the three trips that takes: the runner's race as it unfolds, the finished
// season on its way up, and the finished season on its way back down.

// Fire and forget. A lost tick is a chart frame nobody draws; the season does
// not depend on it, and the runner must not wait on the network to keep
// simulating.
export function sendSimProgress(roomId, token, payload) {
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/sim/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...payload })
  }).catch(() => {});
}

// A six-team season is 136KB of JSON and 23KB gzipped, so it goes up
// compressed — which also keeps it under the server's body cap without the
// server having to inflate anything on a 256MB machine. A browser too old for
// CompressionStream files nothing, and the room falls back to simulating
// locally the way it always did.
export async function fileRoomSim(roomId, token, { salt, runs }, payload) {
  if (typeof CompressionStream !== "function") return false;
  const json = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const gzipped = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const query = new URLSearchParams({ token, salt, runs: String(runs) });
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/sim?${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: gzipped
  });
  return response.ok;
}

// Null when the room has no season on file under that salt — which is the
// signal to wait for the runner, or to give up and play it here.
export async function fetchRoomSim(roomId, salt) {
  const query = salt ? `?salt=${encodeURIComponent(salt)}` : "";
  let response;
  try {
    response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/sim${query}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

// SSE stream of room events. On reconnect the browser re-requests the same
// URL, so the server resends everything after `since`; callers dedupe by seq.
// The server pulses every 20 seconds. Two missed beats and we call it: a
// stream can die without EventSource ever firing an error — a laptop sleeps, a
// router drops the socket, a proxy quietly stops forwarding — and the room goes
// on without you while your screen sits there looking fine.
const STREAM_SILENCE_MS = 45000;

// The token goes with the subscription so the server knows which seat this
// stream is holding open. A seat nobody is streaming is a seat nobody is in.
export function subscribeRoom(roomId, since, handlers, token = null) {
  const query = `since=${since}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/stream?${query}`);
  let lastBeat = Date.now();
  const beat = () => { lastBeat = Date.now(); };

  const listen = (name, handler) => source.addEventListener(name, (event) => {
    beat();
    handler?.(JSON.parse(event.data));
  });
  listen("action", handlers.onAction);
  listen("seats", handlers.onSeats);
  // A lobby's settings changed, or the host started the draft.
  listen("room", handlers.onRoom);
  listen("hello", handlers.onHello);
  // A live auction lot: who is up and who has bid, but never the amounts —
  // those only arrive as actions once the card sells.
  listen("lot", handlers.onLot);
  // The browser running the room's sim, reporting its race as it goes and then
  // saying that the finished season is on the server.
  listen("sim-progress", handlers.onSimProgress);
  listen("sim-ready", handlers.onSimReady);
  listen("ping", () => {});

  const watchdog = setInterval(() => {
    if (Date.now() - lastBeat < STREAM_SILENCE_MS) return;
    beat(); // don't fire again while the resync is in flight
    handlers.onSilent?.();
  }, 5000);

  source.onerror = () => handlers.onError?.();
  const close = source.close.bind(source);
  source.close = () => {
    clearInterval(watchdog);
    close();
  };
  return source;
}

export function loadOnlineSeat(roomId) {
  try {
    const raw = localStorage.getItem(SEAT_STORAGE_PREFIX + roomId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeOnlineSeat(roomId, seat) {
  localStorage.setItem(SEAT_STORAGE_PREFIX + roomId, JSON.stringify({ ...loadOnlineSeat(roomId), ...seat }));
}

export function clearOnlineSeat(roomId) {
  localStorage.removeItem(SEAT_STORAGE_PREFIX + roomId);
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("Could not reach the room server. Is it running? (npm run online)");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (!data.error && response.status === 404) {
      throw new Error("This web server doesn't have the online rooms API. Restart the app with `npm run serve` or `npm run online` from the latest code.");
    }
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}
