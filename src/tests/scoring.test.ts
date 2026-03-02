import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScore, computeRecencyDecay, mergeAndScore } from "../mergeAndScore.js";
import type { ScoringWeights } from "../config.js";
import type { SpotifyTrack } from "../spotifyClient.js";
import type { LastFmTrackStats } from "../lastfmClient.js";

const WEIGHTS: ScoringWeights = {
  spotifyLikeWeight: 5.0,
  lastfmPlayWeight: 1.0,
  recencyWeight: 0.5,
};

const NOW = Date.now();
const HOUR_AGO_S = Math.floor((NOW - 60 * 60 * 1000) / 1000);
const SIX_DAYS_AGO_S = Math.floor((NOW - 6 * 24 * 60 * 60 * 1000) / 1000);

describe("computeRecencyDecay()", () => {
  it("returns 0 for empty timestamps", () => {
    assert.equal(computeRecencyDecay([], NOW), 0);
  });

  it("play 1 hour ago has decay close to 1", () => {
    const decay = computeRecencyDecay([HOUR_AGO_S], NOW);
    assert.ok(decay > 0.98, `expected > 0.98, got ${decay}`);
    assert.ok(decay <= 1.0, `expected <= 1.0, got ${decay}`);
  });

  it("play 6 days ago has decay ~1/7 ≈ 0.14", () => {
    const decay = computeRecencyDecay([SIX_DAYS_AGO_S], NOW);
    assert.ok(decay > 0.1 && decay < 0.2, `expected ~0.14, got ${decay}`);
  });

  it("sums decay across multiple plays", () => {
    const decay = computeRecencyDecay([HOUR_AGO_S, SIX_DAYS_AGO_S], NOW);
    assert.ok(decay > 1.0, `expected > 1.0 for two plays, got ${decay}`);
  });
});

describe("computeScore()", () => {
  it("liked track with no Last.fm data scores exactly spotifyLikeWeight", () => {
    const result = computeScore(true, undefined, WEIGHTS, NOW);
    assert.equal(result.score, WEIGHTS.spotifyLikeWeight);
    assert.equal(result.weeklyPlayCount, 0);
    assert.equal(result.recencyDecay, 0);
  });

  it("unliked track with no Last.fm data scores 0", () => {
    const result = computeScore(false, undefined, WEIGHTS, NOW);
    assert.equal(result.score, 0);
    assert.equal(result.likedContrib, 0);
  });

  it("liked flag doubles score relative to unliked at same play count", () => {
    const stats: LastFmTrackStats = {
      artist: "A",
      artistNorm: "a",
      track: "T",
      trackNorm: "t",
      playCount: 2,
      lastPlayedAt: HOUR_AGO_S,
      timestamps: [HOUR_AGO_S, HOUR_AGO_S - 3600],
    };
    const liked = computeScore(true, stats, WEIGHTS, NOW);
    const unliked = computeScore(false, stats, WEIGHTS, NOW);
    assert.equal(liked.score - unliked.score, WEIGHTS.spotifyLikeWeight);
  });

  it("adds play count contribution", () => {
    const stats: LastFmTrackStats = {
      artist: "Test Artist",
      artistNorm: "test artist",
      track: "Test Track",
      trackNorm: "test track",
      playCount: 3,
      lastPlayedAt: HOUR_AGO_S,
      timestamps: [HOUR_AGO_S, HOUR_AGO_S - 3600, HOUR_AGO_S - 7200],
    };
    const result = computeScore(true, stats, WEIGHTS, NOW);
    assert.equal(result.weeklyPlayCount, 3);
    assert.ok(result.playContrib === 3.0, `expected playContrib=3.0, got ${result.playContrib}`);
    assert.ok(result.score > WEIGHTS.spotifyLikeWeight + 3.0, "score should include recency");
  });

  it("score increases with more plays", () => {
    const makeStats = (count: number): LastFmTrackStats => ({
      artist: "A",
      artistNorm: "a",
      track: "T",
      trackNorm: "t",
      playCount: count,
      lastPlayedAt: HOUR_AGO_S,
      timestamps: Array.from({ length: count }, () => HOUR_AGO_S),
    });
    const score1 = computeScore(true, makeStats(1), WEIGHTS, NOW).score;
    const score5 = computeScore(true, makeStats(5), WEIGHTS, NOW).score;
    assert.ok(score5 > score1, `score5 (${score5}) should exceed score1 (${score1})`);
  });
});

describe("mergeAndScore()", () => {
  const makeTrack = (name: string, artist: string): SpotifyTrack => ({
    uri: `spotify:track:${name}`,
    id: name,
    name,
    artists: [artist],
    artistIds: ["id1"],
    genres: [],
    addedAt: new Date().toISOString(),
    popularity: 50,
    durationMs: 200_000,
    album: "",
  });

  it("returns tracks sorted by score descending", () => {
    const tracks = [makeTrack("Low", "A"), makeTrack("High", "B")];
    const statsMap = new Map<string, LastFmTrackStats>();
    // Give "High" a high play count
    statsMap.set("b|||high", {
      artist: "B",
      artistNorm: "b",
      track: "High",
      trackNorm: "high",
      playCount: 10,
      lastPlayedAt: HOUR_AGO_S,
      timestamps: Array.from({ length: 10 }, () => HOUR_AGO_S),
    });

    const scored = mergeAndScore(tracks, statsMap, WEIGHTS);
    assert.equal(scored[0].track.name, "High");
    assert.equal(scored[1].track.name, "Low");
    assert.ok(scored[0].score > scored[1].score);
  });

  it("liked tracks get like weight, Last.fm-only tracks do not", () => {
    const liked = makeTrack("Liked", "A");
    const lfmOnly = makeTrack("Played", "B");
    const statsMap = new Map<string, LastFmTrackStats>();
    // Both have identical play histories
    const stats: LastFmTrackStats = {
      artist: "X",
      artistNorm: "x",
      track: "x",
      trackNorm: "x",
      playCount: 3,
      lastPlayedAt: HOUR_AGO_S,
      timestamps: [HOUR_AGO_S, HOUR_AGO_S - 3600, HOUR_AGO_S - 7200],
    };
    statsMap.set("a|||liked", { ...stats, artist: "A", artistNorm: "a", track: "Liked", trackNorm: "liked" });
    statsMap.set("b|||played", { ...stats, artist: "B", artistNorm: "b", track: "Played", trackNorm: "played" });

    const scored = mergeAndScore([liked], statsMap, WEIGHTS, [lfmOnly]);
    const likedScored = scored.find((s) => s.track.name === "Liked")!;
    const lfmScored = scored.find((s) => s.track.name === "Played")!;

    assert.ok(likedScored.liked);
    assert.ok(!lfmScored.liked);
    assert.ok(likedScored.score > lfmScored.score, "liked should score higher with same plays");
    assert.ok(
      Math.abs((likedScored.score - lfmScored.score) - WEIGHTS.spotifyLikeWeight) < 0.001,
      `score diff should equal spotifyLikeWeight (${WEIGHTS.spotifyLikeWeight})`
    );
  });

  it("unmatched liked tracks still receive spotify like weight", () => {
    const tracks = [makeTrack("NoMatch", "Z")];
    const scored = mergeAndScore(tracks, new Map(), WEIGHTS);
    assert.equal(scored.length, 1);
    assert.equal(scored[0].score, WEIGHTS.spotifyLikeWeight);
    assert.equal(scored[0].lastFmStats, undefined);
    assert.equal(scored[0].liked, true);
  });

  it("starts with zero penalty and no suppression", () => {
    const tracks = [makeTrack("Clean", "X")];
    const scored = mergeAndScore(tracks, new Map(), WEIGHTS);
    assert.equal(scored[0].penalty, 0);
    assert.equal(scored[0].suppressed, false);
    assert.deepEqual(scored[0].suppressionReasons, []);
  });
});
