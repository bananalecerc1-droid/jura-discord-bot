const { loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

// دالة لفحص إذا كان الرابط تابع لديسكورد ومنتهي الصلاحية
function isDiscordLinkExpired(url, err) {
  if (!url.includes('cdn.discordapp.com') && !url.includes('media.discordapp.net')) {
    return false; // ليس رابط ديسكورد
  }
  // ديسكورد يرجع كود 403 أو 404 عندما تنتهي صلاحية الرابط (بعد أسبوع تقريباً)
  if (err.response && (err.response.status === 403 || err.response.status === 404)) {
    return true;
  }
  return false;
}

// Shared image fetcher used by all canvas card generators
async function downloadImageBytes(url, { timeout = 8000, retries = 2 } = {}) {
  if (!url) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot; +https://discord.com)',
          Accept: 'image/*,*/*;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return Buffer.from(res.data);
    } catch (err) {
      // فحص إذا كان الرابط منتهي الصلاحية (خلّصت مدته)
      if (isDiscordLinkExpired(url, err)) {
        console.warn(`[رابط منتهي] خلصت مدة صلاحية الصورة بعد أسبوع تقريباً: ${url}`);
        return 'EXPIRED'; // نرجع كلمة تدل على انتهاء الصلاحية للتعامل معها لاحقاً
      }

      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        console.error(`downloadImageBytes failed for ${url}:`, err.message);
        return null;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

// Accepts either a remote URL (string) or already-downloaded bytes (Buffer)
async function fetchImage(source, opts = {}) {
  if (!source) return null;
  try {
    if (Buffer.isBuffer(source)) return await loadImage(source);
    
    const bytes = await downloadImageBytes(source, opts);
    
    if (!bytes) return null;
    if (bytes === 'EXPIRED') {
      // هنا تقدر تتصرف (مثلاً ترجع صورة افتراضية أو تنبه السيستم أن الصورة خلصت مدتها)
      console.error('تعذر تحميل الصورة لأن الرابط expired');
      return null; 
    }
    
    return await loadImage(bytes);
  } catch (err) {
    console.error('fetchImage decode failed:', err.message);
    return null;
  }
}

// Strip emoji, symbols, and other characters that render as □ boxes on canvas fonts.
// Keeps basic Latin, Latin-Extended, Arabic, digits, spaces, and common punctuation.
function sanitizeName(str) {
  if (!str) return '';
  return str
    // Emoji: Emoticons, Misc Symbols and Pictographs, Transport, Supplemental, flags
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    // Misc Symbols, Dingbats, Enclosed Alphanumerics, etc.
    .replace(/[\u{2300}-\u{27BF}]/gu, '')
    // Enclosed ideographic supplement, CJK symbols
    .replace(/[\u{2E80}-\u{33FF}]/gu, '')
    // CJK Unified Ideographs and extensions
    .replace(/[\u{4E00}-\u{9FFF}]/gu, '')
    // Hangul, Katakana, Hiragana, etc.
    .replace(/[\u{3000}-\u{4DBF}]/gu, '')
    // Variation selectors, zero-width characters, BOM
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[\u{200B}-\u{200F}]/gu, '')
    // Replacement character
    .replace(/\uFFFD/g, '')
    .trim();
}

// imgbb page links (https://ibb.co/xxxxx or https://imgbb.com/xxxxx) are HTML pages,
// not raw images — Discord's setImage()/setThumbnail() need a direct image URL to work.
// This resolves a page link to its direct i.ibb.co image URL by reading the og:image tag.
// Direct links (i.ibb.co/...) and non-imgbb URLs are returned untouched.
const IMGBB_DIRECT_REGEX = /^https?:\/\/i\.ibb\.co\//i;
const IMGBB_PAGE_REGEX = /^https?:\/\/(?:www\.)?(?:ibb\.co|imgbb\.com)\/[A-Za-z0-9]+/i;

async function resolveImgbbUrl(url) {
  if (!url) return url;
  const trimmed = String(url).trim();
  if (!trimmed) return trimmed;
  if (IMGBB_DIRECT_REGEX.test(trimmed)) return trimmed; // already a direct image link
  if (!IMGBB_PAGE_REGEX.test(trimmed)) return trimmed; // not an imgbb link, leave as-is

  try {
    const res = await axios.get(trimmed, {
      timeout: 8000,
      maxRedirects: 5,
      // Use a normal browser UA here (not "DiscordBot") — imgbb/ibb.co pages
      // are scraped for their og:image tag, and some hosts serve bots a
      // stripped-down page without the meta tags, or block them outright.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const match =
      html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].replace(/&amp;/g, '&');
    }
    console.warn(`resolveImgbbUrl: no og:image found for ${trimmed}`);
  } catch (err) {
    console.error(`resolveImgbbUrl failed for ${trimmed}:`, err.message);
  }
  return trimmed; // fall back to the original link if resolution fails
}

module.exports = { fetchImage, downloadImageBytes, sanitizeName, resolveImgbbUrl };
