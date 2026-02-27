import {
  replacePlaylistTracks,
  updatePlaylistDescription,
  type SpotifyTrack,
} from "./spotifyClient.js";
import { getSpotifyConfig } from "./config.js";

function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

export interface PlaylistResult {
  playlistId: string;
  playlistUrl: string;
  trackCount: number;
}

/** Replace tracks in the fixed weekly playlist. */
export async function syncWeeklyPlaylist(
  tracks: SpotifyTrack[],
  dryRun: boolean
): Promise<PlaylistResult> {
  const { playlistId } = getSpotifyConfig();
  const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;

  console.log(`Target playlist: ${playlistId}`);

  if (dryRun) {
    console.log(`[DRY RUN] Would replace ${tracks.length} tracks in playlist ${playlistId}`);
    return { playlistId, playlistUrl, trackCount: tracks.length };
  }

  const uris = tracks.map((t) => t.uri);

  // Update description with this week's run date
  const description = `Monday Morning Likes — auto-updated ${todayDateStr()} — ${tracks.length} tracks`;
  await updatePlaylistDescription(playlistId, description);

  // Replace all tracks
  console.log(`Replacing tracks in playlist ${playlistId}...`);
  await replacePlaylistTracks(playlistId, uris);

  return { playlistId, playlistUrl, trackCount: tracks.length };
}
