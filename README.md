# BeatFit Weekly Likes

Local-first CLI that creates a weekly Spotify playlist from your recently liked songs.

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the redirect URI to `http://127.0.0.1:3000/callback`
4. Note your Client ID and Client Secret

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in your credentials in `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

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
2. Creates or updates a playlist named `BeatFit Weekly - YYYY-MM-DD`
3. Writes run state to `data/state.json`
4. Writes a tweet draft to `output/tweet-YYYY-MM-DD.txt`

### `npm run dry`

Same as `weekly` but skips all Spotify write operations (no playlist created/updated). Useful for testing.

### `npm run status`

Prints last run metadata from `data/state.json`.

## Project Structure

```
src/
  config.ts         - env loading + paths
  spotifyAuth.ts    - OAuth flow + token refresh
  spotifyClient.ts  - Spotify API wrapper with retry/backoff
  weeklyLikes.ts    - fetch + dedupe liked songs
  playlist.ts       - create/update weekly playlist
  draftTweet.ts     - write tweet draft file
  state.ts          - local token + run state persistence
  index.ts          - CLI entry point
data/               - runtime state (tokens, run state)
output/             - tweet drafts
```

## Troubleshooting

**"No tokens found"** - Run `npm run auth` first.

**"Token refresh failed"** - Your refresh token may have been revoked. Run `npm run auth` again.

**Port 3000 in use** - Kill the process using port 3000 or change `SPOTIFY_REDIRECT_URI` in `.env` and your Spotify app settings.

**Rate limited** - The client retries automatically with backoff. If persistent, wait a few minutes.

**No liked songs found** - Make sure you've liked songs on Spotify within the last 7 days.
