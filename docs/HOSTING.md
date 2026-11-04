# Shark Discord Bot — Hosting

## Requirements
- Node.js 20+
- A host that supports a long-running Node.js process
- Discord application credentials
- Turso database credentials

## Install and start
```bash
npm ci
node deploy-commands.js && node index.js
```

Or set the host start command to:
```bash
npm start
```

## Environment variables
Copy `.env.example` to `.env` or add these in your host's environment/secrets settings:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DASH_PASSWORD`
- `PORT` (the host may provide this automatically)
- `COBALT_API_URL` (optional, needed by the download command)
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Do not commit or upload `.env` with real credentials.

## Included GIF files
- `songifs` — used only by `/son`
- `think` — used only by `/think`
- `gifs` — used by `/kiss`
