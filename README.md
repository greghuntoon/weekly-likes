# Monday Morning Likes

Local-first CLI that updates a Spotify playlist each week with your recently liked songs, DJ-sorted for smooth genre transitions.

## How it works

Every Monday at 10:45am PST (via [OpenClaw](https://openclaw.ai) cron), this pipeline:

1. Pulls your liked songs from the last 7 days
2. Fetches artist genres from Spotify for each track
3. DJ-sorts the tracks using a genre-aware nearest-neighbor algorithm — genres cluster naturally with smooth transitions at boundaries, no same-artist back-to-back
4. Replaces the tracks in your target playlist
5. Writes a tweet draft to `output/`

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the redirect URI to `http://127.0.0.1:3000/callback`
4. Check **Web API**
5. Note your Client ID and Client Secret

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_PLAYLIST_ID=your_target_playlist_id
```

`SPOTIFY_PLAYLIST_ID` is the ID of the playlist you want updated each week. You can grab it from the Spotify share URL: `https://open.spotify.com/playlist/<this-part>`.

### 3. Install Dependencies

```bash
npm install
```

## Commands

### `npm run auth`

Starts the OAuth flow. Opens a local server on port 3000, prints an authorization URL to visit in your browser. After approving, tokens are saved to `data/tokens.json`.

### `npm run weekly`

Full pipeline:
1. Fetches liked songs from the last 7 days
2. Enriches tracks with artist genre data
3. DJ-sorts tracks (genre-aware transitions, opener to cooldown)
4. Replaces tracks in the target playlist
5. Writes run state to `data/state.json`
6. Writes a tweet draft to `output/tweet-YYYY-MM-DD.txt`

### `npm run dry`

Same as `weekly` but skips all Spotify write operations. Useful for testing.

### `npm run status`

Prints last run metadata from `data/state.json`.

## DJ Sort Algorithm

Since Spotify's audio-features endpoint isn't available for newer apps, the sort uses artist genres, track popularity, and duration:

- **Genre distance** (Jaccard similarity, 60% weight) — the main signal that prevents jarring genre whiplash
- **Popularity gap** (25% weight) — keeps energy levels smooth
- **Duration gap** (15% weight, capped) — pacing variety
- **Same-artist bonus** — clusters collaborations and features naturally
- **Artist separation pass** — prevents back-to-back same-artist tracks

The algorithm picks a mid-popularity opener, then walks to the nearest unvisited track at each step (nearest-neighbor), creating natural genre clusters with gentle transitions at the boundaries.

## Project Structure

```
src/
  config.ts         - env loading + paths (lazy credentials)
  spotifyAuth.ts    - OAuth flow + token refresh
  spotifyClient.ts  - Spotify API wrapper with retry/backoff + genre enrichment
  weeklyLikes.ts    - fetch, dedupe, enrich, DJ-sort liked songs
  djSort.ts         - genre-aware nearest-neighbor track ordering
  playlist.ts       - update fixed target playlist
  draftTweet.ts     - write tweet draft file
  state.ts          - local token + run state persistence
  index.ts          - CLI entry point
data/               - runtime state (tokens, run state)
output/             - tweet drafts
```

## Troubleshooting

**"No tokens found"** — Run `npm run auth` first.

**"Token refresh failed"** — Your refresh token may have been revoked. Run `npm run auth` again.

**"Missing required env var: SPOTIFY_PLAYLIST_ID"** — Add your target playlist ID to `.env`.

**Port 3000 in use** — Kill the process using port 3000 or change `SPOTIFY_REDIRECT_URI` in `.env` and your Spotify app settings.

**Rate limited** — The client retries automatically with backoff. If persistent, wait a few minutes.

**No liked songs found** — Make sure you've liked songs on Spotify within the last 7 days.
