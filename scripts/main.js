/**
 * ULT's Module Hub — entry point and hook wiring.
 *
 *   init    settings, the settings-menu button and the public API are set up.
 *   ready   the Game Master's client checks GitHub in the background (if the
 *           settings allow it) and mentions new versions once each.
 *
 * Other ULT modules open the Hub, and can jump to their own tile, with:
 *
 *   const hub = game.modules.get("ult-hub");
 *   if (hub?.active) hub.api.open("ult-ls");
 *
 * A module shows a "Settings" button on its tile when it exposes
 * `api.openHub()` or `api.openSettings()`; otherwise the button opens
 * Foundry's own settings window.
 */

import { MODULE_ID, registerSettings, getSetting, setSetting } from "./settings.js";
import { ModuleHub, collectRows, countUpdates, buildDiagnostics } from "./hub.js";
import { CATALOG } from "./catalog.js";
import { checkAll, isDue, isManualOnly, compareVersions } from "./updates.js";
import { loc, fmt } from "./dom.js";

/** Wait after `ready` before touching the network, so world loading is not slowed. */
const BACKGROUND_CHECK_DELAY_MS = 4000;

function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

/** Keep only characters a version or tag can sensibly contain. */
function cleanVersion(value) {
  return String(value ?? "").replace(/[^\w.+-]/g, "");
}

/* -------------------------------------------------------------------------- */
/*  Toolbox button                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Add the Hub button to the token controls, the same way ULT's Loading Screen
 * adds its own. In v13 and later `controls` is an object keyed by control name
 * and each control's `tools` an object keyed by tool name. Core rebuilds the
 * controls now and then, so this only ever overwrites its own key.
 */
function registerToolboxButton(controls) {
  if (!controls || typeof controls !== "object") return;

  const group =
    controls.tokens ??
    controls.token ??
    Object.values(controls).find((g) => g?.name === "tokens" || g?.name === "token");
  if (!group) return;

  group.tools ??= {};

  if (!getSetting("showToolbox")) {
    delete group.tools.ulthubOpen;
    return;
  }

  const updates = game.user?.isGM ? countUpdates() : 0;
  group.tools.ulthubOpen = {
    name: "ulthubOpen",
    title: updates > 0 ? fmt("ULTHUB.Toolbox.OpenWithUpdates", { count: updates }) : loc("ULTHUB.Toolbox.Open"),
    icon: updates > 0 ? "fa-solid fa-circle-arrow-up" : "fa-solid fa-diagram-project",
    order: Object.keys(group.tools).length + 1,
    button: true,
    visible: true,
    onChange: () => ModuleHub.open()
  };
}

function refreshControls() {
  try {
    ui.controls?.initialize?.();
  } catch (err) {
    /* purely cosmetic: the tooltip stays as it was */
  }
}

/* -------------------------------------------------------------------------- */
/*  Background check                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Mention each new version once. What has been mentioned is remembered by
 * module id and version, so the same update never nags twice, but a newer
 * release after it does get its own message.
 */
async function notifyNewVersions() {
  const pending = collectRows().filter((row) => row.info.installed && row.update.kind === "update");
  if (pending.length === 0) return;

  const seen = getSetting("notified") ?? {};
  const fresh = pending.filter((row) => seen[row.entry.id] !== row.update.latest.version);
  if (fresh.length === 0) return;

  const list = fresh.map((row) => `${row.entry.title} ${cleanVersion(row.update.latest.version)}`).join(", ");
  ui.notifications?.info(fmt("ULTHUB.Notify.UpdatesAvailable", { list }));

  const next = { ...seen };
  for (const row of fresh) next[row.entry.id] = row.update.latest.version;
  await setSetting("notified", next);
}

async function backgroundCheck() {
  if (!game.user?.isGM) return;
  if (!getSetting("checkOnStart") || isManualOnly()) return;

  try {
    if (isDue()) await checkAll({ force: false });
    await notifyNewVersions();
  } catch (err) {
    console.warn(`${MODULE_ID} | background update check failed`, err);
  }

  refreshControls();
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();

  // Not restricted: players get the same window in its view-only form.
  game.settings.registerMenu(MODULE_ID, "hub", {
    name: "ULTHUB.Hub.MenuName",
    label: "ULTHUB.Hub.MenuLabel",
    hint: "ULTHUB.Hub.MenuHint",
    icon: "fa-solid fa-diagram-project",
    type: ModuleHub,
    restricted: false
  });

  const mod = game.modules?.get?.(MODULE_ID);
  if (mod) {
    mod.api = {
      /** Open the Hub; with a module id, scroll to and highlight that module's tile. */
      open: (moduleId = null) => ModuleHub.open(moduleId),
      /** Same as `open`, named like the other ULT modules' `openHub`. */
      openHub: (moduleId = null) => ModuleHub.open(moduleId),
      /** What the Hub currently knows about every catalog module. */
      getModules: () =>
        collectRows().map(({ entry, info, update }) => ({
          id: entry.id,
          title: info.title,
          installed: info.installed,
          active: info.active,
          version: info.version,
          latest: update.latest?.version ?? null,
          updateAvailable: update.kind === "update"
        })),
      /** Ask GitHub now. Resolves to the number of repositories asked. */
      checkUpdates: (options = {}) => checkAll({ force: Boolean(options.force) }),
      /** The plain-text summary the Hub copies for bug reports. */
      diagnostics: () => buildDiagnostics(),
      /** Exposed for tests and scripting. */
      compareVersions,
      catalog: CATALOG.map((entry) => ({ id: entry.id, title: entry.title }))
    };
  }

  log("init: settings, menu and API registered");
});

Hooks.once("ready", () => {
  window.setTimeout(() => {
    backgroundCheck();
  }, BACKGROUND_CHECK_DELAY_MS);
});

Hooks.on("getSceneControlButtons", (controls) => {
  try {
    registerToolboxButton(controls);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not register the toolbox button`, err);
  }
});
