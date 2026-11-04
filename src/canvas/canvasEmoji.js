'use strict';

const { loadImage } = require('@napi-rs/canvas');

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72';
const cache = new Map();

function emojiCodepoints(emoji) {
  return Array.from(String(emoji))
    .map(char => char.codePointAt(0).toString(16))
    .join('-');
}

async function getEmojiImage(emoji) {
  const key = String(emoji || '');
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const promise = loadImage(`${TWEMOJI_BASE}/${emojiCodepoints(key)}.png`).catch(() => null);
  cache.set(key, promise);
  return promise;
}

function drawEmojiImage(ctx, image, centerX, centerY, size) {
  if (!image) return false;
  ctx.drawImage(image, centerX - size / 2, centerY - size / 2, size, size);
  return true;
}

async function preloadEmoji(emojis) {
  const unique = [...new Set((emojis || []).filter(Boolean))];
  return Promise.all(unique.map(async emoji => [emoji, await getEmojiImage(emoji)]));
}

module.exports = { emojiCodepoints, getEmojiImage, drawEmojiImage, preloadEmoji };
