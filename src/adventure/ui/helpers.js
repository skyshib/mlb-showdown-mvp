import { positionsLabel } from "../../rules/cards.js?v=20260713-h";
import { escapeHtml, shortName } from "../../ui/cardFace.js?v=20260713-h";

// The card face and the booth are shared with the draft app (src/ui). What
// lives here is the Game Boy shell around them: cursor menus, the compact
// list lines, and the diamond.
export { cardPanelHtml, escapeHtml, eraYear, rarityTag, shortName, stripCardYear } from "../../ui/cardFace.js?v=20260713-h";
export { describeEvent, halfLabel } from "../../ui/playByPlay.js?v=20260713-h";

export function clampIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

// A cursor menu: items render with .gq-cursor on the selected row. Screens
// keep the index in their own state and call menuHtml to draw. Sectioned
// menus pass `offset` so every row carries its global index for clicks.
export function menuHtml(items, selectedIndex, { className = "", offset = 0 } = {}) {
  return `<ul class="gq-menu ${className}">${items
    .map((item, index) => {
      const selected = index === selectedIndex;
      return `<li class="${selected ? "gq-cursor" : ""} ${item.disabled ? "gq-disabled" : ""}" data-menu-index="${offset + index}">
          <span class="gq-caret">${selected ? "&#9654;" : "&nbsp;"}</span>${item.html ?? escapeHtml(item.label)}
        </li>`;
    })
    .join("")}</ul>`;
}

export function cardLine(card) {
  const stat = card.kind === "pitcher"
    ? `${card.role} CTRL${card.control} IP${card.ip}`
    : `${escapeHtml(positionsLabel(card))} OB${card.onBase} SPD${card.speed}`;
  return `${escapeHtml(shortName(card.name))} <span class="gq-dim">${stat} ${card.points}PT</span>`;
}

// Occupied bases carry the runner's card id so hovering the icon floats the
// full card (main.js resolves data-card-id into the tooltip).
export function diamondHtml(state) {
  const [first, second, third] = state.bases;
  const base = (cls, runner) =>
    `<span class="gq-base ${cls} ${runner ? "gq-base-on" : ""}"${
      runner?.id ? ` data-card-id="${escapeHtml(runner.id)}" title="${escapeHtml(runner.name)}"` : ""
    }></span>`;
  return `<div class="gq-diamond">
    ${base("gq-base-2", second)}
    ${base("gq-base-3", third)}
    ${base("gq-base-1", first)}
    <span class="gq-base gq-base-h"></span>
  </div>`;
}

export function outsHtml(outs) {
  return `<span class="gq-outs">${[0, 1, 2]
    .map((i) => `<i class="${i < outs ? "gq-out-on" : ""}"></i>`)
    .join("")} OUT</span>`;
}
