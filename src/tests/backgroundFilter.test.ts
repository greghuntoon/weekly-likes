import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  containsBackgroundKeyword,
  isLikelyLoop,
  applyBackgroundFilter,
  resetDenylistCache,
} from "../backgroundFilter.js";
import type { FilterConfig } from "../config.js";
import type { ScoredTrack } from "../mergeAndScore.js";
import type { SpotifyTrack } from "../spotifyClient.js";

const TEST_CONFIG: FilterConfig = {
  loopPlaysPerDayThreshold: 4,
  penaltyAmount: 3,
  suppressThreshold: 6,
};

function makeTrack(name: string, artist: string, genres: string[] = []): SpotifyTrack {
  return {
    uri: `spotify:track:${name}`,
    id: name,
    name,
    artists: [artist],
    artistIds: ["id1"],
    genres,
    addedAt: new Date().toISOString(),
    popularity: 50,
    durationMs: 200_000,
    album: "",
  };
}

function makeScoredTrack(track: SpotifyTrack): ScoredTrack {
  return {
    track,
    liked: true,
    score: 5,
    likedContrib: 5,
    playContrib: 0,
    recencyContrib: 0,
    weeklyPlayCount: 0,
    recencyDecay: 0,
    lastFmStats: undefined,
    penalty: 0,
    suppressionReasons: [],
    suppressed: false,
  };
}

describe("containsBackgroundKeyword()", () => {
  it("detects 'ambient' keyword", () => {
    assert.ok(containsBackgroundKeyword("ambient music for focus") !== undefined);
  });

  it("detects 'binaural' keyword", () => {
    assert.ok(containsBackgroundKeyword("Binaural Beats for Sleep") !== undefined);
  });

  it("detects 'lofi' keyword", () => {
    assert.ok(containsBackgroundKeyword("lofi hip hop study mix") !== undefined);
  });

  it("returns undefined for regular track names", () => {
    assert.equal(containsBackgroundKeyword("Karma Police"), undefined);
    assert.equal(containsBackgroundKeyword("Hey Ya!"), undefined);
    assert.equal(containsBackgroundKeyword("Bohemian Rhapsody"), undefined);
  });

  it("is case-insensitive", () => {
    assert.ok(containsBackgroundKeyword("AMBIENT STUDY MUSIC") !== undefined);
  });
});

describe("isLikelyLoop()", () => {
  const now = Math.floor(Date.now() / 1000);

  it("returns false for fewer than 3 plays", () => {
    assert.equal(isLikelyLoop([now - 100, now - 50], TEST_CONFIG), false);
  });

  it("detects rapid repeat plays (loop pattern)", () => {
    // 8 plays within 2 hours = 96 plays/day >> threshold of 4
    const timestamps = Array.from({ length: 8 }, (_, i) => now - i * 900); // every 15 min
    assert.equal(isLikelyLoop(timestamps, TEST_CONFIG), true);
  });

  it("does not flag spread-out plays", () => {
    // 4 plays over 6 days = 0.67 plays/day < threshold
    const timestamps = [
      now - 6 * 86400,
      now - 4 * 86400,
      now - 2 * 86400,
      now - 1 * 86400,
    ];
    assert.equal(isLikelyLoop(timestamps, TEST_CONFIG), false);
  });
});

describe("applyBackgroundFilter()", () => {
  it("does not penalize clean tracks", () => {
    resetDenylistCache();
    const s = makeScoredTrack(makeTrack("Karma Police", "Radiohead"));
    applyBackgroundFilter([s], TEST_CONFIG);
    assert.equal(s.penalty, 0);
    assert.equal(s.suppressed, false);
    assert.deepEqual(s.suppressionReasons, []);
  });

  it("penalizes tracks with background keyword in name", () => {
    resetDenylistCache();
    const s = makeScoredTrack(makeTrack("Ambient Study Beats", "Focus Corp"));
    applyBackgroundFilter([s], TEST_CONFIG);
    assert.ok(s.penalty > 0, "expected penalty > 0");
    assert.ok(s.suppressionReasons.length > 0);
  });

  it("suppresses track when penalty meets threshold", () => {
    resetDenylistCache();
    // Track name with keyword + artist name with keyword = 2 * penaltyAmount (3) = 6 >= threshold (6)
    const s = makeScoredTrack(makeTrack("Ambient Focus Music", "Study Music Factory"));
    applyBackgroundFilter([s], TEST_CONFIG);
    assert.equal(s.suppressed, true);
  });

  it("penalizes background genre tag", () => {
    resetDenylistCache();
    const s = makeScoredTrack(makeTrack("Normal Track", "Artist", ["ambient", "electronic"]));
    applyBackgroundFilter([s], TEST_CONFIG);
    assert.ok(s.suppressionReasons.some((r) => r.startsWith("keyword:genre")));
    assert.ok(s.penalty > 0);
    assert.equal(s.suppressed, false); // half penalty only — below threshold
  });

  it("penalizes loop pattern from Last.fm stats", () => {
    resetDenylistCache();
    const now = Math.floor(Date.now() / 1000);
    const s = makeScoredTrack(makeTrack("Work Track", "Artist"));
    // Inject Last.fm stats with a loop pattern (8 plays in 2 hours)
    s.lastFmStats = {
      artist: "Artist",
      artistNorm: "artist",
      track: "Work Track",
      trackNorm: "work track",
      playCount: 8,
      lastPlayedAt: now,
      timestamps: Array.from({ length: 8 }, (_, i) => now - i * 900),
    };
    applyBackgroundFilter([s], TEST_CONFIG);
    assert.ok(s.suppressionReasons.some((r) => r.startsWith("loop(")));
    assert.ok(s.penalty >= TEST_CONFIG.penaltyAmount);
  });

  it("does not mutate unrelated tracks in the array", () => {
    resetDenylistCache();
    const clean = makeScoredTrack(makeTrack("Clean", "Radiohead"));
    const noisy = makeScoredTrack(makeTrack("Ambient Focus", "Study App"));
    applyBackgroundFilter([clean, noisy], TEST_CONFIG);
    assert.equal(clean.penalty, 0);
    assert.equal(clean.suppressed, false);
    assert.ok(noisy.penalty > 0);
  });
});
