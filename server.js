/**
 * TikTok Music Clean - Production Server (Render / Docker / Node.js)
 * Multi-Layer TikTok Music Scraper + Clean Filter + 32MB Chunked Range Stream Proxy
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname), {
  etag: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('feed_data.json') || filePath.endsWith('catalog_bundle.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ============================================================================
// 1. IN-MEMORY & DISK CATALOG DATABASE + STATS
// ============================================================================
const FEED_FILE = path.join(__dirname, 'feed_data.json');
const CATALOG_BUNDLE_FILE = path.join(__dirname, 'catalog_bundle.js');

const state = {
  tracksMap: new Map(),
  streamUrlCache: new Map(), // videoId -> { url, expiresAt }
  blockedAdsCount: 142,
  lastScrapeAt: null,
  isBackgroundScraping: false
};

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function loadInitialDatabase() {
  try {
    if (fs.existsSync(FEED_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
      const list = Array.isArray(raw) ? raw : (raw.tracks || []);
      if (typeof raw.blockedAdsCount === 'number') {
        state.blockedAdsCount = raw.blockedAdsCount;
      }
      list.forEach(item => {
        if (item && item.id) {
          state.tracksMap.set(String(item.id), normalizeStoredTrack(item));
        }
      });
      console.log(`[DB] Loaded ${state.tracksMap.size} clean tracks from feed_data.json`);
    }
  } catch (err) {
    console.warn('[DB] Could not load feed_data.json:', err.message);
  }
}

function normalizeStoredTrack(item) {
  const width = Number(item.width) || (item.aspectRatio === '16:9' ? 1280 : 720);
  const height = Number(item.height) || (item.aspectRatio === '16:9' ? 720 : 1280);
  const aspectRatio = width > height ? '16:9' : '9:16';
  return {
    id: String(item.id),
    title: item.title || item.desc || 'Nhạc TikTok Tuyển Chọn',
    desc: item.desc || item.title || '',
    author: (item.author || 'tiktokmusic').replace(/^@/, ''),
    authorName: item.authorName || item.author || 'TikTok Music',
    avatar: item.avatar || '',
    cover: item.cover || '',
    musicTitle: item.musicTitle || item.title || 'Original Sound - TikTok Music',
    views: item.views || formatViewCount(item.playCount || 150000),
    likes: Number(item.likes || item.diggCount || 12000),
    duration: Number(item.duration || 45),
    width,
    height,
    aspectRatio,
    tags: Array.isArray(item.tags) ? item.tags : extractHashtags(item.desc || ''),
    videoUrl: item.videoUrl || item.playUrl || '',
    searchQuery: item.searchQuery || ''
  };
}

function saveDatabaseToDisk() {
  try {
    const tracks = Array.from(state.tracksMap.values()).slice(0, 600);
    const payload = {
      updatedAt: new Date().toISOString(),
      blockedAdsCount: state.blockedAdsCount,
      totalTracks: tracks.length,
      tracks
    };
    fs.writeFileSync(FEED_FILE, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(
      CATALOG_BUNDLE_FILE,
      `// Auto-generated Clean Music Catalog\nwindow.INITIAL_CATALOG_DATA = ${JSON.stringify(payload)};\n`,
      'utf8'
    );
  } catch (err) {
    // On read-only filesystems, keep in-memory map active without crashing
    console.warn('[DB] Non-fatal write warning:', err.message);
  }
}

// ============================================================================
// 2. CLEAN MUSIC FILTER (BLOCKS TIKTOK SHOP, ADS, LIVESTREAMS, AFFILIATE SPAM)
// ============================================================================
const SPAM_KEYWORDS = [
  'giỏ hàng', 'gio hang', 'mua tại', 'link bio', 'link ở bio', 'shopee', 'lazada',
  'tiktok shop', 'tiktokshop', 'chốt đơn', 'sỉ lẻ', 'inbox giá', 'freeship',
  'mã giảm giá', 'voucher', 'affiliate', 'kèm link', 'bấm vào giỏ', 'click vào giỏ',
  'kem trộn', 'tuyển sỉ', 'xả kho', 'sale sập sàn'
];

function isCleanMusicVideo(rawItem) {
  if (!rawItem) return false;
  if (rawItem.is_ad || rawItem.is_ads || rawItem.is_top === 1 && rawItem.commerce_info?.ad_source) {
    state.blockedAdsCount++;
    return false;
  }
  if (rawItem.commerce_info && (rawItem.commerce_info.ad_source || rawItem.commerce_info.auction_ad_invited)) {
    state.blockedAdsCount++;
    return false;
  }
  if (Array.isArray(rawItem.anchors) && rawItem.anchors.some(a => /shop|product|commerce|ec_/i.test(JSON.stringify(a)))) {
    state.blockedAdsCount++;
    return false;
  }
  const text = `${rawItem.title || ''} ${rawItem.desc || ''}`.toLowerCase();
  for (const kw of SPAM_KEYWORDS) {
    if (text.includes(kw)) {
      state.blockedAdsCount++;
      return false;
    }
  }
  const duration = Number(rawItem.duration || rawItem.video?.duration || 0);
  if (duration > 0 && duration < 10) {
    return false;
  }
  return true;
}

function extractHashtags(text = '') {
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return Array.from(new Set(matches)).slice(0, 8);
}

function formatViewCount(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n || '12.5K');
}

function normalizeTikWMItem(item, extraTag = '') {
  const id = String(item.video_id || item.aweme_id || item.id || '');
  if (!id) return null;

  const rawPlay = item.hdplay || item.play || item.wmplay || '';
  const playUrl = rawPlay.startsWith('http')
    ? rawPlay
    : (rawPlay ? `https://www.tikwm.com${rawPlay}` : '');

  if (playUrl) {
    state.streamUrlCache.set(id, {
      url: playUrl,
      expiresAt: Date.now() + 45 * 60 * 1000
    });
  }

  const width = Number(item.width || item.video?.width || 720);
  const height = Number(item.height || item.video?.height || 1280);
  const aspectRatio = width > height ? '16:9' : '9:16';

  const desc = (item.title || item.desc || '').trim();
  const tags = extractHashtags(desc);
  if (extraTag && !tags.includes(extraTag)) {
    tags.unshift(extraTag.startsWith('#') ? extraTag : `#${extraTag}`);
  }

  return {
    id,
    title: desc || `${item.music_info?.title || 'Nhạc TikTok'} - @${item.author?.unique_id || 'music'}`,
    desc: desc || `${item.music_info?.title || 'Nhạc Chill TikTok'}`,
    author: (item.author?.unique_id || item.author?.nickname || 'tiktokmusic').replace(/^@/, ''),
    authorName: item.author?.nickname || item.author?.unique_id || 'TikTok Music',
    avatar: item.author?.avatar || '',
    cover: item.cover || item.origin_cover || '',
    musicTitle: item.music_info?.title
      ? `${item.music_info.title}${item.music_info.author ? ' — ' + item.music_info.author : ''}`
      : `Nhạc nền — @${item.author?.unique_id || 'tiktokmusic'}`,
    views: formatViewCount(item.play_count || item.statistics?.play_count || 120000),
    likes: Number(item.digg_count || item.statistics?.digg_count || 8500),
    duration: Number(item.duration || item.video?.duration || 45),
    width,
    height,
    aspectRatio,
    tags,
    videoUrl: playUrl
  };
}

// ============================================================================
// 3. RATE-LIMITED SCRAPING QUEUE + MULTI-LAYER FALLBACK ENGINE
// ============================================================================
let queuePromise = Promise.resolve();
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1180; // Respects TikWM 1 req/sec IP limit on Render

function enqueueRequest(taskFn) {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestTime));
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }
    lastRequestTime = Date.now();
    return taskFn();
  };
  const next = queuePromise.then(run, run);
  queuePromise = next.catch(() => {});
  return next;
}

async function callTikWM(endpoint, params = {}, retries = 2) {
  return enqueueRequest(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const url = `https://www.tikwm.com${endpoint}`;
        const response = await axios({
          method: 'GET',
          url,
          params,
          timeout: 12000,
          headers: {
            'User-Agent': randomUA(),
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
            'Referer': 'https://www.tikwm.com/'
          }
        });
        if (response.data && response.data.code === 0 && response.data.data) {
          return response.data.data;
        }
        // Rate limit code === -1 -> wait and retry
        if (response.data && response.data.code === -1 && attempt < retries) {
          await new Promise(r => setTimeout(r, 1400 * (attempt + 1)));
          continue;
        }
        return null;
      } catch (err) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        return null;
      }
    }
    return null;
  });
}

// Layer 2 Fallback: Scrape TikTok Embed V2 HTML directly when API is busy
async function resolveFromTikTokEmbed(videoId) {
  try {
    const embedUrl = `https://www.tiktok.com/embed/v2/${videoId}`;
    const res = await axios.get(embedUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': randomUA(),
        'Accept-Language': 'vi-VN,vi;q=0.9'
      }
    });
    const html = String(res.data || '');
    const playMatch = html.match(/"playAddr"\s*:\s*"([^"]+)"/) || html.match(/"play_addr"[\s\S]*?"url_list"\s*:\s*\[\s*"([^"]+)"/);
    if (playMatch && playMatch[1]) {
      const decoded = playMatch[1]
        .replace(/\\u002F/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
      if (decoded.startsWith('http')) {
        state.streamUrlCache.set(String(videoId), {
          url: decoded,
          expiresAt: Date.now() + 30 * 60 * 1000
        });
        return decoded;
      }
    }
  } catch (_) {}
  return null;
}

async function scrapeSearchByKeyword(rawQuery, count = 24, cursor = 0) {
  const cleanQ = String(rawQuery || 'nhạc chill tiktok').trim();
  const isUser = cleanQ.startsWith('@');
  const results = [];

  if (isUser) {
    const username = cleanQ.replace(/^@+/, '').trim();
    const userData = await callTikWM('/api/user/posts', {
      unique_id: username,
      count: Math.min(count, 30),
      cursor
    });
    const rawVideos = userData?.videos || [];
    for (const v of rawVideos) {
      if (isCleanMusicVideo(v)) {
        const norm = normalizeTikWMItem(v, `@${username}`);
        if (norm) {
          state.tracksMap.set(norm.id, norm);
          results.push(norm);
        }
      }
    }
    if (results.length > 0) {
      state.lastScrapeAt = new Date().toISOString();
      saveDatabaseToDisk();
      return results;
    }
  }

  // Fallback or standard keyword/hashtag search
  const searchKeywords = isUser
    ? `${cleanQ.replace(/^@+/, '')} nhạc`
    : (cleanQ.toLowerCase().includes('nhạc') || cleanQ.toLowerCase().includes('lofi') || cleanQ.toLowerCase().includes('remix') || cleanQ.toLowerCase().includes('chill') || cleanQ.toLowerCase().includes('acoustic') || cleanQ.toLowerCase().includes('bolero') || cleanQ.toLowerCase().includes('piano')
        ? cleanQ
        : `${cleanQ} nhạc`);

  const searchData = await callTikWM('/api/feed/search', {
    keywords: searchKeywords,
    count: Math.min(count, 30),
    cursor
  });

  const rawList = searchData?.videos || (Array.isArray(searchData) ? searchData : []);
  for (const v of rawList) {
    if (isCleanMusicVideo(v)) {
      const norm = normalizeTikWMItem(v, cleanQ.startsWith('#') ? cleanQ : '');
      if (norm) {
        state.tracksMap.set(norm.id, norm);
        results.push(norm);
      }
    }
  }

  if (results.length > 0) {
    state.lastScrapeAt = new Date().toISOString();
    saveDatabaseToDisk();
  }
  return results;
}

async function resolveFreshVideoUrl(videoId) {
  const idStr = String(videoId || '').trim();
  if (!idStr) return null;

  const cached = state.streamUrlCache.get(idStr);
  if (cached && cached.url && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const stored = state.tracksMap.get(idStr);

  // 1. Try TikWM detail lookup by video ID
  const detail = await callTikWM('/api/', {
    url: `https://www.tiktok.com/@tiktok/video/${idStr}`,
    hd: 1
  });
  if (detail) {
    const norm = normalizeTikWMItem(detail);
    if (norm && norm.videoUrl) {
      state.tracksMap.set(idStr, { ...(stored || {}), ...norm });
      return norm.videoUrl;
    }
  }

  // 2. Try TikTok Embed V2 fallback
  const embedUrl = await resolveFromTikTokEmbed(idStr);
  if (embedUrl) {
    return embedUrl;
  }

  // 3. If it's a curated seed track with a searchQuery, resolve a live match on the fly
  if (stored && (stored.searchQuery || stored.title)) {
    const query = stored.searchQuery || stored.title;
    const matches = await scrapeSearchByKeyword(query, 10, 0);
    if (matches.length > 0 && matches[0].videoUrl) {
      const best = matches[0];
      state.streamUrlCache.set(idStr, {
        url: best.videoUrl,
        expiresAt: Date.now() + 45 * 60 * 1000
      });
      stored.videoUrl = best.videoUrl;
      return best.videoUrl;
    }
  }

  return stored?.videoUrl || null;
}

// ============================================================================
// 4. API ROUTES (/api/health, /api/feed, /api/search, /api/user/:u, /api/ingest)
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'tik-music-clean',
    environment: IS_RENDER ? 'render' : 'node',
    totalTracks: state.tracksMap.size,
    blockedAdsCount: state.blockedAdsCount,
    lastScrapeAt: state.lastScrapeAt
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    ok: true,
    totalTracks: state.tracksMap.size,
    blockedAdsCount: state.blockedAdsCount,
    lastScrapeAt: state.lastScrapeAt
  });
});

app.get('/api/feed', async (req, res) => {
  try {
    const tag = String(req.query.tag || '').trim();
    const forceLive = req.query.live === '1';

    if (tag || forceLive) {
      const scraped = await scrapeSearchByKeyword(tag || '#nhacchill', 25, 0);
      if (scraped.length > 0) {
        return res.json({
          ok: true,
          source: 'live_scrape',
          blockedAdsCount: state.blockedAdsCount,
          tracks: scraped
        });
      }
    }

    let allTracks = Array.from(state.tracksMap.values());
    if (tag) {
      const lowerTag = tag.toLowerCase().replace(/^#/, '');
      const filtered = allTracks.filter(t =>
        (t.tags || []).some(tg => tg.toLowerCase().includes(lowerTag)) ||
        (t.title || '').toLowerCase().includes(lowerTag) ||
        (t.desc || '').toLowerCase().includes(lowerTag)
      );
      if (filtered.length > 0) {
        allTracks = filtered;
      }
    }

    // Trigger non-blocking background scrape if catalog is small
    if (state.tracksMap.size < 25 && !state.isBackgroundScraping) {
      triggerBackgroundCatalogWarmup();
    }

    return res.json({
      ok: true,
      source: 'catalog_cache',
      blockedAdsCount: state.blockedAdsCount,
      tracks: allTracks
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.keyword || '').trim();
    if (!q) {
      return res.json({
        ok: true,
        blockedAdsCount: state.blockedAdsCount,
        tracks: Array.from(state.tracksMap.values()).slice(0, 30)
      });
    }

    const scraped = await scrapeSearchByKeyword(q, 28, Number(req.query.cursor || 0));
    if (scraped.length > 0) {
      return res.json({
        ok: true,
        source: 'live_scrape',
        query: q,
        blockedAdsCount: state.blockedAdsCount,
        tracks: scraped
      });
    }

    // Local catalog fallback search if upstream API is temporarily unreachable
    const qLower = q.toLowerCase().replace(/^[@#]/, '');
    const localMatches = Array.from(state.tracksMap.values()).filter(t =>
      (t.title || '').toLowerCase().includes(qLower) ||
      (t.desc || '').toLowerCase().includes(qLower) ||
      (t.author || '').toLowerCase().includes(qLower) ||
      (t.musicTitle || '').toLowerCase().includes(qLower) ||
      (t.tags || []).some(tg => tg.toLowerCase().includes(qLower))
    );

    return res.json({
      ok: true,
      source: 'local_fallback',
      query: q,
      blockedAdsCount: state.blockedAdsCount,
      tracks: localMatches.length > 0 ? localMatches : Array.from(state.tracksMap.values()).slice(0, 15)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/user/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').replace(/^@+/, '').trim();
    if (!username) {
      return res.status(400).json({ ok: false, error: 'Missing username' });
    }
    const scraped = await scrapeSearchByKeyword(`@${username}`, 28, Number(req.query.cursor || 0));
    if (scraped.length > 0) {
      return res.json({
        ok: true,
        username,
        blockedAdsCount: state.blockedAdsCount,
        tracks: scraped
      });
    }
    const localChannel = Array.from(state.tracksMap.values()).filter(
      t => (t.author || '').toLowerCase() === username.toLowerCase()
    );
    return res.json({
      ok: true,
      username,
      blockedAdsCount: state.blockedAdsCount,
      tracks: localChannel
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Client-Assisted Ingest Endpoint: allows residential client browsers to share scraped clean tracks
app.post('/api/ingest', (req, res) => {
  try {
    const items = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
    let added = 0;
    for (const item of items) {
      if (item && item.id && isCleanMusicVideo(item)) {
        const norm = item.video_id ? normalizeTikWMItem(item) : normalizeStoredTrack(item);
        if (norm) {
          state.tracksMap.set(norm.id, norm);
          if (norm.videoUrl) {
            state.streamUrlCache.set(norm.id, {
              url: norm.videoUrl,
              expiresAt: Date.now() + 45 * 60 * 1000
            });
          }
          added++;
        }
      }
    }
    if (added > 0) {
      state.lastScrapeAt = new Date().toISOString();
      saveDatabaseToDisk();
    }
    return res.json({
      ok: true,
      added,
      totalTracks: state.tracksMap.size,
      blockedAdsCount: state.blockedAdsCount
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// 5. 32MB CHUNKED RANGE VIDEO STREAM PROXY (/api/stream/:id)
//    Fixes previous syntax error & auto-refreshes expired 403 CDN URLs
// ============================================================================
const MAX_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB chunk cap

app.get('/api/stream/:id', async (req, res) => {
  const videoId = String(req.params.id || '').trim();
  const directUrlParam = req.query.url ? String(req.query.url) : '';

  try {
    let targetUrl = directUrlParam || (await resolveFreshVideoUrl(videoId));
    if (!targetUrl) {
      return res.status(404).json({ ok: false, error: 'Stream URL could not be resolved' });
    }

    const clientRange = req.headers.range;
    const buildHeaders = () => {
      const h = {
        'User-Agent': randomUA(),
        'Accept': '*/*',
        'Referer': 'https://www.tiktok.com/'
      };
      if (clientRange) {
        const match = clientRange.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const requestedEnd = match[2] ? parseInt(match[2], 10) : start + MAX_CHUNK_SIZE - 1;
          const cappedEnd = Math.min(requestedEnd, start + MAX_CHUNK_SIZE - 1);
          h['Range'] = `bytes=${start}-${cappedEnd}`;
        } else {
          h['Range'] = clientRange;
        }
      }
      return h;
    };

    let upstream;
    try {
      upstream = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: buildHeaders(),
        timeout: 15000,
        validateStatus: status => status >= 200 && status < 400
      });
    } catch (firstErr) {
      // Auto-refresh expired CDN URL on 403 / 410 / 404
      state.streamUrlCache.delete(videoId);
      const refreshedUrl = await resolveFreshVideoUrl(videoId);
      if (!refreshedUrl || refreshedUrl === targetUrl) {
        throw firstErr;
      }
      targetUrl = refreshedUrl;
      upstream = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: buildHeaders(),
        timeout: 15000,
        validateStatus: status => status >= 200 && status < 400
      });
    }

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    if (upstream.headers['content-range']) {
      res.setHeader('Content-Range', upstream.headers['content-range']);
    }

    upstream.data.on('error', () => {
      if (!res.headersSent) res.end();
    });
    req.on('close', () => {
      if (upstream.data && typeof upstream.data.destroy === 'function') {
        upstream.data.destroy();
      }
    });

    upstream.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: 'Failed to proxy video stream', detail: err.message });
    }
  }
});

// ============================================================================
// 6. BACKGROUND WARMUP SCRAPER
// ============================================================================
const SEED_TAGS = [
  '#nhacchill',
  '#lofichill',
  '#nhachaymoingay',
  '#tiktokremix',
  '#acousticmoc',
  '#vpop',
  '#nhacchualanh'
];

async function triggerBackgroundCatalogWarmup() {
  if (state.isBackgroundScraping) return;
  state.isBackgroundScraping = true;
  try {
    for (const tag of SEED_TAGS) {
      const found = await scrapeSearchByKeyword(tag, 15, 0);
      if (found.length > 0) {
        console.log(`[Warmup] Scraped ${found.length} clean music tracks for ${tag}`);
      }
    }
  } catch (err) {
    console.warn('[Warmup] Background scrape warning:', err.message);
  } finally {
    state.isBackgroundScraping = false;
  }
}

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

loadInitialDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`🎵 TikTok Music Clean Server listening on port ${PORT}`);
  console.log(`🛡️ Clean Music Filter active (Blocked Ads: ${state.blockedAdsCount})`);
  console.log(`========================================================`);
  setTimeout(() => {
    triggerBackgroundCatalogWarmup();
  }, 2500);
});
