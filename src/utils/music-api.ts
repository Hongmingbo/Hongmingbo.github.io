export interface MusicSession {
	/** 仅为展示和本地状态服务；绝不包含上游酷狗 token、Cookie 或设备指纹。 */
	userid: number | string;
	nickname?: string;
	pic?: string;
}

/** BFF 二维码轮询结果。二维码状态与成功会话严格分离，避免 UI 猜测响应结构。 */
export interface MusicQrPoll {
	status: number;
	nickname?: string;
	session?: MusicSession;
}

export interface MusicRiskChallenge {
	eventid: string;
	ssaCode?: string;
	edt: string;
	sid: string;
	hash: string;
}

export interface MusicPlaylist {
	listid: string | number;
	name: string;
	count?: number;
	cover?: string;
	[key: string]: unknown;
}

export interface MusicSong {
	hash: string;
	name: string;
	author: string;
	img: string;
	timeLength: number;
	album?: string;
	[key: string]: unknown;
}

// Fixed production endpoint. Browser code never receives an arbitrary credentialed API origin.
export const MUSIC_BFF_ORIGIN = "https://music.hmb2011.bond";

export class MusicApiError extends Error {
	readonly code?: number | string;
	readonly status?: number;
	readonly payload: unknown;

	constructor(message: string, payload: unknown = null, status?: number, code?: number | string) {
		super(message);
		this.name = "MusicApiError";
		this.payload = payload;
		this.status = status;
		this.code = code;
	}
}

export class MusicRiskVerifyError extends MusicApiError {
	readonly challenge: MusicRiskChallenge;

	constructor(message: string, payload: unknown, challenge: MusicRiskChallenge) {
		super(message, payload, 423, "RISK_VERIFY_REQUIRED");
		this.name = "MusicRiskVerifyError";
		this.challenge = challenge;
	}
}

const apiData = (payload: any): any => payload?.data ?? payload?.body?.data ?? payload?.body ?? payload;
export const responseData = <T = any>(payload: unknown): T => apiData(payload) as T;

const responseMessage = (payload: any): string => {
	const body = payload?.body ?? payload;
	for (const value of [body?.message, body?.error_msg, body?.msg, body?.error]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
};

export const responseStatus = (payload: any): number | undefined => {
	const raw = payload?.status ?? payload?.body?.status ?? payload?.code;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
};

export const responseErrorCode = (payload: any): number | string | undefined => {
	const raw = payload?.error_code ?? payload?.body?.error_code ?? payload?.data?.error_code ?? payload?.body?.data?.error_code ?? payload?.error?.error_code;
	return raw === undefined || raw === null ? undefined : raw;
};

export const musicErrorMessage = (error: unknown, fallback: string): string => {
	const code = error instanceof MusicApiError ? error.code : responseErrorCode(error as any);
	const status = error instanceof MusicApiError ? error.status : Number((error as any)?.status);
	if (status === 429 || String(code) === "RATE_LIMITED") return "请求过于频繁，请稍后再试";
	if (String(code) === "131001") return "今日已经领取过 VIP";
	if (String(code) === "20028") return "当前账号需要在酷狗官方客户端完成验证";
	if (error instanceof MusicApiError && error.message) return error.message;
	return fallback;
};

export const responseSucceeded = (payload: unknown): boolean => {
	const status = responseStatus(payload);
	return status === 1 || status === 200;
};

export type MusicRiskMode = "captcha" | "sms" | "login" | "unsupported";

export const classifyMusicRisk = (value: unknown): MusicRiskMode => {
	const type = Number(value);
	if (type === 23) return "captcha";
	if (type === 32) return "sms";
	if (type === 38) return "login";
	return "unsupported";
};

export const normalizeApiBaseUrl = (input: string): string => {
	const raw = input.trim().replace(/\/+$/, "");
	if (!raw) return "";
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "https:" && !(import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) return "";
		return raw;
	} catch {
		return "";
	}
};

export const getShanghaiDateKey = (date = new Date()): string => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
};

export type DailyVipResult =
	| { status: "completed"; shouldMarkComplete: true; message: string }
	| { status: "retry"; shouldMarkComplete: false; message: string }
	| { status: "risk"; shouldMarkComplete: false; message: string };

/**
 * Shared, deterministic daily-VIP state machine.
 * The caller persists a completion marker only when shouldMarkComplete is true.
 */
export const runDailyVipFlow = async (input: {
	dateKey: string;
	claim: (dateKey: string) => Promise<unknown>;
	upgrade: () => Promise<unknown>;
}): Promise<DailyVipResult> => {
	let claimPayload: unknown;
	try {
		claimPayload = await input.claim(input.dateKey);
	} catch (error) {
		const code = error instanceof MusicApiError ? error.code : undefined;
		if (String(code) === "131001") claimPayload = { status: 0, error_code: 131001 };
		else if (String(code) === "20028") return { status: "risk", shouldMarkComplete: false, message: "当前账号需要在酷狗官方客户端完成验证" };
		else return { status: "retry", shouldMarkComplete: false, message: "今日 VIP 检查失败，可在首次播放时重试" };
	}

	const claimCode = responseErrorCode(claimPayload);
	if (!responseSucceeded(claimPayload) && String(claimCode) !== "131001") {
		if (String(claimCode) === "20028") return { status: "risk", shouldMarkComplete: false, message: "当前账号需要在酷狗官方客户端完成验证" };
		return { status: "retry", shouldMarkComplete: false, message: "今日 VIP 检查失败，可在首次播放时重试" };
	}

	try {
		const upgradePayload = await input.upgrade();
		if (!responseSucceeded(upgradePayload)) {
			if (String(responseErrorCode(upgradePayload)) === "20028") return { status: "risk", shouldMarkComplete: false, message: "当前账号需要在酷狗官方客户端完成验证" };
			return { status: "retry", shouldMarkComplete: false, message: "今日畅听权益已领取，但概念版升级可稍后重试" };
		}
		return { status: "completed", shouldMarkComplete: true, message: "今日 VIP 已领取并升级" };
	} catch (error) {
		const code = error instanceof MusicApiError ? error.code : undefined;
		if (String(code) === "20028") return { status: "risk", shouldMarkComplete: false, message: "当前账号需要在酷狗官方客户端完成验证" };
		return { status: "retry", shouldMarkComplete: false, message: "今日畅听权益已领取，但概念版升级可稍后重试" };
	}
};

const asList = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const AUDIO_EXTENSION_RE = /\.(?:mp3|flac|m4a|aac|ogg|wav|wma|ape|opus)(?:\?.*)?$/i;
const SONG_TITLE_SEPARATOR_RE = /\s*(?:[-–—+|｜:：])\s*/;

const textValue = (value: unknown): string => {
	if (typeof value === "string" || typeof value === "number") return String(value).trim();
	if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("、");
	return "";
};

const stripAudioExtension = (value: string): string => value.replace(AUDIO_EXTENSION_RE, "").trim();

const stripAuthorPrefix = (title: string, author: string): string => {
	const cleanTitle = stripAudioExtension(title);
	const cleanAuthor = author.trim();
	if (!cleanTitle || !cleanAuthor) return cleanTitle;
	const prefix = new RegExp(`^${cleanAuthor.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*(?:[-–—+|｜:：])\\s*`, "i");
	return cleanTitle.replace(prefix, "").trim() || cleanTitle;
};

const parseSongIdentity = (item: any): { name: string; author: string } => {
	const rawName = textValue(item.name ?? item.ori_audio_name ?? item.songname ?? item.SongName ?? item.OriSongName ?? item.AudioName ?? item.audio_name ?? item.FileName ?? item.filename);
	const explicitAuthor = textValue(item.author ?? item.author_name ?? item.singername ?? item.singerName ?? item.SingerName ?? item.singer ?? item.artist ?? item.Artist ?? item.singers);
	const cleanName = stripAuthorPrefix(rawName, explicitAuthor);
	if (explicitAuthor) return { name: cleanName || "未命名歌曲", author: explicitAuthor };

	const parts = cleanName.split(SONG_TITLE_SEPARATOR_RE).map((part) => part.trim()).filter(Boolean);
	if (parts.length === 2 && parts[0] && parts[1]) return { name: parts[1], author: parts[0] };
	return { name: cleanName || "未命名歌曲", author: "未知艺术家" };
};

export const normalizePlaylists = (payload: unknown): MusicPlaylist[] => {
	const data = responseData<any>(payload);
	const info = asList(data?.info ?? data?.lists ?? data);
	return info
		.filter((item) => item && (item.listid !== undefined || item.list_create_listid !== undefined))
		.map((item) => ({
			...item,
			listid: item.listid ?? item.list_create_listid,
			name: String(item.name ?? "未命名歌单"),
			count: Number(item.count ?? item.song_count ?? 0) || undefined,
			cover: item.pic ?? item.cover ?? item.img ?? "",
		}));
};

export const normalizeSongs = (payload: unknown): MusicSong[] => {
	const data = responseData<any>(payload);
	const info = asList(data?.info ?? data?.lists ?? data?.song_list ?? data);
	return info
		.filter((item) => item && typeof (item.hash ?? item.FileHash) === "string")
		.map((item) => {
			const identity = parseSongIdentity(item);
			return {
				...item,
				hash: String(item.hash ?? item.FileHash),
				name: identity.name,
				author: identity.author,
				img: String(item.cover ?? item.sizable_cover ?? item.pic ?? item.image ?? item.img ?? "").replace("{size}", "480"),
				timeLength: Number(item.timelen ?? item.time_length ?? item.duration ?? item.timeLength ?? 0) || 0,
				album: item.album ?? item.album_name ?? "",
			};
		});
};

export const paginateSongs = <T,>(items: T[], page: number, pageSize: number): T[] => {
	const safePage = Math.max(1, Math.floor(page));
	const safePageSize = Math.max(1, Math.floor(pageSize));
	return items.slice((safePage - 1) * safePageSize, safePage * safePageSize);
};

export const sortSongs = (songs: MusicSong[], sort: "default" | "title" | "artist"): MusicSong[] => [...songs].sort((a, b) => {
	if (sort === "title") return a.name.localeCompare(b.name, "zh-CN");
	if (sort === "artist") return a.author.localeCompare(b.author, "zh-CN");
	return 0;
});

/** 歌单内歌曲的 fileid（删除接口需要），仅歌单曲目接口返回该字段。 */
export const songFileId = (song: MusicSong): string | null => {
	const raw = song.id ?? song.fileid ?? song.song_id;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? String(value) : null;
};

export type PlayMode = "order" | "list" | "one" | "shuffle";

export const PLAY_MODE_ORDER: PlayMode[] = ["order", "list", "one", "shuffle"];

export const nextPlayMode = (mode: PlayMode): PlayMode => {
	const index = PLAY_MODE_ORDER.indexOf(mode);
	return PLAY_MODE_ORDER[(index + 1) % PLAY_MODE_ORDER.length];
};

/** 迁移旧播放器独立的 shuffle/repeat 状态为统一播放模式。 */
export const normalizePlayMode = (shuffle: boolean, repeat: "list" | "one" | "off"): PlayMode => {
	if (shuffle) return "shuffle";
	if (repeat === "one") return "one";
	return "list";
};

export const isSongInPlaylist = (hash: string, songs: MusicSong[]): boolean => songs.some((song) => song.hash === hash);

/** Deterministic Fisher–Yates shuffle with optional seed. Never mutates the input. */
export const shuffleSongs = <T,>(items: T[], seed = Math.floor(Math.random() * 2 ** 31)): T[] => {
	const copy = [...items];
	let state = seed >>> 0;
	const next = () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
	for (let i = copy.length - 1; i > 0; i -= 1) {
		const j = Math.floor(next() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

export interface MusicLyricLine {
	time: number | null;
	text: string;
}

const LYRIC_META_RE = /^\[(?:ti|ar|al|by|offset|re|ve|sign|id|hash):/i;
// 酷狗部分歌曲歌词尾部带非标准元数据行（如 [qq:...]、[total:...]、base64 串），统一过滤。
const LYRIC_JUNK_LINE_RE = /^\[(?:qq|total|kana|language|trans|roman|karakera|version):/i;
const LYRIC_BASE64ISH_RE = /^[A-Za-z0-9+/=]{40,}$/;
const KRC_CHAR_TAG_RE = /<\d+(?:,\d+)+>/g;
const LRC_TIME_RE = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*/;
const KRC_TIME_RE = /^\[(\d+),(\d+)\]\s*/;

const parseLrcSeconds = (minutes: string, seconds: string, fraction = ""): number => {
	const fractionValue = fraction ? Number(`0.${fraction}`) : 0;
	return Number(minutes) * 60 + Number(seconds) + fractionValue;
};

export const isCurrentLyricsRequest = (requestedHash: string, currentHash: string | undefined, requestGeneration: number, currentGeneration: number): boolean => (
	requestedHash === currentHash && requestGeneration === currentGeneration
);

export const centeredLyricScrollTop = (lineOffsetTop: number, lineHeight: number, containerHeight: number, scrollHeight: number): number => {
	const target = lineOffsetTop - Math.max(0, (containerHeight - lineHeight) / 2);
	return Math.max(0, Math.min(target, Math.max(0, scrollHeight - containerHeight)));
};

/** Convert LRC/KRC text into clean line-level timestamps for the player UI. */
export const parseLyricsText = (raw: string): MusicLyricLine[] => {
	const lines: MusicLyricLine[] = [];
	for (const original of String(raw || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
		let line = original.trim();
		if (!line || LYRIC_META_RE.test(line) || LYRIC_JUNK_LINE_RE.test(line)) continue;
		if (LYRIC_BASE64ISH_RE.test(line)) continue;

		const krcMatch = line.match(KRC_TIME_RE);
		if (krcMatch) {
			const text = line.slice(krcMatch[0].length).replace(KRC_CHAR_TAG_RE, "").trim();
			if (text) lines.push({ time: Number(krcMatch[1]) / 1000, text: text.slice(0, 240) });
			continue;
		}

		const timestamps: number[] = [];
		let timestampMatch: RegExpMatchArray | null;
		while ((timestampMatch = line.match(LRC_TIME_RE))) {
			timestamps.push(parseLrcSeconds(timestampMatch[1], timestampMatch[2], timestampMatch[3]));
			line = line.slice(timestampMatch[0].length);
		}
		const text = line.replace(KRC_CHAR_TAG_RE, "").trim();
		if (!text) continue;
		if (timestamps.length === 0) lines.push({ time: null, text: text.slice(0, 240) });
		else for (const time of timestamps) lines.push({ time, text: text.slice(0, 240) });
	}
	return lines.sort((a, b) => {
		if (a.time === null) return 1;
		if (b.time === null) return -1;
		return a.time - b.time;
	}).slice(0, 300);
};

/**
 * Browser-side client for the hardened music BFF, not for KuGouMusicApi directly.
 * The BFF owns upstream credentials/device state and returns only public profile data.
 */
export class MusicApiClient {
	readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = normalizeApiBaseUrl(baseUrl);
	}

	async request<T = any>(path: string, options: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
		if (!this.baseUrl) throw new MusicApiError("音乐服务尚未配置");
		const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
		}
		const headers: Record<string, string> = { Accept: "application/json", "Cache-Control": "no-store" };
		if (options.body !== undefined) headers["Content-Type"] = "application/json";
		const response = await fetch(url, {
			method: options.method ?? (options.body === undefined ? "GET" : "POST"),
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			credentials: "include",
			cache: "no-store",
		});
		const text = await response.text();
		let payload: any = null;
		try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
		if (!response.ok) {
			if (response.status === 423 && payload?.error_code === "RISK_VERIFY_REQUIRED") {
				const data = payload?.data ?? {};
				throw new MusicRiskVerifyError(
					String(payload?.message || "需要完成安全验证"),
					payload,
					{
						eventid: String(data.eventid || data.ssaCode || ""),
						ssaCode: data.ssaCode ? String(data.ssaCode) : undefined,
						edt: String(data.edt || ""),
						sid: String(data.sid || ""),
						hash: String(data.hash || ""),
					},
				);
			}
			throw new MusicApiError(responseMessage(payload) || `音乐服务返回 HTTP ${response.status}`, payload, response.status, responseErrorCode(payload));
		}
		return payload as T;
	}

	async health(): Promise<void> {
		const payload = await this.request("/health");
		if (!responseSucceeded(payload)) throw new MusicApiError("音乐服务健康检查失败", payload, undefined, responseErrorCode(payload));
	}

	async getSession(): Promise<MusicSession | null> {
		try {
			const payload = await this.request("/session");
			if (!responseSucceeded(payload)) return null;
			const data = responseData<any>(payload);
			if (!data?.authenticated || data.userid === undefined) return null;
			return { userid: data.userid, nickname: data.nickname, pic: data.pic };
		} catch (error) {
			if (error instanceof MusicApiError && error.status === 401) return null;
			throw error;
		}
	}

	async loginPassword(username: string, password: string): Promise<MusicSession> {
		const payload = await this.request("/auth/password", { body: { username, password } });
		if (!responseSucceeded(payload)) throw new MusicApiError("账号密码登录失败", payload, undefined, responseErrorCode(payload));
		return this.sessionFromLogin(payload);
	}

	async sendCaptcha(mobile: string): Promise<void> {
		const payload = await this.request("/auth/sms/send", { body: { mobile } });
		if (!responseSucceeded(payload)) throw new MusicApiError("验证码发送失败", payload, undefined, responseErrorCode(payload));
	}

	async loginPhone(mobile: string, code: string, userid?: string): Promise<MusicSession> {
		const payload = await this.request("/auth/sms/login", { body: { mobile, code, userid } });
		if (!responseSucceeded(payload)) throw new MusicApiError("手机验证码登录失败", payload, undefined, responseErrorCode(payload));
		return this.sessionFromLogin(payload);
	}

	async createQr(): Promise<{ key: string; image: string }> {
		const payload = await this.request("/auth/qr", { method: "POST", body: {} });
		if (!responseSucceeded(payload)) throw new MusicApiError("二维码创建失败", payload, undefined, responseErrorCode(payload));
		const data = responseData<any>(payload);
		const key = String(data?.key ?? data?.id ?? "");
		const image = String(data?.image ?? data?.base64 ?? "");
		if (!key || !image) throw new MusicApiError("二维码响应无效", payload);
		return { key, image };
	}

	async checkQr(key: string): Promise<MusicQrPoll> {
		const payload = await this.request("/auth/qr/status", { query: { key } });
		const data = responseData<any>(payload);
		const status = Number(data?.status);
		if (!Number.isInteger(status) || status < 0) throw new MusicApiError("二维码状态响应无效", payload);
		return {
			status,
			nickname: typeof data?.nickname === "string" ? data.nickname : "",
			...(status === 4 ? { session: this.sessionFromQr(payload) } : {}),
		};
	}

	private sessionFromLogin(payload: unknown): MusicSession {
		const data = responseData<any>(payload);
		if (data?.userid === undefined) throw new MusicApiError("登录会话响应无效", payload);
		return { userid: data.userid, nickname: data.nickname, pic: data.pic };
	}

	private sessionFromQr(payload: unknown): MusicSession {
		const data = responseData<any>(payload);
		if (Number(data?.status) !== 4 || data?.userid === undefined) throw new MusicApiError("二维码会话响应无效", payload);
		return { userid: data.userid, nickname: data.nickname, pic: data.pic };
	}

	async logout(): Promise<void> {
		await this.request("/session/logout", { method: "POST" });
	}

	async getPlaylists(): Promise<MusicPlaylist[]> {
		return normalizePlaylists(await this.request("/playlists", { query: { pagesize: 500 } }));
	}

	async getPlaylistSongs(id: string | number): Promise<MusicSong[]> {
		const all: MusicSong[] = [];
		for (let page = 1; page <= 4; page += 1) {
			const payload = await this.request(`/playlists/${encodeURIComponent(String(id))}/tracks`, { query: { pagesize: 300, page } });
			const songs = normalizeSongs(payload);
			all.push(...songs);
			if (songs.length < 300) break;
		}
		return all;
	}

	async getDailyRecommendations(): Promise<MusicSong[]> {
		return normalizeSongs(await this.request("/recommendations/daily"));
	}

	async searchSongs(keyword: string, page = 1, pagesize = 50): Promise<MusicSong[]> {
		const payload = await this.request("/search/songs", { query: { keyword, page, pagesize } });
		return normalizeSongs(payload);
	}

	async addPlaylistTracks(listid: string | number, data: string): Promise<unknown> {
		return this.request(`/playlists/${encodeURIComponent(String(listid))}/add`, { method: "POST", body: { data } });
	}

	async delPlaylistTracks(listid: string | number, fileids: Array<string | number>): Promise<unknown> {
		return this.request(`/playlists/${encodeURIComponent(String(listid))}/tracks/delete`, { method: "POST", body: { fileids } });
	}

	async getStreamPreparation(hash: string): Promise<void> {
		await this.request(`/tracks/${encodeURIComponent(hash)}/prepare`);
	}

	async getRiskInfo(eventid: string): Promise<any> {
		return this.request("/verify/info", { method: "POST", body: { eventid } });
	}

	async submitRiskVerification(input: { eventid: string; vType: number; verifycode: string; sid: string; edt: string }): Promise<any> {
		return this.request("/verify/verify", {
			method: "POST",
			body: {
				eventid: input.eventid,
				v_type: input.vType,
				verifycode: input.verifycode,
				sid: input.sid,
				edt: input.edt,
			},
		});
	}

	async getStreamUrl(hash: string): Promise<string> {
		if (!this.baseUrl) throw new MusicApiError("音乐服务尚未配置");
		await this.getStreamPreparation(hash);
		// Native Audio requests this BFF URL directly. The BFF HttpOnly session cookie
		// authenticates the request; this never resolves or exposes an upstream media URL.
		return `${this.baseUrl}/tracks/${encodeURIComponent(hash)}/stream`;
	}

	async getLyrics(hash: string): Promise<string> {
		const payload = await this.request(`/tracks/${encodeURIComponent(hash)}/lyrics`);
		const data = responseData<any>(payload);
		return String(data?.content ?? data?.decodeContent ?? "");
	}

	async claimVip(dateKey: string): Promise<any> {
		return this.request("/vip/daily", { method: "POST", body: { receive_day: dateKey } });
	}

	async upgradeVip(): Promise<any> {
		return this.request("/vip/daily/upgrade", { method: "POST", body: {} });
	}
}
