import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "./config.js";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export interface RunState {
  lastRunAt: string | null;
  lastPlaylistId: string | null;
  lastPlaylistName: string | null;
  lastTrackCount: number | null;
  lastError: string | null;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Tokens ---

export function loadTokens(): TokenData | null {
  if (!existsSync(config.tokensPath)) return null;
  try {
    const raw = readFileSync(config.tokensPath, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token && typeof data.expires_at === "number") {
      return data as TokenData;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: TokenData): void {
  ensureDir(config.tokensPath);
  writeFileSync(config.tokensPath, JSON.stringify(tokens, null, 2), "utf-8");
}

export function tokensExpired(tokens: TokenData): boolean {
  // Consider expired 60s before actual expiry
  return Date.now() > tokens.expires_at - 60_000;
}

// --- Run state ---

const defaultState: RunState = {
  lastRunAt: null,
  lastPlaylistId: null,
  lastPlaylistName: null,
  lastTrackCount: null,
  lastError: null,
};

export function loadState(): RunState {
  if (!existsSync(config.statePath)) return { ...defaultState };
  try {
    const raw = readFileSync(config.statePath, "utf-8");
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
}

export function saveState(state: RunState): void {
  ensureDir(config.statePath);
  writeFileSync(config.statePath, JSON.stringify(state, null, 2), "utf-8");
}
