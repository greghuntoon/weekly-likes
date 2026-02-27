import { runAuthFlow } from "./spotifyAuth.js";
import { fetchWeeklyLikes } from "./weeklyLikes.js";
import { syncWeeklyPlaylist } from "./playlist.js";
import { writeTweetDraft } from "./draftTweet.js";
import { loadState, saveState, type RunState } from "./state.js";

const command = process.argv[2];

async function cmdAuth(): Promise<void> {
  await runAuthFlow();
  console.log("\nAuth complete. You can now run: npm run weekly");
}

async function cmdWeekly(dryRun: boolean): Promise<void> {
  const label = dryRun ? "[DRY RUN] " : "";
  console.log(`\n${label}Starting weekly pipeline...\n`);

  const state: RunState = {
    lastRunAt: new Date().toISOString(),
    lastPlaylistId: null,
    lastPlaylistName: null,
    lastTrackCount: null,
    lastError: null,
  };

  try {
    const tracks = await fetchWeeklyLikes();

    if (tracks.length === 0) {
      console.log("No liked songs in the last 7 days. Nothing to do.");
      state.lastTrackCount = 0;
      saveState(state);
      return;
    }

    const result = await syncWeeklyPlaylist(tracks, dryRun);

    state.lastPlaylistId = result.playlistId;
    state.lastPlaylistName = "Monday Morning Likes";
    state.lastTrackCount = result.trackCount;

    writeTweetDraft({
      playlistUrl: result.playlistUrl,
      trackCount: result.trackCount,
    });

    console.log("\n--- Summary ---");
    console.log(`Playlist: Monday Morning Likes – @greghuntoon`);
    console.log(`Tracks:   ${result.trackCount}`);
    console.log(`URL:      ${result.playlistUrl}`);
    console.log(`Mode:     ${dryRun ? "dry run" : "live"}`);
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    saveState(state);
  }
}

function cmdStatus(): void {
  const state = loadState();
  console.log("\n--- Last Run Status ---");
  if (!state.lastRunAt) {
    console.log("No runs recorded yet. Run `npm run weekly` first.");
    return;
  }
  console.log(`Last run:     ${state.lastRunAt}`);
  console.log(`Playlist:     ${state.lastPlaylistName ?? "n/a"}`);
  console.log(`Playlist ID:  ${state.lastPlaylistId ?? "n/a"}`);
  console.log(`Track count:  ${state.lastTrackCount ?? "n/a"}`);
  console.log(`Last error:   ${state.lastError ?? "none"}`);
}

async function main(): Promise<void> {
  switch (command) {
    case "auth":
      await cmdAuth();
      break;
    case "weekly":
      await cmdWeekly(false);
      break;
    case "dry":
      await cmdWeekly(true);
      break;
    case "status":
      cmdStatus();
      break;
    default:
      console.log("Usage: node dist/index.js <auth|weekly|dry|status>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
