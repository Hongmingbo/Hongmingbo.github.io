export interface MusicSession {
	/** 仅为展示和本地状态服务；绝不包含上游酷狗 token、Cookie 或设备指纹。 */
	userid: number | string;
	nickname?: string;
	pic?: string;
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

const apiData = (payload: any): any => payload?.data ?? payload?.body?.data ?? payload?.body ?? payload;
export const responseData = <T = any>(payload: unknown): T => apiData(payload) as T;

export const responseStatus = (payload: any): number | undefined => {
	const raw = payload?.status ?? payload?.body?.status ?? payload?.code;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
};

export const responseErrorCode = (payload: any): number | string | undefined => {
	const raw = payload?.error_code ?? payload?.body?.error_code ?? payload?.data?.error_code ?? payload?.body?.data?.error_code ?? payload?.error?.error_code;
	return raw === undefined || raw === null ? undefined : raw;
};

export const responseSucceeded = (payload: unknown): boolean => {
	const status = responseStatus(payload);
	return status === 1 || status === 200;
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
	const info = asList(data?.info ?? data?.lists ?? data);
	return info
		.filter((item) => item && typeof (item.hash ?? item.FileHash) === "string")
		.map((item) => ({
			...item,
			hash: String(item.hash ?? item.FileHash),
			name: String(item.name ?? item.songname ?? item.OriSongName ?? "未命名歌曲"),
			author: String(item.author ?? item.singername ?? item.singerName ?? "未知艺术家"),
			img: String(item.cover ?? item.pic ?? item.image ?? item.img ?? "").replace("{size}", "480"),
			timeLength: Number(item.timelen ?? item.duration ?? item.timeLength ?? 0) || 0,
			album: item.album ?? item.album_name ?? "",
		}));
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
		if (!response.ok) throw new MusicApiError(`音乐服务返回 HTTP ${response.status}`, payload, response.status, responseErrorCode(payload));
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
		const payload = await this.request("/auth/qr", { method: "POST" });
		if (!responseSucceeded(payload)) throw new MusicApiError("二维码创建失败", payload, undefined, responseErrorCode(payload));
		const data = responseData<any>(payload);
		const key = String(data?.key ?? data?.id ?? "");
		const image = String(data?.image ?? data?.base64 ?? "");
		if (!key || !image) throw new MusicApiError("二维码响应无效", payload);
		return { key, image };
	}

	async checkQr(key: string): Promise<any> {
		const payload = await this.request("/auth/qr/status", { query: { key } });
		const data = responseData<any>(payload);
		if (Number(data?.status) === 4) return this.sessionFromQr(payload);
		return payload;
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

	async getStreamUrl(hash: string): Promise<string> {
		if (!this.baseUrl) throw new MusicApiError("音乐服务尚未配置");
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
		return this.request("/vip/daily/upgrade", { method: "POST" });
	}
}
