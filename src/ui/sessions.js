// Turning the visit log into sessions: one page load, with the beats somebody
// left inside it. Used by the Sessions panel on the stats page, and pulled out
// here so the grouping can be tested without a browser.

// The log arrives newest first. A session is one page load: "view" opens it and
// "bye" closes it, with no clock involved. An idle threshold used to do this job
// and got it wrong — a leisurely draft logs nothing between the deal and the sim,
// so a half-hour of picks read as a half-hour hole and split one visit into
// pieces that began mid-story. The two markers are not equally trustworthy, and
// the asymmetry is what makes this work: "view" is written server-side from the
// request itself, before the 304 branch and on a no-cache page, so every open
// leaves one. "bye" is a pagehide beacon and roughly a third of them never
// arrive. So the open is the boundary we lean on; a missing close costs nothing,
// because the next line from that device can only follow another page load,
// which brings its own "view" and ends the session anyway.
//
// Lines from a browser that refused the cookie fall back to the visitor hash,
// which is a whole household but better than nothing.
export function groupSessions(visits) {
  const sessions = [];
  const open = new Map();
  const openFor = (key) => open.get(key) ?? open.set(key, []).get(key);
  for (const line of [...visits].reverse()) {
    const key = line.device || `ip:${line.visitor}`;
    const at = Date.parse(line.t);
    const live = openFor(key);
    // A page load starts a session. More than one can be open at a time: a
    // second tab, or a reload whose old page has not said goodbye yet.
    if (line.kind === "view" || !live.length) {
      const session = { key, startedAt: at, lastAt: at, lines: [], names: new Set() };
      live.push(session);
      sessions.push(session);
    }
    // A "bye" reports how long its own page lived, which says which of the open
    // sessions it belongs to — worth asking, because a beacon can arrive after
    // the next page's "view" and would otherwise close the wrong one. Everything
    // else joins the newest, the only guess available.
    const session = line.kind === "bye"
      ? closestOpen(live, at - ((line.data ?? {}).seconds ?? 0) * 1000)
      : live[live.length - 1];
    session.lastAt = Math.max(session.lastAt, at);
    session.lines.push(line);
    for (const name of namesIn(line)) session.names.add(name);
    if (line.kind === "bye") {
      session.seconds = (line.data ?? {}).seconds;
      live.splice(live.indexOf(session), 1);
    }
  }
  // Rebuilt in time order: a line can land in a session opened before the one
  // ahead of it, and the beats inside each want to read top to bottom.
  for (const session of sessions) session.lines.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

// The open session that started nearest to when this page says it opened.
function closestOpen(live, openedAt) {
  return live.reduce((best, session) =>
    Math.abs(session.startedAt - openedAt) < Math.abs(best.startedAt - openedAt) ? session : best);
}

// Who this was, in their own words: the names typed into a draft or a campaign.
// Computer managers are the app's, not theirs, so they are left out.
export function namesIn(line) {
  const data = line.data ?? {};
  const cpu = new Set(data.cpu ?? []);
  if (line.kind === "local-draft-start" || line.kind === "sim") {
    return (data.humans ?? data.managers ?? []).filter((name) => !cpu.has(name));
  }
  if (line.kind === "room-create") return (data.managers ?? []).filter((name) => !cpu.has(name));
  if (line.kind === "room-join") return data.manager ? [data.manager] : [];
  if (line.kind === "adventure-start" || line.kind === "adventure-open") return data.name ? [data.name] : [];
  return [];
}
