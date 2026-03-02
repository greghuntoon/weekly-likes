import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "./config.js";
import type { ScoredTrack } from "./mergeAndScore.js";
import type { SpotifyTrack } from "./spotifyClient.js";
import type { LastFmTrackInfo } from "./lastfmClient.js";

// --- Terminal explain table ---

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/**
 * Print a formatted table of scored tracks to stdout for `explain:v2`.
 */
export function printExplainTable(scored: ScoredTrack[]): void {
  const RANK = 4;
  const SCORE = 7;
  const ARTIST = 24;
  const TRACK = 30;
  const PLAYS = 5;
  const RCNCY = 7;
  const STATUS = 30;

  const header = [
    pad("Rank", RANK),
    pad("Score", SCORE),
    pad("Artist", ARTIST),
    pad("Track", TRACK),
    pad("Plays", PLAYS),
    pad("Recncy", RCNCY),
    "Status",
  ].join("  ");

  const divider = "─".repeat(header.length);

  console.log("\n" + divider);
  console.log(header);
  console.log(divider);

  scored.forEach((s, i) => {
    const artist = s.track.artists.join(", ");
    const statusSymbol = s.suppressed ? "✗" : s.penalty > 0 ? "~" : "✓";
    const reasons = s.suppressionReasons.join(", ");
    const statusText = s.suppressed
      ? `✗ SUPPRESSED  ${reasons}`
      : s.penalty > 0
      ? `~ penalized  ${reasons}`
      : "✓";

    console.log(
      [
        pad(String(i + 1), RANK),
        pad(fmt(s.score - s.penalty), SCORE),
        pad(artist, ARTIST),
        pad(s.track.name, TRACK),
        pad(String(s.weeklyPlayCount), PLAYS),
        pad(fmt(s.recencyDecay, 2), RCNCY),
        statusText,
      ].join("  ")
    );
  });

  console.log(divider);

  const live = scored.filter((s) => !s.suppressed).length;
  const suppressed = scored.filter((s) => s.suppressed).length;
  const penalized = scored.filter((s) => !s.suppressed && s.penalty > 0).length;
  console.log(`\nTotal: ${scored.length}  Live: ${live}  Penalized: ${penalized}  Suppressed: ${suppressed}\n`);
}

// --- Markdown report ---

function topArtists(tracks: SpotifyTrack[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const a = t.artists[0] ?? "Unknown";
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([artist]) => artist);
}

function topGenres(tracks: SpotifyTrack[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    for (const g of t.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([genre]) => genre);
}

function generateStory(
  finalTracks: SpotifyTrack[],
  suppressed: ScoredTrack[]
): string {
  const parts: string[] = [];

  if (finalTracks.length === 0) {
    return "No tracks made the final cut this week.";
  }

  parts.push(`This week's playlist draws ${finalTracks.length} tracks from your Spotify likes and Last.fm listening history.`);

  const leaders = topArtists(finalTracks, 3);
  if (leaders.length > 0) {
    parts.push(`${leaders[0]} leads the rotation${leaders.length > 1 ? `, with ${leaders.slice(1).join(" and ")} close behind` : ""}.`);
  }

  const genres = topGenres(finalTracks, 2);
  if (genres.length > 0) {
    parts.push(`The sound leans toward ${genres.join(" and ")}.`);
  }

  const lfmCount = finalTracks.filter((t) => {
    // check if any scored track (by URI) had lastFmStats — we infer from weeklyPlayCount
    return false; // we don't have that info here; omit
  }).length;
  void lfmCount;

  if (suppressed.length > 0) {
    parts.push(
      `${suppressed.length} track${suppressed.length !== 1 ? "s" : ""} were filtered for background-noise patterns and excluded from the final set.`
    );
  }

  return parts.join(" ");
}

export interface ReportData {
  date: string;
  allScored: ScoredTrack[];
  finalTracks: SpotifyTrack[];
}

/**
 * Generate a Spotify playlist description that leads with the top-scored track's wiki snippet
 * (when available), then a play-count summary. Fits within Spotify's 300-character limit.
 *
 * Example (with wiki):
 *   "'Je t'aimais, je t'aimais' by Dominique Fils-Aimé led this week with 17 plays. A cover of
 *    Francis Cabrel, it closes her album My World Is The Sun. · 33 tracks · Week of Mar 2"
 *
 * Example (no wiki):
 *   "Week of Mar 2 · 33 tracks · Dominique Fils-Aimé (17 plays), Asake (9), Sarz (8)"
 */
export function generatePlaylistDescription(
  allScored: ScoredTrack[],
  date: string,
  leadoffTrackInfo?: LastFmTrackInfo | null
): string {
  const liveCount = allScored.filter((s) => !s.suppressed).length;

  // Format date as "Mar 2"
  const d = new Date(date + "T12:00:00Z");
  const monthStr = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const dayStr = d.toLocaleString("en-US", { day: "numeric", timeZone: "UTC" });
  const dateLabel = `${monthStr} ${dayStr}`;

  // Find the leadoff track's play count from the scored list
  const leadoffPlays = leadoffTrackInfo
    ? (allScored.find(
        (s) =>
          !s.suppressed &&
          s.track.artists[0]?.toLowerCase() === leadoffTrackInfo.artist.toLowerCase()
      )?.weeklyPlayCount ?? 0)
    : 0;

  // Build richer description if we have wiki content
  if (leadoffTrackInfo?.wikiSummary) {
    // Take the first sentence of the wiki summary (up to the first period + space or end)
    const firstSentenceMatch = leadoffTrackInfo.wikiSummary.match(/^[^.!?]+[.!?]/);
    const firstSentence = firstSentenceMatch
      ? firstSentenceMatch[0].trim()
      : leadoffTrackInfo.wikiSummary.slice(0, 120).trim();

    const playsStr = leadoffPlays > 0 ? ` with ${leadoffPlays} plays` : "";
    const lead = `"${leadoffTrackInfo.track}" by ${leadoffTrackInfo.artist} led this week${playsStr}. ${firstSentence} · ${liveCount} tracks · Week of ${dateLabel}`;

    if (lead.length <= 300) return lead;
    // If too long, truncate the sentence
    const budget = 300 - `"${leadoffTrackInfo.track}" by ${leadoffTrackInfo.artist} led this week${playsStr}.  · ${liveCount} tracks · Week of ${dateLabel}`.length;
    const truncatedSentence = budget > 10 ? firstSentence.slice(0, budget - 3) + "..." : "";
    return `"${leadoffTrackInfo.track}" by ${leadoffTrackInfo.artist} led this week${playsStr}. ${truncatedSentence} · ${liveCount} tracks · Week of ${dateLabel}`.slice(0, 300);
  }

  // Fallback: artist play-count summary
  const artistPlays = new Map<string, number>();
  for (const s of allScored) {
    if (s.suppressed || s.weeklyPlayCount === 0) continue;
    const artist = s.track.artists[0] ?? "Unknown";
    artistPlays.set(artist, (artistPlays.get(artist) ?? 0) + s.weeklyPlayCount);
  }

  const topArtists = [...artistPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  let desc = `Week of ${dateLabel} · ${liveCount} tracks`;

  if (topArtists.length > 0) {
    const [first, ...rest] = topArtists;
    const firstStr = `${first[0]} (${first[1]} plays)`;
    const restStr = rest.map(([a, n]) => `${a} (${n})`).join(", ");
    const artistStr = restStr ? `${firstStr}, ${restStr}` : firstStr;
    desc += ` · ${artistStr}`;
  }

  return desc.slice(0, 300);
}

/**
 * Generate and write a markdown report to output/weekly-v2-report-YYYY-MM-DD.md.
 */
export function writeReport(data: ReportData): string {
  const { date, allScored, finalTracks } = data;

  const suppressed = allScored.filter((s) => s.suppressed);
  const penalized = allScored.filter((s) => !s.suppressed && s.penalty > 0);
  const live = allScored.filter((s) => !s.suppressed);

  const story = generateStory(finalTracks, suppressed);

  const lines: string[] = [
    `# Weekly v2 Report — ${date}`,
    "",
    `## Week in Review`,
    "",
    story,
    "",
    `## Top Scored Tracks`,
    "",
    `| Rank | Score | Artist | Track | Plays | Recency | Penalized |`,
    `|------|-------|--------|-------|-------|---------|-----------|`,
    ...live.slice(0, 20).map((s, i) =>
      `| ${i + 1} | ${fmt(s.score)} | ${s.track.artists.join(", ")} | ${s.track.name} | ${s.weeklyPlayCount} | ${fmt(s.recencyDecay)} | ${s.penalty > 0 ? `${fmt(s.penalty)} (${s.suppressionReasons.join(", ")})` : "—"} |`
    ),
    "",
    `## Final Playlist Order`,
    "",
    `${finalTracks.length} tracks, DJ-sorted for smooth transitions:`,
    "",
    ...finalTracks.map((t, i) => `${i + 1}. **${t.artists.join(", ")}** — ${t.name}`),
    "",
  ];

  if (penalized.length > 0) {
    lines.push(
      `## Penalized Tracks (kept, score reduced)`,
      "",
      `| Artist | Track | Penalty | Reasons |`,
      `|--------|-------|---------|---------|`,
      ...penalized.map((s) =>
        `| ${s.track.artists.join(", ")} | ${s.track.name} | ${fmt(s.penalty)} | ${s.suppressionReasons.join(", ")} |`
      ),
      ""
    );
  }

  if (suppressed.length > 0) {
    lines.push(
      `## Suppressed Tracks (excluded)`,
      "",
      `| Artist | Track | Penalty | Reasons |`,
      `|--------|-------|---------|---------|`,
      ...suppressed.map((s) =>
        `| ${s.track.artists.join(", ")} | ${s.track.name} | ${fmt(s.penalty)} | ${s.suppressionReasons.join(", ")} |`
      ),
      ""
    );
  }

  lines.push(
    `## Stats`,
    "",
    `- Total scored: ${allScored.length}`,
    `- Final playlist: ${finalTracks.length}`,
    `- Penalized (kept): ${penalized.length}`,
    `- Suppressed (excluded): ${suppressed.length}`,
    `- Last.fm matched: ${allScored.filter((s) => s.lastFmStats !== undefined).length}`,
    ""
  );

  const content = lines.join("\n");

  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  const filePath = resolve(config.outputDir, `weekly-v2-report-${date}.md`);
  writeFileSync(filePath, content, "utf-8");
  console.log(`Report written to ${filePath}`);
  return filePath;
}
