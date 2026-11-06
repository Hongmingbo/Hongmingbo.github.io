'use strict';

/**
 * 网易云路由（挂在 /netease/* 前缀下）。
 *
 * 设计原则：
 *   1. 只新增前缀路由，绝不改动酷狗的既有路由 —— 酷狗路径零回归风险。
 *   2. 会话完全独立：用 mb_netease_sid 这个 host-only HttpOnly cookie 承载
 *      一个随机 id，id 到网易云 cookie 的映射存在 provider 自带的 jar 里。
 *      酷狗的 session-store 完全不参与。
 *   3. 返回体形状与酷狗对齐（{status:1, data:{info:[...]}}），让前端的
 *      normalizeSongs / normalizePlaylists 零改动复用。
 *   4. 流媒体由 BFF 代理，不把上游直链暴露给浏览器。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');

const NETEASE_SESSION_COOKIE = 'mb_netease_sid';
const STREAM_TIMEOUT_MS = 20000;

function cookieOptions(secure) {
	return {
		httpOnly: true,
		secure,
		sameSite: 'lax',
		path: '/',
	};
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {object} deps.provider   createNeteaseProvider() 的返回值
 * @param {(req,res,rule:object)=>boolean} deps.requireRate
 * @param {(res:object, error:Error, opts?:object)=>any} deps.upstreamFailure
 * @param {boolean} deps.secureCookies
 */
function registerNeteaseRoutes(app, { provider, requireRate, upstreamFailure, secureCookies = true, config = {} }) {
	if (!provider) throw new Error('registerNeteaseRoutes requires a netease provider');

	const cookieOpts = cookieOptions(secureCookies);

	// ------------------------------------------------------------------
	// 凭据保存与口令登录：与酷狗完全同构 —— 同一 ADMIN_PASSWORD_SHA256、
	// 只存 cookie 字符串、文件权限 0600、口令本身永不落盘。
	// ------------------------------------------------------------------
	const credentialPath = () => path.join(config.dataDir || path.join(__dirname, 'data'), 'netease-credentials.json');

	function adminConfigured() {
		return /^[0-9a-f]{64}$/.test(String(config.adminPasswordSha256 || ''));
	}

	function passphraseOk(candidate) {
		if (!adminConfigured()) return false;
		const digest = crypto.createHash('sha256').update(String(candidate || ''), 'utf8').digest('hex');
		const a = Buffer.from(digest, 'hex');
		const b = Buffer.from(String(config.adminPasswordSha256), 'hex');
		return a.length === b.length && crypto.timingSafeEqual(a, b);
	}

	function readCredentials() {
		try {
			const parsed = JSON.parse(fs.readFileSync(credentialPath(), 'utf8'));
			const cookie = String(parsed?.cookie || '');
			if (!cookie || !/MUSIC_U=/.test(cookie)) return null;
			return { cookie, savedAt: Number(parsed.savedAt || 0) };
		} catch (error) {
			return null;
		}
	}

	function writeCredentials(cookie) {
		const file = credentialPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), cookie }, null, 2), { mode: 0o600 });
		fs.chmodSync(file, 0o600);
	}

	function adminError(res, status, code, message) {
		return res.status(status).json({ status: 0, error_code: code, message });
	}

	/** 读/建网易云 session id。只在真正需要绑定时建（登录成功时）。 */
	function readSid(req) {
		const raw = String(req.headers.cookie || '');
		for (const part of raw.split(';')) {
			const index = part.indexOf('=');
			if (index < 0) continue;
			if (part.slice(0, index).trim() !== NETEASE_SESSION_COOKIE) continue;
			const value = part.slice(index + 1).trim();
			return /^[0-9a-f]{48}$/.test(value) ? value : '';
		}
		return '';
	}

	/** 当前网易云 cookie（未登录返回 null）。 */
	function currentNeteaseCookie(req) {
		const sid = readSid(req);
		if (!sid) return null;
		return provider.jar.get(sid);
	}

	function requireNetease(req, res) {
		const cookie = currentNeteaseCookie(req);
		if (!cookie) {
			res.status(401).json({ status: 0, error_code: 'NETEASE_SESSION_EXPIRED', message: '请先登录网易云' });
			return null;
		}
		return cookie;
	}

	/** 登录成功后：生成 sid → 存 cookie → 下发浏览器 cookie。 */
	function establishSession(req, res, neteaseCookie, profile) {
		// 只有真的拿到 MUSIC_U 才算登录成功。否则下发一个空会话，
		// 用户会在下一次请求时才莫名失败（实测踩过：cookie 被 Set-Cookie
		// 属性污染后账号看似登录、实际所有认证请求都返回 profile:null）。
		if (!provider.hasSessionCookie(neteaseCookie)) {
			return adminError(res, 502, 'NETEASE_NO_SESSION_COOKIE', '登录未拿到 MUSIC_U，请重试');
		}
		const sid = crypto.randomBytes(24).toString('hex');
		provider.jar.set(sid, neteaseCookie);
		res.cookie(NETEASE_SESSION_COOKIE, sid, cookieOpts);
		return res.json({ status: 1, data: { authenticated: true, ...(profile || {}) } });
	}

	function fail(res, error) {
		if (error && error.name === 'NeteaseError') {
			return res.status(error.status || 502).json({
				status: 0,
				error_code: error.code || 'NETEASE_UPSTREAM_ERROR',
				message: error.message,
			});
		}
		return upstreamFailure(res, error);
	}

	// ---------------- 健康与会话 ----------------

	app.get('/netease/health', async (req, res) => {
		try {
			const result = await provider.health();
			return res.json({ status: result.reachable ? 1 : 0, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.get('/netease/session', async (req, res) => {
		const cookie = currentNeteaseCookie(req);
		if (!cookie) return res.json({ status: 1, data: { authenticated: false } });
		try {
			const profile = await provider.account(cookie);
			if (!profile) {
				// 上游已失效：顺手清掉本地映射，避免前端反复拿到假登录态
				provider.jar.remove(readSid(req));
				return res.json({ status: 1, data: { authenticated: false } });
			}
			return res.json({ status: 1, data: { authenticated: true, ...profile } });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.post('/netease/session/logout', (req, res) => {
		const sid = readSid(req);
		if (sid) provider.jar.remove(sid);
		res.clearCookie(NETEASE_SESSION_COOKIE, { ...cookieOpts, maxAge: undefined });
		return res.json({ status: 1, data: {} });
	});

	// ---------------- 登录：扫码 ----------------

	// 扫码挑战与酷狗侧同契约：下发给浏览器的是服务端 challenge id（不是上游 key），
	// 状态码也统一成 0=过期 / 1=等待 / 2=已扫待确认 / 4=授权成功。
	// 这样前端 checkQr 一套逻辑两个源通用。
	const QR_TTL_MS = 5 * 60 * 1000;
	const QR_CODE_TO_STATUS = { 800: 0, 801: 1, 802: 2, 803: 4 };
	const qrChallenges = new Map();

	function purgeQr() {
		const now = Date.now();
		for (const [id, entry] of qrChallenges) {
			if (entry.expiresAt <= now) qrChallenges.delete(id);
		}
	}

	app.post('/netease/auth/qr', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 8 })) return;
		purgeQr();
		try {
			const qr = await provider.qrCreate();
			const id = crypto.randomBytes(18).toString('base64url');
			qrChallenges.set(id, { upstreamKey: qr.key, expiresAt: Date.now() + QR_TTL_MS });
			return res.json({ status: 1, data: { key: id, image: qr.image } });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.get('/netease/auth/qr/status', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 45 })) return;
		purgeQr();
		const id = String(req.query?.key || '');
		const challenge = qrChallenges.get(id);
		if (!challenge) return res.json({ status: 1, data: { status: 0 } });
		try {
			const result = await provider.qrCheck(challenge.upstreamKey);
			const status = QR_CODE_TO_STATUS[result.code] ?? 1;
			if (status !== 4) return res.json({ status: 1, data: { status, nickname: '' } });
			if (!result.cookie) {
				return res.status(502).json({ status: 0, error_code: 'NETEASE_QR_NO_COOKIE', message: '授权成功但未拿到会话凭据' });
			}
			qrChallenges.delete(id);
			const profile = result.profile || (await provider.account(result.cookie));
			const sid = crypto.randomBytes(24).toString('hex');
			provider.jar.set(sid, result.cookie);
			res.cookie(NETEASE_SESSION_COOKIE, sid, cookieOpts);
			return res.json({
				status: 1,
				data: { status: 4, nickname: (profile && profile.nickname) || '', userid: (profile && profile.userid) || '' },
			});
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 登录：手机验证码 ----------------

	app.post('/netease/auth/sms/send', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 3 })) return;
		const phone = String(req.body?.phone || '').trim();
		try {
			await provider.smsSend(phone);
			return res.json({ status: 1, data: {} });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.post('/netease/auth/sms/login', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 10 })) return;
		const phone = String(req.body?.phone || '').trim();
		const captcha = String(req.body?.captcha || '').trim();
		try {
			const result = await provider.smsLogin(phone, captcha);
			if (!result.cookie) {
				return res.status(502).json({ status: 0, error_code: 'NETEASE_NO_COOKIE', message: '登录未建立会话' });
			}
			const profile = result.profile || (await provider.account(result.cookie));
			return establishSession(req, res, result.cookie, profile);
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 凭据保存 / 口令登录（与酷狗同构）----------------

	app.get('/netease/auth/admin/status', (_req, res) => {
		return res.set('Cache-Control', 'no-store').json({
			status: 1,
			data: { configured: adminConfigured(), saved: Boolean(readCredentials()) },
		});
	});

	app.post('/netease/auth/admin', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 5 })) return;
		if (!adminConfigured()) return adminError(res, 404, 'ADMIN_NOT_CONFIGURED', '管理员登录未配置');
		const passphrase = String(req.body?.passphrase || '');
		if (!passphrase || passphrase.length > 256) return adminError(res, 400, 'INVALID_INPUT', '请输入管理员口令');
		if (!passphraseOk(passphrase)) return adminError(res, 401, 'ADMIN_AUTH_FAILED', '管理员口令不正确');

		const saved = readCredentials();
		if (!saved) return adminError(res, 404, 'ADMIN_CREDENTIALS_MISSING', '尚未保存网易云登录凭据，请先登录并保存');

		// 新鲜度校验：保存的 cookie 必须仍能拿到账号信息，否则视为失效。
		let profile = null;
		try {
			profile = await provider.account(saved.cookie);
		} catch (error) {
			return adminError(res, 502, 'ADMIN_VERIFY_FAILED', '验证保存凭据时网易云上游不可用，请稍后再试');
		}
		if (!profile) return adminError(res, 401, 'ADMIN_CREDENTIALS_STALE', '保存的凭据已失效，请重新登录并保存');

		const sid = crypto.randomBytes(24).toString('hex');
		provider.jar.set(sid, saved.cookie);
		res.cookie(NETEASE_SESSION_COOKIE, sid, cookieOpts);
		return res.json({ status: 1, data: { ...profile, restored: true } });
	});

	app.post('/netease/auth/admin/save', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 15 * 60 * 1000, max: 5 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		if (!adminConfigured()) return adminError(res, 404, 'ADMIN_NOT_CONFIGURED', '管理员登录未配置');
		const passphrase = String(req.body?.passphrase || '');
		if (!passphrase || passphrase.length > 256) return adminError(res, 400, 'INVALID_INPUT', '请输入管理员口令');
		if (!passphraseOk(passphrase)) return adminError(res, 401, 'ADMIN_AUTH_FAILED', '管理员口令不正确');

		// 保存前先验活：写入一个用不了的 cookie，只会让下次口令登录报「已失效」，
		// 比当场拒绝更难排查（实测踩过）。这里直接问上游要账号信息。
		let profile = null;
		try {
			profile = await provider.account(cookie);
		} catch (error) {
			return adminError(res, 502, 'ADMIN_VERIFY_FAILED', '验证当前登录态时网易云上游不可用，请稍后再试');
		}
		if (!profile) return adminError(res, 400, 'ADMIN_SESSION_INVALID', '当前登录态无效，无法保存，请重新登录后再试');

		try {
			writeCredentials(cookie);
		} catch (error) {
			return adminError(res, 500, 'ADMIN_SAVE_FAILED', '保存凭据失败，请检查服务器 data 目录');
		}
		return res.json({ status: 1, data: { saved: true, userid: profile.userid } });
	});

	// ---------------- 每日推荐（酷狗每日推荐的等价物）----------------

	app.get('/netease/recommendations/daily', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 6 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		try {
			const result = await provider.dailyRecommendations(cookie);
			// 与酷狗同形：前端 normalizeSongs 读 data.info
			return res.json({ status: 1, data: { info: result.songs } });
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 每日签到（酷狗 VIP 每日领取的等价物）----------------

	app.post('/netease/vip/daily', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 4 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		try {
			const result = await provider.dailySignin(cookie);
			return res.json({ status: 1, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	// 网易云没有「概念版升级」这个概念，明确告知而不是假装成功。
	app.post('/netease/vip/daily/upgrade', async (req, res) => {
		return res.status(200).json({
			status: 0,
			error_code: 'NETEASE_NOT_APPLICABLE',
			message: '网易云没有概念版升级这一步，签到已完成',
		});
	});

	// ---------------- 歌单 ----------------

	app.get('/netease/playlists', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		try {
			const result = await provider.playlists(cookie);
			// 与酷狗同形：前端 normalizePlaylists 读 data.info
			return res.json({ status: 1, data: { info: result.playlists, profile: result.profile } });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.get('/netease/playlists/:id/tracks', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_PLAYLIST', message: '无效的歌单 id' });
		}
		try {
			const result = await provider.playlistTracks(cookie, id, req.query.page, req.query.pagesize);
			return res.json({ status: 1, data: { info: result.songs, total: result.total } });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.post('/netease/playlists', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 6 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		try {
			const result = await provider.createPlaylist(cookie, req.body?.name);
			return res.json({ status: 1, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.delete('/netease/playlists/:id', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 6 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_PLAYLIST', message: '无效的歌单 id' });
		}
		try {
			const result = await provider.deletePlaylist(cookie, id);
			return res.json({ status: 1, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	// 与酷狗同形：body.data = "歌名|hash|albumId|mixSongId"，网易云的歌曲 id 就在第 2 段，
	// 所以前端不需要为两个源准备两套加歌参数。
	app.post('/netease/playlists/:id/add', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 30 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_PLAYLIST', message: '无效的歌单 id' });
		}
		const raw = String(req.body?.data || '').trim();
		if (!raw || raw.length > 4096) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_TRACKS', message: '缺少歌曲信息' });
		}
		const trackIds = raw
			.split(',')
			.map((item) => String(item).split('|')[1] || '')
			.map((item) => item.trim())
			.filter((item) => /^\d{1,20}$/.test(item));
		if (!trackIds.length) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_TRACKS', message: '歌曲 id 无效' });
		}
		try {
			const result = await provider.addPlaylistTracks(cookie, id, trackIds);
			return res.json({ status: 1, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.post('/netease/playlists/:id/tracks/delete', async (req, res) => {
		if (!requireRate(req, res, { windowMs: 60 * 1000, max: 30 })) return;
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_PLAYLIST', message: '无效的歌单 id' });
		}
		const raw = Array.isArray(req.body?.fileids) ? req.body.fileids : [];
		const trackIds = raw.map((item) => String(item).trim()).filter((item) => /^\d{1,20}$/.test(item));
		if (!trackIds.length) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_TRACKS', message: '缺少歌曲 id' });
		}
		if (trackIds.length > 100) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_TOO_MANY_TRACKS', message: '单次最多移除 100 首' });
		}
		try {
			const result = await provider.delPlaylistTracks(cookie, id, trackIds);
			return res.json({ status: 1, data: result });
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 搜索 ----------------

	app.get('/netease/search/songs', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		const keyword = String(req.query?.keyword || '').trim();
		if (!keyword || keyword.length > 120) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_SEARCH', message: '请输入搜索关键词' });
		}
		try {
			const result = await provider.search(cookie, keyword, req.query.page, req.query.pagesize);
			return res.json({ status: 1, data: { info: result.songs, total: result.total } });
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 歌词 ----------------

	app.get('/netease/tracks/:id/lyrics', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_ID', message: '无效的歌曲 id' });
		}
		try {
			const result = await provider.lyric(cookie, id);
			return res.json({ status: 1, data: { content: result.content, translation: result.translation } });
		} catch (error) {
			return fail(res, error);
		}
	});

	// ---------------- 播放 ----------------

	app.get('/netease/tracks/:id/prepare', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_ID', message: '无效的歌曲 id' });
		}
		try {
			await provider.songUrl(cookie, id, req.query.quality);
			return res.json({ status: 1, data: { ready: true } });
		} catch (error) {
			return fail(res, error);
		}
	});

	app.get('/netease/tracks/:id/stream', async (req, res) => {
		const cookie = requireNetease(req, res); if (!cookie) return;
		const id = String(req.params.id || '');
		if (!/^\d{1,20}$/.test(id)) {
			return res.status(400).json({ status: 0, error_code: 'NETEASE_INVALID_ID', message: '无效的歌曲 id' });
		}
		try {
			const media = await provider.songUrl(cookie, id, req.query.quality);
			const upstreamResponse = await fetch(media.url, {
				headers: {
					...(req.headers.range ? { Range: req.headers.range } : {}),
					'User-Agent': 'Mozilla/5.0',
					Referer: 'https://music.163.com/',
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
			});
			if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
				return res.status(502).json({ status: 0, error_code: 'NETEASE_STREAM_FAILED', message: '音频源拒绝了请求' });
			}
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
		} catch (error) {
			return fail(res, error);
		}
	});

	return { cookieName: NETEASE_SESSION_COOKIE };
}

module.exports = { registerNeteaseRoutes, NETEASE_SESSION_COOKIE };
