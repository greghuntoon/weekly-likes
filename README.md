# Monday Morning Likes

Local-first CLI that updates a Spotify playlist each week with your recently liked songs. v2 integrates Last.fm listening data to rank tracks by actual play behavior and suppresses background-noise tracks.

## How it works

### v1 (original)

Every Monday at 10:45am PST (via [OpenClaw](https://openclaw.ai) cron):

1. Pulls your liked songs from the last 7 days
2. Fetches artist genres from Spotify
3. DJ-sorts the tracks using a genre-aware nearest-neighbor algorithm
4. Replaces tracks in the target playlist
5. Writes a tweet draft to `output/`

### v2 (Last.fm enhanced)

Same schedule, but before DJ-sorting:

1. Pulls Spotify liked tracks (last 7 days)
2. Fetches your Last.fm recent tracks (last 7 days, cached for 6h)
3. Scores each track: `(like_weight × 1) + (play_weight × weekly_plays) + (recency_weight × recency_decay)`
4. Applies background-noise suppression (keywords, loop detection, denylist)
5. DJ-sorts the surviving tracks
6. Writes a scored markdown report to `output/`

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app, set redirect URI to `http://127.0.0.1:3000/callback`
3. Note your Client ID and Client Secret

### 2. Get a Last.fm API Key (v2 only)

1. Go to [Last.fm API](https://www.last.fm/api/account/create) and create an account
2. Note your API Key

### 3. Configure Environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
# Spotify (required for all commands)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_PLAYLIST_ID=your_target_playlist_id

# Last.fm (required for v2 commands)
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_USERNAME=your_lastfm_username

# v2 scoring weights (optional, these are the defaults)
LASTFM_LIKE_WEIGHT=5.0       # base score for being in the liked set
LASTFM_PLAY_WEIGHT=1.0       # added per Last.fm play in the 7-day window
LASTFM_RECENCY_WEIGHT=0.5    # multiplier for recency-decayed play score

# v2 background filter (optional, these are the defaults)
BG_LOOP_THRESHOLD=4.0        # plays/day rate that triggers loop flag
BG_PENALTY=3.0               # score penalty per flagged heuristic
BG_SUPPRESS_THRESHOLD=6.0    # cumulative penalty that fully suppresses a track
```

`SPOTIFY_PLAYLIST_ID` is the ID from the Spotify share URL: `https://open.spotify.com/playlist/<this-part>`.

### 4. Install Dependencies

```bash
npm install
```

## Commands

### v1 Commands (unchanged)

#### `npm run auth`

OAuth flow. Opens a local server on port 3000, prints a URL to visit. Saves tokens to `data/tokens.json`.

#### `npm run weekly`

Full v1 pipeline: fetch likes → genre enrichment → DJ-sort → write playlist → tweet draft.

#### `npm run dry`

Same as `weekly` but skips all Spotify write operations.

#### `npm run status`

Prints last run metadata from `data/state.json`.

### v2 Commands

#### `npm run weekly:v2`

Full v2 pipeline:
1. Fetch Spotify likes + genre enrichment
2. Fetch Last.fm recent tracks (cached for 6h in `data/lastfm-cache.json`)
3. Merge + score (like weight + play count + recency decay)
4. Apply background-noise suppression
5. DJ-sort surviving tracks
6. Write playlist to Spotify
7. Write scored markdown report to `output/weekly-v2-report-YYYY-MM-DD.md`

#### `npm run dry:v2`

Same as `weekly:v2` but skips all Spotify writes. Prints the explain table.

#### `npm run explain:v2`

Dry run that prints a detailed scored table to stdout showing every track's score breakdown and suppression status:

```
────────────────────────────────────────────────────────────────────────────────────
Rank  Score    Artist                    Track                           Plays  Recncy  Status
────────────────────────────────────────────────────────────────────────────────────
   1  12.50    Radiohead                 Karma Police                       5    4.85  ✓
   2   8.20    Massive Attack            Teardrop                           2    1.90  ✓
  ...
  15   2.10    Study Music Co            Deep Work Ambience                 8    7.20  ✗ SUPPRESSED  keyword:track("ambient"), loop(8plays/1d)
```

#### `npm test`

Builds and runs the unit test suite.

## Scoring Formula

```
score = (LASTFM_LIKE_WEIGHT  × 1)
      + (LASTFM_PLAY_WEIGHT  × weekly_play_count)
      + (LASTFM_RECENCY_WEIGHT × recency_decay)
```

Where `recency_decay = Σ max(0, 1 - age_of_play / 7_days)` — each play contributes 0–1 based on recency (1 = played right now, 0 = played 7 days ago). Tracks played often *and* recently score highest.

## Background Noise Suppression

Tracks are penalized (or fully suppressed) if they match these heuristics:

| Heuristic | Penalty |
|-----------|---------|
| Track name contains background keyword (ambient, binaural, study, lofi, etc.) | `BG_PENALTY` |
| Artist name contains background keyword | `BG_PENALTY` |
| Spotify genre tag contains background keyword | `BG_PENALTY × 0.5` |
| Last.fm play rate exceeds `BG_LOOP_THRESHOLD` plays/day | `BG_PENALTY` |
| Track appears in `data/background-denylist.json` | Instant suppress |

Tracks with `cumulative_penalty >= BG_SUPPRESS_THRESHOLD` are **suppressed** (excluded from playlist). Tracks below threshold receive a reduced score but remain in the playlist.

### Custom Denylist

Edit `data/background-denylist.json` to hard-block specific artists or tracks:

```json
[
  { "artist": "Focus at Will", "reason": "background music service" },
  { "artist": "Brain.fm", "track": "Deep Work Session" }
]
```

Entries match on normalized artist and/or track name (case-insensitive, punctuation-stripped).

## DJ Sort Algorithm

After scoring and filtering, the surviving tracks are DJ-sorted using the existing genre-aware nearest-neighbor algorithm:

- **Genre distance** (Jaccard similarity, 60% weight) — prevents jarring genre whiplash
- **Popularity gap** (25% weight) — keeps energy levels smooth
- **Duration gap** (15% weight, capped) — pacing variety
- **Same-artist bonus** — clusters collaborations naturally
- **Artist separation pass** — prevents back-to-back same-artist tracks

## Project Structure

```
src/
  config.ts            - env loading, paths, Spotify + Last.fm + scoring config
  spotifyAuth.ts       - OAuth flow + token refresh
  spotifyClient.ts     - Spotify API wrapper with retry/backoff + genre enrichment
  weeklyLikes.ts       - v1: fetch, dedupe, enrich, DJ-sort liked songs
  djSort.ts            - genre-aware nearest-neighbor track ordering
  playlist.ts          - update fixed target playlist
  draftTweet.ts        - write tweet draft file
  state.ts             - local token + run state persistence
  lastfmClient.ts      - Last.fm API, caching, normalization, play aggregation
  mergeAndScore.ts     - merge Spotify + Last.fm, compute per-track scores
  backgroundFilter.ts  - background-noise heuristics + denylist suppression
  weeklyV2.ts          - v2 pipeline orchestrator
  report.ts            - markdown report + terminal explain table
  index.ts             - CLI entry point (v1 + v2 commands)
  tests/
    normalize.test.ts  - normalization matching tests
    scoring.test.ts    - score computation tests
    backgroundFilter.test.ts - suppression heuristic tests
data/
  tokens.json          - Spotify OAuth tokens (gitignored)
  state.json           - last run metadata
  lastfm-cache.json    - Last.fm plays cache (6h TTL, runtime)
  background-denylist.json - manual track/artist denylist
output/
  tweet-YYYY-MM-DD.txt          - v1 tweet drafts
  weekly-v2-report-YYYY-MM-DD.md - v2 scored markdown reports
```

## Troubleshooting

**"No tokens found"** — Run `npm run auth` first.

**"Token refresh failed"** — Your refresh token may have been revoked. Run `npm run auth` again.

**"Missing required env var: LASTFM_API_KEY"** — Add your Last.fm API key to `.env`. Only required for v2 commands.

**"Last.fm API error 6: User not found"** — Check `LASTFM_USERNAME` in `.env` matches your Last.fm username exactly.

**Last.fm shows 0 matches** — Last.fm and Spotify may spell artist/track names differently. The normalizer handles common cases (feat., remasters, punctuation). For persistent mismatches, check `data/lastfm-cache.json` to see how Last.fm spells the artist/track.

**Last.fm data gap (no recent scrobbles)** — v2 still works; all tracks receive the base `LASTFM_LIKE_WEIGHT` score and are sorted by DJ algorithm. The playlist will be the same as v1 but with background filtering applied.

**Rate limited (Spotify)** — The client retries automatically with backoff. If persistent, wait a few minutes.

**Rate limited (Last.fm)** — The client adds a 250ms delay between paginated requests and retries on 429. If persistent, increase `PAGE_DELAY_MS` in `src/lastfmClient.ts`.

**Port 3000 in use** — Kill the process using port 3000, or change `SPOTIFY_REDIRECT_URI` in `.env` and your Spotify app settings.

**Track wrongly suppressed** — Check `explain:v2` for the suppression reasons. Add the artist to `data/background-denylist.json` with a negative (override) pattern is not supported; instead, tune `BG_SUPPRESS_THRESHOLD` higher or adjust `BG_PENALTY` to reduce sensitivity.
