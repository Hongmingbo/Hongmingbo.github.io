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
export const MUSIC_BFF_ORIGIN = "https://music.hmb2011.dpdns.org";

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
	if (String(code) === "UPSTREAM_REJECTED" || String(code) === "UPSTREAM_ERROR") {
		return "酷狗未接受本次操作，请稍后重试或改用扫码登录";
	}
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
				// 上游不同接口的大小写不一致：歌单曲目接口返回大写 hash、搜索接口返回
				// 小写，直接比较会让搜索行的收藏状态永远匹配不上（空心）。
				// 统一以小写为规范形态；下游比较全部经由这一处归一。
				hash: String(item.hash ?? item.FileHash).toLowerCase(),
				name: identity.name,
				author: identity.author,
				// 搜索结果经常没有封面对段；酷狗封面接口按 hash 取图，
				// 缺字段时用它兜底，避免列表里大片占位图标。
				img: String(
					item.cover ??
						item.sizable_cover ??
						item.pic ??
						item.image ??
						item.img ??
						(item.hash || item.FileHash
							? `https://imge.kugou.com/stdmusic/480/${String(item.hash ?? item.FileHash).toLowerCase()}.jpg`
							: ""),
				).replace("{size}", "480"),
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

// 列表循环与顺序播放对同一列表的遍历顺序完全相同，只在列表末尾行为上有差别，
// 同时保留两个选项只会让用户困惑，因此合并为 "list"（列表循环）。
export type PlayMode = "list" | "one" | "shuffle";

export const PLAY_MODE_ORDER: PlayMode[] = ["list", "one", "shuffle"];

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

/** 读取历史存储值：旧的 "order" 迁移到 "list"，未知值回退到默认。 */
export const coercePlayMode = (raw: string | null): PlayMode => {
	if (raw === "one" || raw === "shuffle" || raw === "list") return raw;
	// "order" 已合并进 "list"；其余（含 null/空）都用默认列表循环。
	return "list";
};

export const isSongInPlaylist = (hash: string, songs: MusicSong[]): boolean => {
	const needle = String(hash || "").toLowerCase();
	return songs.some((song) => String(song.hash || "").toLowerCase() === needle);
};

/** 音质白名单：存储值可能被旧版本或手改污染，播放请求前必须归一。 */
export const AUDIO_QUALITIES = ["128", "320", "flac"] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];
export const normalizeAudioQuality = (value: unknown): AudioQuality =>
	(AUDIO_QUALITIES as readonly string[]).includes(String(value)) ? (String(value) as AudioQuality) : "128";

/** 播放行音质徽章用的短标签。 */
export const qualityLabel = (value: AudioQuality | string): string =>
	value === "flac" ? "无损" : `${value}k`;

/** 搜索历史：去重（trim + 大小写不敏感）、新词置顶、上限 10 条。
 * 存储里可能是任何形状（旧数据/损坏 JSON），一律容错。 */
/** 下载文件名：过滤文件系统保留字符与控制符，压平空白，去掉开头的点
 * （避免生成隐藏文件或相对路径），并限制长度。全空时给一个占位名。 */
export const sanitizeDownloadFilename = (raw: string, fallback = "track"): string => {
	const cleaned = String(raw ?? "")
		.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.trim()
		.slice(0, 120)
		.trim();
	return cleaned || fallback;
};

/** 依据上游 Content-Type 判定扩展名；拿不到类型时回落到音质档位。 */
export const audioExtensionFor = (contentType: string | undefined, quality?: string): string => {
	const type = String(contentType || "").toLowerCase();
	if (type.includes("flac")) return "flac";
	if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
	if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
	return String(quality || "").toLowerCase() === "flac" ? "flac" : "mp3";
};

const DOWNLOAD_EXTENSIONS = ["mp3", "flac", "m4a"] as const;

/** 组合「歌名 - 歌手.扩展名」；扩展名只允许白名单，歌手为空时不留尾随分隔符。 */
export const buildDownloadName = (name: string, author: string, ext: string): string => {
	const safeExt = (DOWNLOAD_EXTENSIONS as readonly string[]).includes(String(ext).toLowerCase())
		? String(ext).toLowerCase()
		: "mp3";
	const title = [String(name ?? "").trim(), String(author ?? "").trim()].filter(Boolean).join(" - ");
	return `${sanitizeDownloadFilename(title, "track")}.${safeExt}`;
};

// ===== 下载队列模型 =====
// 纯逻辑，不碰网络与 DOM：并发调度、进度推进、去重、历史裁剪都在这里定死，
// 由契约测试锁定，UI 只负责渲染。
export type DownloadStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface DownloadRecord {
	id: string;
	hash: string;
	name: string;
	author: string;
	quality: string;
	status: DownloadStatus;
	loaded: number;
	total: number;
	/** 完成后的实际字节数；未完成时为 0。 */
	size: number;
	attempt: number;
	error?: string;
	createdAt: number;
	finishedAt?: number;
}

export const DOWNLOAD_QUEUE_LIMIT = 100;
export const DOWNLOAD_HISTORY_LIMIT = 50;
export const DOWNLOAD_CONCURRENCY_MIN = 1;
export const DOWNLOAD_CONCURRENCY_MAX = 4;
export const DOWNLOAD_CONCURRENCY_DEFAULT = 2;

/** 并发数白名单化：非法输入回落到默认值，越界夹到边界。 */
export const clampDownloadConcurrency = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return DOWNLOAD_CONCURRENCY_DEFAULT;
	const floored = Math.trunc(parsed);
	if (floored < DOWNLOAD_CONCURRENCY_MIN) return DOWNLOAD_CONCURRENCY_MIN;
	if (floored > DOWNLOAD_CONCURRENCY_MAX) return DOWNLOAD_CONCURRENCY_MAX;
	return floored;
};

export const formatBytes = (bytes: number): string => {
	const value = Number(bytes);
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	if (value < 1024) return `${Math.round(value)} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** 百分比：总长未知返回 null（UI 用不确定态），否则夹在 0..100。 */
export const downloadProgressPercent = (loaded: number, total: number): number | null => {
	const l = Number(loaded);
	const t = Number(total);
	if (!Number.isFinite(t) || t <= 0) return null;
	if (!Number.isFinite(l) || l <= 0) return 0;
	if (l >= t) return 100;
	return Math.round((l / t) * 100);
};

export const isDownloadActive = (record: { status: DownloadStatus }): boolean =>
	record.status === "queued" || record.status === "running";

let downloadSeq = 0;
const nextDownloadId = (): string => {
	downloadSeq += 1;
	return `dl-${Date.now().toString(36)}-${downloadSeq.toString(36)}`;
};

/** 同一首歌可以有多条历史记录（重下/换音质），因此 id 必须独立于 hash。 */
export const createDownloadRecord = (
	song: { hash: string; name: string; author: string; quality: string },
	attempt = 1,
): DownloadRecord => ({
	id: nextDownloadId(),
	hash: String(song.hash || "").toLowerCase(),
	name: String(song.name || ""),
	author: String(song.author || ""),
	quality: String(song.quality || "128"),
	status: "queued",
	loaded: 0,
	total: 0,
	size: 0,
	attempt,
	createdAt: Date.now(),
});

/** 状态推进唯一入口：进度单调、终态粘滞。 */
export const updateDownloadRecord = (
	record: DownloadRecord,
	patch: Partial<Pick<DownloadRecord, "loaded" | "total" | "size" | "status" | "error">>,
): DownloadRecord => {
	const next: DownloadRecord = { ...record };
	// 终态不可被迟到回调改写：只有当前仍是活动态时才接受 running/queued。
	const incomingStatus = patch.status;
	const isTerminal = (status?: DownloadStatus) =>
		status === "done" || status === "failed" || status === "canceled";
	if (incomingStatus && isTerminal(record.status) && !isTerminal(incomingStatus)) {
		return next;
	}
	if (patch.total !== undefined && Number.isFinite(patch.total) && patch.total > 0) {
		next.total = patch.total;
	}
	if (patch.loaded !== undefined && Number.isFinite(patch.loaded)) {
		next.loaded = Math.max(next.loaded, patch.loaded, 0);
		// 已经有进度却还标着 queued 是自相矛盾的：自动进入 running，
		// 免得每个进度回调都要额外传一次 status。
		if (next.status === "queued" && next.loaded > 0) next.status = "running";
	}
	if (patch.size !== undefined && Number.isFinite(patch.size) && patch.size > 0) {
		next.size = patch.size;
	}
	if (patch.error !== undefined) next.error = String(patch.error);
	if (incomingStatus) {
		next.status = incomingStatus;
		if (incomingStatus === "running" && next.loaded === 0 && !next.error) {
			// 开跑时清掉上一轮的错误，避免重试成功后仍显示旧错误。
			delete next.error;
		}
		if (isTerminal(incomingStatus)) {
			next.finishedAt = Date.now();
			if (incomingStatus === "done" && next.size === 0 && next.loaded > 0) {
				next.size = next.loaded;
			}
		}
	}
	return next;
};

/** 入队：同 hash 已在活动态则跳过；已完成的不阻塞（换音质重下是合法的）。 */
export const enqueueDownloads = (
	existing: DownloadRecord[],
	songs: Array<{ hash: string; name: string; author: string; quality: string }>,
	attempt = 1,
): { added: DownloadRecord[]; skipped: Array<{ hash: string }>; rejected: Array<{ hash: string }>; records: DownloadRecord[] } => {
	const records = [...existing];
	const added: DownloadRecord[] = [];
	const skipped: Array<{ hash: string }> = [];
	const rejected: Array<{ hash: string }> = [];
	for (const song of songs) {
		const hash = String(song.hash || "").toLowerCase();
		if (!hash) continue;
		const active = records.some((r) => r.hash === hash && isDownloadActive(r));
		if (active) {
			skipped.push({ hash });
			continue;
		}
		const activeCount = records.filter(isDownloadActive).length;
		if (activeCount >= DOWNLOAD_QUEUE_LIMIT) {
			rejected.push({ hash });
			continue;
		}
		const record = createDownloadRecord({ ...song, hash, quality: song.quality ?? "128" }, attempt);
		records.push(record);
		added.push(record);
	}
	return { added, skipped, rejected, records };
};

/** 按剩余槽位取下一批待跑任务（先入先出），纯函数不发起任何请求。 */
export const nextDownloadBatch = (records: DownloadRecord[], freeSlots: number): DownloadRecord[] => {
	const slots = Math.max(0, Math.trunc(Number(freeSlots) || 0));
	if (slots === 0) return [];
	return records.filter((r) => r.status === "queued").slice(0, slots);
};

export const summarizeDownloads = (records: DownloadRecord[]) => {
	const summary = { total: records.length, done: 0, failed: 0, canceled: 0, running: 0, queued: 0, active: 0 };
	for (const record of records) {
		switch (record.status) {
			case "done":
				summary.done += 1;
				break;
			case "failed":
				summary.failed += 1;
				break;
			case "canceled":
				summary.canceled += 1;
				break;
			case "running":
				summary.running += 1;
				break;
			default:
				summary.queued += 1;
		}
	}
	summary.active = summary.running + summary.queued;
	return summary;
};

/** 按创建时间保留最近 N 条，但活动任务一律保留（否则下载还在跑却没有 UI 入口）。 */
export const pruneDownloadHistory = (records: DownloadRecord[], limit = DOWNLOAD_HISTORY_LIMIT): DownloadRecord[] => {
	if (records.length <= limit) return records;
	const active = records.filter(isDownloadActive);
	const finished = records
		.filter((r) => !isDownloadActive(r))
		.slice()
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, Math.max(0, limit - active.length));
	return [...active, ...finished];
};

export const SEARCH_HISTORY_LIMIT = 10;
export const pushSearchHistory = (stored: unknown, keyword: string): string[] => {
	const trimmed = String(keyword || "").trim();
	if (!trimmed) return Array.isArray(stored) ? stored.filter((x) => typeof x === "string") : [];
	const base = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
	const needle = trimmed.toLowerCase();
	return [trimmed, ...base.filter((x) => x.toLowerCase() !== needle)].slice(0, SEARCH_HISTORY_LIMIT);
};

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

	async sendCaptcha(mobile: string): Promise<void> {
		const payload = await this.request("/auth/sms/send", { body: { mobile } });
		if (!responseSucceeded(payload)) throw new MusicApiError("验证码发送失败", payload, undefined, responseErrorCode(payload));
	}

	async loginPhone(mobile: string, code: string, userid?: string): Promise<MusicSession> {
		const payload = await this.request("/auth/sms/login", { body: { mobile, code, userid } });
		if (!responseSucceeded(payload)) throw new MusicApiError("手机验证码登录失败", payload, undefined, responseErrorCode(payload));
		return this.sessionFromLogin(payload);
	}

	/** 管理员口令快速登录：用服务器保存的凭据恢复会话（口令本身不落盘）。 */
	async adminStatus(): Promise<{ configured: boolean; saved: boolean }> {
		const payload = await this.request("/auth/admin/status");
		const data = responseData<any>(payload);
		return { configured: Boolean(data?.configured), saved: Boolean(data?.saved) };
	}

	async loginAdmin(passphrase: string): Promise<MusicSession> {
		const payload = await this.request("/auth/admin", { body: { passphrase } });
		if (!responseSucceeded(payload)) throw new MusicApiError("管理员登录失败", payload, undefined, responseErrorCode(payload));
		return this.sessionFromLogin(payload);
	}

	async saveAdminCredentials(passphrase: string): Promise<void> {
		const payload = await this.request("/auth/admin/save", { body: { passphrase } });
		if (!responseSucceeded(payload)) throw new MusicApiError("保存登录凭据失败", payload, undefined, responseErrorCode(payload));
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

	async createPlaylist(name: string): Promise<{ listid: string | null; name: string }> {
		const payload = await this.request("/playlists", { method: "POST", body: { name } });
		if (!responseSucceeded(payload)) throw new MusicApiError("新建歌单失败", payload, undefined, responseErrorCode(payload));
		const data = responseData<any>(payload);
		return { listid: data?.listid != null ? String(data.listid) : null, name: String(data?.name ?? name) };
	}

	async deletePlaylist(listid: string | number): Promise<void> {
		const payload = await this.request(`/playlists/${encodeURIComponent(String(listid))}`, { method: "DELETE" });
		if (!responseSucceeded(payload)) throw new MusicApiError("删除歌单失败", payload, undefined, responseErrorCode(payload));
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

	async getStreamUrl(hash: string, quality?: string): Promise<string> {
		if (!this.baseUrl) throw new MusicApiError("音乐服务尚未配置");
		await this.getStreamPreparation(hash, quality);
		// Native Audio requests this BFF URL directly. The BFF HttpOnly session cookie
		// authenticates the request; this never resolves or exposes an upstream media URL.
		const streamQuery = quality ? `?quality=${encodeURIComponent(quality)}` : "";
		return `${this.baseUrl}/tracks/${encodeURIComponent(hash)}/stream${streamQuery}`;
	}

	/** 取整首歌的二进制（下载用）。鉴权与播放一致，走同一个 BFF 会话 Cookie；
	 * 上游拒绝/风控/未登录都会以 JSON 错误体返回，这里统一转成可读异常，
	 * 避免把错误 JSON 当成音频存成损坏文件。
	 *
	 * 优先走 /download（专用路由，超时 180s，适合无损大文件）。旧版 BFF 还没有
	 * 该路由时会 404——此时回落到 /stream 取整首，功能立刻可用；后端重启后
	 * 自动改用下载路由，无需再改前端。 */
	async getTrackBlob(
		hash: string,
		quality?: string,
		options: {
			/** 每收到一段数据回调一次，用于进度条。total 未知时为 0。 */
			onProgress?: (loaded: number, total: number) => void;
			/** 取消信号：中止后 fetch 与流读取都会立刻停止。 */
			signal?: AbortSignal;
		} = {},
	): Promise<Blob> {
		if (!this.baseUrl) throw new MusicApiError("音乐服务尚未配置");
		try {
			return await this.fetchTrackBytes(hash, quality, "download", options);
		} catch (error) {
			// 只有「路由不存在」才回落到 stream；真实业务错误（401/423/502）不能重试，
			// 否则会把一次风控挑战变成两次上游请求。
			if (error instanceof MusicApiError && error.status === 404) {
				return await this.fetchTrackBytes(hash, quality, "stream", options);
			}
			throw error;
		}
	}

	private async fetchTrackBytes(
		hash: string,
		quality: string | undefined,
		route: "download" | "stream",
		options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
	): Promise<Blob> {
		const url = new URL(`${this.baseUrl}/tracks/${encodeURIComponent(hash)}/${route}`);
		if (quality) url.searchParams.set("quality", quality);
		const response = await fetch(url, { credentials: "include", cache: "no-store", signal: options.signal });
		if (!response.ok) {
			let payload: any = null;
			try {
				payload = await response.json();
			} catch {
				/* 错误体不是 JSON（例如网关返回 HTML）时保持 payload 为空 */
			}
			if (response.status === 423 && payload?.error_code === "RISK_VERIFY_REQUIRED") {
				const data = payload?.data ?? {};
				throw new MusicRiskVerifyError(String(payload?.message || "需要完成安全验证"), payload, {
					eventid: String(data.eventid || data.ssaCode || ""),
					ssaCode: data.ssaCode ? String(data.ssaCode) : undefined,
					edt: String(data.edt || ""),
					sid: String(data.sid || ""),
					hash: String(data.hash || hash),
				});
			}
			throw new MusicApiError(
				responseMessage(payload) || `下载失败（HTTP ${response.status}）`,
				payload,
				response.status,
				responseErrorCode(payload),
			);
		}

		const declaredTotal = Number(response.headers.get("content-length") || 0) || 0;
		// 没有可读流（老浏览器/被代理包装）时退回一次性读取，功能不退化。
		if (!response.body) {
			const fallback = await response.blob();
			if (fallback.size === 0) throw new MusicApiError("下载内容为空，可能是该歌曲无可用音源");
			options.onProgress?.(fallback.size, fallback.size);
			return fallback;
		}

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let loaded = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					loaded += value.byteLength;
					options.onProgress?.(loaded, declaredTotal);
				}
			}
		} catch (error) {
			// 取消或网络中断：显式释放 reader，避免连接悬挂。
			try {
				await reader.cancel();
			} catch {
				/* 已经断开时 cancel 会抛，忽略 */
			}
			throw error;
		}
		if (loaded === 0) throw new MusicApiError("下载内容为空，可能是该歌曲无可用音源");
		return new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "audio/mpeg" });
	}

	async getLyrics(hash: string, durationMs = 0): Promise<string> {
		const query = durationMs > 0 ? `?duration=${Math.floor(durationMs)}` : "";
		const payload = await this.request(`/tracks/${encodeURIComponent(hash)}/lyrics${query}`);
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
