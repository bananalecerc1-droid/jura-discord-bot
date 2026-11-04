# Jura Discord Bot

A Node.js Discord bot with moderation, tickets, XP levels, games, dashboards, and media utilities.

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- A Turso/libSQL database
- A host that supports a long-running Node.js process

## Run locally or on a VM

```bash
cp .env.example .env
# Edit .env and provide the real credentials
npm ci
npm run deploy
npm start
```

`npm start` registers the slash commands and starts the bot. Do not commit `.env` or real credentials. On Railway, Render, Oracle Cloud, or another host, add the same variables in the host's secret/environment-variable settings.

## Required environment variables

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DASH_PASSWORD`

Optional variables include `PORT`, `COBALT_API_URL`, and `GIPHY_API_KEY`.
