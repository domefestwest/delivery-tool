/**
 * update-checker.js — polls GitHub Releases for newer versions of the tool.
 *
 * On launch (and optionally every 6 hours), fetches the latest release tag
 * from github.com/{owner}/{repo}/releases/latest. Compares against the
 * currently-running version. If a newer one exists, the main process emits
 * an 'update:available' event to the renderer.
 *
 * No external dependency — uses Node's built-in https.
 * Network failures and rate limits are silently swallowed (this is a
 * best-effort convenience, not a critical path).
 */

const https = require('https');

const REPO_OWNER = 'domefestwest';
const REPO_NAME = 'delivery-tool';
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Compare two semver-ish version strings.
 * Returns: -1 (a < b), 0 (equal), 1 (a > b).
 * Pre-release suffixes (e.g. -beta, -rc1) are treated as LOWER than no-suffix.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const cleaned = String(v || '').replace(/^v/, '');
    const [main, pre] = cleaned.split('-');
    const nums = main.split('.').map(n => parseInt(n, 10) || 0);
    return { nums, pre: pre || null };
  };
  const pa = parse(a);
  const pb = parse(b);

  const maxLen = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < maxLen; i++) {
    const ai = pa.nums[i] || 0;
    const bi = pb.nums[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  // Main versions equal — check pre-release suffix
  if (pa.pre === pb.pre) return 0;
  if (pa.pre && !pb.pre) return -1; // 1.0.0-beta < 1.0.0
  if (!pa.pre && pb.pre) return 1;  // 1.0.0 > 1.0.0-beta
  return pa.pre.localeCompare(pb.pre);
}

/**
 * Make a single HTTPS GET request to the GitHub API.
 * Resolves with parsed JSON or { error }.
 */
function fetchGitHub(url, timeoutMs = 8000) {
  return new Promise(resolve => {
    const opts = {
      headers: {
        'User-Agent': `${REPO_OWNER}-delivery-tool-update-check`,
        Accept: 'application/vnd.github+json',
      },
    };
    const req = https.get(url, opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({ error: `HTTP ${res.statusCode}` });
          }
          resolve(JSON.parse(body));
        } catch (err) {
          resolve({ error: 'Parse error: ' + err.message });
        }
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ error: 'Timeout' });
    });
  });
}

/**
 * Fetch latest release info from GitHub.
 * Returns { ok, tagName, htmlUrl, name, publishedAt, body } or { error }.
 *
 * Note: GitHub's /releases/latest excludes pre-releases by default. We
 * also check /releases (which includes pre-releases) and prefer the
 * highest version found across both, since we're publishing pre-releases
 * during 0.x.
 */
async function getLatestRelease() {
  // Get all releases (includes pre-releases) — first 30, which is plenty for picking the highest
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`;
  const data = await fetchGitHub(url);
  if (data.error) return { error: data.error };
  if (!Array.isArray(data) || data.length === 0) {
    return { error: 'No releases found' };
  }

  // Sort by tag version descending; take highest
  const sorted = [...data].sort((a, b) =>
    compareVersions(b.tag_name, a.tag_name));
  const latest = sorted[0];

  return {
    ok: true,
    tagName:     latest.tag_name,
    htmlUrl:     latest.html_url,
    name:        latest.name,
    publishedAt: latest.published_at,
    prerelease:  latest.prerelease,
    body:        latest.body || '',
  };
}

/**
 * Check if a newer release exists than the current version.
 * Returns { hasUpdate: bool, current, latest, release } or { error }.
 */
async function checkForUpdate(currentVersion) {
  const release = await getLatestRelease();
  if (release.error) return { error: release.error };
  const cmp = compareVersions(currentVersion, release.tagName);
  return {
    hasUpdate: cmp < 0,
    current:   currentVersion,
    latest:    release.tagName,
    release,
  };
}

/**
 * Schedule periodic checks. Calls back with the result each time.
 * Returns a stop function.
 */
function schedulePeriodicCheck(currentVersion, onResult, intervalMs = POLL_INTERVAL_MS) {
  let cancelled = false;
  let timer = null;

  const tick = async () => {
    if (cancelled) return;
    const result = await checkForUpdate(currentVersion);
    if (cancelled) return;
    try { onResult(result); } catch (_) {}
    timer = setTimeout(tick, intervalMs);
  };

  // First check after a 2-second delay to let app finish starting
  timer = setTimeout(tick, 2000);

  return () => {
    cancelled = true;
    if (timer) { clearTimeout(timer); timer = null; }
  };
}

module.exports = {
  compareVersions,
  getLatestRelease,
  checkForUpdate,
  schedulePeriodicCheck,
};
