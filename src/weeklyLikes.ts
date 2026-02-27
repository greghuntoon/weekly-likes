import { getLikedSongsSince, type SpotifyTrack } from "./spotifyClient.js";

/** Get liked songs from the last 7 days, deduplicated by track URI, sorted by addedAt descending */
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

  // Sort by addedAt descending (most recent first)
  unique.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  console.log(`Found ${unique.length} unique tracks from the last 7 days.`);
  return unique;
}
