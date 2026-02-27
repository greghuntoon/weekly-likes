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
