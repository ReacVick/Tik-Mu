/**
 * TikTok Music Clean - Frontend Application Logic (app.js)
 * Key Features & Fixes:
 * 1. Mobile Left Drawer Search & Tag Touch Fix: Isolates sidebar touch events from stage swipe gestures.
 * 2. Smart Aspect Ratio Engine:
 *    - 9:16 Vertical videos: Fit vertical screen, HIDE zoom/fullscreen button.
 *    - 16:9 Landscape videos: Show zoom button; clicking zooms fullscreen AND rotates to landscape
 *      using Native Screen Orientation Lock + CSS 90deg Rotation Fallback (100% cross-browser on iOS & Android).
 * 3. Hybrid Scraping Engine: Uses Server API (/api/search, /api/feed, /api/user/:u) + Client-Side CORS
 *    Fallback (tikwm.com) + Auto-Ingest (/api/ingest) so scraping works reliably on Render.
 * 4. Dolby Atmos Binaural Web Audio DSP (6 real-time EQ/compressor presets) + Ambient Light Canvas.
 */

(function () {
  'use strict';

  const DEFAULT_TAGS = [
    { label: '#Nhạc Chill', removable: false },
    { label: '#Lofi Chill', removable: false },
    { label: '#Nhạc Hay Mỗi Ngày', removable: false },
    { label: '#TikTok Remix', removable: false },
    { label: '#Acoustic Mộc', removable: false },
    { label: '#VietMix / Nonstop', removable: false },
    { label: '#V-Pop Nhạc Trẻ', removable: false },
    { label: '#Âu Mỹ (US-UK)', removable: false },
    { label: '#Trữ Tình Bolero', removable: false },
    { label: '#Nhạc Chữa Lành', removable: false },
    { label: '#Piano / Không Lời', removable: false },
    { label: '#Nhạc Tâm Trạng', removable: false },
    { label: '#gaixinhnhay', removable: true },
    { label: '#nhaytrend', removable: true },
    { label: '#nhacchill', removable: true },
    { label: '#lofi', removable: true },
    { label: '#remix', removable: true }
  ];

  const SAMPLE_LYRICS = {
    '7389123456789012301': [
      'Thu qua, đông sang, xin em hãy lắng nghe',
      'Nơi tim hoang mang, không gian nay vắng em',
      'Tình nào mà tình chẳng đắng, chẳng say',
      'Rượu vào, người nồng nàn, gửi lời chát, lời cay',
      'Khi ta bên nhau, em đã hứa đi đến sau',
      'Nhưng không bao lâu, anh là người nhận nhói đau',
      'Là mình vội vàng, tình vừa đến dở dang',
      'Vội trao lời ngọt ngào trọn vẹn, người lại vội chào'
    ],
    default: [
      'Giai điệu nhạc TikTok sạch — Không quảng cáo, không TikTok Shop',
      'Tận hưởng âm thanh Dolby Atmos 3D sống động',
      'Vuốt lên/xuống hoặc bấm ⏮ / ⏭ để chuyển bài',
      'Mở thanh bên trái (☰) để tìm bài hát, #hashtag hoặc @kênh bất kỳ'
    ]
  };

  // Safe localStorage wrapper
  function loadStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  // App State
  const initialCatalog = (window.INITIAL_CATALOG_DATA && window.INITIAL_CATALOG_DATA.tracks) || [];
  const appState = {
    allTracks: initialCatalog.slice(),
    playlist: initialCatalog.slice(),
    currentIndex: 0,
    isPlaying: false,
    autoNext: true,
    loopOne: false,
    activeTag: '#nhacchill',
    activeNav: 'feed',
    activeLibTab: 'liked',
    selectedChannel: 'itslowkey._y',
    blockedAdsCount: (window.INITIAL_CATALOG_DATA && window.INITIAL_CATALOG_DATA.blockedAdsCount) || 142,
    tags: loadStorage('tm_tags_v2', DEFAULT_TAGS),
    likedIds: loadStorage('tm_liked_v2', []),
    savedIds: loadStorage('tm_saved_v2', []),
    historyIds: loadStorage('tm_history_v2', []),
    isLandscapeFullscreen: false,
    currentVideoIs16x9: true,
    synthTimer: null,
    synthCurrentTime: 0,
    synthDuration: 60,
    usingFallbackSynth: false,
    audioCtx: null,
    dspPreset: 'atmos',
    dspNodes: null
  };

  // DOM Elements
  const el = {
    statusToast: document.getElementById('statusToast'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    sidebarLeft: document.getElementById('sidebarLeft'),
    sidebarRight: document.getElementById('sidebarRight'),
    btnOpenLeftDrawer: document.getElementById('btnOpenLeftDrawer'),
    btnCloseLeftDrawer: document.getElementById('btnCloseLeftDrawer'),
    btnOpenRightDrawer: document.getElementById('btnOpenRightDrawer'),
    btnCloseRightDrawer: document.getElementById('btnCloseRightDrawer'),
    blockedAdsBadge: document.getElementById('blockedAdsBadge'),
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    tagsCloud: document.getElementById('tagsCloud'),
    btnToggleAddTag: document.getElementById('btnToggleAddTag'),
    addTagBox: document.getElementById('addTagBox'),
    newTagInput: document.getElementById('newTagInput'),
    btnSaveNewTag: document.getElementById('btnSaveNewTag'),
    tabBtnLiked: document.getElementById('tabBtnLiked'),
    tabBtnSaved: document.getElementById('tabBtnSaved'),
    tabLikedNum: document.getElementById('tabLikedNum'),
    tabSavedNum: document.getElementById('tabSavedNum'),
    likedCountBadge: document.getElementById('likedCountBadge'),
    savedCountBadge: document.getElementById('savedCountBadge'),
    channelCountBadge: document.getElementById('channelCountBadge'),
    sidebarLibList: document.getElementById('sidebarLibList'),
    playerStage: document.getElementById('playerStage'),
    ambientCanvas: document.getElementById('ambientCanvas'),
    activeTagPill: document.getElementById('activeTagPill'),
    activeTagText: document.getElementById('activeTagText'),
    btnPrevTrack: document.getElementById('btnPrevTrack'),
    btnNextTrack: document.getElementById('btnNextTrack'),
    mainVideo: document.getElementById('mainVideo'),
    visualLyricStage: document.getElementById('visualLyricStage'),
    lyricLinesBox: document.getElementById('lyricLinesBox'),
    floatingLandscapeBtn: document.getElementById('floatingLandscapeBtn'),
    btnExitLandscape: document.getElementById('btnExitLandscape'),
    railAvatarBtn: document.getElementById('railAvatarBtn'),
    railAvatarImg: document.getElementById('railAvatarImg'),
    btnLikeTrack: document.getElementById('btnLikeTrack'),
    likeLabelText: document.getElementById('likeLabelText'),
    btnSaveTrack: document.getElementById('btnSaveTrack'),
    btnSameMusic: document.getElementById('btnSameMusic'),
    vinylDisc: document.getElementById('vinylDisc'),
    infoAuthor: document.getElementById('infoAuthor'),
    infoViews: document.getElementById('infoViews'),
    aspectBadge: document.getElementById('aspectBadge'),
    infoDesc: document.getElementById('infoDesc'),
    btnToggleDesc: document.getElementById('btnToggleDesc'),
    infoMusicTitle: document.getElementById('infoMusicTitle'),
    btnPlayPause: document.getElementById('btnPlayPause'),
    currentTimeText: document.getElementById('currentTimeText'),
    durationTimeText: document.getElementById('durationTimeText'),
    seekSlider: document.getElementById('seekSlider'),
    btnFullscreenRotate: document.getElementById('btnFullscreenRotate'),
    dspPresetGrid: document.getElementById('dspPresetGrid'),
    activeDspLabel: document.getElementById('activeDspLabel'),
    btnModeAutoNext: document.getElementById('btnModeAutoNext'),
    btnModeLoop: document.getElementById('btnModeLoop'),
    btnRefreshScrape: document.getElementById('btnRefreshScrape'),
    queueTotalCount: document.getElementById('queueTotalCount'),
    upNextQueue: document.getElementById('upNextQueue')
  };

  let toastTimeout = null;
  function showToast(msg) {
    if (!el.statusToast) return;
    el.statusToast.textContent = msg;
    el.statusToast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.statusToast.classList.remove('show');
    }, 2600);
  }

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' + r : r}`;
  }

  // ==========================================================================
  // 1. MOBILE DRAWER CONTROLS & TOUCH ISOLATION FIX
  // ==========================================================================
  function openLeftDrawer(focusSearch) {
    el.sidebarLeft.classList.add('open');
    el.sidebarRight.classList.remove('open');
    el.sidebarBackdrop.classList.add('visible');
    if (focusSearch && el.searchInput) {
      setTimeout(() => {
        el.searchInput.focus();
      }, 180);
    }
  }

  function openRightDrawer() {
    el.sidebarRight.classList.add('open');
    el.sidebarLeft.classList.remove('open');
    el.sidebarBackdrop.classList.add('visible');
  }

  function closeAllDrawers() {
    el.sidebarLeft.classList.remove('open');
    el.sidebarRight.classList.remove('open');
    el.sidebarBackdrop.classList.remove('visible');
  }

  // Isolate touch/click inside sidebars so stage swipe handler never steals focus or closes drawer
  [el.sidebarLeft, el.sidebarRight].forEach(panel => {
    if (!panel) return;
    ['touchstart', 'touchmove', 'touchend'].forEach(evtName => {
      panel.addEventListener(evtName, e => {
        e.stopPropagation();
      }, { passive: true });
    });
  });

  el.btnOpenLeftDrawer.addEventListener('click', () => openLeftDrawer(false));
  el.btnCloseLeftDrawer.addEventListener('click', closeAllDrawers);
  el.btnOpenRightDrawer.addEventListener('click', openRightDrawer);
  el.btnCloseRightDrawer.addEventListener('click', closeAllDrawers);
  el.sidebarBackdrop.addEventListener('click', closeAllDrawers);

  // Clicking the top active tag pill opens search drawer on mobile and focuses search box
  el.activeTagPill.addEventListener('click', () => {
    openLeftDrawer(true);
  });

  // ==========================================================================
  // 2. SMART 9:16 vs 16:9 ASPECT RATIO & LANDSCAPE FULLSCREEN ROTATION
  // ==========================================================================
  function applyAspectRatioMode(is16x9, width, height) {
    appState.currentVideoIs16x9 = Boolean(is16x9);
    if (is16x9) {
      el.playerStage.classList.add('video-16-9');
      el.playerStage.classList.remove('video-9-16');
      el.aspectBadge.textContent = `16:9 MV (${width || 1280}×${height || 720})`;
    } else {
      el.playerStage.classList.add('video-9-16');
      el.playerStage.classList.remove('video-16-9');
      el.aspectBadge.textContent = `9:16 Dọc (${width || 720}×${height || 1280})`;
      // If user was in 16:9 landscape fullscreen and switched to a 9:16 video, exit landscape fullscreen automatically
      if (appState.isLandscapeFullscreen) {
        exitLandscapeFullscreen();
      }
    }
  }

  function syncLandscapeOrientationClass() {
    if (!appState.isLandscapeFullscreen) {
      el.playerStage.classList.remove('css-rotate-90');
      return;
    }
    // If viewport is still portrait (e.g. iOS Safari or Android with rotation lock enabled),
    // rotate the stage 90 degrees via CSS so the 16:9 video fills the screen horizontally!
    const isViewportPortrait = window.innerHeight > window.innerWidth;
    if (isViewportPortrait) {
      el.playerStage.classList.add('css-rotate-90');
    } else {
      el.playerStage.classList.remove('css-rotate-90');
    }
  }

  async function enterLandscapeFullscreen() {
    if (!appState.currentVideoIs16x9) {
      showToast('Video 9:16 đã vừa khít màn hình dọc');
      return;
    }
    appState.isLandscapeFullscreen = true;
    el.playerStage.classList.add('landscape-fullscreen-active');
    syncLandscapeOrientationClass();

    // 1. Try Native Fullscreen API
    try {
      const reqFs = el.playerStage.requestFullscreen || el.playerStage.webkitRequestFullscreen || el.playerStage.msRequestFullscreen;
      if (reqFs && !document.fullscreenElement) {
        await reqFs.call(el.playerStage);
      }
    } catch (_) {}

    // 2. Try Native Screen Orientation Lock to Landscape
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape');
      }
    } catch (_) {}

    // 3. Re-check viewport after 220ms to ensure CSS 90deg fallback activates if device stayed portrait
    setTimeout(syncLandscapeOrientationClass, 220);
    showToast('Đã phóng to & xoay ngang 16:9 (Bấm ✕ để thu nhỏ)');
  }

  async function exitLandscapeFullscreen() {
    appState.isLandscapeFullscreen = false;
    el.playerStage.classList.remove('landscape-fullscreen-active', 'css-rotate-90');

    try {
      if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
      }
    } catch (_) {}

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (_) {}
  }

  function toggleLandscapeFullscreen() {
    if (appState.isLandscapeFullscreen) {
      exitLandscapeFullscreen();
    } else {
      enterLandscapeFullscreen();
    }
  }

  el.btnFullscreenRotate.addEventListener('click', toggleLandscapeFullscreen);
  el.floatingLandscapeBtn.addEventListener('click', enterLandscapeFullscreen);
  el.btnExitLandscape.addEventListener('click', exitLandscapeFullscreen);

  window.addEventListener('resize', () => {
    if (appState.isLandscapeFullscreen) {
      syncLandscapeOrientationClass();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && appState.isLandscapeFullscreen && !el.playerStage.classList.contains('css-rotate-90')) {
      exitLandscapeFullscreen();
    }
  });

  // ==========================================================================
  // 3. HYBRID MULTI-LAYER SCRAPING (SERVER API + CLIENT FALLBACK + INGEST)
  // ==========================================================================
  const SPAM_KEYWORDS = [
    'giỏ hàng', 'gio hang', 'mua tại', 'link bio', 'shopee', 'lazada',
    'tiktok shop', 'chốt đơn', 'sỉ lẻ', 'affiliate', 'freeship', 'voucher'
  ];

  function isCleanItemClient(raw) {
    if (!raw || raw.is_ad || raw.is_ads || raw.commerce_info?.ad_source) {
      appState.blockedAdsCount++;
      return false;
    }
    const text = `${raw.title || ''} ${raw.desc || ''}`.toLowerCase();
    for (const w of SPAM_KEYWORDS) {
      if (text.includes(w)) {
        appState.blockedAdsCount++;
        return false;
      }
    }
    return true;
  }

  function normalizeClientTikWM(v, tagHint) {
    const id = String(v.video_id || v.id || '');
    if (!id) return null;
    const width = Number(v.width || 720);
    const height = Number(v.height || 1280);
    const rawPlay = v.hdplay || v.play || '';
    const videoUrl = rawPlay.startsWith('http') ? rawPlay : (rawPlay ? `https://www.tikwm.com${rawPlay}` : '');
    const playCount = Number(v.play_count || 125000);
    const views = playCount >= 1000000
      ? (playCount / 1000000).toFixed(1) + 'M'
      : Math.max(1, Math.round(playCount / 1000)) + 'K';

    return {
      id,
      title: (v.title || 'Nhạc TikTok Tuyển Chọn').trim(),
      desc: (v.title || '').trim(),
      author: (v.author?.unique_id || 'tiktokmusic').replace(/^@/, ''),
      authorName: v.author?.nickname || 'TikTok Music',
      avatar: v.author?.avatar || '',
      musicTitle: v.music_info?.title || 'Original Sound — TikTok Music',
      views,
      likes: Number(v.digg_count || 9200),
      duration: Number(v.duration || 45),
      width,
      height,
      aspectRatio: width > height ? '16:9' : '9:16',
      tags: tagHint ? [tagHint] : ['#nhacchill'],
      videoUrl
    };
  }

  async function clientDirectScrapeFallback(query) {
    try {
      const cleanQ = String(query || '#nhacchill').trim();
      const isUser = cleanQ.startsWith('@');
      const endpoint = isUser
        ? `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(cleanQ.replace(/^@/, ''))}&count=25&cursor=0`
        : `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(cleanQ.includes('nhạc') ? cleanQ : cleanQ + ' nhạc')}&count=25&cursor=0`;

      const res = await fetch(endpoint);
      if (!res.ok) return [];
      const json = await res.json();
      const rawVideos = json?.data?.videos || [];
      const cleaned = [];
      for (const item of rawVideos) {
        if (isCleanItemClient(item)) {
          const norm = normalizeClientTikWM(item, cleanQ.startsWith('#') ? cleanQ : '');
          if (norm) cleaned.push(norm);
        }
      }
      el.blockedAdsBadge.textContent = String(appState.blockedAdsCount);

      // Asynchronously share newly scraped tracks with backend /api/ingest
      if (cleaned.length > 0) {
        const ingestUrl = [window.location.origin, 'api', 'ingest'].join('/');
        fetch(ingestUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: cleaned })
        }).catch(() => {});
      }
      return cleaned;
    } catch (_) {
      return [];
    }
  }

  async function searchAndLoadTracks(query, labelOverride) {
    const q = String(query || '').trim();
    if (!q) return;

    appState.activeTag = labelOverride || q;
    el.activeTagText.textContent = appState.activeTag;
    showToast(`Đang tìm & cào nhạc: ${q}...`);
    closeAllDrawers();

    let foundTracks = [];

    // 1. Try Server API first (/api/user/:u or /api/search?q=...)
    try {
      const apiUrl = q.startsWith('@')
        ? `/api/user/${encodeURIComponent(q.replace(/^@/, ''))}`
        : `/api/search?q=${encodeURIComponent(q)}`;
      const resp = await fetch(apiUrl);
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.blockedAdsCount === 'number') {
          appState.blockedAdsCount = data.blockedAdsCount;
          el.blockedAdsBadge.textContent = String(appState.blockedAdsCount);
        }
        if (Array.isArray(data.tracks) && data.tracks.length > 0 && data.source === 'live_scrape') {
          foundTracks = data.tracks;
        } else if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          foundTracks = data.tracks;
        }
      }
    } catch (_) {}

    // 2. If server returned local fallback or was unreachable, also try direct client residential scrape
    if (foundTracks.length === 0 || !foundTracks[0].videoUrl) {
      const directClientTracks = await clientDirectScrapeFallback(q);
      if (directClientTracks.length > 0) {
        foundTracks = directClientTracks;
      }
    }

    // 3. Fallback to filtering existing catalog
    if (foundTracks.length === 0) {
      const qLower = q.toLowerCase().replace(/^[@#]/, '');
      foundTracks = appState.allTracks.filter(t =>
        (t.title || '').toLowerCase().includes(qLower) ||
        (t.desc || '').toLowerCase().includes(qLower) ||
        (t.author || '').toLowerCase().includes(qLower) ||
        (t.musicTitle || '').toLowerCase().includes(qLower) ||
        (t.tags || []).some(tg => tg.toLowerCase().includes(qLower))
      );
    }

    if (foundTracks.length === 0) {
      showToast(`Không tìm thấy "${q}", hiển thị danh sách đề xuất`);
      foundTracks = appState.allTracks.slice();
    } else {
      // Merge into allTracks
      const existingIds = new Set(appState.allTracks.map(t => t.id));
      foundTracks.forEach(t => {
        if (!existingIds.has(t.id)) {
          appState.allTracks.unshift(t);
          existingIds.add(t.id);
        }
      });
      showToast(`Đã tải ${foundTracks.length} bài nhạc cho "${q}"`);
    }

    appState.playlist = foundTracks;
    appState.currentIndex = 0;
    renderTagsCloud();
    renderQueue();
    loadTrackAtIndex(0, true);
  }

  // Wire Search Form (Works with both Enter key on mobile keyboard and tapping "Tìm" button)
  el.searchForm.addEventListener('submit', e => {
    e.preventDefault();
    e.stopPropagation();
    const q = el.searchInput.value.trim();
    if (!q) {
      showToast('Hãy nhập tên bài nhạc, #tag hoặc @kênh cần tìm');
      el.searchInput.focus();
      return;
    }
    el.searchInput.blur();
    searchAndLoadTracks(q, q);
  });

  el.searchBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const q = el.searchInput.value.trim();
    if (!q) {
      showToast('Hãy nhập tên bài nhạc, #tag hoặc @kênh cần tìm');
      el.searchInput.focus();
      return;
    }
    el.searchInput.blur();
    searchAndLoadTracks(q, q);
  });

  // ==========================================================================
  // 4. VIDEO & SYNTHESIZED AUDIO PLAYBACK ENGINE + DOLBY ATMOS DSP
  // ==========================================================================
  function ensureAudioDSP() {
    if (appState.audioCtx) {
      if (appState.audioCtx.state === 'suspended') {
        appState.audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 120;

      const midFilter = ctx.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = 1100;
      midFilter.Q.value = 1.0;

      const trebleFilter = ctx.createBiquadFilter();
      trebleFilter.type = 'highshelf';
      trebleFilter.frequency.value = 6500;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.ratio.value = 3;

      const masterGain = ctx.createGain();
      masterGain.gain.value = 1.0;

      bassFilter.connect(midFilter);
      midFilter.connect(trebleFilter);
      trebleFilter.connect(compressor);
      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      try {
        const mediaSource = ctx.createMediaElementSource(el.mainVideo);
        mediaSource.connect(bassFilter);
      } catch (_) {}

      appState.audioCtx = ctx;
      appState.dspNodes = { bassFilter, midFilter, trebleFilter, masterGain };
      applyDspPreset(appState.dspPreset);
    } catch (_) {}
  }

  function applyDspPreset(presetKey) {
    appState.dspPreset = presetKey;
    const labels = {
      flat: 'Chuẩn Original',
      atmos: 'Dolby Atmos 3D',
      bass: 'Siêu Trầm Bass',
      lofi: 'Lofi Chill Ấm',
      vocal: 'Vocal Acoustic',
      club: 'Vũ Trường Remix'
    };
    el.activeDspLabel.textContent = labels[presetKey] || 'Dolby Atmos 3D';

    document.querySelectorAll('#dspPresetGrid .dsp-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.dsp === presetKey);
    });

    if (!appState.dspNodes) return;
    const { bassFilter, midFilter, trebleFilter, masterGain } = appState.dspNodes;
    const configs = {
      flat:   { b: 0,  m: 0,  t: 0,  g: 1.0 },
      atmos:  { b: 5,  m: 2,  t: 6,  g: 1.12 },
      bass:   { b: 10, m: -1, t: 2,  g: 1.15 },
      lofi:   { b: 4,  m: 1,  t: -7, g: 0.96 },
      vocal:  { b: -2, m: 6,  t: 4,  g: 1.08 },
      club:   { b: 8,  m: -2, t: 7,  g: 1.18 }
    };
    const cfg = configs[presetKey] || configs.atmos;
    bassFilter.gain.value = cfg.b;
    midFilter.gain.value = cfg.m;
    trebleFilter.gain.value = cfg.t;
    masterGain.gain.value = cfg.g;
  }

  el.dspPresetGrid.addEventListener('click', e => {
    const btn = e.target.closest('.dsp-btn');
    if (!btn) return;
    ensureAudioDSP();
    applyDspPreset(btn.dataset.dsp);
    showToast(`Đã bật cấu hình âm thanh: ${btn.textContent.trim()}`);
  });

  // Gentle Web Audio melodic backing when playing offline/Canvas preview tracks
  let synthInterval = null;
  function startFallbackMelody() {
    stopFallbackMelody();
    ensureAudioDSP();
    if (!appState.audioCtx || !appState.dspNodes) return;
    const notes = [261.63, 329.63, 392.00, 493.88, 440.00, 349.23, 293.66, 392.00];
    let step = 0;
    synthInterval = setInterval(() => {
      if (!appState.isPlaying || !appState.usingFallbackSynth || !appState.audioCtx) return;
      try {
        const ctx = appState.audioCtx;
        if (ctx.state === 'suspended') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = notes[step % notes.length];
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.75);
        osc.connect(gain);
        gain.connect(appState.dspNodes.bassFilter);
        osc.start();
        osc.stop(ctx.currentTime + 0.78);
        step++;
      } catch (_) {}
    }, 800);
  }

  function stopFallbackMelody() {
    if (synthInterval) {
      clearInterval(synthInterval);
      synthInterval = null;
    }
  }

  function startFallbackProgressTimer(durationSec) {
    clearInterval(appState.synthTimer);
    appState.usingFallbackSynth = true;
    appState.synthDuration = Number(durationSec) || 60;
    appState.synthCurrentTime = 0;
    el.durationTimeText.textContent = formatSeconds(appState.synthDuration);
    el.visualLyricStage.classList.add('active');

    appState.synthTimer = setInterval(() => {
      if (!appState.isPlaying) return;
      appState.synthCurrentTime += 0.25;
      if (appState.synthCurrentTime >= appState.synthDuration) {
        if (appState.loopOne) {
          appState.synthCurrentTime = 0;
        } else if (appState.autoNext) {
          playNextTrack();
          return;
        } else {
          pausePlayback();
          return;
        }
      }
      el.currentTimeText.textContent = formatSeconds(appState.synthCurrentTime);
      el.seekSlider.value = String((appState.synthCurrentTime / appState.synthDuration) * 100);
    }, 250);
  }

  function loadTrackAtIndex(idx, autoPlay) {
    if (!appState.playlist.length) return;
    const safeIdx = ((idx % appState.playlist.length) + appState.playlist.length) % appState.playlist.length;
    appState.currentIndex = safeIdx;
    const track = appState.playlist[safeIdx];
    if (!track) return;

    // Record in history
    appState.historyIds = [track.id, ...appState.historyIds.filter(id => id !== track.id)].slice(0, 60);
    saveStorage('tm_history_v2', appState.historyIds);

    // Update UI metadata
    appState.selectedChannel = (track.author || 'itslowkey._y').replace(/^@/, '');
    el.infoAuthor.textContent = `@${appState.selectedChannel}`;
    el.infoViews.textContent = `• ${track.views || '120K'} lượt xem`;
    el.infoDesc.textContent = track.desc || track.title || '';
    el.infoDesc.classList.remove('expanded');
    el.btnToggleDesc.textContent = 'thêm';
    el.infoMusicTitle.textContent = track.musicTitle || track.title || 'TikTok Music Clean';

    if (track.avatar) {
      el.railAvatarImg.src = track.avatar;
    }

    // Update aspect ratio immediately from track metadata (and refine on loadedmetadata)
    const w = Number(track.width) || (track.aspectRatio === '16:9' ? 1280 : 720);
    const h = Number(track.height) || (track.aspectRatio === '16:9' ? 720 : 1280);
    applyAspectRatioMode(w > h, w, h);

    // Populate fallback lyric stage lines
    const lines = SAMPLE_LYRICS[track.id] || [
      track.title || 'Nhạc TikTok Tuyển Chọn',
      track.desc || '',
      `Kênh: @${appState.selectedChannel} • ${track.views || '100K'} lượt xem`,
      `Âm thanh: ${track.musicTitle || 'Dolby Atmos Clean Stream'}`
    ];
    el.lyricLinesBox.innerHTML = lines.map(l => `<p>${l}</p>`).join('');

    updateActionButtonsState(track.id);
    renderQueue();
    updateChannelBadgeCount();

    // Stop previous timers
    clearInterval(appState.synthTimer);
    stopFallbackMelody();
    appState.usingFallbackSynth = false;
    el.currentTimeText.textContent = '0:00';
    el.durationTimeText.textContent = formatSeconds(track.duration || 60);
    el.seekSlider.value = '0';

    // Determine video stream source: server proxy `/api/stream/:id` or direct `videoUrl`
    const streamSrc = track.videoUrl
      ? track.videoUrl
      : `/api/stream/${encodeURIComponent(track.id)}`;

    el.visualLyricStage.classList.remove('active');
    el.mainVideo.src = streamSrc;
    el.mainVideo.load();

    if (autoPlay) {
      startPlayback(track);
    } else {
      pausePlayback();
    }
  }

  function startPlayback(trackObj) {
    const track = trackObj || appState.playlist[appState.currentIndex];
    appState.isPlaying = true;
    el.btnPlayPause.textContent = '⏸';
    el.vinylDisc.classList.add('playing');

    const playPromise = el.mainVideo.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // If stream URL is offline (e.g. inside sandboxed Canvas preview), smoothly run visual lyric stage
        startFallbackProgressTimer(track ? track.duration : 60);
        startFallbackMelody();
      });
    }
  }

  function pausePlayback() {
    appState.isPlaying = false;
    el.btnPlayPause.textContent = '▶';
    el.vinylDisc.classList.remove('playing');
    try {
      el.mainVideo.pause();
    } catch (_) {}
    stopFallbackMelody();
  }

  function togglePlayPause() {
    ensureAudioDSP();
    if (appState.isPlaying) {
      pausePlayback();
    } else {
      if (appState.usingFallbackSynth) {
        appState.isPlaying = true;
        el.btnPlayPause.textContent = '⏸';
        el.vinylDisc.classList.add('playing');
        startFallbackMelody();
      } else {
        startPlayback();
      }
    }
  }

  function playNextTrack() {
    loadTrackAtIndex(appState.currentIndex + 1, true);
  }

  function playPrevTrack() {
    loadTrackAtIndex(appState.currentIndex - 1, true);
  }

  // Video element events
  el.mainVideo.addEventListener('loadedmetadata', () => {
    const vw = el.mainVideo.videoWidth;
    const vh = el.mainVideo.videoHeight;
    if (vw > 0 && vh > 0) {
      applyAspectRatioMode(vw > vh, vw, vh);
    }
    if (el.mainVideo.duration && isFinite(el.mainVideo.duration)) {
      el.durationTimeText.textContent = formatSeconds(el.mainVideo.duration);
    }
  });

  el.mainVideo.addEventListener('timeupdate', () => {
    if (appState.usingFallbackSynth) return;
    const cur = el.mainVideo.currentTime || 0;
    const dur = el.mainVideo.duration || 60;
    el.currentTimeText.textContent = formatSeconds(cur);
    if (dur > 0 && isFinite(dur)) {
      el.durationTimeText.textContent = formatSeconds(dur);
      el.seekSlider.value = String((cur / dur) * 100);
    }
  });

  el.mainVideo.addEventListener('ended', () => {
    if (appState.loopOne) {
      el.mainVideo.currentTime = 0;
      el.mainVideo.play().catch(() => {});
    } else if (appState.autoNext) {
      playNextTrack();
    } else {
      pausePlayback();
    }
  });

  el.mainVideo.addEventListener('error', () => {
    const track = appState.playlist[appState.currentIndex];
    startFallbackProgressTimer(track ? track.duration : 60);
    if (appState.isPlaying) {
      startFallbackMelody();
    }
  });

  // Seekbar interaction (Isolated from stage swipe!)
  el.seekSlider.addEventListener('input', e => {
    e.stopPropagation();
    const pct = Number(el.seekSlider.value) / 100;
    if (appState.usingFallbackSynth) {
      appState.synthCurrentTime = pct * appState.synthDuration;
      el.currentTimeText.textContent = formatSeconds(appState.synthCurrentTime);
    } else if (el.mainVideo.duration && isFinite(el.mainVideo.duration)) {
      el.mainVideo.currentTime = pct * el.mainVideo.duration;
    }
  });

  ['touchstart', 'touchmove', 'touchend'].forEach(evt => {
    el.seekSlider.addEventListener(evt, e => e.stopPropagation(), { passive: true });
  });

  el.btnPlayPause.addEventListener('click', togglePlayPause);
  el.btnNextTrack.addEventListener('click', playNextTrack);
  el.btnPrevTrack.addEventListener('click', playPrevTrack);

  // Tap video viewport to play/pause
  document.getElementById('videoViewport').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    togglePlayPause();
  });

  // Vertical Swipe Gesture on Center Stage (Strictly ignores touches when drawers are open or on controls!)
  let touchStartY = null;
  let touchStartX = null;

  el.playerStage.addEventListener('touchstart', e => {
    if (
      el.sidebarLeft.classList.contains('open') ||
      el.sidebarRight.classList.contains('open') ||
      e.target.closest('button, input, form, .bottom-player-bar, .action-rail, .top-stage-bar')
    ) {
      touchStartY = null;
      return;
    }
    if (e.touches && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    }
  }, { passive: true });

  el.playerStage.addEventListener('touchend', e => {
    if (touchStartY === null || !e.changedTouches || !e.changedTouches.length) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dx = e.changedTouches[0].clientX - touchStartX;
    touchStartY = null;

    if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        playNextTrack();
      } else {
        playPrevTrack();
      }
    }
  }, { passive: true });

  // ==========================================================================
  // 5. TAGS, NAVIGATION, LIKES, SAVES & QUEUE RENDERING
  // ==========================================================================
  function renderTagsCloud() {
    el.tagsCloud.innerHTML = '';
    appState.tags.forEach((tagObj, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (appState.activeTag.toLowerCase() === tagObj.label.toLowerCase() ? ' active' : '');
      const textSpan = document.createElement('span');
      textSpan.textContent = tagObj.label;
      chip.appendChild(textSpan);

      if (tagObj.removable) {
        const rm = document.createElement('span');
        rm.className = 'tag-remove';
        rm.textContent = '✕';
        rm.title = 'Xóa thẻ tag này';
        rm.addEventListener('click', e => {
          e.stopPropagation();
          appState.tags.splice(idx, 1);
          saveStorage('tm_tags_v2', appState.tags);
          renderTagsCloud();
          showToast(`Đã xóa thẻ ${tagObj.label}`);
        });
        chip.appendChild(rm);
      }

      chip.addEventListener('click', () => {
        searchAndLoadTracks(tagObj.label, tagObj.label);
      });

      el.tagsCloud.appendChild(chip);
    });
  }

  el.btnToggleAddTag.addEventListener('click', () => {
    el.addTagBox.classList.toggle('show');
    if (el.addTagBox.classList.contains('show')) {
      el.newTagInput.focus();
    }
  });

  el.btnSaveNewTag.addEventListener('click', () => {
    const raw = el.newTagInput.value.trim();
    if (!raw) return;
    const formatted = raw.startsWith('#') ? raw : `#${raw}`;
    if (!appState.tags.some(t => t.label.toLowerCase() === formatted.toLowerCase())) {
      appState.tags.push({ label: formatted, removable: true });
      saveStorage('tm_tags_v2', appState.tags);
      renderTagsCloud();
    }
    el.newTagInput.value = '';
    el.addTagBox.classList.remove('show');
    searchAndLoadTracks(formatted, formatted);
  });

  function updateActionButtonsState(trackId) {
    const isLiked = appState.likedIds.includes(trackId);
    const isSaved = appState.savedIds.includes(trackId);

    el.btnLikeTrack.classList.toggle('liked', isLiked);
    el.btnLikeTrack.querySelector('.rail-icon-circle').textContent = isLiked ? '❤️' : '🤍';

    el.btnSaveTrack.classList.toggle('saved', isSaved);

    el.likedCountBadge.textContent = String(appState.likedIds.length);
    el.savedCountBadge.textContent = String(appState.savedIds.length);
    el.tabLikedNum.textContent = String(appState.likedIds.length);
    el.tabSavedNum.textContent = String(appState.savedIds.length);

    renderSidebarLibraryList();
  }

  function updateChannelBadgeCount() {
    const count = appState.allTracks.filter(
      t => (t.author || '').toLowerCase() === appState.selectedChannel.toLowerCase()
    ).length;
    el.channelCountBadge.textContent = String(count);
  }

  el.btnLikeTrack.addEventListener('click', () => {
    const track = appState.playlist[appState.currentIndex];
    if (!track) return;
    const idx = appState.likedIds.indexOf(track.id);
    if (idx === -1) {
      appState.likedIds.unshift(track.id);
      showToast('Đã thêm vào Bài hát yêu thích ❤️');
    } else {
      appState.likedIds.splice(idx, 1);
      showToast('Đã bỏ khỏi Bài hát yêu thích');
    }
    saveStorage('tm_liked_v2', appState.likedIds);
    updateActionButtonsState(track.id);
  });

  el.btnSaveTrack.addEventListener('click', () => {
    const track = appState.playlist[appState.currentIndex];
    if (!track) return;
    const idx = appState.savedIds.indexOf(track.id);
    if (idx === -1) {
      appState.savedIds.unshift(track.id);
      showToast('Đã lưu vào Phần lưu nhạc 🔖');
    } else {
      appState.savedIds.splice(idx, 1);
      showToast('Đã bỏ khỏi Phần lưu nhạc');
    }
    saveStorage('tm_saved_v2', appState.savedIds);
    updateActionButtonsState(track.id);
  });

  el.btnSameMusic.addEventListener('click', () => {
    const track = appState.playlist[appState.currentIndex];
    if (!track) return;
    const q = track.musicTitle || track.title || '#nhacchill';
    searchAndLoadTracks(q, `🎵 ${q.slice(0, 22)}`);
  });

  el.railAvatarBtn.addEventListener('click', () => {
    searchAndLoadTracks(`@${appState.selectedChannel}`, `@${appState.selectedChannel}`);
  });

  el.infoAuthor.addEventListener('click', () => {
    searchAndLoadTracks(`@${appState.selectedChannel}`, `@${appState.selectedChannel}`);
  });

  el.btnToggleDesc.addEventListener('click', () => {
    const expanded = el.infoDesc.classList.toggle('expanded');
    el.btnToggleDesc.textContent = expanded ? 'thu gọn' : 'thêm';
  });

  // Left Sidebar Navigation Items
  document.querySelectorAll('.nav-menu .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-menu .nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const navType = btn.dataset.nav;
      appState.activeNav = navType;

      if (navType === 'feed') {
        appState.playlist = appState.allTracks.slice();
        el.activeTagText.textContent = '#nhacchill';
        closeAllDrawers();
        loadTrackAtIndex(0, true);
      } else if (navType === 'channel') {
        searchAndLoadTracks(`@${appState.selectedChannel}`, `@${appState.selectedChannel}`);
      } else if (navType === 'shuffle') {
        const shuffled = appState.allTracks.slice().sort(() => Math.random() - 0.5);
        appState.playlist = shuffled;
        el.activeTagText.textContent = '🧭 Trộn nhạc';
        closeAllDrawers();
        loadTrackAtIndex(0, true);
        showToast('Đã trộn ngẫu nhiên danh sách phát');
      } else if (navType === 'saved') {
        const savedTracks = appState.allTracks.filter(t => appState.savedIds.includes(t.id));
        if (!savedTracks.length) {
          showToast('Chưa có bài nhạc nào được lưu 🔖');
          return;
        }
        appState.playlist = savedTracks;
        el.activeTagText.textContent = '🔖 Đã lưu';
        closeAllDrawers();
        loadTrackAtIndex(0, true);
      } else if (navType === 'liked') {
        const likedTracks = appState.allTracks.filter(t => appState.likedIds.includes(t.id));
        if (!likedTracks.length) {
          showToast('Chưa có bài hát yêu thích nào ❤️');
          return;
        }
        appState.playlist = likedTracks;
        el.activeTagText.textContent = '❤️ Yêu thích';
        closeAllDrawers();
        loadTrackAtIndex(0, true);
      } else if (navType === 'history') {
        const histTracks = appState.historyIds
          .map(id => appState.allTracks.find(t => t.id === id))
          .filter(Boolean);
        if (!histTracks.length) {
          showToast('Lịch sử nghe đang trống');
          return;
        }
        appState.playlist = histTracks;
        el.activeTagText.textContent = '🕒 Lịch sử';
        closeAllDrawers();
        loadTrackAtIndex(0, true);
      }
      renderQueue();
    });
  });

  // Library Bottom Tabs in Left Sidebar
  el.tabBtnLiked.addEventListener('click', () => {
    appState.activeLibTab = 'liked';
    el.tabBtnLiked.classList.add('active');
    el.tabBtnSaved.classList.remove('active');
    renderSidebarLibraryList();
  });

  el.tabBtnSaved.addEventListener('click', () => {
    appState.activeLibTab = 'saved';
    el.tabBtnSaved.classList.add('active');
    el.tabBtnLiked.classList.remove('active');
    renderSidebarLibraryList();
  });

  function renderSidebarLibraryList() {
    const targetIds = appState.activeLibTab === 'liked' ? appState.likedIds : appState.savedIds;
    const items = targetIds.map(id => appState.allTracks.find(t => t.id === id)).filter(Boolean);
    if (!items.length) {
      el.sidebarLibList.innerHTML = `<div class="lib-empty">${
        appState.activeLibTab === 'liked'
          ? 'Chưa có bài hát yêu thích nào. Bấm ❤️ trên video để thêm!'
          : 'Chưa có bài nhạc đã lưu nào. Bấm 📑 Lưu nhạc trên video để thêm!'
      }</div>`;
      return;
    }
    el.sidebarLibList.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'lib-mini-item';
      row.innerHTML = `<span class="lib-mini-title">${item.title}</span><span>▶</span>`;
      row.addEventListener('click', () => {
        appState.playlist = items;
        const idx = items.findIndex(x => x.id === item.id);
        closeAllDrawers();
        loadTrackAtIndex(idx >= 0 ? idx : 0, true);
      });
      el.sidebarLibList.appendChild(row);
    });
  }

  function renderQueue() {
    el.queueTotalCount.textContent = String(appState.playlist.length);
    el.upNextQueue.innerHTML = '';
    appState.playlist.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'queue-item' + (idx === appState.currentIndex ? ' playing' : '');
      const ratioTag = (item.width > item.height || item.aspectRatio === '16:9') ? '16:9' : '9:16';
      div.innerHTML = `
        <div class="queue-meta">
          <div class="queue-title">${item.title}</div>
          <div class="queue-sub">
            <span>@${item.author}</span>
            <span>•</span>
            <span>${ratioTag}</span>
            <span>•</span>
            <span>${item.views || '100K'}</span>
          </div>
        </div>
        <span>${idx === appState.currentIndex ? '🔊' : '▶'}</span>
      `;
      div.addEventListener('click', () => {
        closeAllDrawers();
        loadTrackAtIndex(idx, true);
      });
      el.upNextQueue.appendChild(div);
    });
  }

  // Playback Mode Buttons in Right Sidebar
  el.btnModeAutoNext.addEventListener('click', () => {
    appState.autoNext = !appState.autoNext;
    el.btnModeAutoNext.classList.toggle('active', appState.autoNext);
    showToast(appState.autoNext ? 'Đã bật Tự chuyển bài' : 'Đã tắt Tự chuyển bài');
  });

  el.btnModeLoop.addEventListener('click', () => {
    appState.loopOne = !appState.loopOne;
    el.btnModeLoop.classList.toggle('active', appState.loopOne);
    showToast(appState.loopOne ? 'Đã bật Lặp lại 1 bài' : 'Đã tắt Lặp lại 1 bài');
  });

  el.btnRefreshScrape.addEventListener('click', () => {
    searchAndLoadTracks(appState.activeTag || '#nhacchill', appState.activeTag || '#nhacchill');
  });

  // ==========================================================================
  // 6. YOUTUBE-STYLE AMBIENT LIGHT CANVAS LOOP
  // ==========================================================================
  const ambCtx = el.ambientCanvas ? el.ambientCanvas.getContext('2d') : null;
  let hueShift = 0;
  function renderAmbientLoop() {
    if (ambCtx) {
      try {
        if (!appState.usingFallbackSynth && el.mainVideo.readyState >= 2) {
          ambCtx.drawImage(el.mainVideo, 0, 0, el.ambientCanvas.width, el.ambientCanvas.height);
        } else {
          hueShift = (hueShift + 0.4) % 360;
          const grad = ambCtx.createLinearGradient(0, 0, el.ambientCanvas.width, el.ambientCanvas.height);
          grad.addColorStop(0, `hsl(${(345 + hueShift * 0.2) % 360}, 82%, 32%)`);
          grad.addColorStop(1, `hsl(${(190 + hueShift * 0.2) % 360}, 78%, 24%)`);
          ambCtx.fillStyle = grad;
          ambCtx.fillRect(0, 0, el.ambientCanvas.width, el.ambientCanvas.height);
        }
      } catch (_) {}
    }
    requestAnimationFrame(renderAmbientLoop);
  }

  // ==========================================================================
  // 7. INITIALIZATION & INITIAL LIVE FEED FETCH
  // ==========================================================================
  async function initApp() {
    el.blockedAdsBadge.textContent = String(appState.blockedAdsCount);
    renderTagsCloud();
    renderQueue();
    loadTrackAtIndex(0, false);
    requestAnimationFrame(renderAmbientLoop);

    // Fetch live feed from server on startup if available
    try {
      const feedUrl = [window.location.origin, 'api', 'feed'].join('/');
      const res = await fetch(feedUrl);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.blockedAdsCount === 'number') {
          appState.blockedAdsCount = data.blockedAdsCount;
          el.blockedAdsBadge.textContent = String(appState.blockedAdsCount);
        }
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          appState.allTracks = data.tracks;
          appState.playlist = data.tracks.slice();
          renderQueue();
          loadTrackAtIndex(0, false);
        }
      }
    } catch (_) {}
  }

  initApp();
})();
