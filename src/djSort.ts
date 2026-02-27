import type { SpotifyTrack } from "./spotifyClient.js";

/**
 * Genre-aware DJ sort.
 *
 * Problem: a weekly likes list can span metal, classical, country, reggae.
 * Dropping them in random or popularity order creates jarring whiplash.
 *
 * Solution: treat tracks as nodes in a graph where the "distance" between two
 * tracks is how different they sound (genre overlap + popularity gap + duration).
 * Walk the graph via nearest-neighbor to create the smoothest path through
 * wildly different genres.
 *
 * Flow:
 * 1. Start with a mid-energy track (approachable opener)
 * 2. At each step, pick the most similar unvisited track
 * 3. This naturally clusters genres together while creating gentle transitions
 *    at boundaries (metal → hard rock → alt rock → indie → folk, etc.)
 * 4. Final pass separates back-to-back same-artist tracks
 */
export function djSort(tracks: SpotifyTrack[]): SpotifyTrack[] {
  if (tracks.length <= 2) return tracks;

  // Precompute genre sets for each track
  const genreSets = tracks.map((t) => new Set(t.genres));

  // Pick opener: track closest to median popularity (approachable start)
  const sortedPops = tracks.map((t) => t.popularity).sort((a, b) => a - b);
  const medianPop = sortedPops[Math.floor(sortedPops.length / 2)];
  let startIdx = 0;
  let startDist = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const d = Math.abs(tracks[i].popularity - medianPop);
    if (d < startDist) {
      startDist = d;
      startIdx = i;
    }
  }

  // Nearest-neighbor walk
  const visited = new Set<number>();
  const order: number[] = [startIdx];
  visited.add(startIdx);

  while (order.length < tracks.length) {
    const current = order[order.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < tracks.length; i++) {
      if (visited.has(i)) continue;
      const d = trackDistance(tracks[current], genreSets[current], tracks[i], genreSets[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    order.push(bestIdx);
    visited.add(bestIdx);
  }

  // Final pass: prevent back-to-back same artist
  const result = order.map((i) => tracks[i]);
  return separateArtists(result);
}

/**
 * Distance between two tracks (lower = more similar = better transition).
 *
 * - Genre distance (Jaccard, weight 0.60): biggest factor for whiplash
 * - Popularity gap (weight 0.25): energy-level smoothness
 * - Duration gap (weight 0.15, capped): pacing flow
 * - Same-artist bonus (-0.3): cluster features/collabs together naturally
 */
function trackDistance(
  a: SpotifyTrack, aGenres: Set<string>,
  b: SpotifyTrack, bGenres: Set<string>
): number {
  // Genre: Jaccard distance
  let genreDist = 1.0;
  if (aGenres.size > 0 && bGenres.size > 0) {
    let intersection = 0;
    for (const g of aGenres) {
      if (bGenres.has(g)) intersection++;
    }
    const union = aGenres.size + bGenres.size - intersection;
    genreDist = union > 0 ? 1 - intersection / union : 1;
  } else if (aGenres.size === 0 && bGenres.size === 0) {
    genreDist = 0.5; // both unknown — neutral
  }

  // Popularity gap (0-1)
  const popDist = Math.abs(a.popularity - b.popularity) / 100;

  // Duration gap (capped at 0.3)
  const durDist = Math.min(0.3, Math.abs(a.durationMs - b.durationMs) / 600_000);

  // Same-artist bonus: pull same-artist tracks closer
  const artistBonus = a.artists.some((art) => b.artists.includes(art)) ? -0.3 : 0;

  return genreDist * 0.6 + popDist * 0.25 + durDist * 0.15 + artistBonus;
}

/** Push consecutive same-artist tracks apart by swapping with nearest different-artist track */
function separateArtists(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const result = [...tracks];

  for (let i = 1; i < result.length; i++) {
    if (shareArtist(result[i], result[i - 1])) {
      let swapIdx = -1;
      for (let j = i + 1; j < result.length; j++) {
        const conflictsPrev = shareArtist(result[j], result[i - 1]);
        const conflictsNext = i + 1 < result.length ? shareArtist(result[j], result[i + 1]) : false;
        if (!conflictsPrev && !conflictsNext) {
          swapIdx = j;
          break;
        }
      }
      if (swapIdx !== -1) {
        [result[i], result[swapIdx]] = [result[swapIdx], result[i]];
      }
    }
  }

  return result;
}

function shareArtist(a: SpotifyTrack, b: SpotifyTrack): boolean {
  return a.artists.some((artist) => b.artists.includes(artist));
}
