import { readFileSync, existsSync } from "fs";
import { config, getFilterConfig, type FilterConfig } from "./config.js";
import { normalize } from "./lastfmClient.js";
import type { ScoredTrack } from "./mergeAndScore.js";

// --- Keyword lists ---

/**
 * Genre/tag keywords that indicate a track is likely used as background audio
 * rather than intentional listening. Matched against artist name, track name,
 * album name, and genre tags.
 */
const BACKGROUND_KEYWORDS = [
  "ambient",
  "binaural",
  "focus",
  "study",
  "concentration",
  "white noise",
  "brown noise",
  "pink noise",
  "rain sounds",
  "nature sounds",
  "meditation",
  "relaxation",
  "sleep",
  "lofi",
  "lo fi",
  "chillhop",
  "soundtrack",
  "score",
  "bgm",
  "background music",
  "work music",
  "productivity",
  "spa",
  "yoga",
  "mindfulness",
  "deep work",
  "pomodoro",
  "focus music",
  "study music",
  "white noise for",
  "rain for",
];

// --- Denylist ---

interface DenylistEntry {
  artist?: string;
  track?: string;
  reason?: string;
}

let _denylist: DenylistEntry[] | null = null;

function loadDenylist(): DenylistEntry[] {
  if (_denylist !== null) return _denylist;
  if (!existsSync(config.backgroundDenylistPath)) {
    _denylist = [];
    return _denylist;
  }
  try {
    const raw = readFileSync(config.backgroundDenylistPath, "utf-8");
    _denylist = JSON.parse(raw) as DenylistEntry[];
  } catch {
    _denylist = [];
  }
  return _denylist;
}

/** Reset the denylist cache (useful in tests). */
export function resetDenylistCache(): void {
  _denylist = null;
}

// --- Heuristics ---

/**
 * Check if a string contains any background keyword.
 * Uses normalized comparison.
 */
export function containsBackgroundKeyword(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const kw of BACKGROUND_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return undefined;
}

/**
 * Detect if a track appears to be on a "loop" — many plays crammed into a
 * short session, typical of work-background or sleep-aid behavior.
 *
 * Returns true if plays/day exceeds threshold AND at least 3 plays occurred.
 */
export function isLikelyLoop(
  timestamps: number[],
  cfg: FilterConfig
): boolean {
  if (timestamps.length < 3) return false;

  const sorted = [...timestamps].sort((a, b) => a - b);
  const windowSec = sorted[sorted.length - 1] - sorted[0];
  const windowDays = Math.max(windowSec / 86400, 1 / 24); // at least 1 hour
  const playsPerDay = timestamps.length / windowDays;

  return playsPerDay >= cfg.loopPlaysPerDayThreshold;
}

/**
 * Check a track against the manual denylist.
 * Matches on normalized artist and/or track name.
 */
function matchesDenylist(
  artistNorm: string,
  trackNorm: string,
  denylist: DenylistEntry[]
): DenylistEntry | undefined {
  for (const entry of denylist) {
    const artistMatch = entry.artist ? normalize(entry.artist) === artistNorm : true;
    const trackMatch = entry.track ? normalize(entry.track) === trackNorm : true;
    if (artistMatch && trackMatch) return entry;
  }
  return undefined;
}

// --- Main filter ---

/**
 * Apply background-noise suppression heuristics to a list of scored tracks.
 *
 * Mutates each ScoredTrack in place:
 * - Adds reason codes to `suppressionReasons`
 * - Increases `penalty`
 * - Sets `suppressed = true` if penalty >= threshold
 *
 * Returns the same array (for chaining).
 */
export function applyBackgroundFilter(
  scored: ScoredTrack[],
  cfg?: FilterConfig
): ScoredTrack[] {
  const filterCfg = cfg ?? getFilterConfig();
  const denylist = loadDenylist();

  for (const s of scored) {
    const { track, lastFmStats } = s;
    const primaryArtist = track.artists[0] ?? "";
    const artistNorm = normalize(primaryArtist);
    const trackNorm = normalize(track.name);

    // 1. Keyword check: track name
    const trackKw = containsBackgroundKeyword(track.name);
    if (trackKw) {
      s.suppressionReasons.push(`keyword:track("${trackKw}")`);
      s.penalty += filterCfg.penaltyAmount;
    }

    // 2. Keyword check: artist name
    const artistKw = containsBackgroundKeyword(primaryArtist);
    if (artistKw) {
      s.suppressionReasons.push(`keyword:artist("${artistKw}")`);
      s.penalty += filterCfg.penaltyAmount;
    }

    // 3. Keyword check: genre tags from Spotify
    for (const genre of track.genres) {
      const genreKw = containsBackgroundKeyword(genre);
      if (genreKw) {
        s.suppressionReasons.push(`keyword:genre("${genre}")`);
        s.penalty += filterCfg.penaltyAmount * 0.5; // half penalty for genre
        break; // only penalize once even if multiple genre tags match
      }
    }

    // 4. Keyword check: Last.fm album name (often revealing for background playlists)
    if (lastFmStats) {
      // We don't have album on ScoredTrack, but we stored stats; check artist name via stats
      const statsArtistKw = containsBackgroundKeyword(lastFmStats.artist);
      if (statsArtistKw && !artistKw) {
        // Avoid double-counting if we already flagged the artist
        s.suppressionReasons.push(`keyword:lfm-artist("${statsArtistKw}")`);
        s.penalty += filterCfg.penaltyAmount * 0.5;
      }
    }

    // 5. Loop detection via Last.fm play pattern
    if (lastFmStats && isLikelyLoop(lastFmStats.timestamps, filterCfg)) {
      s.suppressionReasons.push(
        `loop(${lastFmStats.playCount}plays/${Math.ceil(lastFmStats.timestamps.length / filterCfg.loopPlaysPerDayThreshold)}d)`
      );
      s.penalty += filterCfg.penaltyAmount;
    }

    // 6. Denylist check
    const denyEntry = matchesDenylist(artistNorm, trackNorm, denylist);
    if (denyEntry) {
      const reason = denyEntry.reason ? `denylist(${denyEntry.reason})` : "denylist";
      s.suppressionReasons.push(reason);
      s.penalty += filterCfg.suppressThreshold; // immediate full suppress
    }

    // Apply suppression decision
    if (s.penalty >= filterCfg.suppressThreshold) {
      s.suppressed = true;
    }
  }

  const suppressed = scored.filter((s) => s.suppressed).length;
  const penalized = scored.filter((s) => !s.suppressed && s.penalty > 0).length;
  if (suppressed > 0 || penalized > 0) {
    console.log(
      `[filter] ${suppressed} suppressed, ${penalized} penalized (partial penalty applied).`
    );
  }

  return scored;
}
