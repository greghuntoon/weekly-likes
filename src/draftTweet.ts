import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "./config.js";

export interface TweetDraftInput {
  playlistUrl: string;
  trackCount: number;
}

export function writeTweetDraft(input: TweetDraftInput): string {
  const { playlistUrl, trackCount } = input;
  const date = new Date().toISOString().split("T")[0];

  const short = `${trackCount} tracks, DJ-mixed for your Monday morning. ${playlistUrl}`;

  const medium = [
    `Monday Morning Likes just got refreshed.`,
    `${trackCount} tracks from this week, sorted opener-to-cooldown like a real set.`,
    `Listen: ${playlistUrl}`,
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
