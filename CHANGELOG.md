# Changelog

## 0.1.0 — first version

### Added
- One window with a tile for each ULT module: picture, title, description, installed version and state (active, disabled, not installed, in development).
- Update check against GitHub, remembered for 6 or 24 hours (or only on request). A tile shows "new version available", "up to date" or why the check failed.
- "What's new" on a tile: the text of the newest GitHub release, shown as plain text.
- "Update" and "Install" explain the short way through Foundry's Setup screen; "Install" also copies the module's manifest link. (Foundry cannot install or update modules from inside a running world, so the Hub does not pretend to.)
- "Settings" opens a module's own settings window when the module offers one, otherwise Foundry's settings.
- A warning chip when a module was verified only for an older Foundry version than the one running.
- A copyable summary (Foundry version, system, ULT module versions) for bug reports.
- One notification per new version, for the Game Master only.
- A toolbox button and a settings-page button; both can be hidden.
- View-only mode for players: the ULT modules active in this world, with descriptions.
- Public API for other modules: `game.modules.get("ult-hub").api.open("ult-ls")`.
- English, Russian and German.
