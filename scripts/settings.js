/**
 * ULT's Module Hub — settings.
 *
 * Deliberately few. Every visible setting is per client (each person decides
 * for their own browser); the two hidden ones are this client's memory of what
 * GitHub said last time, so the Hub does not ask again on every window open.
 */

export const MODULE_ID = "ult-hub";

/** Fallbacks used when a setting cannot be read (before `init` has registered it). */
const DEFAULTS = {
  checkOnStart: true,
  checkInterval: "h6",
  showToolbox: true,
  tileSize: "large",
  updateCache: {},
  notified: {}
};

export function getSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (err) {
    return DEFAULTS[key];
  }
}

export async function setSetting(key, value) {
  try {
    return await game.settings.set(MODULE_ID, key, value);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not save setting "${key}"`, err);
    return undefined;
  }
}

/** Ask core to rebuild the scene controls so the Hub button follows the setting. */
function refreshControls() {
  try {
    ui.controls?.initialize?.();
  } catch (err) {
    /* purely cosmetic */
  }
}

/** Redraw the Hub window if it is open, so a changed tile size applies at once. */
function refreshHub() {
  try {
    const app = foundry.applications.instances?.get?.("ulthub-hub");
    if (app?.rendered) app.render();
  } catch (err) {
    /* nothing to redraw */
  }
}

export function registerSettings() {
  game.settings.register(MODULE_ID, "checkOnStart", {
    name: "ULTHUB.Settings.CheckOnStart.Name",
    hint: "ULTHUB.Settings.CheckOnStart.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS.checkOnStart
  });

  game.settings.register(MODULE_ID, "checkInterval", {
    name: "ULTHUB.Settings.CheckInterval.Name",
    hint: "ULTHUB.Settings.CheckInterval.Hint",
    scope: "client",
    config: true,
    type: String,
    // Not plain numbers: JavaScript lists integer-like keys in numeric order,
    // which would put "only when I ask" (0) first in the drop-down.
    choices: {
      h6: "ULTHUB.Settings.CheckInterval.Six",
      h24: "ULTHUB.Settings.CheckInterval.Day",
      manual: "ULTHUB.Settings.CheckInterval.Manual"
    },
    default: DEFAULTS.checkInterval
  });

  game.settings.register(MODULE_ID, "showToolbox", {
    name: "ULTHUB.Settings.ShowToolbox.Name",
    hint: "ULTHUB.Settings.ShowToolbox.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS.showToolbox,
    onChange: refreshControls
  });

  game.settings.register(MODULE_ID, "tileSize", {
    name: "ULTHUB.Settings.TileSize.Name",
    hint: "ULTHUB.Settings.TileSize.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      large: "ULTHUB.Settings.TileSize.Large",
      compact: "ULTHUB.Settings.TileSize.Compact"
    },
    default: DEFAULTS.tileSize,
    onChange: refreshHub
  });

  game.settings.register(MODULE_ID, "updateCache", {
    scope: "client",
    config: false,
    type: Object,
    default: DEFAULTS.updateCache
  });

  game.settings.register(MODULE_ID, "notified", {
    scope: "client",
    config: false,
    type: Object,
    default: DEFAULTS.notified
  });
}
