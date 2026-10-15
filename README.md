# Basic Live Chat

A deliberately small live-chat system with:

- `chat.html`: a single-file client that can be opened directly in any modern browser.
- `server.js`: a Render-ready Node HTTP API with REST, Server-Sent Events, validation, CORS, and basic rate limiting.
- Supabase Postgres: durable shared message storage. The service-role key stays on Render and is never exposed to the HTML client.

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
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render.
4. Put the Render service URL into `DEFAULT_SERVER_URL` in `chat.html`.

## Limits

This is a basic, unauthenticated room chat. Anyone who knows the server URL and room name can read and post messages. Add user authentication and per-room authorization before using it for private or sensitive conversations.
