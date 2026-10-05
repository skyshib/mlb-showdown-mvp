const SEAT_STORAGE_PREFIX = "mlb-showdown-online-seat-";

// Every field the setup screen chose has to make the trip. A name left out of
// this list is silently dropped and the room quietly opens on the default —
// which is how a random-nomination room came out as a manual auction.
export async function createRoom({ seed, managers, universe, startingPitchers, bullpenSlots, bullpenMin, temperature, pickTimer, cpu, draftType, nomination, hidePoints, coaches, budget, auctionTimer, snakeTimer, snakeReview, snakePicks, lobby }) {
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
