/**
 * ULT's Module Hub — the catalog and what the Hub can learn about each module.
 *
 * Two sources are combined for every tile:
 *
 *   this file          which modules exist, their icon, where their GitHub
 *                      repository is. Needed to show modules that are not
 *                      installed at all.
 *   game.modules       what this world really has: installed, active, version,
 *                      the Foundry version the author verified it against.
 *
 * To add a module: append an entry to CATALOG and add its description to every
 * file in lang/ as `ULTHUB.Catalog.<key>.Description`. Its picture goes into
 * assets/tiles/<art>.webp (or .png / .jpg), 16:9, ideally 960 x 540.
 *
 * `repo` is "owner/name" on GitHub, or null while a module has no public
 * repository yet (its tile then reads "in development" and offers no install).
 */

export const CATALOG = [
  {
    id: "ult-ls",
    key: "loadingScreen",
    title: "ULT's Loading Screen",
    icon: "fa-solid fa-hourglass-half",
    art: "ult-ls",
    repo: "x4isfate/ult-ls"
  },
  {
    id: "ult-rate",
    key: "sessionRating",
    title: "ULT's Session Rating",
    icon: "fa-solid fa-star",
    art: "ult-rate",
    repo: "x4isfate/ult-rate"
  }
];

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A repository name safe to place in a URL, or null. */
export function safeRepo(repo) {
  return typeof repo === "string" && REPO_PATTERN.test(repo) ? repo : null;
}

export function repoUrl(repo) {
  const safe = safeRepo(repo);
  return safe ? `https://github.com/${safe}` : null;
}

/** The address Foundry's "Install Module" asks for. It never changes between releases. */
export function manifestUrl(repo) {
  const safe = safeRepo(repo);
  return safe ? `https://github.com/${safe}/releases/latest/download/module.json` : null;
}

/** Only ever hand a github.com address from an API answer to an <a href>. */
export function isGithubUrl(url) {
  return typeof url === "string" && /^https:\/\/github\.com\//i.test(url);
}

/**
 * What this world knows about one catalog module.
 * Everything is optional-chained: a missing module is a normal answer here.
 */
export function moduleInfo(entry) {
  const mod = game.modules?.get?.(entry.id) ?? null;
  const installed = Boolean(mod);
  const active = Boolean(mod?.active);
  const version = installed ? String(mod.version ?? "") : "";

  // `compatibility.verified` is "14", "14.360" or similar; only the generation
  // (the major number) decides whether Foundry itself would call it outdated.
  const verified = mod?.compatibility?.verified ?? null;
  const coreGeneration = Number(game.release?.generation ?? String(game.version ?? "").split(".")[0]);
  const verifiedGeneration = verified == null ? NaN : Number(String(verified).split(".")[0]);
  const unverified =
    installed && Number.isFinite(verifiedGeneration) && Number.isFinite(coreGeneration) && verifiedGeneration < coreGeneration;

  return {
    installed,
    active,
    version,
    verified: verified == null ? "" : String(verified),
    coreGeneration: Number.isFinite(coreGeneration) ? coreGeneration : null,
    unverified,
    title: mod?.title || entry.title,
    api: mod?.api ?? null
  };
}

/**
 * Whether a tile can offer "Settings". A module opts in by exposing
 * `api.openHub()` or `api.openSettings()` (ult-ls already has the former).
 */
export function settingsOpener(info) {
  const api = info?.api;
  if (typeof api?.openHub === "function") return () => api.openHub();
  if (typeof api?.openSettings === "function") return () => api.openSettings();
  return null;
}
