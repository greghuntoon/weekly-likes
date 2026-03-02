import { getLikedSongsSince, enrichWithGenres, searchTrack, type SpotifyTrack } from "./spotifyClient.js";
import { djSort } from "./djSort.js";
import { fetchRecentTracks, aggregatePlays, lookupStats, normalize, getTrackInfo } from "./lastfmClient.js";
import { mergeAndScore, matchSummary } from "./mergeAndScore.js";
import { applyBackgroundFilter } from "./backgroundFilter.js";
import { writeReport, printExplainTable, generatePlaylistDescription } from "./report.js";
import { getLastfmConfig, getScoringWeights, getV2CandidateConfig } from "./config.js";

const SEARCH_DELAY_MS = 150; // avoid hammering Spotify search

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface V2PipelineOptions {
  dryRun: boolean;
  explainOnly: boolean;
}

export interface V2PipelineResult {
  allScored: ReturnType<typeof mergeAndScore>;
  finalTracks: SpotifyTrack[];
  playlistDescription: string;
  reportPath: string | null;
}

/**
 * Full v2 pipeline:
 *  1. Fetch Spotify liked tracks (last 7 days) + enrich with genres
 *  2. Fetch Last.fm recent tracks (last 7 days)
 *  3. Find Last.fm-only candidates (played >= minPlays, not liked) and search Spotify for them
 *  4. Merge + score all candidates
 *  5. Apply background-noise filter
 *  6. DJ-sort the non-suppressed set
 *  7. Write markdown report
 */
export async function runWeeklyV2(opts: V2PipelineOptions): Promise<V2PipelineResult> {
  const label = opts.dryRun ? "[DRY RUN] " : "";
  console.log(`\n${label}Starting v2 pipeline...\n`);

  const date = new Date().toISOString().split("T")[0];
  const now = Date.now();
  const sevenDaysAgo = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000); // unix seconds
  const toUnix = Math.floor(now / 1000);

  // --- Step 1: Spotify liked tracks ---
  const sinceISO = new Date(sevenDaysAgo * 1000).toISOString();
  console.log(`Fetching liked songs since ${sinceISO}...`);
  const rawTracks = await getLikedSongsSince(sinceISO);

  // Deduplicate by URI
  const seenUris = new Set<string>();
  const likedTracks: SpotifyTrack[] = [];
  for (const t of rawTracks) {
    if (!seenUris.has(t.uri)) {
      seenUris.add(t.uri);
      likedTracks.push(t);
    }
  }
  console.log(`Found ${likedTracks.length} unique liked tracks.`);

  if (likedTracks.length === 0 ) {
    console.log("No liked songs in the last 7 days. Nothing to do.");
    return { allScored: [], finalTracks: [], playlistDescription: "", reportPath: null };
  }

  console.log("Fetching artist genres...");
  await enrichWithGenres(likedTracks);

  // --- Step 2: Last.fm plays ---
  const { username } = getLastfmConfig();
  const plays = await fetchRecentTracks(username, sevenDaysAgo, toUnix);
  const statsMap = aggregatePlays(plays);
  console.log(`[lastfm] Aggregated ${statsMap.size} unique artist+track combinations.`);

  // --- Step 3: Last.fm-only candidates ---
  const { lastfmMinPlays, lastfmMaxCandidates } = getV2CandidateConfig();

  // Build a normalized name lookup for liked tracks to catch URI-mismatch duplicates
  // (e.g. Spotify returns a regional version with a different URI for the same track)
  const likedNormKeys = new Set(
    likedTracks.map((t) => `${normalize(t.artists[0] ?? "")}|||${normalize(t.name)}`)
  );

  const lastfmOnlyTracks: SpotifyTrack[] = [];
  const candidateStats = [...statsMap.values()]
    .filter((s) => s.playCount >= lastfmMinPlays)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, lastfmMaxCandidates);

  if (candidateStats.length > 0) {
    console.log(
      `[lastfm] Searching Spotify for ${candidateStats.length} Last.fm-only candidates (>= ${lastfmMinPlays} plays)...`
    );
    for (const stats of candidateStats) {
      const found = await searchTrack(stats.artist, stats.track);
      if (!found) continue;

      // URI dedup: skip if already in the liked set by URI
      if (seenUris.has(found.uri)) continue;

      // Name dedup: skip if this is clearly the same track as a liked one
      // (catches regional/version mismatches where URIs differ but it's the same song)
      const foundNormKey = `${normalize(found.artists[0] ?? "")}|||${normalize(found.name)}`;
      if (likedNormKeys.has(foundNormKey)) continue;

      // Relevance check: confirm Last.fm stats actually match this result.
      // If lookupStats returns nothing, the search returned a wrong track (e.g. a
      // "Wheel Of Fortune" query matching Kay Starr instead of the intended artist).
      const confirmedStats = lookupStats(found.artists[0] ?? "", found.name, statsMap);
      if (!confirmedStats) continue;

      seenUris.add(found.uri);
      lastfmOnlyTracks.push(found);
      await sleep(SEARCH_DELAY_MS);
    }
    if (lastfmOnlyTracks.length > 0) {
      console.log(`[lastfm] Enriching ${lastfmOnlyTracks.length} Last.fm-only candidates with genre data...`);
      await enrichWithGenres(lastfmOnlyTracks);
    }
    console.log(`[lastfm] Added ${lastfmOnlyTracks.length} Last.fm-only candidates to pool.`);
  }

  // --- Step 4: Merge + score ---
  const weights = getScoringWeights();
  const allScored = mergeAndScore(likedTracks, statsMap, weights, lastfmOnlyTracks);
  console.log(`[score] ${matchSummary(allScored)}`);

  // --- Step 5: Background filter ---
  applyBackgroundFilter(allScored);

  // --- Step 6: Pin top-scored track as leadoff, DJ-sort the rest ---
  // Sort live tracks by effective score (score - penalty) to find the leadoff
  const liveSorted = allScored
    .filter((s) => !s.suppressed)
    .sort((a, b) => (b.score - b.penalty) - (a.score - a.penalty));

  const leadoffTrack = liveSorted[0]?.track;
  const restTracks = liveSorted.slice(1).map((s) => s.track);
  const djSortedRest = djSort(restTracks);
  const finalTracks: SpotifyTrack[] = leadoffTrack
    ? [leadoffTrack, ...djSortedRest]
    : djSortedRest;

  const suppressedCount = allScored.filter((s) => s.suppressed).length;
  if (leadoffTrack) {
    console.log(
      `Leadoff: "${leadoffTrack.name}" by ${leadoffTrack.artists[0] ?? "Unknown"}. ` +
      `DJ-sorted ${djSortedRest.length} remaining tracks (${suppressedCount} suppressed).`
    );
  } else {
    console.log(`DJ-sorted ${finalTracks.length} tracks (${suppressedCount} suppressed).`);
  }

  // --- Step 7: Fetch track info for leadoff, generate description ---
  let leadoffTrackInfo = null;
  if (leadoffTrack) {
    console.log(`[lastfm] Fetching track info for leadoff: "${leadoffTrack.name}"...`);
    leadoffTrackInfo = await getTrackInfo(leadoffTrack.artists[0] ?? "", leadoffTrack.name, username);
  }

  const playlistDescription = generatePlaylistDescription(allScored, date, leadoffTrackInfo);

  let reportPath: string | null = null;
  if (!opts.dryRun) {
    reportPath = writeReport({ date, allScored, finalTracks });
  }

  if (opts.explainOnly || opts.dryRun) {
    printExplainTable(allScored);
    console.log(`\nPlaylist description: "${playlistDescription}"`);
  }

  return { allScored, finalTracks, playlistDescription, reportPath };
}
