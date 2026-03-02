import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lastfmClient.js";

describe("normalize()", () => {
  it("lowercases input", () => {
    assert.equal(normalize("Hello World"), "hello world");
  });

  it("removes non-alphanumeric characters", () => {
    assert.equal(normalize("It's Alright"), "its alright");
    assert.equal(normalize("AC/DC"), "acdc");
  });

  it("strips (feat. Artist) from track names", () => {
    assert.equal(normalize("Track (feat. Someone)"), "track");
    assert.equal(normalize("Track (Feat. Someone Else)"), "track");
    assert.equal(normalize("Song [ft. Artist]"), "song");
  });

  it("strips (with Artist) parentheticals", () => {
    assert.equal(normalize("Track (with Someone)"), "track");
  });

  it("strips remix/remaster suffixes", () => {
    assert.equal(normalize("Track - Remastered"), "track");
    assert.equal(normalize("Song - Live"), "song");
    assert.equal(normalize("Beat - Remix"), "beat");
    assert.equal(normalize("Song - Radio Edit"), "song");
  });

  it("collapses whitespace", () => {
    assert.equal(normalize("  two   spaces  "), "two spaces");
  });

  it("handles empty string", () => {
    assert.equal(normalize(""), "");
  });

  it("matches Spotify and Last.fm naming variations", () => {
    // Spotify: "Karma Police (2016 Remaster)"  vs  Last.fm: "Karma Police"
    assert.equal(normalize("Karma Police (2016 Remaster)"), normalize("Karma Police"));
  });

  it("matches feat. variants", () => {
    // Spotify: "HUMBLE. (feat. Kendrick Lamar)"  vs  Last.fm: "HUMBLE."
    assert.equal(
      normalize("HUMBLE. (feat. Kendrick Lamar)"),
      normalize("HUMBLE.")
    );
  });
});
