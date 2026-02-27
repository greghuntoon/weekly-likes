import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "./config.js";

export interface TweetDraftInput {
  playlistUrl: string;
  playlistName: string;
  trackCount: number;
}

export function writeTweetDraft(input: TweetDraftInput): string {
  const { playlistUrl, playlistName, trackCount } = input;
  const date = new Date().toISOString().split("T")[0];

  const short = `This week's ${trackCount} fave tracks, auto-curated. ${playlistUrl}`;

  const medium = [
    `${playlistName} just dropped.`,
    `${trackCount} tracks I liked this week, auto-curated into one playlist.`,
    `Listen here: ${playlistUrl}`,
  ].join("\n");

  const content = [
    `# Tweet Draft - ${date}`,
    ``,
    `## Short`,
    short,
    ``,
    `## Medium`,
    medium,
    ``,
  ].join("\n");

  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  const filePath = resolve(config.outputDir, `tweet-${date}.txt`);
  writeFileSync(filePath, content, "utf-8");
  console.log(`Tweet draft written to ${filePath}`);
  return filePath;
}
