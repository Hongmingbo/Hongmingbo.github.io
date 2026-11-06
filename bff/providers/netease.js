'use strict';

/**
 * 网易云 provider。
 *
 * 上游是一个自建的 NeteaseCloudMusicApiEnhanced 服务（只监听 127.0.0.1），
 * 本模块是 BFF 访问它的唯一出口，负责四件事：
 *   1. 统一超时与错误映射（上游挂了给 502，不把网络异常伪装成业务失败）
 *   2. 把网易云的数据结构归一化成酷狗侧的形状，好让前端的 normalizeSongs /
 *      normalizePlaylists 零改动复用
 *   3. 用独立的 cookie jar 按 session id 存登录态（不碰酷狗的会话逻辑）
 *   4. 音质档位映射到上游的 level 参数
 *
 * 归一化后的歌曲形状（与酷狗对齐）：
 *   { hash, name, author, img, timeLength(秒), album, source }
 * 归一化后的歌单形状：
 *   { listid, name, count, cover, source }
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const REQUEST_TIMEOUT_MS = 20000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// 真正需要回传的网易云 cookie（其余都是 Set-Cookie 的属性，混进去会把 Cookie 头弄坏）
const NETEASE_COOKIE_NAMES = new Set([
	'MUSIC_U', 'MUSIC_A', 'MUSIC_A_T', 'MUSIC_R_T', 'MUSIC_SNS',
	'__csrf', '__remember_me', 'NMTID', '_ntes_nuid', '_ntes_nnid',
	'WNMCID', 'WEVNSM', 'os', 'appver', 'osver', 'deviceId', 'channel',
]);

// 前端音质档位 → 网易云 /song/url/v1 的 level 参数
const QUALITY_TO_LEVEL = Object.freeze({
	'128': 'standard',
	'320': 'exhigh',
	flac: 'lossless',
});

// /login/qr/check 的返回码语义
const QR_STATUS = Object.freeze({
	800: 'expired',
	801: 'waiting',
	802: 'scanned',
	803: 'authorized',
});

class NeteaseError extends Error {
	constructor(message, { status = 502, code = 'NETEASE_UPSTREAM_ERROR' } = {}) {
		super(message);
		this.name = 'NeteaseError';
		this.status = status;
		this.code = code;
	}
}

/** 按 session id 存网易云 cookie 的独立 jar，带 TTL。 */
function createCookieJar({ ttlMs = SESSION_TTL_MS, now = () => Date.now() } = {}) {
	const entries = new Map();

	function sweep() {
		const t = now();
		for (const [key, value] of entries) {
			if (value.expiresAt <= t) entries.delete(key);
		}
	}

	return {
		get(id) {
			sweep();
			const entry = entries.get(String(id));
			return entry ? entry.cookie : null;
		},
		set(id, cookie) {
			sweep();
			if (!cookie) return;
			entries.set(String(id), { cookie, expiresAt: now() + ttlMs });
		},
		remove(id) {
			entries.delete(String(id));
		},
		size() {
			sweep();
			return entries.size;
		},
	};
}

function asArray(...candidates) {
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

function httpsUrl(value) {
	return String(value || '').replace(/^http:\/\//i, 'https://');
}

/** 网易云 song → 酷狗同形。网易云的 dt 是毫秒，酷狗侧 timeLength 用秒。 */
function normalizeSong(song) {
	if (!song || song.id === undefined || song.id === null) return null;
	const artists = asArray(song.ar, song.artists, song.singer)
		.map((artist) => (artist && artist.name ? String(artist.name) : ''))
		.filter(Boolean)
		.join(' / ');
	const album = song.al || song.album || {};
	return {
		hash: String(song.id),
		name: String(song.name ?? ''),
		author: artists || '未知艺术家',
		img: httpsUrl(album.picUrl || song.picUrl || ''),
		timeLength: Math.round((Number(song.dt ?? song.duration ?? 0) || 0) / 1000),
		album: String(album.name ?? ''),
		source: 'netease',
	};
}

/** 网易云 playlist → 酷狗同形。 */
function normalizePlaylist(playlist) {
	if (!playlist || playlist.id === undefined || playlist.id === null) return null;
	const count = Number(playlist.trackCount ?? 0);
	return {
		listid: String(playlist.id),
		name: String(playlist.name ?? '未命名歌单'),
		count: Number.isFinite(count) && count > 0 ? count : undefined,
		cover: httpsUrl(playlist.coverImgUrl || playlist.picUrl || ''),
		source: 'netease',
	};
}

function createNeteaseProvider(options = {}) {
	const baseUrl = String(options.baseUrl || process.env.NETEASE_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const jar = options.jar || createCookieJar();
	const timeoutMs = Number(options.timeoutMs || REQUEST_TIMEOUT_MS);

	/**
	 * 调上游。始终带时间戳绕开上游缓存；cookie 通过 Cookie 头传，
	 * 不放进 query（query 里的 cookie 会进上游访问日志）。
	 */
	async function call(endpoint, params = {}, cookie = '') {
		const url = new URL(endpoint.replace(/^\/+/, ''), `${baseUrl}/`);
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null || value === '') continue;
			url.searchParams.set(key, String(value));
		}
		url.searchParams.set('timestamp', String(Date.now()));

		let response;
		try {
			response = await fetch(url, {
				headers: {
					accept: 'application/json',
					...(cookie ? { cookie } : {}),
				},
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new NeteaseError(`Netease upstream unreachable: ${error.message}`, {
				status: 502,
				code: 'NETEASE_UNREACHABLE',
			});
		}

		if (!response.ok) {
			throw new NeteaseError(`Netease upstream returned HTTP ${response.status}`, {
				status: 502,
				code: 'NETEASE_BAD_STATUS',
			});
		}

		let body;
		try {
			body = await response.json();
		} catch {
			throw new NeteaseError('Netease upstream returned a non-JSON body', {
				status: 502,
				code: 'NETEASE_BAD_BODY',
			});
		}
		return body;
	}

	/** 上游业务码非 200 时抛出，把上游的 message 原样带出去。 */
	function assertOk(body, action) {
		const code = Number(body?.code);
		if (code === 200) return body;
		const message = String(body?.message || body?.msg || `Netease ${action} failed`);
		const status = code === 301 || code === 400 || code === 502 ? 400 : 502;
		throw new NeteaseError(message, { status, code: `NETEASE_${code || 'ERROR'}` });
	}

	/**
	 * 从登录/检查响应里提取真正可用的 Cookie 头。
	 *
	 * 上游有两种形态：
	 *   - `cookie` 是数组，每项一条完整 Set-Cookie
	 *   - `cookie` 是字符串（例如 login_qr_check 用 join(';') 拼过）
	 * 两种情况都必须只保留 name=value，丢掉 Max-Age/Expires/Path/HTTPOnly
	 * 这些属性 —— 把它们塞进 Cookie 头会污染请求，网易云直接当未登录
	 * （实测表现为 /user/account 返回 code 200 但 profile 为 null）。
	 */
	function cookieFrom(body, fallback) {
		const raw = body?.cookie ?? body?.cookies;
		const collected = new Map();

		const absorb = (value) => {
			const text = String(value || '');
			if (!text) return;
			for (const chunk of text.split(/[;,]/)) {
				const piece = chunk.trim();
				if (!piece) continue;
				const eq = piece.indexOf('=');
				if (eq <= 0) continue;
				const name = piece.slice(0, eq).trim();
				const val = piece.slice(eq + 1).trim();
				if (!name || !val) continue;
				if (!NETEASE_COOKIE_NAMES.has(name)) continue;
				collected.set(name, val);
			}
		};

		if (Array.isArray(raw)) raw.forEach(absorb);
		else absorb(raw);

		if (collected.size) {
			return Array.from(collected, ([key, value]) => `${key}=${value}`).join('; ');
		}
		return fallback || '';
	}

	function profileFrom(body) {
		const profile = body?.profile || body?.account || null;
		if (!profile) return null;
		return {
			userid: String(profile.userId ?? profile.id ?? ''),
			nickname: String(profile.nickname ?? profile.userName ?? ''),
			avatar: httpsUrl(profile.avatarUrl ?? profile.avatar ?? ''),
			source: 'netease',
		};
	}

	return {
		baseUrl,
		jar,

		/** cookie 里是否真的带上了登录态（MUSIC_U 才是登录凭证）。 */
		hasSessionCookie(cookie) {
			return /(?:^|;\s*)MUSIC_U=/.test(String(cookie || ''));
		},

		/** 上游存活探测：只打一个轻量接口，不触发风控。 */
		async health() {
			const startedAt = Date.now();
			const body = await call('/login/qr/key');
			return {
				reachable: Number(body?.code) === 200,
				latencyMs: Date.now() - startedAt,
				baseUrl,
			};
		},

		// ---------- 登录：扫码 ----------
		async qrCreate() {
			const keyBody = assertOk(await call('/login/qr/key'), 'qr key');
			const key = String(keyBody?.data?.unikey ?? '');
			if (!key) throw new NeteaseError('Netease did not return a QR key', { code: 'NETEASE_QR_NO_KEY' });
			const imageBody = assertOk(await call('/login/qr/create', { key, qrimg: true }), 'qr create');
			return {
				key,
				url: String(imageBody?.data?.qrurl ?? ''),
				image: String(imageBody?.data?.qrimg ?? ''),
			};
		},

		async qrCheck(key) {
			if (!key) throw new NeteaseError('Missing QR key', { status: 400, code: 'NETEASE_QR_KEY_REQUIRED' });
			const body = await call('/login/qr/check', { key });
			const code = Number(body?.code);
			const status = QR_STATUS[code] || 'unknown';
			if (status !== 'authorized') {
				return { status, code, message: String(body?.message || ''), cookie: null, profile: null };
			}
			return {
				status,
				code,
				message: String(body?.message || ''),
				cookie: cookieFrom(body),
				profile: profileFrom(body),
			};
		},

		// ---------- 登录：手机验证码 ----------
		async smsSend(phone) {
			if (!/^1\d{10}$/.test(String(phone || ''))) {
				throw new NeteaseError('Invalid mainland phone number', { status: 400, code: 'NETEASE_PHONE_INVALID' });
			}
			const body = await call('/captcha/sent', { phone });
			assertOk(body, 'sms send');
			return { sent: true };
		},

		async smsLogin(phone, captcha) {
			if (!/^1\d{10}$/.test(String(phone || ''))) {
				throw new NeteaseError('Invalid mainland phone number', { status: 400, code: 'NETEASE_PHONE_INVALID' });
			}
			if (!/^\d{4,8}$/.test(String(captcha || ''))) {
				throw new NeteaseError('Invalid verification code', { status: 400, code: 'NETEASE_CAPTCHA_INVALID' });
			}
			const body = await call('/login/cellphone', { phone, captcha });
			assertOk(body, 'sms login');
			return { cookie: cookieFrom(body), profile: profileFrom(body) };
		},

		// ---------- 账号 ----------
		async account(cookie) {
			if (!cookie) return null;
			const body = await call('/user/account', {}, cookie);
			if (Number(body?.code) !== 200) return null;
			return profileFrom(body);
		},

		// ---------- 歌单 ----------
		async playlists(cookie) {
			const me = await this.account(cookie);
			if (!me || !me.userid) throw new NeteaseError('Netease session expired', { status: 401, code: 'NETEASE_SESSION_EXPIRED' });
			const body = assertOk(await call('/user/playlist', { uid: me.userid, limit: 1000 }, cookie), 'playlists');
			const list = asArray(body?.playlist).map(normalizePlaylist).filter(Boolean);
			return { playlists: list, profile: me };
		},

		async playlistTracks(cookie, id, page = 1, pageSize = 300) {
			const safePage = Math.max(1, Math.min(1000, Number(page) || 1));
			const safeSize = Math.max(1, Math.min(300, Number(pageSize) || 300));
			const body = assertOk(
				await call('/playlist/track/all', {
					id,
					limit: safeSize,
					offset: (safePage - 1) * safeSize,
				}, cookie),
				'playlist tracks',
			);
			const songs = asArray(body?.songs).map(normalizeSong).filter(Boolean);
			return { songs, total: Number(body?.songs?.length) || songs.length };
		},

		// ---------- 搜索 ----------
		async search(cookie, keywords, page = 1, pageSize = 50) {
			const safePage = Math.max(1, Math.min(100, Number(page) || 1));
			const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 50));
			const body = assertOk(
				await call('/search', {
					keywords,
					type: 1,
					limit: safeSize,
					offset: (safePage - 1) * safeSize,
				}, cookie),
				'search',
			);
			const songs = asArray(body?.result?.songs).map(normalizeSong).filter(Boolean);
			return { songs, total: Number(body?.result?.songCount) || songs.length };
		},

		// ---------- 每日推荐（酷狗每日推荐的等价物）----------
		async dailyRecommendations(cookie) {
			const body = assertOk(await call('/recommend/songs', {}, cookie), 'daily recommendations');
			// 上游把结果放在 data.dailySongs；不同版本字段名有出入，按优先级兜底。
			const list = asArray(body?.data?.dailySongs, body?.recommend, body?.songs, body?.data?.songs);
			return { songs: list.map(normalizeSong).filter(Boolean) };
		},

		// ---------- 歌单增删（与酷狗同形）----------
		async createPlaylist(cookie, name) {
			const text = String(name || '').trim();
			if (!text) throw new NeteaseError('歌单名不能为空', { status: 400, code: 'NETEASE_PLAYLIST_NAME_INVALID' });
			if (text.length > 40) throw new NeteaseError('歌单名最长 40 个字符', { status: 400, code: 'NETEASE_PLAYLIST_NAME_INVALID' });
			const body = assertOk(await call('/playlist/create', { name: text }, cookie), 'create playlist');
			const id = String(body?.id ?? body?.playlist?.id ?? '');
			if (!id) throw new NeteaseError('创建歌单未返回 id', { code: 'NETEASE_PLAYLIST_NO_ID' });
			return { listid: id, name: text, count: 0 };
		},

		async deletePlaylist(cookie, id) {
			assertOk(await call('/playlist/delete', { id }, cookie), 'delete playlist');
			return { deleted: true };
		},

		async addPlaylistTracks(cookie, id, trackIds) {
			const tracks = asArray(trackIds).map((item) => String(item).trim()).filter(Boolean);
			if (!tracks.length) throw new NeteaseError('缺少歌曲 id', { status: 400, code: 'NETEASE_TRACKS_REQUIRED' });
			assertOk(await call('/playlist/tracks', { op: 'add', pid: id, tracks: tracks.join(',') }, cookie), 'add tracks');
			return { added: tracks.length };
		},

		async delPlaylistTracks(cookie, id, trackIds) {
			const tracks = asArray(trackIds).map((item) => String(item).trim()).filter(Boolean);
			if (!tracks.length) throw new NeteaseError('缺少歌曲 id', { status: 400, code: 'NETEASE_TRACKS_REQUIRED' });
			assertOk(await call('/playlist/tracks', { op: 'del', pid: id, tracks: tracks.join(',') }, cookie), 'delete tracks');
			return { deleted: tracks.length };
		},

		// ---------- 每日签到（酷狗 VIP 每日领取在网易云侧的等价物）----------
		async dailySignin(cookie) {
			const body = await call('/daily_signin', { type: 1 }, cookie);
			const code = Number(body?.code);
			// -2 是「重复签到」，属于正常状态，不该当错误抛。
			if (code === -2) return { alreadySigned: true, point: Number(body?.point) || 0 };
			if (code !== 200) {
				const message = String(body?.msg || body?.message || '签到失败');
				throw new NeteaseError(message, { status: 400, code: `NETEASE_SIGNIN_${code || 'ERROR'}` });
			}
			return { alreadySigned: false, point: Number(body?.point) || 0 };
		},

		// ---------- 播放 ----------
		async songUrl(cookie, id, quality) {
			const level = QUALITY_TO_LEVEL[String(quality || '128')] || QUALITY_TO_LEVEL['128'];
			const body = assertOk(await call('/song/url/v1', { id, level }, cookie), 'song url');
			const entry = asArray(body?.data)[0] || {};
			const url = String(entry.url || '');
			if (!url) {
				throw new NeteaseError('Netease did not return a playable URL (VIP or region restricted)', {
					status: 502,
					code: 'NETEASE_NO_URL',
				});
			}
			return {
				url,
				br: Number(entry.br) || 0,
				size: Number(entry.size) || 0,
				level: String(entry.level || level),
			};
		},

		// ---------- 歌词 ----------
		async lyric(cookie, id) {
			const body = assertOk(await call('/lyric', { id }, cookie), 'lyric');
			const lrc = String(body?.lrc?.lyric || '');
			const translated = String(body?.tlyric?.lyric || '');
			return { content: lrc, translation: translated };
		},
	};
}

module.exports = {
	NeteaseError,
	createNeteaseProvider,
	createCookieJar,
	normalizeSong,
	normalizePlaylist,
	QUALITY_TO_LEVEL,
	QR_STATUS,
};
