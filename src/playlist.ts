import {
  getCurrentUser,
  getUserPlaylists,
  createPlaylist,
  replacePlaylistTracks,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from "./spotifyClient.js";

function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

function playlistName(): string {
  return `BeatFit Weekly - ${todayDateStr()}`;
}

export interface PlaylistResult {
  playlist: SpotifyPlaylist;
  trackCount: number;
  created: boolean;
}

/** Find or create today's weekly playlist, then set its tracks. */
export async function syncWeeklyPlaylist(
  tracks: SpotifyTrack[],
  dryRun: boolean
): Promise<PlaylistResult> {
  const user = await getCurrentUser();
  const name = playlistName();
  console.log(`Target playlist: "${name}"`);

  const playlists = await getUserPlaylists(user.id);
  const existing = playlists.find((p) => p.name === name);

  if (dryRun) {
    if (existing) {
      console.log(`[DRY RUN] Would replace ${tracks.length} tracks in existing playlist ${existing.id}`);
      return { playlist: existing, trackCount: tracks.length, created: false };
    }
    const fakePlaylist: SpotifyPlaylist = {
      id: "dry-run-id",
      name,
      external_urls: { spotify: `https://open.spotify.com/playlist/dry-run-id` },
    };
    console.log(`[DRY RUN] Would create playlist "${name}" with ${tracks.length} tracks`);
    return { playlist: fakePlaylist, trackCount: tracks.length, created: true };
  }

  const uris = tracks.map((t) => t.uri);

  if (existing) {
    console.log(`Found existing playlist: ${existing.id}. Replacing tracks...`);
    await replacePlaylistTracks(existing.id, uris);
    return { playlist: existing, trackCount: tracks.length, created: false };
  }

  console.log("Creating new playlist...");
  const description = `Auto-generated weekly likes for ${todayDateStr()}`;
  const pl = await createPlaylist(user.id, name, description);
  console.log(`Created playlist: ${pl.id}`);

  if (uris.length > 0) {
    await replacePlaylistTracks(pl.id, uris);
  }

  return { playlist: pl, trackCount: tracks.length, created: true };
}
