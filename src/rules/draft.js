const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const LINEUP_SLOT_LABELS = [...FIELD_POSITIONS, "DH"];
const EXACT_REQUIRED_POSITIONS = ["C", "2B", "3B", "SS", "CF"];
const CORNER_OUTFIELD_POSITIONS = ["LF", "RF"];
const HITTER_TARGET = 9;
const STARTER_TARGET = 2;
const BULLPEN_TARGET = 2;
const PITCHER_TARGET = STARTER_TARGET + BULLPEN_TARGET;
const DEFAULT_ROSTER_SIZE = HITTER_TARGET + PITCHER_TARGET;

export function createDraft(managers, pool, rosterSize = DEFAULT_ROSTER_SIZE) {
  const cleanManagers = managers.map((name, index) => ({
    id: `team-${index + 1}`,
    name: name.trim() || `Manager ${index + 1}`,
    roster: []
  }));

  return {
    managers: cleanManagers,
    pool: pool.map((player) => ({ ...player })),
    pickedIds: new Set(),
    rosterSize,
    pickNumber: 0,
    complete: false
  };
}

export function currentManager(draft) {
  return managerForPickNumber(draft, draft.pickNumber);
}

function managerForPickNumber(draft, pickNumber) {
  const teamCount = draft.managers.length;
  const round = Math.floor(pickNumber / teamCount);
  const indexInRound = pickNumber % teamCount;
  const managerIndex = round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
  return draft.managers[managerIndex];
}

export function availablePlayers(draft) {
  return draft.pool.filter((player) => !draft.pickedIds.has(player.id));
}

export function canPickPlayer(draft, manager, player) {
  if (!player || draft.pickedIds.has(player.id)) {
    return { ok: false, reason: "already picked" };
  }
  if (manager.roster.length >= draft.rosterSize) {
    return { ok: false, reason: "roster full" };
  }
  const hitterLegality = canAddHitterToLineup(manager.roster, player);
  if (!hitterLegality.ok) {
    return hitterLegality;
  }
  const pitcherLegality = canAddPitcherToStaff(manager.roster, player);
  if (!pitcherLegality.ok) {
    return pitcherLegality;
  }

  const nextRoster = [...manager.roster, player];
  const remainingSlots = draft.rosterSize - nextRoster.length;
  const needs = getRosterNeeds(nextRoster);
  const remainingRequired = needs.hitter + needs.starter + needs.bullpen;
  if (remainingRequired > remainingSlots) {
    const needed = [];
    if (needs.hitter > 0) needed.push(`${needs.hitter} hitter${needs.hitter === 1 ? "" : "s"}`);
    if (needs.starter > 0) needed.push(`${needs.starter} starter${needs.starter === 1 ? "" : "s"}`);
    if (needs.bullpen > 0) needed.push(`${needs.bullpen} bullpen pitcher${needs.bullpen === 1 ? "" : "s"}`);
    return { ok: false, reason: `must reserve slots for ${needed.join(" and ")}` };
  }

  if (draft.managers.length > 1) {
    const leagueLegality = canLeagueFinishAfterPick(draft, manager, nextRoster, player);
    if (!leagueLegality.ok) return leagueLegality;
  }

  return { ok: true, reason: "" };
}

export function pickPlayer(draft, playerId) {
  if (draft.complete) return draft;
  const manager = currentManager(draft);
  const player = draft.pool.find((item) => item.id === playerId);
  if (!player || draft.pickedIds.has(playerId)) {
    throw new Error("Player is not available");
  }
  if (manager.roster.length >= draft.rosterSize) {
    throw new Error("Roster is already full");
  }
  const legality = canPickPlayer(draft, manager, player);
  if (!legality.ok) {
    throw new Error(legality.reason);
  }

  manager.roster.push(player);
  draft.pickedIds.add(playerId);
  draft.pickNumber += 1;
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
  return draft;
}

export function undoLastPick(draft) {
  if (!draft || draft.pickNumber <= 0) return null;
  const manager = managerForPickNumber(draft, draft.pickNumber - 1);
  const player = manager?.roster.pop();
  if (!manager || !player) return null;

  draft.pickedIds.delete(player.id);
  draft.pickNumber -= 1;
  draft.complete = false;
  if (manager.lineupAssignments) {
    for (const [slot, playerId] of Object.entries(manager.lineupAssignments)) {
      if (playerId === player.id) delete manager.lineupAssignments[slot];
    }
  }
  return { manager, player };
}

export function autopick(draft) {
  const manager = currentManager(draft);
  const rosterNeeds = getRosterNeeds(manager.roster);
  const candidates = availablePlayers(draft);
  const legal = candidates.filter((player) => canPickPlayer(draft, manager, player).ok);
  if (!legal.length) {
    throw new Error("No legal players are available");
  }
  const best = legal
    .map((player) => ({ player, score: autopickScore(draft, manager, player, rosterNeeds) }))
    .sort((a, b) => b.score - a.score)[0].player;
  return pickPlayer(draft, best.id);
}

export function buildTeam(manager, options = {}) {
  const lineup = assignLineupSlots(manager.roster, manager.lineupAssignments).slots
    .filter((slot) => slot.player)
    .map((slot) => lineupPlayer(slot));
  const starters = manager.roster.filter((player) => player.kind === "pitcher" && pitcherRole(player) === "SP");
  const bullpen = manager.roster.filter((player) => player.kind === "pitcher" && pitcherRole(player) === "RP");
  const starterIndex = starters.length ? Number(options.starterIndex ?? 0) % starters.length : 0;
  const activeStarter = starters[starterIndex];
  return {
    name: manager.name,
    lineup,
    starters,
    bullpen: bullpen.slice(0, BULLPEN_TARGET),
    starterIndex,
    pitchers: [activeStarter, ...bullpen.slice(0, BULLPEN_TARGET)].filter(Boolean)
  };
}

export function validateRoster(manager) {
  const lineup = lineupStatus(manager.roster);
  const staff = staffStatus(manager.roster);
  const issues = [];
  if (lineup.hitters.length < HITTER_TARGET) issues.push(`needs ${HITTER_TARGET - lineup.hitters.length} more hitter${HITTER_TARGET - lineup.hitters.length === 1 ? "" : "s"}`);
  if (lineup.missingPositions.length) issues.push(`missing ${lineup.missingPositions.join("/")}`);
  if (lineup.extraDuplicates.length) issues.push(`too many ${lineup.extraDuplicates.join("/")} hitters`);
  if (staff.starters.length < STARTER_TARGET) issues.push(`needs ${STARTER_TARGET - staff.starters.length} more starter${STARTER_TARGET - staff.starters.length === 1 ? "" : "s"}`);
  if (staff.bullpen.length < BULLPEN_TARGET) issues.push(`needs ${BULLPEN_TARGET - staff.bullpen.length} more bullpen pitcher${BULLPEN_TARGET - staff.bullpen.length === 1 ? "" : "s"}`);
  return issues;
}

export function repairDraftRosters(draft) {
  for (const manager of draft.managers) {
    repairManagerRoster(draft, manager);
  }
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
  return draft;
}

export function getRosterNeeds(roster) {
  const hitters = roster.filter((player) => player.kind === "hitter").length;
  const staff = staffStatus(roster);
  const starter = Math.max(0, STARTER_TARGET - staff.starters.length);
  const bullpen = Math.max(0, BULLPEN_TARGET - staff.bullpen.length);
  return {
    hitter: Math.max(0, HITTER_TARGET - hitters),
    pitcher: starter + bullpen,
    starter,
    bullpen
  };
}

export function staffStatus(roster) {
  const pitchers = roster.filter((player) => player.kind === "pitcher");
  return {
    pitchers,
    starters: pitchers.filter((player) => pitcherRole(player) === "SP"),
    bullpen: pitchers.filter((player) => pitcherRole(player) === "RP")
  };
}

export function lineupStatus(roster) {
  const hitters = roster.filter((player) => player.kind === "hitter");
  const assigned = assignLineupSlots(roster);
  const counts = new Map();
  for (const hitter of hitters) {
    counts.set(hitter.position, (counts.get(hitter.position) ?? 0) + 1);
  }
  const missingPositions = assigned.slots.filter((slot) => slot.label !== "DH" && !slot.player).map((slot) => slot.label);
  const duplicatePositions = assigned.slots
    .filter((slot) => slot.player && slot.player.position !== slot.label && slot.label !== "DH")
    .map((slot) => `${slot.player.position}->${slot.label}`);
  const extraDuplicates = assigned.extras.map((player) => player.position);

  return {
    hitters,
    counts,
    missingPositions,
    duplicatePositions,
    dhFilled: Boolean(assigned.slots.find((slot) => slot.label === "DH")?.player),
    extraDuplicates
  };
}

export function assignLineupSlots(roster, assignments = {}) {
  const hitters = roster.filter((player) => player.kind === "hitter");
  const slots = LINEUP_SLOT_LABELS.map((label) => ({ label, player: null, fielding: null, outOfPosition: false }));
  const used = new Set();
  const manualAssignments = assignments ?? {};

  for (const label of LINEUP_SLOT_LABELS) {
    const player = hitters.find((item) => item.id === manualAssignments[label] && !used.has(item.id));
    if (player && canPlayerFillLineupSlot(player, label)) assignFirst(slots, used, label, player, slotOptions(player, label));
  }

  for (const label of EXACT_REQUIRED_POSITIONS) {
    assignFirst(slots, used, label, hitters.find((player) => player.position === label && !used.has(player.id)));
  }

  for (const label of CORNER_OUTFIELD_POSITIONS) {
    const exactCorner = hitters.find((player) => player.position === label && !used.has(player.id));
    const otherCorner = hitters.find((player) => CORNER_OUTFIELD_POSITIONS.includes(player.position) && !used.has(player.id));
    assignFirst(slots, used, label, exactCorner ?? otherCorner);
  }

  const exactFirstBase = hitters.find((player) => player.position === "1B" && !used.has(player.id));
  const fallbackFirstBase = hitters.find((player) => !used.has(player.id));
  assignFirst(slots, used, "1B", exactFirstBase ?? fallbackFirstBase, { firstBaseOutOfPosition: !exactFirstBase && Boolean(fallbackFirstBase) });

  const dh = hitters.find((player) => !used.has(player.id));
  assignFirst(slots, used, "DH", dh);

  return {
    slots,
    extras: hitters.filter((player) => !used.has(player.id))
  };
}

export function canPlayerFillLineupSlot(player, label) {
  if (player?.kind !== "hitter") return false;
  if (label === "DH") return true;
  if (label === "1B") return true;
  if (CORNER_OUTFIELD_POSITIONS.includes(label)) return CORNER_OUTFIELD_POSITIONS.includes(player.position);
  return player.position === label;
}

function repairManagerRoster(draft, manager) {
  let guard = 0;
  while (validateRoster(manager).length > 0 && guard < draft.rosterSize * 2) {
    guard += 1;
    const needs = getRosterNeeds(manager.roster);
    const lineup = lineupStatus(manager.roster);
    const neededPosition = lineup.missingPositions.find((position) => position !== "1B");
    const neededKind = needs.starter > 0 || needs.bullpen > 0 ? "pitcher" : "hitter";
    const neededRole = needs.starter > 0 ? "SP" : needs.bullpen > 0 ? "RP" : null;
    const replacement = availablePlayers(draft)
      .filter((player) => player.kind === neededKind)
      .filter((player) => !neededRole || pitcherRole(player) === neededRole)
      .filter((player) => !neededPosition || player.position === neededPosition)
      .filter((player) => neededKind !== "hitter" || canAddHitterToLineup(manager.roster, player).ok)
      .sort((a, b) => b.points - a.points)[0] ?? makeEmergencyReplacement(draft, manager, neededKind, neededRole, neededPosition);

    if (manager.roster.length >= draft.rosterSize) {
      const removableKind = neededKind === "pitcher" ? "hitter" : "pitcher";
      const removable = manager.roster
        .filter((player) => player.kind === removableKind)
        .sort((a, b) => a.points - b.points)[0];
      if (!removable) return;
      manager.roster = manager.roster.filter((player) => player.id !== removable.id);
      draft.pickedIds.delete(removable.id);
    }

    manager.roster.push(replacement);
    draft.pickedIds.add(replacement.id);
  }
}

function canLeagueFinishAfterPick(draft, pickingManager, nextRoster, pickedPlayer) {
  const pickedIds = new Set(draft.pickedIds);
  pickedIds.add(pickedPlayer.id);
  const remaining = draft.pool.filter((player) => !pickedIds.has(player.id));
  const demand = emptyLeagueDemand();

  for (const manager of draft.managers) {
    addRosterDemand(demand, manager === pickingManager ? nextRoster : manager.roster);
  }

  const supply = leagueSupply(remaining);
  const shortages = [];
  for (const position of EXACT_REQUIRED_POSITIONS) {
    if (demand.positions[position] > supply.positions[position]) shortages.push(position);
  }
  if (demand.cornerOutfield > supply.cornerOutfield) shortages.push("LF/RF");
  if (demand.starter > supply.starter) shortages.push("starter");
  if (demand.bullpen > supply.bullpen) shortages.push("bullpen");
  if (demand.hitters > supply.hitters) shortages.push("hitter");
  if (shortages.length) {
    return { ok: false, reason: `would leave league without enough ${shortages.join(", ")}` };
  }
  return { ok: true, reason: "" };
}

function emptyLeagueDemand() {
  return {
    positions: Object.fromEntries(EXACT_REQUIRED_POSITIONS.map((position) => [position, 0])),
    cornerOutfield: 0,
    hitters: 0,
    starter: 0,
    bullpen: 0
  };
}

function addRosterDemand(demand, roster) {
  const lineup = lineupStatus(roster);
  const needs = getRosterNeeds(roster);
  for (const position of lineup.missingPositions) {
    if (EXACT_REQUIRED_POSITIONS.includes(position)) demand.positions[position] += 1;
    if (CORNER_OUTFIELD_POSITIONS.includes(position)) demand.cornerOutfield += 1;
  }
  demand.hitters += needs.hitter;
  demand.starter += needs.starter;
  demand.bullpen += needs.bullpen;
}

function leagueSupply(players) {
  const positions = Object.fromEntries(EXACT_REQUIRED_POSITIONS.map((position) => [position, 0]));
  let cornerOutfield = 0;
  let hitters = 0;
  let starter = 0;
  let bullpen = 0;

  for (const player of players) {
    if (player.kind === "hitter") {
      hitters += 1;
      if (EXACT_REQUIRED_POSITIONS.includes(player.position)) positions[player.position] += 1;
      if (CORNER_OUTFIELD_POSITIONS.includes(player.position)) cornerOutfield += 1;
    } else if (pitcherRole(player) === "SP") {
      starter += 1;
    } else {
      bullpen += 1;
    }
  }

  return { positions, cornerOutfield, hitters, starter, bullpen };
}

function makeEmergencyReplacement(draft, manager, neededKind, neededRole, neededPosition) {
  const index = draft.pool.length + 1;
  const teamName = manager.name.split(/[ /]+/)[0] || "Team";
  const replacement = neededKind === "pitcher"
    ? makeEmergencyPitcher(index, teamName, neededRole)
    : makeEmergencyHitter(index, teamName, neededPosition ?? "1B");
  draft.pool.push(replacement);
  return replacement;
}

function makeEmergencyHitter(index, teamName, position) {
  return {
    id: `emergency-h-${index}`,
    kind: "hitter",
    name: `${teamName} Replacement ${position}`,
    position,
    bats: "R",
    onBase: 8,
    speed: 8,
    fielding: emergencyFielding(position),
    points: 180,
    chart: [
      { from: 1, to: 3, result: "SO" },
      { from: 4, to: 6, result: "GB" },
      { from: 7, to: 9, result: "FB" },
      { from: 10, to: 11, result: "BB" },
      { from: 12, to: 18, result: "1B" },
      { from: 19, to: 20, result: "2B" }
    ]
  };
}

function makeEmergencyPitcher(index, teamName, role) {
  return {
    id: `emergency-p-${index}`,
    kind: "pitcher",
    name: `${teamName} Replacement ${role === "SP" ? "Starter" : "Bullpen"}`,
    role: role === "SP" ? "SP" : "RP",
    throws: "R",
    control: 1,
    ip: role === "SP" ? 5 : 1,
    points: 120,
    chart: [
      { from: 1, to: 2, result: "PU" },
      { from: 3, to: 7, result: "SO" },
      { from: 8, to: 13, result: "GB" },
      { from: 14, to: 17, result: "FB" },
      { from: 18, to: 19, result: "BB" },
      { from: 20, to: 20, result: "1B" }
    ]
  };
}

function emergencyFielding(position) {
  if (position === "C") return 4;
  if (position === "2B" || position === "SS") return 2;
  if (position === "3B" || position === "CF") return 1;
  return 0;
}

function autopickScore(draft, manager, player, needs) {
  const remainingSlots = draft.rosterSize - manager.roster.length;
  const matchingNeed = player.kind === "pitcher" ? pitcherNeed(player, needs) : needs.hitter;
  const forcedNeed = matchingNeed > 0 && matchingNeed >= remainingSlots;
  const needBonus = matchingNeed > 0 ? 80 + (matchingNeed / Math.max(1, remainingSlots)) * 120 : 0;
  const balanceBonus = player.kind === "pitcher" && pitcherNeed(player, needs) > 0 ? 35 : 0;
  const positionBonus = hitterPositionBonus(manager.roster, player);
  return player.points + needBonus + balanceBonus + positionBonus + (forcedNeed ? 1000 : 0);
}

function canAddPitcherToStaff(roster, player) {
  if (player?.kind !== "pitcher") return { ok: true, reason: "" };
  const staff = staffStatus(roster);
  if (pitcherRole(player) === "SP" && staff.starters.length >= STARTER_TARGET) {
    return { ok: false, reason: "starter slots are already filled" };
  }
  if (pitcherRole(player) === "RP" && staff.bullpen.length >= BULLPEN_TARGET) {
    return { ok: false, reason: "bullpen slots are already filled" };
  }
  return { ok: true, reason: "" };
}

function pitcherNeed(player, needs) {
  return pitcherRole(player) === "SP" ? needs.starter : needs.bullpen;
}

function pitcherRole(player) {
  return player?.role === "SP" ? "SP" : "RP";
}

function canAddHitterToLineup(roster, player) {
  if (player?.kind !== "hitter") return { ok: true, reason: "" };
  const lineup = lineupStatus(roster);
  if (lineup.hitters.length >= HITTER_TARGET) {
    return { ok: false, reason: "lineup already has 9 hitters" };
  }
  const nextLineup = lineupStatus([...roster, player]);
  const remainingHitterSlots = HITTER_TARGET - nextLineup.hitters.length;
  if (nextLineup.extraDuplicates.length) {
    return { ok: false, reason: "lineup slots are already filled" };
  }
  if (nextLineup.missingPositions.length > remainingHitterSlots) {
    return { ok: false, reason: "must fill remaining positions" };
  }
  return { ok: true, reason: "" };
}

function hitterPositionBonus(roster, player) {
  if (player.kind !== "hitter") return 0;
  const lineup = lineupStatus(roster);
  if (lineup.missingPositions.includes(player.position)) return 60;
  if (CORNER_OUTFIELD_POSITIONS.includes(player.position) && (lineup.missingPositions.includes("LF") || lineup.missingPositions.includes("RF"))) return 60;
  if (lineup.missingPositions.includes("1B")) return 20;
  if (!lineup.dhFilled) return 15;
  return 0;
}

function assignFirst(slots, used, label, player, options = {}) {
  if (!player) return;
  const slot = slots.find((item) => item.label === label);
  if (!slot || slot.player) return;
  slot.player = player;
  slot.outOfPosition = Boolean(options.firstBaseOutOfPosition);
  slot.fielding = options.firstBaseOutOfPosition ? -1 : Number(player.fielding) || 0;
  used.add(player.id);
}

function slotOptions(player, label) {
  return {
    firstBaseOutOfPosition: label === "1B" && player?.position !== "1B"
  };
}

function lineupPlayer(slot) {
  return {
    ...slot.player,
    cardPosition: slot.player.position,
    defensivePosition: slot.label,
    assignedPosition: slot.label,
    fielding: slot.fielding ?? (Number(slot.player.fielding) || 0),
    outOfPosition: slot.outOfPosition
  };
}
