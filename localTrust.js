'use strict';
const db = require('./db.js');
let cache = Object.create(null);
let ready = false;
async function initLocalXP() {
  cache = await db.getLocalXpAll();
  ready = true;
  return cache;
}
function loadLocalXP() { return cache; }
function addLocalXP(rawUserId, amount = 1) {
  const userId = String(rawUserId || '');
  if (!userId) return;
  const delta = Number(amount) || 0;
  cache[userId] = (Number(cache[userId]) || 0) + delta;
  db.incrementLocalXp(userId, delta).catch(err => console.error('[Local XP] Turso save failed:', err.message));
}
module.exports = { initLocalXP, loadLocalXP, addLocalXP, isReady: () => ready };
