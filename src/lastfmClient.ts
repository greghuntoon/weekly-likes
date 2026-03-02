import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { config, getLastfmConfig } from "./config.js";

const API_BASE = "https://ws.audioscrobbler.com/2.0/";
const MAX_RETRIES = 3;
const PAGE_DELAY_MS = 250;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- Types ---

export interface LastFmPlay {
  artist: string;
  track: string;
  album: string;
  timestamp: number; // unix seconds
}

export interface LastFmCache {
  generatedAt: string;
  user: string;
  from: number;
  to: number;
  plays: LastFmPlay[];
}

export interface LastFmTrackStats {
  artist: string;
  artistNorm: string;
  track: string;
  trackNorm: string;
  playCount: number;
  lastPlayedAt: number; // unix seconds (most recent)
  timestamps: number[]; // all play timestamps in window, unix seconds
}

// --- Normalization ---

/**
 * Normalize an artist or track name for fuzzy matching across services.
 *
 * - Lowercases
 * - Strips feat/ft/with/featuring parentheticals
 * - Strips common remix/live/remaster suffixes
 * - Removes punctuation, collapses whitespace
 */
export function normalize(str: string): string {
  return str
    .toLowerCase()
    // Remove (feat. ...) / [ft. ...] / (with ...) / (featuring ...) blocks
    .replace(/\s*[\(\[](feat|ft|with|featuring|prod)[^\)\]]*[\)\]]/gi, "")
    // Remove (YEAR Remaster/Remix/...) style parentheticals e.g. "(2016 Remaster)"
    .replace(/\s*[\(\[]\d{4}\s*(remaster(ed)?|remix|edition|version|deluxe|live|acoustic|reissue)[^\)\]]*[\)\]]/gi, "")
    // Remove trailing " - Remix", " - Live", " - Remastered", etc.
    .replace(/\s*-\s*(remix|remaster(ed)?|live|acoustic|radio\s*edit|edit|version|deluxe|bonus\s*track|instrumental|extended|original\s*mix)\b.*/gi, "")
    // Remove non-alphanumeric except spaces
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- HTTP helpers ---

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function lastfmFetch(
  params: Record<string, string>,
  retries = MAX_RETRIES
): Promise<Record<string, unknown>> {
  const { apiKey } = getLastfmConfig();
  const url = new URL(API_BASE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());

  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
    console.log(`[lastfm] Rate limited. Retrying in ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return lastfmFetch(params, retries - 1);
  }

  if (res.status >= 500 && retries > 0) {
    const delay = (MAX_RETRIES - retries + 1) * 2000;
    console.log(`[lastfm] Server error ${res.status}. Retrying in ${delay}ms...`);
    await sleep(delay);
    return lastfmFetch(params, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Last.fm API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json() as Record<string, unknown>;

  // Last.fm wraps API errors in a 200 with { error: N, message: "..." }
  if (typeof data["error"] === "number") {
    const msg = (data["message"] as string) ?? "Unknown Last.fm API error";
    throw new Error(`Last.fm API error ${data["error"] as number}: ${msg}`);
  }

  return data;
}

// --- Cache helpers ---

function loadCache(): LastFmCache | null {
  if (!existsSync(config.lastfmCachePath)) return null;
  try {
    const raw = readFileSync(config.lastfmCachePath, "utf-8");
    const cache = JSON.parse(raw) as LastFmCache;
    const age = Date.now() - new Date(cache.generatedAt).getTime();
    if (age < CACHE_TTL_MS) return cache;
    return null; // expired
  } catch {
    return null;
  }
}

function saveCache(cache: LastFmCache): void {
  const dir = dirname(config.lastfmCachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(config.lastfmCachePath, JSON.stringify(cache, null, 2), "utf-8");
}

// --- Main API ---

/**
 * Fetch all Last.fm plays for the given user between `from` and `to` (unix seconds).
 * Results are cached to data/lastfm-cache.json for CACHE_TTL_MS.
 */
export async function fetchRecentTracks(
  user: string,
  from: number,
  to: number
): Promise<LastFmPlay[]> {
  // Check cache (match on user + approximate date range within same 6-hour window)
  const cached = loadCache();
  if (cached && cached.user === user && Math.abs(cached.from - from) < 3600 && Math.abs(cached.to - to) < 3600) {
    console.log(`[lastfm] Using cached plays (${cached.plays.length} tracks, cached at ${cached.generatedAt})`);
    return cached.plays;
  }

  console.log(`[lastfm] Fetching recent tracks for ${user} from ${new Date(from * 1000).toISOString()}...`);

  const plays: LastFmPlay[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await lastfmFetch({
      method: "user.getrecenttracks",
      user,
      from: String(from),
      to: String(to),
      limit: "200",
      page: String(page),
    });

    const recenttracks = data["recenttracks"] as Record<string, unknown>;
    const attr = recenttracks["@attr"] as Record<string, string>;
    totalPages = parseInt(attr["totalPages"] ?? "1", 10);

    const rawTracks = recenttracks["track"];
    const tracks = Array.isArray(rawTracks) ? rawTracks : (rawTracks ? [rawTracks] : []);

    for (const t of tracks as Array<Record<string, unknown>>) {
      // Skip "now playing" entry (has @attr.nowplaying but no date)
      const tAttr = t["@attr"] as Record<string, string> | undefined;
      if (tAttr?.["nowplaying"] === "true") continue;

      const dateObj = t["date"] as Record<string, string> | undefined;
      if (!dateObj?.["uts"]) continue;

      const artistObj = t["artist"] as Record<string, string>;
      const albumObj = t["album"] as Record<string, string>;

      plays.push({
        artist: artistObj?.["#text"] ?? "",
        track: (t["name"] as string) ?? "",
        album: albumObj?.["#text"] ?? "",
        timestamp: parseInt(dateObj["uts"], 10),
      });
    }

    if (page < totalPages) {
      await sleep(PAGE_DELAY_MS);
    }
    page++;
  } while (page <= totalPages);

  console.log(`[lastfm] Fetched ${plays.length} plays across ${totalPages} page(s).`);

  const cache: LastFmCache = {
    generatedAt: new Date().toISOString(),
    user,
    from,
    to,
    plays,
  };
  saveCache(cache);

  return plays;
}

/**
 * Aggregate raw play list into per-track stats, keyed by normalized artist+track.
 */
export function aggregatePlays(plays: LastFmPlay[]): Map<string, LastFmTrackStats> {
  const map = new Map<string, LastFmTrackStats>();

  for (const play of plays) {
    const artistNorm = normalize(play.artist);
    const trackNorm = normalize(play.track);
    const key = `${artistNorm}|||${trackNorm}`;

    const existing = map.get(key);
    if (existing) {
      existing.playCount++;
      existing.timestamps.push(play.timestamp);
      if (play.timestamp > existing.lastPlayedAt) {
        existing.lastPlayedAt = play.timestamp;
      }
    } else {
      map.set(key, {
        artist: play.artist,
        artistNorm,
        track: play.track,
        trackNorm,
        playCount: 1,
        lastPlayedAt: play.timestamp,
        timestamps: [play.timestamp],
      });
    }
  }

  return map;
}

// --- Track info ---

export interface LastFmTrackInfo {
  artist: string;
  track: string;
  album: string;
  albumPosition: number | null;
  userPlaycount: number;
  tags: string[];
  /** First paragraph of the Last.fm wiki, plain text, capped at 500 chars. Empty string if unavailable. */
  wikiSummary: string;
}

/**
 * Fetch detailed track info from Last.fm (track.getInfo).
 * Returns null if the track is not found or the API call fails.
 */
export async function getTrackInfo(
  artist: string,
  trackName: string,
  username?: string
): Promise<LastFmTrackInfo | null> {
  try {
    const params: Record<string, string> = {
      method: "track.getinfo",
      artist,
      track: trackName,
      autocorrect: "1",
    };
    if (username) params["username"] = username;

    const data = await lastfmFetch(params);
    const t = data["track"] as Record<string, unknown> | undefined;
    if (!t) return null;

    const albumObj = t["album"] as Record<string, unknown> | undefined;
    const albumTitle = (albumObj?.["title"] as string) ?? "";
    const albumAttr = albumObj?.["@attr"] as Record<string, string> | undefined;
    const albumPosition = albumAttr?.["position"] != null
      ? parseInt(albumAttr["position"], 10)
      : null;

    const userplaycount = parseInt((t["userplaycount"] as string) ?? "0", 10) || 0;

    const tagsObj = t["toptags"] as Record<string, unknown> | undefined;
    const rawTags = tagsObj?.["tag"];
    const tagsArr = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);
    const tags = (tagsArr as Array<Record<string, unknown>>).map((tg) => (tg["name"] as string) ?? "");

    const wikiObj = t["wiki"] as Record<string, unknown> | undefined;
    let wikiSummary = "";
    if (wikiObj?.["summary"]) {
      const raw = (wikiObj["summary"] as string)
        // Strip HTML tags
        .replace(/<[^>]+>/g, "")
        // Remove "Read more on Last.fm" footer (with various separators)
        .replace(/\s*Read more on Last\.fm\s*\.?/gi, "")
        .replace(/\s*User-contributed text is available under.*$/i, "")
        .trim();
      // Take only the first paragraph / first 500 chars
      const firstPara = raw.split(/\n{2,}/)[0] ?? raw;
      wikiSummary = firstPara.length > 500 ? firstPara.slice(0, 497) + "..." : firstPara;
    }

    const artistObj = t["artist"] as Record<string, unknown> | undefined;
    const resolvedArtist = (artistObj?.["name"] as string) ?? artist;
    const resolvedTrack = (t["name"] as string) ?? trackName;

    return {
      artist: resolvedArtist,
      track: resolvedTrack,
      album: albumTitle,
      albumPosition,
      userPlaycount: userplaycount,
      tags,
      wikiSummary,
    };
  } catch {
    return null;
  }
}

/**
 * Look up Last.fm stats for a given Spotify track.
 * Tries exact normalized match first, then a substring containment check.
 */
export function lookupStats(
  artist: string,
  trackName: string,
  statsMap: Map<string, LastFmTrackStats>
): LastFmTrackStats | undefined {
  const artistNorm = normalize(artist);
  const trackNorm = normalize(trackName);
  const exactKey = `${artistNorm}|||${trackNorm}`;

  if (statsMap.has(exactKey)) return statsMap.get(exactKey);

  // Fuzzy fallback: artist must match exactly, track is substring match
  for (const stats of statsMap.values()) {
    if (stats.artistNorm !== artistNorm) continue;
    if (stats.trackNorm.includes(trackNorm) || trackNorm.includes(stats.trackNorm)) {
      return stats;
    }
  }

  return undefined;
}
