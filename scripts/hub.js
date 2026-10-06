/**
 * ULT's Module Hub — the window.
 *
 * One ApplicationV2 window with a grid of tiles, one tile per catalog module.
 *
 *   Game Master   sees every catalog module, installed or not, with versions,
 *                 update status, release notes and the buttons that act on them.
 *   Players       see only the ULT modules that are active in this world, with a
 *                 picture, a title and a description. View only.
 *
 * Built as plain DOM, not Handlebars, the same way ULT's Loading Screen builds
 * its Hub: a template file that fails to resolve fails silently, plain DOM
 * cannot.
 *
 * What the Hub cannot do, on purpose: install or update a module. Foundry only
 * does that from the Setup screen, so the "Update" and "Install" buttons explain
 * the steps and copy the manifest link instead of pretending.
 */

import { MODULE_ID, getSetting } from "./settings.js";
import { CATALOG, moduleInfo, settingsOpener, safeRepo, repoUrl, manifestUrl, isGithubUrl } from "./catalog.js";
import { checkAll, describeUpdate, getLatest, isDue, isManualOnly, lastCheckedAt } from "./updates.js";
import { el, loc, fmt, button, copyText, relativeTime, formatDate, markdownToPlain } from "./dom.js";

const HUB_ID = "ulthub-hub";
const GITHUB_URL = "https://github.com/x4isfate/ult-hub";
const IMAGE_EXTENSIONS = ["webp", "png", "jpg"];

/* -------------------------------------------------------------------------- */
/*  Data                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything a tile needs, gathered once per render. */
export function collectRows() {
  return CATALOG.map((entry) => {
    const info = moduleInfo(entry);
    const update = describeUpdate(entry, info.installed ? info.version : "");
    return { entry, info, update };
  });
}

export function countUpdates(rows = collectRows()) {
  return rows.filter((row) => row.info.installed && row.update.kind === "update").length;
}

/** Plain-text summary for bug reports. Always English, so it reads the same to everyone. */
export function buildDiagnostics() {
  const lines = [];
  const self = game.modules?.get?.(MODULE_ID);
  const active = Array.from(game.modules?.values?.() ?? []).filter((m) => m.active).length;

  lines.push(`ULT's Module Hub ${self?.version ?? "?"}`);
  lines.push(`Foundry VTT ${game.version ?? "?"} (generation ${game.release?.generation ?? "?"}, build ${game.release?.build ?? "?"})`);
  lines.push(`System: ${`${game.system?.id ?? "?"} ${game.system?.version ?? ""}`.trim()}`);
  lines.push(`Interface language: ${game.i18n?.lang ?? "?"}`);
  lines.push(`Active modules: ${active}`);
  lines.push("");
  lines.push("ULT modules:");

  for (const { entry, info, update } of collectRows()) {
    let text;
    if (!info.installed) {
      text = "not installed";
    } else {
      const parts = [info.version || "unknown version", info.active ? "active" : "disabled"];
      if (info.unverified) parts.push(`verified only for Foundry ${info.verified}`);
      if (update.kind === "update") parts.push(`update available: ${update.latest.version}`);
      else if (update.kind === "current") parts.push("up to date");
      text = parts.join(", ");
    }
    lines.push(`- ${entry.title} (${entry.id}): ${text}`);
  }

  return lines.join("\n");
}

/** Open Foundry's own settings window, for modules that offer no window of their own. */
function openGenericSettings() {
  try {
    const sheet = game.settings?.sheet;
    if (sheet?.render) {
      sheet.render({ force: true });
      return;
    }
    const SettingsConfig = foundry.applications?.settings?.SettingsConfig;
    if (SettingsConfig) {
      new SettingsConfig().render({ force: true });
      return;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | could not open the settings window`, err);
  }
  ui.notifications?.info(loc("ULTHUB.Notify.OpenSettingsManually"));
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                    */
/* -------------------------------------------------------------------------- */

function chip(text, variant = "muted", { icon = null, title = null } = {}) {
  const node = el("span", `ulthub-chip is-${variant}`, { title });
  if (icon) node.appendChild(el("i", icon, { "aria-hidden": "true" }));
  node.appendChild(el("span", null, {}, text));
  return node;
}

/**
 * The picture area of a tile. The picture is the author's own file in
 * assets/tiles/<art>.webp (.png and .jpg are tried too). Until a file exists,
 * or if it fails to load, the tile shows its icon on a plain dark surface, so
 * a missing picture is never a broken-image glyph.
 */
function buildArt(entry) {
  const art = el("div", "ulthub-art");
  art.appendChild(el("i", `ulthub-art-icon ${entry.icon}`, { "aria-hidden": "true" }));

  const img = el("img", "ulthub-art-img", { alt: "", loading: "lazy", draggable: "false" });
  const base = `modules/${MODULE_ID}/assets/tiles/${entry.art}`;
  const route = (path) => foundry.utils?.getRoute?.(path) ?? `/${path}`;

  let index = 0;
  const tryNext = () => {
    if (index >= IMAGE_EXTENSIONS.length) {
      img.remove();
      return;
    }
    img.src = route(`${base}.${IMAGE_EXTENSIONS[index++]}`);
  };

  img.addEventListener("load", () => art.classList.add("has-art"));
  img.addEventListener("error", tryNext);
  art.prepend(img);
  tryNext();

  return art;
}

function tileState(info, entry) {
  if (!info.installed) return safeRepo(entry.repo) ? "missing" : "soon";
  return info.active ? "active" : "disabled";
}

const STATE_CHIP = {
  active: { variant: "success", icon: "fa-solid fa-circle-check", key: "ULTHUB.State.Active" },
  disabled: { variant: "muted", icon: "fa-solid fa-circle-pause", key: "ULTHUB.State.Disabled" },
  missing: { variant: "muted", icon: "fa-solid fa-circle-plus", key: "ULTHUB.State.Missing" },
  soon: { variant: "muted", icon: "fa-solid fa-hammer", key: "ULTHUB.State.Soon" }
};

/* -------------------------------------------------------------------------- */
/*  The window                                                                */
/* -------------------------------------------------------------------------- */

export class ModuleHub extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: HUB_ID,
    classes: ["ulthub-app"],
    tag: "div",
    window: {
      title: "ULTHUB.Hub.Title",
      icon: "fa-solid fa-diagram-project",
      resizable: true
    },
    position: { width: 900, height: 660 }
  };

  /** Which panel is open on which tile: module id -> "notes" | "update" | "install". */
  #panels = new Map();
  #checking = false;
  #autoChecked = false;
  #focusId = null;
  #focusTimer = null;

  constructor(options = {}) {
    super(options);
    this.isGM = Boolean(game.user?.isGM);
  }

  /* ------------------------------------------------------------------ */
  /*  Entry points                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Open the window, or bring the existing one forward. With a module id the
   * matching tile is scrolled into view and briefly highlighted, which is what
   * another module's "open in the Hub" button uses.
   */
  static open(focusId = null) {
    const existing = foundry.applications.instances?.get?.(HUB_ID);
    if (existing?.rendered) {
      existing.bringToFront?.();
      existing.focusModule(focusId);
      return existing;
    }
    const app = new this();
    app.#focusId = focusId;
    app.render({ force: true });
    return app;
  }

  focusModule(id) {
    if (!id) return;
    this.#focusId = id;
    this.#applyFocus();
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  async _renderHTML() {
    const all = collectRows();
    const rows = this.isGM ? all : all.filter((row) => row.info.installed && row.info.active);

    const compact = getSetting("tileSize") === "compact";
    const root = el("div", `ulthub${compact ? " is-compact" : ""}`);

    root.appendChild(this.#buildHeader(all, rows));
    root.appendChild(this.#buildGrid(rows));
    root.appendChild(this.#buildFooter());
    return root;
  }

  async _replaceHTML(result, content) {
    // Keep the scroll position across the redraws a finished update check causes.
    const scroller = content.querySelector(".ulthub-scroll");
    const top = scroller ? scroller.scrollTop : 0;

    content.replaceChildren(result);

    const next = content.querySelector(".ulthub-scroll");
    if (next && top) next.scrollTop = top;

    this.#applyFocus();

    // Once per opened window: bring stale answers up to date in the background.
    if (this.isGM && !this.#autoChecked) {
      this.#autoChecked = true;
      if (isDue()) this.#runCheck(false);
    }
  }

  _onClose(options) {
    window.clearTimeout(this.#focusTimer);
    return super._onClose?.(options);
  }

  /* ------------------------------------------------------------------ */
  /*  Header                                                             */
  /* ------------------------------------------------------------------ */

  #buildHeader(all, rows) {
    const head = el("header", "ulthub-head");

    const text = el("div", "ulthub-head-text");
    text.appendChild(el("h2", "ulthub-title", {}, loc("ULTHUB.Hub.Heading")));

    let summary;
    if (this.isGM) {
      const installed = all.filter((row) => row.info.installed).length;
      summary = fmt("ULTHUB.Hub.Summary", { installed, total: all.length, updates: countUpdates(all) });
    } else {
      summary = fmt("ULTHUB.Hub.SummaryPlayer", { count: rows.length });
    }
    text.appendChild(el("p", "ulthub-summary", {}, summary));
    head.appendChild(text);

    if (this.isGM && CATALOG.some((entry) => safeRepo(entry.repo))) {
      const check = button(loc(this.#checking ? "ULTHUB.Action.Checking" : "ULTHUB.Action.CheckNow"), {
        icon: this.#checking ? "fa-solid fa-rotate ulthub-spin" : "fa-solid fa-rotate",
        title: loc("ULTHUB.Action.CheckNowHint")
      });
      if (this.#checking) check.disabled = true;
      check.addEventListener("click", () => this.#runCheck(true));
      head.appendChild(check);
    }

    return head;
  }

  /* ------------------------------------------------------------------ */
  /*  Tiles                                                              */
  /* ------------------------------------------------------------------ */

  #buildGrid(rows) {
    const scroll = el("div", "ulthub-scroll");

    if (rows.length === 0) {
      scroll.appendChild(el("p", "ulthub-empty", {}, loc("ULTHUB.Hub.Empty")));
      return scroll;
    }

    const grid = el("div", "ulthub-grid");
    for (const row of rows) grid.appendChild(this.#buildTile(row));
    scroll.appendChild(grid);
    return scroll;
  }

  #buildTile(row) {
    const { entry, info, update } = row;
    const state = tileState(info, entry);
    const repo = safeRepo(entry.repo);

    const tile = el("article", `ulthub-tile is-${state}${update.kind === "update" ? " has-update" : ""}`, {
      "data-module": entry.id
    });

    /* --- picture and state --------------------------------------------- */
    const art = buildArt(entry);
    if (this.isGM) {
      const spec = STATE_CHIP[state];
      const badge = el("div", "ulthub-art-badge");
      badge.appendChild(chip(loc(spec.key), spec.variant, { icon: spec.icon }));
      art.appendChild(badge);
    }
    tile.appendChild(art);

    /* --- text ------------------------------------------------------------ */
    const body = el("div", "ulthub-body");
    body.appendChild(el("h3", "ulthub-name", {}, info.title));

    if (this.isGM) {
      const versions = this.#buildVersions(row);
      if (versions.childNodes.length > 0) body.appendChild(versions);
    }

    body.appendChild(el("p", "ulthub-desc", {}, loc(`ULTHUB.Catalog.${entry.key}.Description`)));
    if (state === "soon") body.appendChild(el("p", "ulthub-note", {}, loc("ULTHUB.Soon.Note")));
    tile.appendChild(body);

    /* --- buttons ---------------------------------------------------------- */
    const actions = el("div", "ulthub-actions");

    if (this.isGM) {
      if (update.kind === "update") {
        actions.appendChild(this.#panelButton(tile, row, "update", "ULTHUB.Action.Update", "fa-solid fa-circle-arrow-up", true));
      } else if (state === "missing") {
        actions.appendChild(this.#panelButton(tile, row, "install", "ULTHUB.Action.Install", "fa-solid fa-download", true));
      }

      if (info.installed && info.active) {
        const open = settingsOpener(info) ?? openGenericSettings;
        const settings = button(loc("ULTHUB.Action.Settings"), { icon: "fa-solid fa-gear" });
        settings.addEventListener("click", () => {
          try {
            open();
          } catch (err) {
            console.warn(`${MODULE_ID} | could not open the settings of ${entry.id}`, err);
            ui.notifications?.warn(loc("ULTHUB.Notify.SettingsFailed"));
          }
        });
        actions.appendChild(settings);
      }

      const latest = getLatest(repo);
      if (latest?.ok) {
        actions.appendChild(this.#panelButton(tile, row, "notes", "ULTHUB.Action.WhatsNew", "fa-solid fa-scroll", false));
      }
    }

    const url = repoUrl(repo);
    if (url) {
      const link = el("a", "ulthub-icon-btn ulthub-actions-end", {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        title: loc("ULTHUB.Action.GitHub")
      });
      link.appendChild(el("i", "fa-brands fa-github", { "aria-hidden": "true" }));
      actions.appendChild(link);
    }

    if (actions.childNodes.length > 0) tile.appendChild(actions);

    this.#paintPanel(tile, row);
    return tile;
  }

  /** The version line of a tile: installed version plus one status chip. */
  #buildVersions(row) {
    const { info, update } = row;
    const box = el("div", "ulthub-versions");

    if (info.installed && info.version) box.appendChild(el("span", "ulthub-ver", {}, `v${info.version}`));

    switch (update.kind) {
      case "update":
        box.appendChild(
          chip(fmt("ULTHUB.Version.Available", { version: update.latest.version }), "accent", {
            icon: "fa-solid fa-circle-arrow-up",
            title: loc("ULTHUB.Version.UpdateHint")
          })
        );
        break;
      case "current":
        box.appendChild(chip(loc("ULTHUB.Version.UpToDate"), "success", { icon: "fa-solid fa-check" }));
        break;
      case "latest":
        box.appendChild(chip(fmt("ULTHUB.Version.Latest", { version: update.latest.version }), "muted"));
        break;
      case "error":
        box.appendChild(
          chip(loc("ULTHUB.Version.CheckFailed"), "warn", {
            icon: "fa-solid fa-triangle-exclamation",
            title: loc(`ULTHUB.Status.Error.${update.error}`)
          })
        );
        break;
      case "unknown":
        if (info.installed) box.appendChild(chip(loc("ULTHUB.Version.NotChecked"), "muted"));
        break;
      default:
        break;
    }

    if (info.unverified) {
      box.appendChild(
        chip(fmt("ULTHUB.Compat.Unverified", { core: info.coreGeneration }), "warn", {
          icon: "fa-solid fa-triangle-exclamation",
          title: fmt("ULTHUB.Compat.UnverifiedHint", { verified: info.verified, core: info.coreGeneration })
        })
      );
    }

    return box;
  }

  /* ------------------------------------------------------------------ */
  /*  Panels inside a tile                                               */
  /* ------------------------------------------------------------------ */

  #panelButton(tile, row, kind, labelKey, icon, primary) {
    const b = button(loc(labelKey), { icon, className: primary ? "ulthub-btn is-primary" : "ulthub-btn" });
    b.dataset.panel = kind;
    b.addEventListener("click", () => {
      const id = row.entry.id;
      if (this.#panels.get(id) === kind) this.#panels.delete(id);
      else this.#panels.set(id, kind);
      this.#paintPanel(tile, row);
    });
    return b;
  }

  /** Show, swap or remove the panel at the bottom of one tile, without a full redraw. */
  #paintPanel(tile, row) {
    tile.querySelector(".ulthub-panel")?.remove();

    const kind = this.#panels.get(row.entry.id) ?? null;
    for (const b of tile.querySelectorAll("[data-panel]")) {
      b.classList.toggle("is-open", b.dataset.panel === kind);
    }
    tile.classList.toggle("is-expanded", Boolean(kind));
    if (!kind) return;

    const panel =
      kind === "notes" ? this.#panelNotes(row) : kind === "update" ? this.#panelUpdate(row) : this.#panelInstall(row);
    if (panel) tile.appendChild(panel);
  }

  #panelNotes(row) {
    const latest = getLatest(safeRepo(row.entry.repo));
    if (!latest?.ok) return null;

    const panel = el("div", "ulthub-panel");
    panel.appendChild(el("h4", "ulthub-panel-title", {}, fmt("ULTHUB.Panel.Notes.Title", { tag: latest.tag })));

    const date = formatDate(latest.published);
    if (date) panel.appendChild(el("p", "ulthub-panel-meta", {}, fmt("ULTHUB.Panel.Notes.Published", { date })));

    // textContent, not innerHTML: release notes come from outside this module.
    panel.appendChild(el("pre", "ulthub-notes", {}, markdownToPlain(latest.notes) || loc("ULTHUB.Panel.Notes.Empty")));

    if (isGithubUrl(latest.url)) {
      const link = el("a", "ulthub-link", { href: latest.url, target: "_blank", rel: "noopener noreferrer" });
      link.appendChild(el("i", "fa-solid fa-arrow-up-right-from-square", { "aria-hidden": "true" }));
      link.appendChild(el("span", null, {}, loc("ULTHUB.Panel.Notes.Open")));
      panel.appendChild(link);
    }
    return panel;
  }

  #panelUpdate(row) {
    const latest = row.update.latest;
    const panel = el("div", "ulthub-panel");
    panel.appendChild(el("h4", "ulthub-panel-title", {}, fmt("ULTHUB.Panel.Update.Title", { version: latest.version })));
    panel.appendChild(el("p", "ulthub-panel-text", {}, loc("ULTHUB.Panel.Update.Why")));

    const steps = el("ol", "ulthub-steps");
    for (const key of ["Step1", "Step2", "Step3"]) steps.appendChild(el("li", null, {}, loc(`ULTHUB.Panel.Update.${key}`)));
    panel.appendChild(steps);

    if (isGithubUrl(latest.url)) {
      const link = el("a", "ulthub-link", { href: latest.url, target: "_blank", rel: "noopener noreferrer" });
      link.appendChild(el("i", "fa-solid fa-arrow-up-right-from-square", { "aria-hidden": "true" }));
      link.appendChild(el("span", null, {}, loc("ULTHUB.Panel.Notes.Open")));
      panel.appendChild(link);
    }
    return panel;
  }

  #panelInstall(row) {
    const url = manifestUrl(row.entry.repo);
    if (!url) return null;

    const panel = el("div", "ulthub-panel");
    panel.appendChild(el("h4", "ulthub-panel-title", {}, loc("ULTHUB.Panel.Install.Title")));

    const line = el("div", "ulthub-copyline");
    const input = el("input", "ulthub-copyline-input", {
      type: "text",
      readonly: "",
      value: url,
      "aria-label": loc("ULTHUB.Panel.Install.ManifestLabel")
    });
    input.addEventListener("focus", () => input.select());
    line.appendChild(input);

    const copy = button(loc("ULTHUB.Action.CopyManifest"), { icon: "fa-regular fa-copy" });
    copy.addEventListener("click", async () => {
      const done = await copyText(url);
      if (done) {
        ui.notifications?.info(loc("ULTHUB.Notify.ManifestCopied"));
      } else {
        // Nothing could reach the clipboard: leave the link selected to copy by hand.
        input.focus();
        input.select();
        ui.notifications?.warn(loc("ULTHUB.Notify.CopyFailed"));
      }
    });
    line.appendChild(copy);
    panel.appendChild(line);

    const steps = el("ol", "ulthub-steps");
    for (const key of ["Step1", "Step2", "Step3"]) steps.appendChild(el("li", null, {}, loc(`ULTHUB.Panel.Install.${key}`)));
    panel.appendChild(steps);
    return panel;
  }

  /* ------------------------------------------------------------------ */
  /*  Footer                                                             */
  /* ------------------------------------------------------------------ */

  #buildFooter() {
    const footer = el("footer", "ulthub-footer");

    const status = el("div", "ulthub-status");
    this.#paintStatus(status);
    footer.appendChild(status);

    const brand = el("div", "ulthub-brand");
    brand.appendChild(el("span", null, {}, "ULT's Module Hub"));
    brand.appendChild(el("span", "ulthub-signature", {}, loc("ULTHUB.Footer.Signature")));
    footer.appendChild(brand);

    const actions = el("div", "ulthub-footer-actions");

    const diagnostics = el("button", "ulthub-icon-btn", {
      type: "button",
      title: loc("ULTHUB.Action.Diagnostics")
    });
    diagnostics.appendChild(el("i", "fa-solid fa-clipboard-list", { "aria-hidden": "true" }));
    diagnostics.addEventListener("click", async () => {
      const text = buildDiagnostics();
      if (await copyText(text)) {
        ui.notifications?.info(loc("ULTHUB.Notify.DiagnosticsCopied"));
      } else {
        console.log(`${MODULE_ID} | diagnostics\n${text}`);
        ui.notifications?.warn(loc("ULTHUB.Notify.DiagnosticsFailed"));
      }
    });
    actions.appendChild(diagnostics);

    const github = el("a", "ulthub-icon-btn", {
      href: GITHUB_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      title: loc("ULTHUB.Action.HubGitHub")
    });
    github.appendChild(el("i", "fa-brands fa-github", { "aria-hidden": "true" }));
    actions.appendChild(github);

    footer.appendChild(actions);
    return footer;
  }

  #paintStatus(node) {
    node.replaceChildren();

    if (!this.isGM) {
      node.className = "ulthub-status";
      node.appendChild(el("i", "fa-solid fa-eye", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc("ULTHUB.Status.PlayerView")));
      return;
    }

    if (this.#checking) {
      node.className = "ulthub-status is-busy";
      node.appendChild(el("i", "fa-solid fa-rotate ulthub-spin", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc("ULTHUB.Status.Checking")));
      return;
    }

    // The most recent failure among the repositories, if any.
    let failure = null;
    for (const entry of CATALOG) {
      const record = getLatest(safeRepo(entry.repo));
      const error = record?.ok ? record.lastFailure : record?.error;
      if (error && error !== "none") failure = error;
    }

    const last = lastCheckedAt();
    if (failure) {
      node.className = "ulthub-status is-warn";
      node.appendChild(el("i", "fa-solid fa-triangle-exclamation", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc(`ULTHUB.Status.Error.${failure}`)));
    } else if (last) {
      node.className = "ulthub-status is-ok";
      node.appendChild(el("i", "fa-solid fa-check", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, fmt("ULTHUB.Status.LastChecked", { time: relativeTime(last) })));
    } else {
      node.className = "ulthub-status";
      node.appendChild(el("i", "fa-regular fa-clock", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc(isManualOnly() ? "ULTHUB.Status.ManualOnly" : "ULTHUB.Status.NeverChecked")));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Checking and focus                                                 */
  /* ------------------------------------------------------------------ */

  async #runCheck(force) {
    if (this.#checking) return;
    this.#checking = true;
    if (this.rendered) this.render();

    try {
      await checkAll({ force });
    } catch (err) {
      console.warn(`${MODULE_ID} | update check failed`, err);
    }

    this.#checking = false;
    if (this.rendered) this.render();
  }

  #applyFocus() {
    const id = this.#focusId;
    if (!id || !this.element) return;
    this.#focusId = null;

    const tile = this.element.querySelector(`.ulthub-tile[data-module="${CSS.escape(id)}"]`);
    if (!tile) return;

    tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
    tile.classList.add("is-focused");
    window.clearTimeout(this.#focusTimer);
    this.#focusTimer = window.setTimeout(() => tile.classList.remove("is-focused"), 2200);
  }
}
