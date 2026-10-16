# Basic Live Chat

A deliberately small live-chat system with:

- `chat.html`: a single-file client that can be opened directly in any modern browser.
- `server.js`: a Render-ready Node HTTP API with REST, Server-Sent Events, validation, CORS, and basic rate limiting.
- Supabase Postgres: durable shared message storage protected by row-level security. Its publishable key stays on Render and is not embedded in the HTML client.
- Built-in connection audit: replaces basic DevTools visibility on locked-down devices and produces a copyable JSON report.

## Architecture

1. The local HTML file loads and posts messages through the Render URL.
2. The Render API validates each message and writes it to Supabase.
3. Connected Render instances poll the shared table and send new messages to browsers over Server-Sent Events, so clients remain live even when requests reach different instances.

## Local development

```bash
CHAT_STORE=memory PORT=10000 npm start
```

Open `chat.html`, enter `http://localhost:10000`, a room, and a display name.

Run tests with:

```bash
npm test
```

## Production setup

1. Create a Supabase project and apply `supabase/schema.sql`.
2. Create a Render web service from this repository (or apply `render.yaml`).
3. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Render.
4. Put the Render service URL into `DEFAULT_SERVER_URL` in `chat.html`.

## Connection audit and compatibility mode

Open `chat.html`, select **Audit**, then **Run full audit**. The report tests:

- normal CORS and no-CORS reachability;
- an application-origin marker and request ID;
- the database-backed history path;
- JSON POST with browser preflight versus a safelisted text POST;
- passive image loading; and
- Server-Sent Events.

The audit does not send a chat message and does not collect passwords, cookies, files, browsing history, or IP addresses. If streaming is blocked but REST works, chat automatically falls back to three-second polling. If JSON preflight is blocked, message sending retries with a safelisted `text/plain` request.

A `403` report without `x-chat-origin: basic-live-chat-api` or the `basic-live-chat-origin-v2` marker indicates that an upstream proxy or security product responded before the request reached this application. Resolve policy-based blocking through the network administrator or an approved hostname rather than attempting to evade the control.

## Limits

This is a basic, unauthenticated room chat. Anyone who knows the server URL and room name can read and post messages. Add user authentication and per-room authorization before using it for private or sensitive conversations.
