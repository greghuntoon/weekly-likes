import type { SpotifyTrack } from "./spotifyClient.js";
import { lookupStats, normalize, type LastFmTrackStats } from "./lastfmClient.js";
import type { ScoringWeights } from "./config.js";

// --- Types ---

export interface ScoredTrack {
  track: SpotifyTrack;
  /** Whether this track came from the Spotify liked set (vs. Last.fm-only candidate). */
  liked: boolean;
  /** Final computed score (before penalties). */
  score: number;
  /** Liked-flag contribution (spotifyLikeWeight if liked, 0 otherwise). */
  likedContrib: number;
  /** Play-count contribution (weight * weeklyPlayCount). */
  playContrib: number;
  /** Recency contribution (weight * recencyDecay). */
  recencyContrib: number;
  /** Raw play count from Last.fm in the 7-day window (0 if not found). */
  weeklyPlayCount: number;
  /** Recency-decayed play score: sum of (1 - age/7d) over each play. */
  recencyDecay: number;
  /** Last.fm stats if a match was found. */
  lastFmStats: LastFmTrackStats | undefined;
  /** Cumulative penalty from background filter (0 = clean). */
  penalty: number;
  /** Human-readable reason codes from the background filter. */
  suppressionReasons: string[];
  /** True if penalty >= suppressThreshold. */
  suppressed: boolean;
}

// --- Scoring ---

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute the recency-decayed score for a set of play timestamps.
 *
 * Each play contributes a value in [0, 1] where 1 = played right now
 * and 0 = played exactly 7 days ago. The sum gives more weight to
 * tracks played frequently *and* recently.
 */
export function computeRecencyDecay(timestamps: number[], now: number): number {
  let decay = 0;
  for (const ts of timestamps) {
    const ageMs = now - ts * 1000; // ts is unix seconds
    decay += Math.max(0, 1 - ageMs / SEVEN_DAYS_MS);
  }
  return decay;
}

/**
 * Compute score components for a single track.
 *
 * @param liked  True if this track is in the Spotify liked set.
 * @param stats  Last.fm stats for this track, if found.
 */
export function computeScore(
  liked: boolean,
  stats: LastFmTrackStats | undefined,
  weights: ScoringWeights,
  now: number
): { score: number; likedContrib: number; playContrib: number; recencyContrib: number; weeklyPlayCount: number; recencyDecay: number } {
  const likedContrib = weights.spotifyLikeWeight * (liked ? 1 : 0);
  const weeklyPlayCount = stats?.playCount ?? 0;
  const recencyDecay = stats ? computeRecencyDecay(stats.timestamps, now) : 0;
  const playContrib = weights.lastfmPlayWeight * weeklyPlayCount;
  const recencyContrib = weights.recencyWeight * recencyDecay;
  const score = likedContrib + playContrib + recencyContrib;
  return { score, likedContrib, playContrib, recencyContrib, weeklyPlayCount, recencyDecay };
}

function scoreTrack(
  track: SpotifyTrack,
  liked: boolean,
  statsMap: Map<string, LastFmTrackStats>,
  weights: ScoringWeights,
  now: number
): ScoredTrack {
  const primaryArtist = track.artists[0] ?? "";
  let resolvedStats = lookupStats(primaryArtist, track.name, statsMap);

  if (!resolvedStats) {
    for (let i = 1; i < track.artists.length; i++) {
      resolvedStats = lookupStats(track.artists[i], track.name, statsMap);
      if (resolvedStats) break;
    }
  }

  const { score, likedContrib, playContrib, recencyContrib, weeklyPlayCount, recencyDecay } =
    computeScore(liked, resolvedStats, weights, now);

  return {
    track,
    liked,
    score,
    likedContrib,
    playContrib,
    recencyContrib,
    weeklyPlayCount,
    recencyDecay,
    lastFmStats: resolvedStats,
    penalty: 0,
    suppressionReasons: [],
    suppressed: false,
  };
}

/**
 * Merge liked + Last.fm-only candidate tracks with Last.fm play data, computing a
 * preference score for each. Returns all tracks sorted by score descending.
 *
 * @param likedTracks      Tracks from Spotify liked set (liked = true).
 * @param statsMap         Aggregated Last.fm play stats.
 * @param weights          Scoring weights.
 * @param lastfmOnlyTracks Additional candidates from Last.fm not in the liked set (liked = false).
 */
export function mergeAndScore(
  likedTracks: SpotifyTrack[],
  statsMap: Map<string, LastFmTrackStats>,
  weights: ScoringWeights,
  lastfmOnlyTracks: SpotifyTrack[] = []
): ScoredTrack[] {
  const now = Date.now();

  const scored: ScoredTrack[] = [
    ...likedTracks.map((t) => scoreTrack(t, true, statsMap, weights, now)),
    ...lastfmOnlyTracks.map((t) => scoreTrack(t, false, statsMap, weights, now)),
  ];

  // Sort by score descending (highest preference first)
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Return a brief match summary for logging.
 */
export function matchSummary(scored: ScoredTrack[]): string {
  const matched = scored.filter((s) => s.lastFmStats !== undefined).length;
  const likedCount = scored.filter((s) => s.liked).length;
  const lfmOnlyCount = scored.filter((s) => !s.liked).length;
  const artistNorms = new Set(scored.map((s) => normalize(s.track.artists[0] ?? "")));
  return (
    `${matched}/${scored.length} tracks matched in Last.fm` +
    ` (${likedCount} liked, ${lfmOnlyCount} Last.fm-only, ${artistNorms.size} unique artists)`
  );
}
