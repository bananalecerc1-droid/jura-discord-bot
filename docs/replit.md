# Discord Bot + Dashboard

A Discord bot (discord.js v14) with a built-in Express web dashboard. Runs as a single Node.js process.

## Stack

- **Runtime**: Node.js 20
- **Bot**: discord.js v14
- **Dashboard**: Express on port 5000
- **Database**: Turso (LibSQL)
- **Canvas/images**: @napi-rs/canvas, sharp

## How to run

The workflow **Start application** handles everything:
```
node deploy-commands.js && node index.js
```

- Registers slash commands with Discord, then starts the bot + dashboard.
- Dashboard available at the app URL (port 5000). Login with the `DASH_PASSWORD` value.

## Environment variables / secrets

Credentials are loaded from the `.env` file (gitignored) via `dotenv`. The following keys must be present:

| Key | Notes |
|-----|-------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal (sensitive) |
| `DISCORD_CLIENT_ID` | Application/client ID |
| `DASH_PASSWORD` | Dashboard login password |
| `PORT` | Set to `5000` for Replit (overridden via Replit env var) |
| `COBALT_API_URL` | Self-hosted Cobalt instance for media downloads |
| `TURSO_DATABASE_URL` | Turso database URL |
| `TURSO_AUTH_TOKEN` | Turso auth token (sensitive) |

`PORT`, `DISCORD_CLIENT_ID`, `COBALT_API_URL`, and `TURSO_DATABASE_URL` are also set as Replit env vars (shared environment) and take precedence over `.env`.

## Data files

`botConfig.json`, `data.json`, and `xp_data.json` store live bot configuration. The `backgrounds/` folder stores custom rank-card backgrounds uploaded via the dashboard. Back these up before migrating.

## User preferences

- Keep the existing project structure and stack — do not restructure or migrate.
