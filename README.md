# ULT's Module Hub

One window for all of your ULT modules for [Foundry VTT](https://foundryvtt.com): what is installed, in which version, what is new, and a quick way to reach each module's settings. Small on purpose — it visualises what you already have and stays out of the way.

- **Module id:** `ult-hub`
- **Author:** 4isfate
- **License:** MIT
- **Compatibility:** Foundry VTT v13–v14

## Install

In Foundry: **Add-on Modules → Install Module**, paste this into **Manifest URL**, and press Install:

```
https://github.com/x4isfate/ult-hub/releases/latest/download/module.json
```

## What it does

- **Tiles**: one large tile per ULT module with a picture, the title, a short description, the installed version and its state.
- **Updates**: asks GitHub for the newest release of each module and shows "new version available" or "up to date". The answer is remembered (6 or 24 hours, or only when you press the button).
- **What's new**: the text of the newest release, right on the tile.
- **Update / Install**: explains the short way through Foundry's Setup screen and copies the manifest link. Foundry can only install and update modules from the Setup screen, not from inside a running world, so the Hub does not pretend to do it for you.
- **Settings**: opens a module's own settings window (or Foundry's settings for modules without one).
- **Compatibility**: a warning when a module was verified only for an older Foundry version.
- **Bug-report summary**: one click copies the Foundry version, system and ULT module versions.
- **Players** see a view-only version: the ULT modules that are active in this world, with descriptions. Update information is for the Game Master only.
- English, Russian and German.

## Settings

Four, all per person: check when entering the world, how long to remember a check, show the toolbox button, tile size.

## For module authors

Open the Hub, and jump to your own tile, from your module:

```js
const hub = game.modules.get("ult-hub");
if (hub?.active) hub.api.open("ult-ls");   // scrolls to and highlights that tile
```

A tile shows a **Settings** button that calls your module's `api.openHub()` or `api.openSettings()` when one exists; otherwise it opens Foundry's settings window.

```js
const api = game.modules.get("ult-hub").api;
api.open(moduleId?);        // open the Hub (optionally focus one tile)
api.getModules();           // [{ id, title, installed, active, version, latest, updateAvailable }]
api.checkUpdates({ force }) // ask GitHub now; resolves to the number of repositories asked
api.diagnostics();          // the plain-text summary as a string
```

### Adding a module to the catalog

1. Add an entry to `CATALOG` in `scripts/catalog.js` (`id`, `key`, `title`, `icon`, `art`, `repo`).
2. Add `ULTHUB.Catalog.<key>.Description` to every file in `lang/`.
3. Put the picture into `assets/tiles/` (see `assets/tiles/README.txt`).

## Privacy

The only network request is to `api.github.com` (the public "latest release" of each catalog repository). No account, token or personal data is sent or stored. Release text is shown as plain text and links are limited to `github.com`.

## Reporting bugs

<https://github.com/x4isfate/ult-hub/issues>

## License

[MIT](LICENSE) © 2026 4isfate
