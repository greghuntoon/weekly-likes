import http from "http";
import { URL } from "url";
import { getSpotifyConfig } from "./config.js";
import { saveTokens, loadTokens, tokensExpired, type TokenData } from "./state.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";

function basicAuth(): string {
  const { clientId, clientSecret } = getSpotifyConfig();
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/** Exchange authorization code for tokens */
async function exchangeCode(code: string): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getSpotifyConfig().redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (data.expires_in as number) * 1000,
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(tokens: TokenData): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const refreshed: TokenData = {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) ?? tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in as number) * 1000,
  };
  saveTokens(refreshed);
  return refreshed;
}

/** Get a valid access token, refreshing if needed */
export async function getValidToken(): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error("No tokens found. Run `npm run auth` first.");
  }
  if (tokensExpired(tokens)) {
    console.log("Access token expired, refreshing...");
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.access_token;
}

/** Run the interactive OAuth flow via local redirect server */
export async function runAuthFlow(): Promise<void> {
  const spotify = getSpotifyConfig();
  const redirectUrl = new URL(spotify.redirectUri);
  const port = parseInt(redirectUrl.port || "3000", 10);

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", spotify.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", spotify.redirectUri);
  authUrl.searchParams.set("scope", spotify.scopes);

  console.log("\n--- Spotify OAuth ---");
  console.log("Open this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback...\n");

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        if (error) {
          res.writeHead(400);
          res.end(`Authorization error: ${error}`);
          server.close();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }

        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          server.close();
          reject(new Error("No code in callback"));
          return;
        }

        const tokens = await exchangeCode(code);
        saveTokens(tokens);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authenticated!</h1><p>You can close this tab and return to the terminal.</p>");

        console.log("Tokens saved to data/tokens.json");
        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500);
        res.end("Internal error");
        server.close();
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`Callback server listening on http://127.0.0.1:${port}`);
    });

    server.on("error", (err) => {
      reject(new Error(`Could not start callback server: ${err.message}`));
    });
  });
}
