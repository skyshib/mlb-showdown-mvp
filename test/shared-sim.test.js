import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";

async function startServer(t, dataDir) {
  const roomsDir = dataDir ?? (await mkdtemp(join(tmpdir(), "showdown-rooms-")));
  const { server } = createOnlineServer({ dataDir: roomsDir });
  server.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  return base;
}

async function api(base, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// A room drafted to the end, with both seats' tokens and the host's.
async function simmableRoom(base, seed) {
  const created = await api(base, "POST", "/api/rooms", { seed, managers: ["Ana", "Bo"] });
  const roomId = created.data.roomId;
  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken });
  const bo = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });
  const finish = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "finish" }
  });
  assert.equal(finish.status, 200);
  return { roomId, ana: ana.data.token, bo: bo.data.token };
}

// What a browser uploads: the season it just played, as the client's own batch
// state, gzipped. The server never looks inside it.
function simBlob(salt, extra = {}) {
  return gzipSync(Buffer.from(JSON.stringify({
    runs: 200,
    seed: `shared-sim-batch-${salt}`,
    salt,
    summary: { teams: [{ team: "Ana", winPct: 0.55 }, { team: "Bo", winPct: 0.45 }] },
    race: { teamNames: ["Ana", "Bo"], totalRuns: 200, series: [{ n: 1, shares: [0.5, 0.5] }] },
    ...extra
  })));
}

function putSim(base, roomId, query, body) {
  return fetch(`${base}/api/rooms/${roomId}/sim?${new URLSearchParams(query)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body
  });
}

test("one browser files the season and the rest of the room reads it", async (t) => {
  const base = await startServer(t);
  const { roomId, ana, bo } = await simmableRoom(base, "shared-sim");

  // Nothing has been simmed, so there is nothing to read.
  const empty = await api(base, "GET", `/api/rooms/${roomId}/sim`);
  assert.equal(empty.status, 404);

  const sim = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.token ?? ana,
    action: { type: "batch", runs: 200, salt: "salt-one" }
  });
  assert.equal(sim.status, 200);

  // Ana ran it; Ana files it.
  const filed = await putSim(base, roomId, { token: ana, salt: "salt-one", runs: 200 }, simBlob("salt-one"));
  assert.equal(filed.status, 200);

  // Bo reads the identical season off the server rather than playing it.
  const read = await fetch(`${base}/api/rooms/${roomId}/sim?salt=salt-one`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "application/json; charset=utf-8");
  const blob = await read.json();
  assert.equal(blob.salt, "salt-one");
  assert.equal(blob.runs, 200);
  assert.equal(blob.summary.teams[0].team, "Ana");
  assert.equal(blob.race.teamNames.length, 2);

  // The room says a season is on file, which is how a client rejoining knows to
  // fetch instead of simulate.
  const snapshot = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.deepEqual(snapshot.data.sim, { salt: "salt-one", runs: 200 });

  // A client asking for a season the room is no longer running gets nothing
  // rather than the wrong one.
  const stale = await api(base, "GET", `/api/rooms/${roomId}/sim?salt=salt-zero`);
  assert.equal(stale.status, 404);

  // Simming again drops last season on the floor.
  await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo,
    action: { type: "batch", runs: 200, salt: "salt-two" }
  });
  const dropped = await api(base, "GET", `/api/rooms/${roomId}/sim?salt=salt-one`);
  assert.equal(dropped.status, 404);
});

test("a filed season is only the one the room asked for, from someone in it", async (t) => {
  const base = await startServer(t);
  const { roomId, ana } = await simmableRoom(base, "shared-sim-guards");
  await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana,
    action: { type: "batch", runs: 200, salt: "live" }
  });

  const noSeat = await putSim(base, roomId, { token: "bogus", salt: "live" }, simBlob("live"));
  assert.equal(noSeat.status, 403);

  // A tab that was running the previous sim when the room moved on.
  const wrongSalt = await putSim(base, roomId, { token: ana, salt: "old" }, simBlob("old"));
  assert.equal(wrongSalt.status, 409);

  // The bytes go back out under Content-Encoding: gzip, so they have to be gzip.
  const notGzip = await putSim(base, roomId, { token: ana, salt: "live" }, Buffer.from(JSON.stringify({ runs: 200 })));
  assert.equal(notGzip.status, 400);

  const gone = await api(base, "GET", `/api/rooms/${roomId}/sim`);
  assert.equal(gone.status, 404);
});

test("a season survives the machine going to sleep", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const first = await startServer(t, dataDir);
  const { roomId, ana } = await simmableRoom(first, "shared-sim-restart");
  await api(first, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana,
    action: { type: "batch", runs: 200, salt: "kept" }
  });
  const filed = await putSim(first, roomId, { token: ana, salt: "kept", runs: 200 }, simBlob("kept"));
  assert.equal(filed.status, 200);
  // The write is chained behind the room's own saves, so wait for the file
  // rather than for a fixed moment: a fixed one loses under a full suite.
  const simFile = join(dataDir, `${roomId}.sim`);
  for (let tries = 0; tries < 100; tries += 1) {
    if (existsSync(simFile)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(existsSync(simFile), "the season reached the volume");

  const second = await startServer(t, dataDir);
  const read = await fetch(`${second}/api/rooms/${roomId}/sim?salt=kept`);
  assert.equal(read.status, 200);
  const blob = await read.json();
  assert.equal(blob.salt, "kept");
  assert.equal(blob.summary.teams[1].team, "Bo");
});

test("the runner's race is relayed to the room as it unfolds", async (t) => {
  const base = await startServer(t);
  const { roomId, ana } = await simmableRoom(base, "shared-sim-progress");
  await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana,
    action: { type: "batch", runs: 200, salt: "running" }
  });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${base}/api/rooms/${roomId}/stream?since=0`, { signal: controller.signal });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readUntil = async (marker) => {
    for (let i = 0; i < 20 && !buffer.includes(marker); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    assert.ok(buffer.includes(marker), `expected SSE stream to include ${marker}`);
  };
  await readUntil("event: hello");

  const progress = await fetch(`${base}/api/rooms/${roomId}/sim/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: ana, salt: "running", completed: 60, total: 200, rows: [[20, 10], [10, 20]] })
  });
  assert.equal(progress.status, 204);
  await readUntil("event: sim-progress");
  await readUntil('"completed":60');

  // Progress is never logged: it is a chart frame, not a move on the draft.
  const snapshot = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.ok(snapshot.data.actions.every((entry) => entry.action.type !== "sim-progress"));

  const filed = await putSim(base, roomId, { token: ana, salt: "running", runs: 200 }, simBlob("running"));
  assert.equal(filed.status, 200);
  await readUntil("event: sim-ready");
  await readUntil('"salt":"running"');
});
