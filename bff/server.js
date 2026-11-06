const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const stream = require('node:stream');
const express = require('express');
const { createSessionStore, parseCookieString, parseSetCookie, publicProfile } = require('./session-store');
const { UpstreamClient, isSuccess, responseData } = require('./upstream-client');
const { createNeteaseProvider } = require('./providers/netease');
const { registerNeteaseRoutes } = require('./netease-routes');

const QR_TTL_MS = 5 * 60 * 1000;
const PRIVATE_CACHE = 'private, no-store';

function errorCode(payload) {
  const body = payload?.body ?? payload;
  return body?.error_code ?? body?.errcode ?? body?.data?.error_code ?? body?.data?.errcode ?? body?.error?.error_code;
}

function errorPayload(error) {
  return error?.payload ?? error?.body ?? error;
}

function isBusinessUpstreamError(payload) {
  const body = payload?.body ?? payload;
  return Boolean(body && typeof body === 'object' && errorCode(body) !== undefined);
}

function safeErrorMessage(payload, fallback) {
  const body = payload?.body ?? payload;
  for (const value of [body?.message, body?.error_msg, body?.msg, body?.error]) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).slice(0, 160);
  }
  return fallback;
}

function compactError(payload, fallback = '音乐服务请求失败') {
  const body = payload?.body ?? payload;
  return {
    status: 0,
    error_code: errorCode(body) ?? 'UPSTREAM_ERROR',
    message: safeErrorMessage(body, fallback),
  };
}

function sessionCookieName(config) {
  // `__Host-` is valid only for secure host-only cookies. Local HTTP needs a separate name.
  return config.cookieSecure ? '__Host-music_session' : 'music_session';
}

function sessionCookieOptions(config) {
  const common = {
    httpOnly: true,
    path: '/',
    maxAge: config.sessionTtlSeconds * 1000,
  };
  if (config.cookieSecure) {
    // The production frontend and BFF are HTTPS subdomains of hmb2011.bond.
    // Keep the session host-only and same-site; no third-party CHIPS dependency is needed.
    return { ...common, secure: true, sameSite: 'lax' };
  }
  // Local HTTP development uses the same Lax policy without Secure.
  return { ...common, secure: false, sameSite: 'lax' };
}

function clearSessionCookieOptions(config) {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(config);
  return options;
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function createRateLimiter({ now = () => Date.now(), maxBuckets = 10000 } = {}) {
  const buckets = new Map();
  return (key, { windowMs, max }) => {
    const current = now();
    const prior = (buckets.get(key) ?? []).filter((at) => current - at < windowMs);
    if (prior.length >= max) return false;
    prior.push(current);
    buckets.set(key, prior);
    if (buckets.size > maxBuckets) {
      for (const [bucketKey, timestamps] of buckets) {
        if (timestamps.every((at) => current - at >= windowMs)) buckets.delete(bucketKey);
      }
      // An IP-addressed public edge should cap this map even under distributed abuse.
      while (buckets.size > maxBuckets) buckets.delete(buckets.keys().next().value);
    }
    return true;
  };
}

function extractStreamUrl(payload) {
  const data = responseData(payload);
  const candidate = data?.url ?? data?.urls ?? data?.play_url ?? data?.audio_url;
  const raw = Array.isArray(candidate) ? candidate[0] : candidate;
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) return '';
  return raw;
}

function createApp({ config, upstream = new UpstreamClient({ upstreamRoot: config.upstreamRoot }), sessions, now = () => Date.now(), randomBytes = require('node:crypto').randomBytes, fetchImpl = globalThis.fetch } = {}) {
  if (!config || !sessions) throw new Error('createApp requires validated config and session store');
  const app = express();
  const allowRate = createRateLimiter({ now });
  const qrChallenges = new Map();
  const riskChallenges = new Map();
  const streamUrlCache = new Map();
  const kgaBase = String(config.kgaBaseUrl || 'http://127.0.0.1:6530').replace(/\/+$/, '');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb', type: 'application/json' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isJsonMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (origin) {
      if (!String(config.allowedOrigin || '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin)) return res.status(403).json({ status: 0, error_code: 'ORIGIN_DENIED', message: 'Origin is not allowed' });
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        Vary: 'Origin',
      });
    } else if (isJsonMutation) {
      return res.status(403).json({ status: 0, error_code: 'ORIGIN_REQUIRED', message: 'Origin is required' });
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (isJsonMutation && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ status: 0, error_code: 'JSON_REQUIRED', message: 'JSON content type is required' });
    }
    res.set({ 'Cache-Control': PRIVATE_CACHE, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  function purgeExpiredQrChallenges() {
    const current = now();
    for (const [id, challenge] of qrChallenges) {
      if (challenge.expiresAt <= current) qrChallenges.delete(id);
    }
  }

  function clientKey(req) {
    return `${req.ip || 'unknown'}:${req.path}`;
  }

  function requireRate(req, res, rule) {
    if (allowRate(clientKey(req), rule)) return true;
    res.status(429).json({ status: 0, error_code: 'RATE_LIMITED', message: 'Too many requests' });
    return false;
  }

  function getOpaqueSession(req) {
    const cookies = parseCookieString(req.headers.cookie || '');
    return cookies[sessionCookieName(config)] || '';
  }

  function currentSession(req) {
    return sessions.read(getOpaqueSession(req));
  }

  function requireSession(req, res) {
    const session = currentSession(req);
    if (!session) {
      res.status(401).json({ status: 0, error_code: 'SESSION_EXPIRED', message: 'Please sign in again' });
      return null;
    }
    return session;
  }

  function emitLogin(req, res, cookies, data) {
    const merged = { ...(cookies || {}) };
    const profile = publicProfile(merged, data || {});
    if (!profile) {
      return res.status(502).json({ status: 0, error_code: 'LOGIN_RESPONSE_INVALID', message: 'Login did not establish a safe session' });
    }
    const opaque = sessions.mint(merged, profile);
    // Production uses a Secure, host-only, same-site HttpOnly cookie; localhost uses the non-Secure development variant.
    res.cookie(sessionCookieName(config), opaque, sessionCookieOptions(config));
    return res.json({ status: 1, data: profile });
  }

  // ------------------------------------------------------------------
  // Admin quick-login: restore persisted upstream credentials with a
  // passphrase. The passphrase itself is never stored -- only its SHA-256
  // hash, compared with timingSafeEqual.
  // ------------------------------------------------------------------
  const adminCredentialPath = () => path.join(config.dataDir, 'admin-credentials.json');

  function adminPasswordConfigured() {
    return /^[0-9a-f]{64}$/.test(config.adminPasswordSha256 || '');
  }

  function adminPassphraseOk(candidate) {
    if (!adminPasswordConfigured()) return false;
    const digest = crypto.createHash('sha256').update(String(candidate || ''), 'utf8').digest('hex');
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(config.adminPasswordSha256, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function readAdminCredentials() {
    try {
      const raw = fs.readFileSync(adminCredentialPath(), 'utf8');
      const parsed = JSON.parse(raw);
      const cookies = parsed && typeof parsed === 'object' && parsed.cookies && typeof parsed.cookies === 'object'
        ? parsed.cookies : null;
      if (!cookies || !String(cookies.token || '') || !String(cookies.userid || '')) return null;
      return { cookies, savedAt: Number(parsed.savedAt || 0) };
    } catch (error) {
      return null;
    }
  }

  function writeAdminCredentials(cookies) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const payload = JSON.stringify({ savedAt: Date.now(), cookies }, null, 2);
    fs.writeFileSync(adminCredentialPath(), payload, { mode: 0o600 });
    fs.chmodSync(adminCredentialPath(), 0o600);
  }

  // Keep saved admin credentials fresh: upstream rotates cookies during normal
  // use, so the saved copy would otherwise drift stale while the account is
  // actively played. Only same-userid refreshes are written back (a guest
  // scanning their own account must not overwrite admin credentials), and disk
  // writes are throttled to one per 10 minutes.
  const adminSyncIntervalMs = 10 * 60 * 1000;
  let adminSyncLastAt = 0;
  function syncAdminCredentials(cookies) {
    try {
      const saved = readAdminCredentials();
      if (!saved) return;
      const savedUserid = String(saved.cookies.userid || '');
      const sessionUserid = String(cookies?.userid || '');
      if (!savedUserid || savedUserid !== sessionUserid) return;
      if (saved.cookies.token === cookies.token && saved.cookies.t1 === cookies.t1) return;
      if (Date.now() - adminSyncLastAt < adminSyncIntervalMs) return;
      writeAdminCredentials(cookies);
      adminSyncLastAt = Date.now();
    } catch (error) {
      // Best-effort freshness; playback must not depend on this.
    }
  }

  function safeAdminError(res, status, code, message) {
    return res.status(status).json({ status: 0, error_code: code, message });
  }

  function upstreamFailure(res, error, { businessStatus = false } = {}) {
  const status = Number(error?.status);
  const payload = errorPayload(error);
  const compact = compactError(payload, error?.message || 'Music upstream unavailable');
  if (businessStatus && isBusinessUpstreamError(payload)) return res.status(200).json(compact);
  return res.status(status >= 400 && status < 500 ? status : 502).json(compact);
}

  // ------------------------------------------------------------------
  // 网易云第二源：独立 /netease/* 前缀路由。
  // 只新增路由，不改动任何酷狗路径；会话用独立的 mb_netease_sid cookie。
  // 上游不可达时 /netease/health 明确报 0，酷狗功能完全不受影响。
  // ------------------------------------------------------------------
  const neteaseProvider = createNeteaseProvider({ baseUrl: config.neteaseApiBase });
  registerNeteaseRoutes(app, {
    provider: neteaseProvider,
    requireRate,
    upstreamFailure,
    secureCookies: Boolean(config.cookieSecure),
    config,
  });

  function authenticationFailure(res, error, fallback) {
    const payload = errorPayload(error);
    if (isBusinessUpstreamError(payload)) return res.status(401).json(compactError(payload, fallback));
    // Transport/upstream failure: keep whatever the upstream actually said so
    // the caller can tell "bad credentials" apart from "protocol rejected".
    const compact = compactError(payload, fallback);
    const upstreamBody = payload?.body ?? payload;
    const detail = upstreamBody && typeof upstreamBody === 'object'
      ? (upstreamBody.msg ?? upstreamBody.error_msg ?? upstreamBody.error ?? upstreamBody.message)
      : null;
    if (detail !== null && detail !== undefined && detail !== '') {
      const text = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
      if (text && text !== '{}') {
        compact.message = text.slice(0, 120);
        compact.error_code = 'UPSTREAM_REJECTED';
      }
    }
    return res.status(502).json(compact);
  }

  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').json({ status: 1, data: { ready: true } }));


  app.get('/session', (req, res) => {
    const session = currentSession(req);
    return res.json({ status: 1, data: session ? { authenticated: true, ...session.profile } : { authenticated: false } });
  });

  app.post('/session/logout', (req, res) => {
    sessions.remove(getOpaqueSession(req));
    res.clearCookie(sessionCookieName(config), clearSessionCookieOptions(config));
    return res.json({ status: 1, data: {} });
  });

  app.post('/auth/sms/send', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 3 })) return;
    const mobile = String(req.body?.mobile || '').trim();
    if (!/^1\d{10}$/.test(mobile)) return res.status(400).json({ status: 0, error_code: 'INVALID_MOBILE', message: 'Invalid mobile number' });
    try {
      const result = await upstream.sendSms(mobile, {});
      if (!isSuccess(result.payload)) return res.status(400).json(compactError(result.payload, 'SMS request rejected'));
      return res.json({ status: 1, data: {} });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.post('/auth/sms/login', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 5 })) return;
    const mobile = String(req.body?.mobile || '').trim();
    const code = String(req.body?.code || '').trim();
    const userid = req.body?.userid === undefined ? undefined : String(req.body.userid);
    if (!/^1\d{10}$/.test(mobile) || !code || code.length > 32) return res.status(400).json({ status: 0, error_code: 'INVALID_INPUT', message: 'Invalid SMS login input' });
    try {
      const result = await upstream.loginSms(mobile, code, userid, {});
      if (!isSuccess(result.payload)) return res.status(401).json(compactError(result.payload, 'SMS login rejected'));
      return emitLogin(req, res, result.cookies, responseData(result.payload));
    } catch (error) { return authenticationFailure(res, error, 'SMS login rejected'); }
  });

  app.post('/auth/qr', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 8 })) return;
    purgeExpiredQrChallenges();
    try {
      const result = await upstream.createQr({});
      if (!result.key || !result.image) return res.status(502).json({ status: 0, error_code: 'QR_INVALID', message: 'QR generation failed' });
      const id = randomBytes(24).toString('base64url');
      qrChallenges.set(id, { upstreamKey: result.key, cookies: {}, expiresAt: now() + QR_TTL_MS });
      return res.json({ status: 1, data: { key: id, image: result.image } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/auth/qr/status', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 45 })) return;
    purgeExpiredQrChallenges();
    const id = String(req.query?.key || '');
    const challenge = qrChallenges.get(id);
    if (!challenge || challenge.expiresAt <= now()) {
      qrChallenges.delete(id);
      return res.json({ status: 1, data: { status: 0 } });
    }
    try {
      const result = await upstream.checkQr(challenge.upstreamKey, challenge.cookies);
      Object.assign(challenge.cookies, result.cookies);
      const data = responseData(result.payload);
      const qrStatus = Number(data?.status ?? 1);
      if (qrStatus === 4) {
        qrChallenges.delete(id);
        const profile = publicProfile(challenge.cookies, data || {});
        if (!profile) return res.status(502).json({ status: 0, error_code: 'QR_SESSION_INVALID', message: 'QR authorization did not establish a session' });
        const opaque = sessions.mint(challenge.cookies, profile);
        res.cookie(sessionCookieName(config), opaque, sessionCookieOptions(config));
        return res.json({ status: 1, data: { status: qrStatus, nickname: profile.nickname || '', userid: profile.userid } });
      }
      return res.json({ status: 1, data: { status: qrStatus, nickname: data?.nickname || '' } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/recommendations/daily', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 6 })) return;
    const session = currentSession(req);
    try {
      const result = await upstream.dailyRecommendations(session?.cookies || {}, 'android');
      return res.json(result.payload);
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/playlists', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    try { const result = await upstream.playlists(withDeviceIdentity(session.cookies), Number(req.query.pagesize || 500)); return res.json(result.payload); } catch (error) { return upstreamFailure(res, error); }
  });

  // 新建歌单。上游 playlist_add 模块一直存在，但此前没有暴露路由。
  app.post('/playlists', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 10 })) return;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ status: 0, error_code: 'INVALID_NAME', message: 'Playlist name required' });
    if (name.length > 40) return res.status(400).json({ status: 0, error_code: 'NAME_TOO_LONG', message: 'Playlist name too long' });
    try {
      const enriched = await ensureDevice(session);
      const result = await upstream.createPlaylist(name, enriched.cookies);
      const data = responseData(result.payload) || {};
      const listid = data.listid ?? data.list_id ?? data.id ?? null;
      return res.json({ status: 1, data: { listid, name } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  // 删除歌单。
  app.delete('/playlists/:id', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 10 })) return;
    const listid = String(req.params.id || '').trim();
    if (!/^\d+$/.test(listid)) return res.status(400).json({ status: 0, error_code: 'INVALID_LISTID', message: 'Invalid playlist id' });
    try {
      const enriched = await ensureDevice(session);
      await upstream.deletePlaylist(listid, enriched.cookies);
      return res.json({ status: 1, data: { deleted: true, listid } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/playlists/:id/tracks', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const id = String(req.params.id || '');
    if (!/^[\w-]{1,128}$/.test(id)) return res.status(400).json({ status: 0, error_code: 'INVALID_PLAYLIST', message: 'Invalid playlist id' });
    try { const result = await upstream.tracks(id, Number(req.query.page || 1), Math.min(300, Number(req.query.pagesize || 300)), withDeviceIdentity(session.cookies)); return res.json(result.payload); } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/search/songs', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const keyword = String(req.query?.keyword || '').trim();
    const page = Math.max(1, Math.min(100, Number(req.query?.page || 1)));
    const pagesize = Math.max(1, Math.min(100, Number(req.query?.pagesize || 50)));
    if (!keyword || keyword.length > 120) return res.status(400).json({ status: 0, error_code: 'INVALID_SEARCH', message: 'Search keyword is required' });
    try {
      const result = await upstream.search(keyword, page, pagesize, withDeviceIdentity(session.cookies));
      return res.json(result.payload);
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.post('/playlists/:id/add', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const id = String(req.params.id || '');
    const data = String(req.body?.data || '').trim();
    if (!/^[\w-]{1,128}$/.test(id)) return res.status(400).json({ status: 0, error_code: 'INVALID_PLAYLIST', message: 'Invalid playlist id' });
    if (!data || data.length > 2048) return res.status(400).json({ status: 0, error_code: 'INVALID_SONG', message: 'Song data is required' });
    try {
      const result = await upstream.addPlaylistTracks(id, data, session.cookies);
      return res.json(result.payload);
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.post('/playlists/:id/tracks/delete', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const id = String(req.params.id || '');
    if (!/^[\w-]{1,128}$/.test(id)) return res.status(400).json({ status: 0, error_code: 'INVALID_PLAYLIST', message: 'Invalid playlist id' });
    const fileids = Array.isArray(req.body?.fileids) ? req.body.fileids : [];
    const valid = fileids.every((value) => /^\d{1,15}$/.test(String(value)));
    if (fileids.length === 0 || fileids.length > 100 || !valid) {
      return res.status(400).json({ status: 0, error_code: 'INVALID_FILEIDS', message: 'fileids must be a numeric array of at most 100 items' });
    }
    try {
      const result = await upstream.delPlaylistTracks(id, fileids.map((value) => String(Number(value))).join(','), session.cookies);
      return res.json(result.payload);
    } catch (error) { return upstreamFailure(res, error); }
  });

  // ===== 酷狗 ApiServer（KuGouMusicApi）转发辅助 =====
  // KGA 与 MoeKoeMusic 使用同一套模块；验证挑战必须由用户手动完成。
  async function kgaFetch(pathname, { method = 'GET', query = {}, body, cookies = {} } = {}) {
    const url = new URL(kgaBase + pathname);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const auth = Object.entries(cookies)
      .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
      .map(([key, value]) => `${key}=${String(value).replace(/[;\r\n]/g, '')}`)
      .join('; ');
    const headers = {
      Authorization: auth,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    const setCookieLines = typeof response.headers?.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers?.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    return {
      ok: response.ok,
      status: response.status,
      json,
      raw: text,
      cookies: parseSetCookie(setCookieLines),
    };
  }

  function mergeKgaCookies(session, cookies) {
    if (!cookies || Object.keys(cookies).length === 0) return session;
    const merged = { ...session.cookies, ...cookies };
    sessions.update(session.id, { cookies: merged });
    syncAdminCredentials(merged);
    return { ...session, cookies: merged };
  }

  async function ensureKgaDevice(session) {
    const existing = String(session.cookies?.dfid || '').trim();
    if (existing) return session;
    const registration = await kgaFetch('/register/dev', { cookies: session.cookies });
    const data = registration.json?.data ?? registration.json;
    const dfid = String(data?.dfid || '').trim();
    if (!dfid) return session;
    const cookies = { ...session.cookies, dfid };
    sessions.update(session.id, { cookies });
    return { ...session, cookies };
  }

  // ---------------------------------------------------------------------
  // Device identity for the in-process upstream.
  //
  // upstream/server.js injects these through an Express middleware, which the
  // programmatic main.js entry never runs. Concept-edition playback needs a
  // stable identity, so derive it here once per session and persist it.
  // ---------------------------------------------------------------------
  let deviceDefaults = null;
  function getDeviceDefaults() {
    if (deviceDefaults) return deviceDefaults;
    let util = {};
    try { util = require('./upstream/util'); } catch (error) { util = {}; }
    const cryptoMd5 = util.cryptoMd5 || ((v) => String(v));
    const calculateMid = util.calculateMid || ((g) => String(g || '').slice(0, 16));
    const isUUIDv4 = util.isUUIDv4 || (() => false);
    const randomString = util.randomString || ((n) => require('node:crypto').randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n));
    const envGuid = process.env.KUGOU_API_GUID;
    const guid = isUUIDv4(envGuid) ? cryptoMd5(envGuid) : (envGuid || randomString(32));
    deviceDefaults = {
      mid: String(process.env.KUGOU_API_MID || calculateMid(guid)),
      guid,
      dev: String(process.env.KUGOU_API_DEV || 'ANDROID').toUpperCase(),
      mac: String(process.env.KUGOU_API_MAC || '02:00:00:00:00:00').toUpperCase(),
      webgl: String(process.env.KUGOU_API_WEBGL || cryptoMd5('webgl:' + guid)),
      platform: String(process.env.platform || ''),
    };
    return deviceDefaults;
  }

  function withDeviceIdentity(cookies) {
    const d = getDeviceDefaults();
    return {
      ...cookies,
      KUGOU_API_PLATFORM: cookies.KUGOU_API_PLATFORM || d.platform,
      KUGOU_API_MID: cookies.KUGOU_API_MID || d.mid,
      KUGOU_API_GUID: cookies.KUGOU_API_GUID || d.guid,
      KUGOU_API_DEV: cookies.KUGOU_API_DEV || d.dev,
      KUGOU_API_MAC: cookies.KUGOU_API_MAC || d.mac,
      KUGOU_API_WEBGL: cookies.KUGOU_API_WEBGL || d.webgl,
    };
  }

  // Fill in the derived device identity (no network) and try to obtain a real
  // dfid from /register/dev. The latter needs a logged-in context, so any
  // failure is non-fatal: the identity above already makes requests stable.
  // 并发去重：/prepare 与 /stream 会同时进来，各自都调 resolvePlaybackResult。
  // 没有这层的话会跑两次 registerDevice，后一次的 sessions.update 覆盖前一次。
  const deviceInflight = new Map();
  async function ensureDevice(session) {
    const pending = deviceInflight.get(session.id);
    if (pending) return pending;
    const task = ensureDeviceInner(session).finally(() => deviceInflight.delete(session.id));
    deviceInflight.set(session.id, task);
    return task;
  }
  async function ensureDeviceInner(session) {
    const enriched = withDeviceIdentity(session.cookies || {});
    let next = enriched;
    if (!String(next.dfid || '').trim()) {
      try {
        const registration = await upstream.registerDevice(enriched);
        const fromCookie = registration?.cookies || {};
        const fromBody = registration?.payload?.data || registration?.payload || {};
        const dfid = String(fromCookie.dfid || fromBody.dfid || '').trim();
        if (dfid) next = { ...next, dfid };
      } catch (error) {
        // register_dev can throw while decrypting an unexpected response.
        // Keep the derived identity and continue; playback may still work.
      }
    }
    sessions.update(session.id, { cookies: next });
    return { ...session, cookies: next };
  }

  async function resolvePlaybackResult(session, hash, quality) {
    session = await ensureDevice(session);
    if (config.playbackUpstream === 'in_process') {
      try {
        const result = await upstream.songUrl(hash, session.cookies, quality);
        return { session: mergeKgaCookies(session, result.cookies), payload: result.payload, error: null };
      } catch (error) {
        const cookies = parseSetCookie(error?.cookie || error?.cookies || []);
        return { session: mergeKgaCookies(session, cookies), payload: errorPayload(error), error };
      }
    }

    const deviceSession = await ensureKgaDevice(session);
    const kga = await kgaFetch('/song/url', { query: { hash }, cookies: deviceSession.cookies });
    const updatedSession = mergeKgaCookies(deviceSession, kga.cookies);
    return {
      session: updatedSession,
      payload: kga.json,
      error: kga.ok ? null : { status: kga.status, body: kga.json },
    };
  }

  async function invokeInProcess(method, args, session) {
    try {
      const callArgs = method === 'verifyUserInfo'
        ? [{ ...(args[0] || {}), cookies: session.cookies }]
        : [...args, session.cookies];
      const result = await upstream[method](...callArgs);
      return { payload: result.payload, cookies: result.cookies || {}, error: null };
    } catch (error) {
      const cookies = parseSetCookie(error?.cookie || error?.cookies || []);
      return { payload: errorPayload(error), cookies, error };
    }
  }

  async function resolveRiskInfo(session, eventid) {
    if (config.playbackUpstream === 'in_process') return invokeInProcess('getVerifyInfo', [eventid], session);
    const kga = await kgaFetch('/get/verify/info', {
      query: { eventid, userid: session.cookies?.userid || 0 },
      cookies: session.cookies,
    });
    return { payload: kga.json, cookies: kga.cookies, error: kga.ok ? null : { status: kga.status, body: kga.json } };
  }

  async function resolveRiskVerification(session, input) {
    if (config.playbackUpstream === 'in_process') return invokeInProcess('verifyUserInfo', [input], session);
    const kga = await kgaFetch('/verify/user/info', {
      query: { eventid: input.eventid, v_type: Number(input.vType || 23), verifycode: input.verifycode, sid: input.sid, edt: input.edt },
      cookies: session.cookies,
    });
    return { payload: kga.json, cookies: kga.cookies, error: kga.ok ? null : { status: kga.status, body: kga.json } };
  }

  function isRiskChallenge(payload) {
    const body = payload?.body ?? payload;
    return Boolean(body && (Number(body.errcode ?? body.error_code) === 20028 || body.ssaCode));
  }

  function riskChallengeResponse(session, hash, payload) {
    const body = payload?.body ?? payload;
    const eventid = rememberRiskChallenge(session, { ...body, hash });
    return {
      status: 0,
      error_code: 'RISK_VERIFY_REQUIRED',
      message: String(body?.error || body?.message || '本次请求需要验证'),
      data: { eventid, ssaCode: String(body?.ssaCode || eventid), edt: String(body?.edt || ''), sid: String(body?.sid || ''), hash },
    };
  }

  function playbackUrlError(res, playback, fallback = 'No playable stream URL returned') {
    if (playback.error && !isRiskChallenge(playback.payload)) return upstreamFailure(res, playback.error);
    return res.status(502).json({ status: 0, error_code: 'STREAM_UNAVAILABLE', message: fallback });
  }

  function riskKey(sessionId, eventid) {
    return `${sessionId}:${eventid}`;
  }

  function rememberRiskChallenge(session, challenge) {
    const eventid = String(challenge?.ssaCode || challenge?.eventid || '');
    if (!eventid) return '';
    riskChallenges.set(riskKey(session.id, eventid), {
      eventid,
      hash: challenge.hash,
      edt: String(challenge.edt || ''),
      sid: String(challenge.sid || ''),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return eventid;
  }

  function readRiskChallenge(session, eventid) {
    const key = riskKey(session.id, eventid);
    const item = riskChallenges.get(key);
    if (!item || item.expiresAt <= Date.now()) {
      riskChallenges.delete(key);
      return null;
    }
    return item;
  }

  function streamCacheKey(session, hash) {
    return `${session.id}:${hash.toLowerCase()}`;
  }

  function readCachedStreamUrl(session, hash) {
    const key = streamCacheKey(session, hash);
    const item = streamUrlCache.get(key);
    if (!item || item.expiresAt <= Date.now()) {
      streamUrlCache.delete(key);
      return '';
    }
    return item.url;
  }

  function writeCachedStreamUrl(session, hash, url) {
    if (!url) return;
    const key = streamCacheKey(session, hash);
    streamUrlCache.set(key, { url, expiresAt: Date.now() + 90 * 1000 });
    if (streamUrlCache.size > 256) {
      // 先清掉已经过期的，再按插入顺序淘汰；直接 FIFO 可能删掉仍然有效的条目。
      const nowMs = Date.now();
      for (const [entryKey, entry] of streamUrlCache) {
        if (entry.expiresAt <= nowMs) streamUrlCache.delete(entryKey);
      }
      while (streamUrlCache.size > 256) {
        const first = streamUrlCache.keys().next().value;
        if (!first) break;
        streamUrlCache.delete(first);
      }
    }
  }

  app.get('/tracks/:hash/prepare', async (req, res) => {
    let session = requireSession(req, res); if (!session) return;
    const hash = String(req.params.hash || '');
    if (!/^[a-zA-Z0-9]{8,128}$/.test(hash)) return res.status(400).json({ status: 0, error_code: 'INVALID_HASH', message: 'Invalid song hash' });
    try {
      const playback = await resolvePlaybackResult(session, hash, req.query.quality);
      session = playback.session;
      const challenge = playback.payload;
      if (isRiskChallenge(challenge)) return res.status(423).json(riskChallengeResponse(session, hash, challenge));
      const mediaUrl = extractStreamUrl(challenge);
      if (!mediaUrl) return playbackUrlError(res, playback);
      writeCachedStreamUrl(session, hash, mediaUrl);
      return res.json({ status: 1, data: { ready: true } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/tracks/:hash/stream', async (req, res) => {
    let session = requireSession(req, res); if (!session) return;
    const hash = String(req.params.hash || '');
    if (!/^[a-zA-Z0-9]{8,128}$/.test(hash)) return res.status(400).json({ status: 0, error_code: 'INVALID_HASH', message: 'Invalid song hash' });
    try {
      let mediaUrl = readCachedStreamUrl(session, hash);
      if (!mediaUrl) {
        const playback = await resolvePlaybackResult(session, hash, req.query.quality);
        session = playback.session;
        const challenge = playback.payload;
        // Direct audio requests cannot display a challenge; normal browser flow calls /prepare first.
        if (isRiskChallenge(challenge)) return res.status(423).json(riskChallengeResponse(session, hash, challenge));
        mediaUrl = extractStreamUrl(challenge);
        if (mediaUrl) writeCachedStreamUrl(session, hash, mediaUrl);
        if (!mediaUrl) return playbackUrlError(res, playback);
      }
      // 上游 CDN 卡住时不能无限占用连接：1.7 GiB 的机器很容易被拖垮。
      const upstreamResponse = await fetchImpl(mediaUrl, {
        headers: {
          ...(req.headers.range ? { Range: req.headers.range } : {}),
          'User-Agent': 'Mozilla/5.0',
          Referer: 'http://m.kugou.com/',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!upstreamResponse.ok && upstreamResponse.status !== 206) return res.status(502).json({ status: 0, error_code: 'STREAM_FETCH_FAILED', message: 'Media source rejected stream request' });
      const headers = {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'audio/mpeg',
        'Accept-Ranges': upstreamResponse.headers.get('accept-ranges') || 'bytes',
        'Cache-Control': 'private, no-store',
      };
      for (const name of ['content-length', 'content-range']) {
        const value = upstreamResponse.headers.get(name);
        if (value) headers[name === 'content-length' ? 'Content-Length' : 'Content-Range'] = value;
      }
      res.status(upstreamResponse.status).set(headers);
      if (!upstreamResponse.body) return res.end();
      return stream.Readable.fromWeb(upstreamResponse.body).pipe(res);
    } catch (error) { return upstreamFailure(res, error); }
  });

  // 下载：与 /stream 共用同一套解析（缓存 → resolvePlaybackResult → 风控判定），
  // 但只取整套文件、加 Content-Disposition，供浏览器保存到本地。
  // 权限边界与播放完全一致：没有会话、风控挑战、上游拒绝的情况都无法下载。
  app.get('/tracks/:hash/download', async (req, res) => {
    let session = requireSession(req, res); if (!session) return;
    const hash = String(req.params.hash || '');
    if (!/^[a-zA-Z0-9]{8,128}$/.test(hash)) return res.status(400).json({ status: 0, error_code: 'INVALID_HASH', message: 'Invalid song hash' });
    try {
      let mediaUrl = readCachedStreamUrl(session, hash);
      if (!mediaUrl) {
        const playback = await resolvePlaybackResult(session, hash, req.query.quality);
        session = playback.session;
        const challenge = playback.payload;
        if (isRiskChallenge(challenge)) return res.status(423).json(riskChallengeResponse(session, hash, challenge));
        mediaUrl = extractStreamUrl(challenge);
        if (mediaUrl) writeCachedStreamUrl(session, hash, mediaUrl);
        if (!mediaUrl) return playbackUrlError(res, playback);
      }
      // 下载要读完整首歌，不能用播放那套 20s 超时（长曲目/慢网络会被腰斩）。
      const upstreamResponse = await fetchImpl(mediaUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'http://m.kugou.com/' },
        redirect: 'follow',
        signal: AbortSignal.timeout(180000),
      });
      if (!upstreamResponse.ok) return res.status(502).json({ status: 0, error_code: 'DOWNLOAD_FETCH_FAILED', message: 'Media source rejected download request' });
      const contentType = upstreamResponse.headers.get('content-type') || 'audio/mpeg';
      const ext = /flac/i.test(contentType) ? 'flac' : /mp4|m4a|aac/i.test(contentType) ? 'm4a' : 'mp3';
      // 客户端会用自己的文件名覆盖，这里给直连访问一个合理默认值。
      const headers = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${hash}.${ext}"`,
        'Cache-Control': 'private, no-store',
      };
      const contentLength = upstreamResponse.headers.get('content-length');
      if (contentLength) headers['Content-Length'] = contentLength;
      res.status(200).set(headers);
      if (!upstreamResponse.body) return res.end();
      return stream.Readable.fromWeb(upstreamResponse.body).pipe(res);
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.post('/verify/info', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const eventid = String(req.body?.eventid || '');
    const challenge = readRiskChallenge(session, eventid);
    if (!challenge) return res.status(409).json({ status: 0, error_code: 'RISK_CHALLENGE_EXPIRED', message: 'Risk verification challenge expired' });
    try {
      const resolved = await resolveRiskInfo(session, eventid);
      mergeKgaCookies(session, resolved.cookies);
      if (resolved.error && !resolved.payload) return upstreamFailure(res, resolved.error);
      const data = responseData(resolved.payload);
      const success = isSuccess(resolved.payload);
      return res.status(success ? 200 : 502).json({ status: success ? 1 : 0, data, error_code: errorCode(resolved.payload) });
    } catch (error) { return upstreamFailure(res, error); }
  });

  // SSA 人工验证：提交验证结果（腾讯滑块 ticket）
  app.post('/verify/verify', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const { eventid, v_type, verifycode, sid, edt } = req.body || {};
    const challenge = readRiskChallenge(session, String(eventid || ''));
    if (!challenge) return res.status(409).json({ status: 0, error_code: 'RISK_CHALLENGE_EXPIRED', message: 'Risk verification challenge expired' });
    if (!verifycode || String(sid || '') !== challenge.sid || String(edt || '') !== challenge.edt) {
      return res.status(400).json({ status: 0, error_code: 'INVALID_RISK_PROOF', message: 'Risk verification proof is invalid' });
    }
    try {
      const resolved = await resolveRiskVerification(session, { eventid, vType: Number(v_type || 23), verifycode, sid, edt });
      const updatedSession = mergeKgaCookies(session, resolved.cookies);
      const body = responseData(resolved.payload) || {};
      const succeeded = !resolved.error && isSuccess(resolved.payload);
      if (succeeded) riskChallenges.delete(riskKey(updatedSession.id, String(eventid)));
      return res.status(succeeded ? 200 : 502).json({
        status: succeeded ? 1 : 0,
        data: body.data ?? body,
        error_code: errorCode(resolved.payload),
        message: body.message ?? body.error,
      });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.get('/tracks/:hash/lyrics', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    const hash = String(req.params.hash || '');
    if (!/^[a-zA-Z0-9]{8,128}$/.test(hash)) return res.status(400).json({ status: 0, error_code: 'INVALID_HASH', message: 'Invalid song hash' });
    try {
      const durationMs = Number(req.query.duration || 0) || 0;
      const result = await upstream.lyrics(hash, session.cookies, durationMs);
      const data = responseData(result.payload);
      return res.json({ status: 1, data: { content: String(data?.decodeContent ?? data?.content ?? '') } });
    } catch (error) { return upstreamFailure(res, error); }
  });

  app.post('/vip/daily', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 4 })) return;
    const rawDay = String(req.body?.receive_day || '').trim();
    // Accept both 2026-10-24 and 20261024; upstream rejected the dashed form
    // anonymously (20002 vs 304001 for compact), so try dashed first, then the
    // compact form, and let the real login decide which one works.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : (/^\d{8}$/.test(rawDay) ? `${rawDay.slice(0,4)}-${rawDay.slice(4,6)}-${rawDay.slice(6,8)}` : '');
    if (!day) return res.status(400).json({ status: 0, error_code: 'INVALID_DAY', message: 'Invalid receive_day' });
    try { const result = await upstream.claimVip(day, withDeviceIdentity(session.cookies)); return res.json(result.payload); } catch (error) { return upstreamFailure(res, error, { businessStatus: true }); }
  });

  app.post('/vip/daily/upgrade', async (req, res) => {
    const session = requireSession(req, res); if (!session) return;
    if (!requireRate(req, res, { windowMs: 60 * 1000, max: 4 })) return;
    try { const result = await upstream.upgradeVip(withDeviceIdentity(session.cookies)); return res.json(result.payload); } catch (error) { return upstreamFailure(res, error, { businessStatus: true }); }
  });

  // --- Admin quick-login ------------------------------------------------
  app.get('/auth/admin/status', (_req, res) => {
    return res.set('Cache-Control', 'no-store').json({
      status: 1,
      data: {
        configured: adminPasswordConfigured(),
        saved: Boolean(readAdminCredentials()),
      },
    });
  });

  app.post('/auth/admin', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 5 })) return;
    if (!adminPasswordConfigured()) return safeAdminError(res, 404, 'ADMIN_NOT_CONFIGURED', '管理员登录未配置');
    const passphrase = String(req.body?.passphrase || '');
    if (!passphrase || passphrase.length > 256) return safeAdminError(res, 400, 'INVALID_INPUT', '请输入管理员口令');
    if (!adminPassphraseOk(passphrase)) return safeAdminError(res, 401, 'ADMIN_AUTH_FAILED', '管理员口令不正确');

    const saved = readAdminCredentials();
    if (!saved) return safeAdminError(res, 404, 'ADMIN_CREDENTIALS_MISSING', '尚未保存登录凭据，请先扫码登录并保存');

    // Freshness check: the saved cookies must still list playlists upstream.
    try {
      const probe = await upstream.playlists(saved.cookies, 1);
      if (!isSuccess(probe.payload)) {
        return safeAdminError(res, 401, 'ADMIN_CREDENTIALS_STALE', '保存的凭据已失效，请重新扫码登录并保存');
      }
    } catch (error) {
      return safeAdminError(res, 502, 'ADMIN_VERIFY_FAILED', '验证保存凭据时上游不可用，请稍后再试');
    }

    const profile = publicProfile(saved.cookies, {});
    if (!profile) return safeAdminError(res, 500, 'ADMIN_PROFILE_INVALID', '保存的凭据缺少用户信息');
    const merged = withDeviceIdentity(saved.cookies);
    const opaque = sessions.mint(merged, profile);
    res.cookie(sessionCookieName(config), opaque, sessionCookieOptions(config));
    return res.json({ status: 1, data: { ...profile, restored: true } });
  });

  app.post('/auth/admin/save', async (req, res) => {
    if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 5 })) return;
    const session = requireSession(req, res); if (!session) return;
    if (!adminPasswordConfigured()) return safeAdminError(res, 404, 'ADMIN_NOT_CONFIGURED', '管理员登录未配置');
    const passphrase = String(req.body?.passphrase || '');
    if (!passphrase || passphrase.length > 256) return safeAdminError(res, 400, 'INVALID_INPUT', '请输入管理员口令');
    if (!adminPassphraseOk(passphrase)) return safeAdminError(res, 401, 'ADMIN_AUTH_FAILED', '管理员口令不正确');
    if (!String(session.cookies?.token || '') || !String(session.cookies?.userid || '')) {
      return safeAdminError(res, 400, 'SESSION_NOT_PERSISTABLE', '当前会话缺少可保存的凭据');
    }
    try {
      writeAdminCredentials(session.cookies);
    } catch (error) {
      return safeAdminError(res, 500, 'ADMIN_SAVE_FAILED', '保存凭据失败，请检查服务器 data 目录');
    }
    return res.json({ status: 1, data: { saved: true } });
  });

  app.use((_req, res) => res.status(404).json({ status: 0, error_code: 'NOT_FOUND', message: 'Not found' }));
  return app;
}

function loadConfig(env = process.env) {
  const allowedOrigin = String(env.ALLOWED_ORIGIN || '').trim();
  const sessionSecret = String(env.SESSION_SECRET || '');
  const cookieSecure = String(env.COOKIE_SECURE || 'true') !== 'false';
  const playbackUpstream = String(env.PLAYBACK_UPSTREAM || 'in_process').trim().toLowerCase();
  const upstreamRoot = String(env.UPSTREAM_ROOT || path.join(__dirname, 'upstream')).trim();
  const neteaseApiBase = String(env.NETEASE_API_BASE || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  if (!['in_process', 'kga_sidecar'].includes(playbackUpstream)) throw new Error('PLAYBACK_UPSTREAM must be in_process or kga_sidecar');
  if (!allowedOrigin.startsWith('https://') && !isLocalDevelopmentOrigin(allowedOrigin)) throw new Error('ALLOWED_ORIGIN must be a trusted HTTPS origin (localhost allowed only in development)');
  if (!cookieSecure && !isLocalDevelopmentOrigin(allowedOrigin)) throw new Error('COOKIE_SECURE may be false only for localhost development');
  if (!path.isAbsolute(upstreamRoot) || !fs.existsSync(path.join(upstreamRoot, 'main.js'))) throw new Error('UPSTREAM_ROOT must be an absolute local directory containing main.js');
  // 网易云上游只允许本机回环：cookie 会随请求发过去，绝不能指向外部主机。
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(neteaseApiBase)) throw new Error('NETEASE_API_BASE must be a loopback http URL');
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 6522),
    allowedOrigin,
    adminPasswordSha256: String(env.ADMIN_PASSWORD_SHA256 || '').trim().toLowerCase(),
    dataDir: String(env.DATA_DIR || path.join(__dirname, 'data')).trim(),
    upstreamRoot,
    playbackUpstream,
    kgaBaseUrl: String(env.KGA_BASE_URL || 'http://127.0.0.1:6530').trim().replace(/\/+$/, ''),
    neteaseApiBase,
    sessionTtlSeconds: Math.min(86400, Math.max(900, Number(env.SESSION_TTL_SECONDS || 28800))),
    cookieSecure,
    sessionSecret,
  };
}

  function start(config = loadConfig()) {
  const sessions = createSessionStore({ secret: config.sessionSecret, ttlSeconds: config.sessionTtlSeconds });
  const app = createApp({ config, sessions });
  const server = app.listen(config.port, config.host, () => console.log(`music-bff listening on http://${config.host}:${config.port}`));
  server.requestTimeout = 20_000;
  server.headersTimeout = 25_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (require.main === module) start();
module.exports = { createApp, createRateLimiter, loadConfig, start };
