const axios = require('axios');

// روابط انستقرام / تيك توك / يوتيوب اللي نرد عليها بالفيديو
const LINK_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+[^\s]*/gi,
  /https?:\/\/(?:vm\.|vt\.|www\.|m\.)?tiktok\.com\/[^\s]+/gi,
  /https?:\/\/(?:www\.)?youtube\.com\/(?:watch\?v=|shorts\/)[A-Za-z0-9_-]+[^\s]*/gi,
  /https?:\/\/youtu\.be\/[A-Za-z0-9_-]+[^\s]*/gi,
];

// شيل أي رموز التصقت آخر الرابط (زي `>` أو `)` أو نقطة السالفة)
function cleanUrl(url) {
  return url.replace(/[)\]>,.]+$/, '');
}

function extractMediaLinks(content) {
  if (!content) return [];
  const found = [];
  for (const pattern of LINK_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) found.push(...matches.map(cleanUrl));
  }
  return [...new Set(found)];
}

// رابط سيرفر cobalt الخاص فيك. config.json is optional in deployments that
// provide configuration through environment variables.
let _mediaCfg = {};
try { _mediaCfg = require('./config.json'); } catch (_) {}
const COBALT_API_URL = (process.env.COBALT_API_URL || _mediaCfg.cobaltApiUrl || '').replace(/\/+$/, '');

const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#].*)?$/i;

function isVideoCandidate(item) {
  if (!item || typeof item !== 'object' || typeof item.url !== 'string') return false;
  const type = String(item.type || '').toLowerCase();
  const mime = String(item.mime || item.contentType || '').toLowerCase();
  const filename = String(item.filename || item.name || '').toLowerCase();
  if (type === 'video' || type.startsWith('video/')) return true;
  if (mime.startsWith('video/')) return true;
  if (/\.(?:mp4|webm|mov|m4v|mkv)(?:[?#].*)?$/i.test(filename)) return true;
  return !IMAGE_URL_RE.test(item.url);
}

function normalizeVideoResult(url, filename = 'video.mp4') {
  if (typeof url !== 'string' || !url.trim()) throw new Error('cobalt: missing_media_url');
  const safeFilename = String(filename || 'video.mp4');
  if (IMAGE_URL_RE.test(url) || IMAGE_URL_RE.test(safeFilename)) {
    throw new Error('cobalt: received_image_not_video');
  }
  return { url, filename: safeFilename };
}

function mediaSourceVariants(sourceUrl) {
  const variants = [sourceUrl];
  // Instagram tracking parameters can cause intermittent resolver failures.
  try {
    const parsed = new URL(sourceUrl);
    if (/instagram\.com$/i.test(parsed.hostname.replace(/^www\./i, ''))) {
      parsed.search = '';
      parsed.hash = '';
      variants.push(parsed.toString());
    }
  } catch (_) {}
  return [...new Set(variants)];
}

function parseCobaltResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('cobalt: empty_or_invalid_response');
  }
  if (data.status === 'error') {
    throw new Error(`cobalt: ${data.error?.code || data.text || 'unknown_error'}`);
  }
  if (data.status === 'tunnel' || data.status === 'redirect') {
    return normalizeVideoResult(data.url, data.filename || 'video.mp4');
  }
  if (data.status === 'local-processing') {
    const tunnelUrl = data.tunnel?.[0];
    if (!tunnelUrl) throw new Error('cobalt: no_tunnel_url');
    return normalizeVideoResult(tunnelUrl, data.output?.filename || 'video.mp4');
  }
  if (data.status === 'picker') {
    const items = Array.isArray(data.picker) ? data.picker : [];
    const firstVideo = items.find(isVideoCandidate);
    if (!firstVideo) throw new Error('cobalt: no_video_in_picker');
    return normalizeVideoResult(firstVideo.url, firstVideo.filename || firstVideo.name || 'video.mp4');
  }
  if (data.url) {
    return normalizeVideoResult(data.url, data.filename || 'video.mp4');
  }
  throw new Error(`cobalt: unexpected_response ${JSON.stringify(data).slice(0, 200)}`);
}

// يسأل cobalt عن رابط تحميل مباشر للفيديو مع fallback للروابط canonical وإعادة المحاولة
async function resolveMedia(sourceUrl) {
  if (!COBALT_API_URL) {
    throw new Error('COBALT_API_URL غير مضبوط في .env');
  }
  let lastError = null;
  for (const candidate of mediaSourceVariants(sourceUrl)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await axios.post(
          `${COBALT_API_URL}/`,
          { url: candidate },
          {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'jura-discord-bot/1.0',
            },
            timeout: 30000,
            validateStatus: () => true,
          },
        );
        if (res.status >= 400) {
          const code = res.data?.error?.code || res.data?.message || `http_${res.status}`;
          throw new Error(`cobalt: ${code}`);
        }
        return parseCobaltResponse(res.data);
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 900));
      }
    }
  }
  throw new Error(`cobalt request failed: ${lastError?.message || 'unknown_error'}`);
}

// يحمّل الفيديو كـ Buffer، ويرمي خطأ إذا تعدى الحجم المسموح
async function downloadMediaBuffer(url, maxBytes) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot; +https://discord.com)' },
  });
  return Buffer.from(res.data);
}

async function downloadInstagramFallback(sourceUrl) {
  const { spawn } = require('child_process');
  const fs = require('fs/promises');
  return await new Promise((resolve, reject) => {
    const child = spawn('python3', ['/home/ec2-user/instagram_fallback.py', sourceUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('instagram fallback timed out'));
    }, 90000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', async code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`instagram fallback failed: ${stderr.trim() || stdout.trim() || `exit_${code}`}`));
      try {
        const result = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || '{}');
        if (!result.path) return reject(new Error(result.error || 'instagram fallback returned no file'));
        await fs.access(result.path);
        resolve(result);
      } catch (error) {
        reject(new Error(`instagram fallback invalid result: ${error.message}`));
      }
    });
  });
}

module.exports = { extractMediaLinks, resolveMedia, downloadMediaBuffer, downloadInstagramFallback };
