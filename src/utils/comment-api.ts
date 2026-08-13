/**
 * 评论 API 客户端（浏览器侧）
 *
 * 契约：评论服务独立部署于 api.<domain>（云机就绪后启用）。
 * 生产源未配置（空串）时，前端进入「离线草稿模式」——评论区不发起网络请求。
 *
 * 端点约定：
 *   GET  /health                              → { status:1, data:{ ready:true } }
 *   GET  /comments?post=<slug>&page=1         → { status:1, data:{ list: CommentItem[], page, pageSize, total } }
 *   POST /comments                            → { status:1, data:{ id } }   body: CommentDraft
 *   POST /comments/:id/hide                   → 管理端预留（审核隐藏）
 *
 * 安全约定（服务端必须执行，前端不信任）：
 *   - 内容服务端清洗（HTML 剥离，仅允许有限 Markdown 子集）
 *   - 邮箱仅存哈希（gravatar），绝不回传明文
 *   - 每条评论状态 pending → approved 审核流
 *   - IP 限流（10 次/分钟/来源）
 */

export interface CommentItem {
	id: number;
	postSlug: string;
	parentId: number | null;
	name: string;
	emailHash: string;
	content: string;
	quote: string | null;
	createdAt: string; // ISO 8601
}

export interface CommentDraft {
	post: string;
	name: string;
	email?: string;
	content: string;
	quote?: string;
	parentId?: number | null;
}

export interface CommentListResult {
	list: CommentItem[];
	page: number;
	pageSize: number;
	total: number;
}

/** 生产评论 API 源；云机就绪后改为 https://api.hmb2011.bond */
export const COMMENT_API_ORIGIN = "";

export const responseStatus = (payload: unknown): number | undefined =>
	payload && typeof payload === "object" && "status" in payload
		? Number((payload as { status: unknown }).status)
		: undefined;

export const responseSucceeded = (payload: unknown): boolean => {
	const status = responseStatus(payload);
	return status === 1 || status === 200;
};

export const responseData = <T>(payload: unknown): T | null => {
	if (payload && typeof payload === "object" && "data" in payload) {
		return (payload as { data: T }).data;
	}
	return null;
};

export const normalizeCommentApiBaseUrl = (input: string): string => {
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

export const normalizeComments = (payload: unknown): CommentItem[] => {
	// 兼容两种调用：传完整 payload（{status,data}）或直接传 data 层（{list,...}）
	const data =
		payload && typeof payload === "object" && "list" in payload
			? payload
			: responseData<any>(payload);
	const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
	return list
		.filter((item) => item && typeof item.id === "number")
		.map((item) => ({
			id: Number(item.id),
			postSlug: String(item.postSlug ?? item.post_slug ?? ""),
			parentId: item.parentId ?? item.parent_id ?? null,
			name: String(item.name ?? "匿名"),
			emailHash: String(item.emailHash ?? item.email_hash ?? ""),
			content: String(item.content ?? ""),
			quote: item.quote ? String(item.quote) : null,
			createdAt: String(item.createdAt ?? item.created_at ?? ""),
		}));
};

export const formatCommentDate = (iso: string): string => {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export class CommentApiError extends Error {
	readonly status?: number;
	readonly payload?: unknown;

	constructor(message: string, status?: number, payload?: unknown) {
		super(message);
		this.name = "CommentApiError";
		this.status = status;
		this.payload = payload;
	}
}

export class CommentApiClient {
	readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = normalizeCommentApiBaseUrl(baseUrl);
	}

	async request<T = any>(path: string, options: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
		if (!this.baseUrl) throw new CommentApiError("评论服务尚未配置");
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
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = { message: text };
		}
		if (!response.ok) throw new CommentApiError(`评论服务返回 HTTP ${response.status}`, response.status, payload);
		return payload as T;
	}

	async health(): Promise<void> {
		const payload = await this.request("/health");
		if (!responseSucceeded(payload)) throw new CommentApiError("评论服务健康检查失败", undefined, payload);
	}

	async getComments(post: string, page = 1): Promise<CommentListResult> {
		const payload = await this.request("/comments", { query: { post, page, pageSize: 50 } });
		if (!responseSucceeded(payload)) throw new CommentApiError("评论列表加载失败", undefined, payload);
		const data = responseData<any>(payload);
		return {
			list: normalizeComments(data),
			page: Number(data?.page ?? 1),
			pageSize: Number(data?.pageSize ?? 50),
			total: Number(data?.total ?? 0),
		};
	}

	async createComment(draft: CommentDraft): Promise<{ id: number }> {
		const payload = await this.request("/comments", { body: draft });
		if (!responseSucceeded(payload)) throw new CommentApiError("评论提交失败", undefined, payload);
		const data = responseData<any>(payload);
		return { id: Number(data?.id ?? 0) };
	}
}
