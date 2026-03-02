import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

let envLoaded = false;

function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = resolve(PROJECT_ROOT, ".env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf-8");
  } catch {
    throw new Error(`.env file not found at ${envPath}. Copy .env.example to .env and fill in your credentials.`);
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

/** Paths are always available. Spotify credentials are loaded lazily via getSpotifyConfig(). */
export const config = {
  dataDir: resolve(PROJECT_ROOT, "data"),
  outputDir: resolve(PROJECT_ROOT, "output"),
  tokensPath: resolve(PROJECT_ROOT, "data", "tokens.json"),
  statePath: resolve(PROJECT_ROOT, "data", "state.json"),
  lastfmCachePath: resolve(PROJECT_ROOT, "data", "lastfm-cache.json"),
  backgroundDenylistPath: resolve(PROJECT_ROOT, "data", "background-denylist.json"),
  spotifySearchCachePath: resolve(PROJECT_ROOT, "data", "spotify-search-cache.json"),
} as const;

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  playlistId: string;
}

let _spotifyConfig: SpotifyConfig | null = null;

/** Load .env and return Spotify credentials. Throws if .env is missing or incomplete. */
export function getSpotifyConfig(): SpotifyConfig {
  if (_spotifyConfig) return _spotifyConfig;
  loadEnv();
  _spotifyConfig = {
    clientId: requireEnv("SPOTIFY_CLIENT_ID"),
    clientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
    redirectUri: requireEnv("SPOTIFY_REDIRECT_URI"),
    scopes: requireEnv("SPOTIFY_SCOPES"),
    playlistId: requireEnv("SPOTIFY_PLAYLIST_ID"),
  };
  return _spotifyConfig;
}

// --- Last.fm ---

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

let _lastfmConfig: LastfmConfig | null = null;

/** Load .env and return Last.fm credentials. */
export function getLastfmConfig(): LastfmConfig {
  if (_lastfmConfig) return _lastfmConfig;
  loadEnv();
  _lastfmConfig = {
    apiKey: requireEnv("LASTFM_API_KEY"),
    username: requireEnv("LASTFM_USERNAME"),
  };
  return _lastfmConfig;
}

// --- Scoring weights ---

export interface ScoringWeights {
  /** Points awarded for being in the Spotify liked set (always 1 for v2 tracks). */
  spotifyLikeWeight: number;
  /** Points per Last.fm play in the 7-day window. */
  lastfmPlayWeight: number;
  /** Multiplier for recency-decayed play score (each play contributes 0–1 based on age). */
  recencyWeight: number;
}

export function getScoringWeights(): ScoringWeights {
  loadEnv();
  return {
    spotifyLikeWeight: parseFloat(process.env["LASTFM_LIKE_WEIGHT"] ?? "5.0"),
    lastfmPlayWeight: parseFloat(process.env["LASTFM_PLAY_WEIGHT"] ?? "1.0"),
    recencyWeight: parseFloat(process.env["LASTFM_RECENCY_WEIGHT"] ?? "0.5"),
  };
}

// --- v2 candidate pool config ---

export interface V2CandidateConfig {
  /** Minimum Last.fm play count for a scrobbled track to enter the candidate pool. */
  lastfmMinPlays: number;
  /** Max number of Last.fm-only candidates to search for on Spotify per run. */
  lastfmMaxCandidates: number;
}

export function getV2CandidateConfig(): V2CandidateConfig {
  loadEnv();
  return {
    lastfmMinPlays: parseInt(process.env["LASTFM_MIN_PLAYS"] ?? "2", 10),
    lastfmMaxCandidates: parseInt(process.env["LASTFM_MAX_CANDIDATES"] ?? "30", 10),
  };
}

// --- Background filter config ---

export interface FilterConfig {
  /** Plays-per-day rate above which a track is flagged as a potential loop. */
  loopPlaysPerDayThreshold: number;
  /** Score penalty applied to flagged tracks. */
  penaltyAmount: number;
  /** If cumulative penalty >= this value, the track is fully suppressed. */
  suppressThreshold: number;
}

export function getFilterConfig(): FilterConfig {
  loadEnv();
  return {
    loopPlaysPerDayThreshold: parseFloat(process.env["BG_LOOP_THRESHOLD"] ?? "4.0"),
    penaltyAmount: parseFloat(process.env["BG_PENALTY"] ?? "3.0"),
    suppressThreshold: parseFloat(process.env["BG_SUPPRESS_THRESHOLD"] ?? "6.0"),
  };
}
