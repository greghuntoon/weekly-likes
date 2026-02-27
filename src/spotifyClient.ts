import { getValidToken } from "./spotifyAuth.js";

const API_BASE = "https://api.spotify.com/v1";
const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Make an authenticated Spotify API request with retry/backoff */
async function spotifyFetch(
  path: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  const token = await getValidToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
    console.log(`Rate limited. Retrying in ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return spotifyFetch(path, options, retries - 1);
  }

  if (res.status >= 500 && retries > 0) {
    const delay = (MAX_RETRIES - retries + 1) * 1000;
    console.log(`Server error ${res.status}. Retrying in ${delay}ms...`);
    await sleep(delay);
    return spotifyFetch(path, options, retries - 1);
  }

  return res;
}

// --- Types ---

export interface SpotifyTrack {
  uri: string;
  id: string;
  name: string;
  artists: string[];
  artistIds: string[];
  genres: string[];      // populated after artist genre lookup
  addedAt: string;
  popularity: number;    // 0-100
  durationMs: number;
}

export interface SpotifyUser {
  id: string;
  display_name: string;
}

// --- API methods ---

export async function getCurrentUser(): Promise<SpotifyUser> {
  const res = await spotifyFetch("/me");
  if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    id: data.id as string,
    display_name: (data.display_name as string) ?? "Unknown",
  };
}

/** Fetch liked songs added after `since` (ISO string). Pages through all results. */
export async function getLikedSongsSince(since: string): Promise<SpotifyTrack[]> {
  const sinceDate = new Date(since).getTime();
  const tracks: SpotifyTrack[] = [];
  let url: string | null = "/me/tracks?limit=50";

  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) throw new Error(`GET liked songs failed: ${res.status}`);

    const data = await res.json() as Record<string, unknown>;
    const items = data.items as Array<Record<string, unknown>>;

    let reachedOlder = false;
    for (const item of items) {
      const addedAt = item.added_at as string | undefined;
      if (!addedAt) continue;

      if (new Date(addedAt).getTime() < sinceDate) {
        reachedOlder = true;
        break;
      }

      const track = item.track as Record<string, unknown> | undefined;
      if (!track || !track.uri) continue;

      const artists = (track.artists as Array<Record<string, unknown>> | undefined) ?? [];
      tracks.push({
        uri: track.uri as string,
        id: track.id as string,
        name: (track.name as string) ?? "Unknown",
        artists: artists.map((a) => (a.name as string) ?? "Unknown"),
        artistIds: artists.map((a) => (a.id as string) ?? ""),
        genres: [],  // filled in by enrichWithGenres
        addedAt,
        popularity: (track.popularity as number) ?? 50,
        durationMs: (track.duration_ms as number) ?? 200_000,
      });
    }

    if (reachedOlder) break;
    url = (data.next as string) ?? null;
  }

  return tracks;
}

/**
 * Batch-fetch artist genres and merge them onto tracks.
 * Spotify GET /artists accepts up to 50 IDs per call.
 */
export async function enrichWithGenres(tracks: SpotifyTrack[]): Promise<void> {
  // Collect unique artist IDs
  const allIds = new Set<string>();
  for (const t of tracks) {
    for (const id of t.artistIds) {
      if (id) allIds.add(id);
    }
  }

  // Fetch in batches of 50
  const idList = [...allIds];
  const genreMap = new Map<string, string[]>();

  for (let i = 0; i < idList.length; i += 50) {
    const batch = idList.slice(i, i + 50);
    const res = await spotifyFetch(`/artists?ids=${batch.join(",")}`);
    if (!res.ok) {
      console.warn(`Warning: artist genre lookup failed (${res.status}), falling back to popularity-only sorting.`);
      return;
    }
    const data = await res.json() as Record<string, unknown>;
    const artistsArr = data.artists as Array<Record<string, unknown>> | undefined;
    if (!artistsArr) continue;

    for (const artist of artistsArr) {
      if (!artist || !artist.id) continue;
      const genres = (artist.genres as string[]) ?? [];
      genreMap.set(artist.id as string, genres);
    }
  }

  // Merge genres onto tracks (union of all artist genres)
  for (const t of tracks) {
    const genreSet = new Set<string>();
    for (const aid of t.artistIds) {
      const g = genreMap.get(aid);
      if (g) g.forEach((genre) => genreSet.add(genre));
    }
    t.genres = [...genreSet];
  }

  const withGenres = tracks.filter((t) => t.genres.length > 0).length;
  console.log(`Genre data enriched: ${withGenres}/${tracks.length} tracks have genre tags.`);
}

/** Update a playlist's description */
export async function updatePlaylistDescription(
  playlistId: string,
  description: string
): Promise<void> {
  const res = await spotifyFetch(`/playlists/${playlistId}`, {
    method: "PUT",
    body: JSON.stringify({ description }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update playlist description failed (${res.status}): ${text}`);
  }
}

/** Replace all tracks in a playlist (max 100 per call, handles batching) */
export async function replacePlaylistTracks(playlistId: string, uris: string[]): Promise<void> {
  const firstBatch = uris.slice(0, 100);
  const res = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: "PUT",
    body: JSON.stringify({ uris: firstBatch }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replace tracks failed (${res.status}): ${text}`);
  }

  for (let i = 100; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const addRes = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
    if (!addRes.ok) {
      const text = await addRes.text();
      throw new Error(`Add tracks batch failed (${addRes.status}): ${text}`);
    }
  }
}
