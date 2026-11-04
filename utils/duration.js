'use strict';

const UNIT_MS = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
});

/**
 * Parse values such as: 30s, 1m, 1h, 1d, 1d 2h 30m, or 1d2h30m.
 * A leading duration is accepted when followed by a reason, which supports
 * prefixed commands such as: mute @user 1h being rude.
 */
function parseDuration(value) {
  if (value === null || value === undefined) return null;
  const input = String(value).trim().toLowerCase();
  if (!input) return null;

  const match = input.match(/^((?:\d+(?:\.\d+)?\s*[smhdw]\s*)+)/i);
  if (!match) return null;

  const durationText = match[1];
  const parts = [...durationText.matchAll(/(\d+(?:\.\d+)?)\s*([smhdw])/gi)];
  if (!parts.length) return null;

  const ms = parts.reduce((total, part) => {
    return total + Number(part[1]) * UNIT_MS[part[2].toLowerCase()];
  }, 0);

  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : null;
}

function formatDuration(ms) {
  let remaining = Math.max(0, Math.floor(Number(ms) || 0));
  const units = [
    ['d', UNIT_MS.d],
    ['h', UNIT_MS.h],
    ['m', UNIT_MS.m],
    ['s', UNIT_MS.s],
  ];
  const output = [];
  for (const [label, unit] of units) {
    const amount = Math.floor(remaining / unit);
    if (amount > 0) {
      output.push(`${amount}${label}`);
      remaining -= amount * unit;
    }
  }
  return output.join(' ') || '0s';
}

// Node's setTimeout overflows above ~24.8 days. This safely schedules longer
// durations by sleeping in chunks and invoking the callback at the end.
function scheduleTimeout(callback, delayMs) {
  const MAX_DELAY = 2_147_000_000;
  let timer;
  const schedule = (remaining) => {
    timer = setTimeout(() => {
      if (remaining <= MAX_DELAY) callback();
      else schedule(remaining - MAX_DELAY);
    }, Math.min(remaining, MAX_DELAY));
    timer.unref?.();
  };
  schedule(Math.max(0, Math.floor(Number(delayMs) || 0)));
  return { cancel: () => clearTimeout(timer) };
}

module.exports = { parseDuration, formatDuration, scheduleTimeout, UNIT_MS };
