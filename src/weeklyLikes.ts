import { getLikedSongsSince, enrichWithGenres, type SpotifyTrack } from "./spotifyClient.js";
import { djSort } from "./djSort.js";

/** Get liked songs from the last 7 days, deduplicated, genre-enriched, DJ-sorted for flow */
export async function fetchWeeklyLikes(): Promise<SpotifyTrack[]> {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceISO = since.toISOString();

  console.log(`Fetching liked songs since ${sinceISO}...`);
  const tracks = await getLikedSongsSince(sinceISO);

  // Deduplicate by URI, keeping the first (most recent) occurrence
  const seen = new Set<string>();
  const unique: SpotifyTrack[] = [];
  for (const t of tracks) {
    if (!seen.has(t.uri)) {
      seen.add(t.uri);
      unique.push(t);
    }
  }

  console.log(`Found ${unique.length} unique tracks from the last 7 days.`);

  if (unique.length === 0) return unique;

  // Fetch artist genres for smart transitions
  console.log("Fetching artist genres for mix intelligence...");
  await enrichWithGenres(unique);

  // DJ-sort: genre-aware nearest-neighbor walk for smooth transitions
  const mixed = djSort(unique);
  console.log("Tracks DJ-sorted (genre-aware transitions, opener → flow → cooldown).");

  return mixed;
}
