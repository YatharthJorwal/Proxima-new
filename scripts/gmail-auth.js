/**
 * One-time setup: OAuth2 authorization for Gmail (Milestone 10 Part C,
 * Gmail slice). Run this once, after creating OAuth credentials in
 * Google Cloud Console (see README.md's Gmail setup step for the actual
 * Console click-through - this script only handles the authorization
 * round-trip, not creating the credentials themselves):
 *
 *   npm run setup:gmail
 *
 * What it does, plainly, since this project never runs setup steps
 * without describing them first: opens your browser to a Google consent
 * screen asking for read-only Gmail access, starts a short-lived local
 * server on http://localhost:53682 to catch the redirect Google sends
 * back with an authorization code, exchanges that code for a refresh
 * token, then prints the refresh token for you to paste into .env
 * yourself - same "you paste it in, nothing writes your .env for you"
 * pattern as every other credential in this project (Piper paths,
 * ElevenLabs keys).
 *
 * Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET already in .env before
 * running this.
 */

require("dotenv/config");
const http = require("http");
const { URL } = require("url");
const { exec } = require("child_process");
const { google } = require("googleapis");

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "GMAIL_CLIENT_ID and/or GMAIL_CLIENT_SECRET are missing from .env.\n" +
      "Follow the Gmail setup step in README.md to create these in Google Cloud Console first."
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log("Couldn't open a browser automatically - open this URL yourself:");
      console.log(url);
    }
  });
}

console.log("Opening your browser to sign in and grant read-only Gmail access...");
console.log(`If it doesn't open, go to:\n${authUrl}\n`);
openBrowser(authUrl);

const server = http.createServer(async (req, res) => {
  let reqUrl;
  try {
    reqUrl = new URL(req.url, REDIRECT_URI);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  if (reqUrl.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = reqUrl.searchParams.get("code");
  const error = reqUrl.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Authorization was denied. You can close this tab.");
    console.error(`Google returned an error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("No authorization code received. You can close this tab.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Gmail connected. You can close this tab and go back to the terminal.");
    server.close();

    if (!tokens.refresh_token) {
      console.error(
        "Google didn't return a refresh token. This usually happens if you've\n" +
          "authorized this app before - go to https://myaccount.google.com/permissions,\n" +
          "remove Proxima's access, then run this script again."
      );
      process.exit(1);
    }

    console.log("\nGmail connected. Add this line to your .env:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    console.error("Failed to exchange the authorization code for tokens:", err.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong - check the terminal.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
