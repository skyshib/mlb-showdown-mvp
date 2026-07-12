const SEAT_STORAGE_PREFIX = "mlb-showdown-online-seat-";

// Every field the setup screen chose has to make the trip. A name left out of
// this list is silently dropped and the room quietly opens on the default —
// which is how a random-nomination room came out as a manual auction.
export async function createRoom({ seed, managers, universe, pickTimer, cpu, draftType, nomination, budget }) {
  return request("POST", "/api/rooms", { seed, managers, universe, pickTimer, cpu, draftType, nomination, budget });
}

export async function fetchRoom(roomId) {
  return request("GET", `/api/rooms/${encodeURIComponent(roomId)}`);
}

export async function joinRoom(roomId, managerId, hostToken) {
  return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/join`, { managerId, hostToken });
}

export async function sendRoomAction(roomId, token, action) {
  return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/actions`, { token, action });
}

// SSE stream of room events. On reconnect the browser re-requests the same
// URL, so the server resends everything after `since`; callers dedupe by seq.
export function subscribeRoom(roomId, since, handlers) {
  const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/stream?since=${since}`);
  source.addEventListener("action", (event) => handlers.onAction?.(JSON.parse(event.data)));
  source.addEventListener("seats", (event) => handlers.onSeats?.(JSON.parse(event.data)));
  source.addEventListener("hello", (event) => handlers.onHello?.(JSON.parse(event.data)));
  // A live auction lot: who is up and who has bid, but never the amounts —
  // those only arrive as actions once the card sells.
  source.addEventListener("lot", (event) => handlers.onLot?.(JSON.parse(event.data)));
  source.onerror = () => handlers.onError?.();
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
