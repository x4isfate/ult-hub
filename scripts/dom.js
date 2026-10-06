/**
 * ULT's Module Hub — small DOM and text helpers shared by the window and main.js.
 *
 * Everything is built with createElement and textContent, never innerHTML, so
 * text that comes from outside (release notes, module titles) cannot inject
 * markup.
 */

export function el(tag, className = null, attrs = {}, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = String(text);
  return node;
}

export function loc(key) {
  return game.i18n.localize(key);
}

export function fmt(key, data) {
  return game.i18n.format(key, data);
}

/** A button with an optional icon and label. */
export function button(label, { icon = null, className = "ulthub-btn", title = null } = {}) {
  const node = el("button", className, { type: "button", title });
  if (icon) node.appendChild(el("i", icon, { "aria-hidden": "true" }));
  if (label) node.appendChild(el("span", null, {}, label));
  return node;
}

/**
 * Put text on the clipboard. Returns true on success.
 *
 * `navigator.clipboard` only exists on secure pages (https or localhost), and
 * many Foundry servers are reached over plain http on a LAN, so a textarea
 * copy is the fallback. If both fail the caller shows the text to select.
 */
export async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    /* fall through to the next method */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    if (done) return true;
  } catch (err) {
    /* fall through */
  }

  try {
    if (game.clipboard?.copyPlainText) {
      await game.clipboard.copyPlainText(text);
      return true;
    }
  } catch (err) {
    /* nothing left to try */
  }

  return false;
}

/**
 * Release notes are Markdown. They are shown as plain text, never rendered, so
 * nothing in them can become markup; this only strips the symbols that would
 * otherwise clutter the text (heading marks, bold, code ticks, link syntax) and
 * turns list dashes into bullets.
 */
export function markdownToPlain(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "5 minutes ago" in the interface language, with a plain fallback. */
export function relativeTime(then, now = Date.now()) {
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const lang = game.i18n?.lang || "en";

  let value;
  let unit;
  if (abs < 60) {
    value = seconds;
    unit = "second";
  } else if (abs < 3600) {
    value = Math.round(seconds / 60);
    unit = "minute";
  } else if (abs < 86400) {
    value = Math.round(seconds / 3600);
    unit = "hour";
  } else {
    value = Math.round(seconds / 86400);
    unit = "day";
  }

  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(value, unit);
  } catch (err) {
    return new Date(then).toLocaleString();
  }
}

/** A calendar date in the interface language, or "" for an unusable value. */
export function formatDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  try {
    return new Date(time).toLocaleDateString(game.i18n?.lang || undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch (err) {
    return new Date(time).toISOString().slice(0, 10);
  }
}
