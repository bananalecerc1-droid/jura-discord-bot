'use strict';

require('dotenv').config();

// One-off script: clears the stored boost-role DATA for a single user,
// without touching the actual Discord role (it stays on the server/member).
//
// Talks directly to the Turso DB (same as db.js / webServer.js), so it
// reads/writes the real live config instead of the local JSON fallback.
//
// Run this from the SAME directory as index.js / webServer.js / db.js:
//   node resetBoostRole.js

const db = require('../../db.js');

const TARGET_USER_ID = '1472262665194967302';

async function main() {
  await db.initDb();

  const cfg = await db.loadBotConfig();

  const existing = cfg.boost?.roles?.[TARGET_USER_ID];
  if (!existing) {
    console.log(`No boost role data found in the database for user ${TARGET_USER_ID} — nothing to do.`);
    return;
  }

  console.log('Found existing entry, about to delete:');
  console.log(JSON.stringify(existing, null, 2));

  delete cfg.boost.roles[TARGET_USER_ID];
  await db.saveBotConfig(cfg);

  console.log(`✅ Cleared stored boost role data for user ${TARGET_USER_ID}.`);
  console.log('Note: the Discord role itself was NOT deleted — only the stored record.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
