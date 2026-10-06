/**
 * ULT's Module Hub — asking GitHub what the newest release of each module is.
 *
 * Why the GitHub API and not the module's own manifest link: the manifest
 * address (releases/latest/download/module.json) redirects to a storage host
 * that sends no CORS header, so a browser refuses to read it. The API answers
 * with `Access-Control-Allow-Origin: *`. It allows 60 requests an hour per IP
 * without a token, which is why every answer is remembered on this client.
 *
 * Nothing here needs, stores or sends credentials, and the release text is
 * only ever shown as plain text.
 */

import { getSetting, setSetting } from "./settings.js";
import { CATALOG, safeRepo, isGithubUrl } from "./catalog.js";

const API_ROOT = "https://api.github.com/repos/";
const TIMEOUT_MS = 8000;

/** After a failed request, do not try that repository again for this long. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

/** Release notes are trimmed so a huge release cannot flood the window. */
const NOTES_MAX_CHARS = 1600;

/* -------------------------------------------------------------------------- */
/*  Versions                                                                  */
/* -------------------------------------------------------------------------- */

/** "v1.4.1" -> "1.4.1". */
export function normalizeVersion(tag) {
  return String(tag ?? "")
    .trim()
    .replace(/^v/i, "");
}

/**
 * Compare two version strings. Returns 1 when `a` is newer, -1 when older,
 * 0 when equal. A pre-release ("1.5.0-beta") sorts below its release ("1.5.0").
 * Anything that is not a number counts as 0, so odd tags never throw.
 */
export function compareVersions(a, b) {
  const split = (value) => {
    const text = normalizeVersion(value);
    const dash = text.indexOf("-");
    const core = dash === -1 ? text : text.slice(0, dash);
    const pre = dash === -1 ? "" : text.slice(dash + 1);
    const nums = core.split(".").map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, pre };
  };

  const x = split(a);
  const y = split(b);
  const length = Math.max(x.nums.length, y.nums.length);

  for (let i = 0; i < length; i++) {
    const left = x.nums[i] ?? 0;
    const right = y.nums[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  if (x.pre === y.pre) return 0;
  return x.pre > y.pre ? 1 : -1;
}

/* -------------------------------------------------------------------------- */
/*  Cache                                                                     */
/* -------------------------------------------------------------------------- */

function readCache() {
  const cache = getSetting("updateCache");
  return cache && typeof cache === "object" ? cache : {};
}

/** The remembered answer for one repository, or null. */
export function getLatest(repo) {
  const safe = safeRepo(repo);
  return safe ? (readCache()[safe] ?? null) : null;
}

const INTERVAL_HOURS = { h6: 6, h24: 24, manual: 0 };

/** Hours a result stays valid; 0 means "only when asked". */
function intervalHours() {
  const hours = INTERVAL_HOURS[getSetting("checkInterval")];
  return Number.isFinite(hours) ? hours : INTERVAL_HOURS.h6;
}

export function isManualOnly() {
  return intervalHours() === 0;
}

function isFresh(record, now = Date.now()) {
  if (!record || !Number.isFinite(record.fetchedAt)) return false;

  // A good older answer that a later request failed to refresh: wait out the
  // retry delay before asking again instead of retrying on every window open.
  if (Number.isFinite(record.lastTried) && now - record.lastTried < RETRY_AFTER_FAILURE_MS) return true;

  const age = now - record.fetchedAt;
  if (!record.ok) return age < RETRY_AFTER_FAILURE_MS;
  const hours = intervalHours();
  return hours > 0 && age < hours * 3600 * 1000;
}

/** Is any repository in the catalog missing a usable answer right now? */
export function isDue() {
  if (isManualOnly()) return false;
  const now = Date.now();
  return CATALOG.some((entry) => safeRepo(entry.repo) && !isFresh(getLatest(entry.repo), now));
}

/** When the newest successful answer was received, in ms, or null. */
export function lastCheckedAt() {
  const cache = readCache();
  let latest = null;
  for (const record of Object.values(cache)) {
    // "No release published yet" is a real answer from GitHub, not a failure.
    const answered = record?.ok || record?.error === "none";
    if (answered && Number.isFinite(record.fetchedAt)) {
      latest = Math.max(latest ?? 0, record.fetchedAt);
    }
  }
  return latest;
}

/* -------------------------------------------------------------------------- */
/*  Asking GitHub                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the latest published release of one repository.
 * Never throws; a failure comes back as `{ ok: false, error }` with `error`
 * one of "none" (no release yet), "rate" (limit reached), "network", "http".
 */
export async function fetchLatest(repo) {
  const safe = safeRepo(repo);
  if (!safe) return { ok: false, error: "none", fetchedAt: Date.now() };

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_ROOT}${safe}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });

    if (response.status === 404) return { ok: false, error: "none", fetchedAt: Date.now() };
    if (response.status === 403 || response.status === 429) return { ok: false, error: "rate", fetchedAt: Date.now() };
    if (!response.ok) return { ok: false, error: "http", fetchedAt: Date.now() };

    const data = await response.json();
    const tag = typeof data?.tag_name === "string" ? data.tag_name : "";
    if (!tag) return { ok: false, error: "http", fetchedAt: Date.now() };

    return {
      ok: true,
      tag,
      version: normalizeVersion(tag),
      notes: String(data.body ?? "").slice(0, NOTES_MAX_CHARS),
      url: isGithubUrl(data.html_url) ? data.html_url : `https://github.com/${safe}/releases`,
      published: typeof data.published_at === "string" ? data.published_at : "",
      fetchedAt: Date.now()
    };
  } catch (err) {
    return { ok: false, error: "network", fetchedAt: Date.now() };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Refresh every catalog repository whose answer is stale (or all of them with
 * `force`). Requests run side by side; one failing does not affect the rest.
 * Returns the number of repositories that were asked.
 */
export async function checkAll({ force = false } = {}) {
  const now = Date.now();
  const due = CATALOG.filter((entry) => {
    const repo = safeRepo(entry.repo);
    return repo && (force || !isFresh(getLatest(repo), now));
  });
  if (due.length === 0) return 0;

  const results = await Promise.all(due.map(async (entry) => [safeRepo(entry.repo), await fetchLatest(entry.repo)]));

  // Re-read right before writing: another tab or window may have saved meanwhile.
  const cache = { ...readCache() };
  for (const [repo, record] of results) {
    // A failed request must not erase a good older answer; keep it and only
    // note when we last tried, so the retry delay still applies.
    const previous = cache[repo];
    if (!record.ok && previous?.ok) {
      cache[repo] = { ...previous, fetchedAt: previous.fetchedAt, lastFailure: record.error, lastTried: record.fetchedAt };
    } else {
      cache[repo] = record;
    }
  }
  await setSetting("updateCache", cache);
  return due.length;
}

/* -------------------------------------------------------------------------- */
/*  What it means for a tile                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The update situation of one catalog entry.
 *
 *   kind "update"   installed and GitHub has a newer release
 *   kind "current"  installed and up to date
 *   kind "latest"   not installed; `latest` is what would be installed
 *   kind "unknown"  no answer yet
 *   kind "error"    the last request failed (`error` says how)
 *   kind "none"     no repository, or no release published
 */
export function describeUpdate(entry, installedVersion) {
  const repo = safeRepo(entry.repo);
  if (!repo) return { kind: "none" };

  const record = getLatest(repo);
  if (!record) return { kind: "unknown" };

  if (!record.ok) {
    return record.error === "none" ? { kind: "none" } : { kind: "error", error: record.error };
  }

  if (!installedVersion) return { kind: "latest", latest: record };
  return compareVersions(record.version, installedVersion) > 0
    ? { kind: "update", latest: record }
    : { kind: "current", latest: record };
}
