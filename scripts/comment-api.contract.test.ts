import assert from "node:assert/strict";
import {
	CommentApiClient,
	CommentApiError,
	COMMENT_API_ORIGIN,
	formatCommentDate,
	normalizeCommentApiBaseUrl,
	normalizeComments,
	responseData,
	responseSucceeded,
} from "../src/utils/comment-api.ts";

// —— 响应形状解析 ——
const wrapped = { status: 1, data: { list: [{ id: 1, name: "访客", content: "你好", createdAt: "2026-08-13T10:00:00Z" }], page: 1, pageSize: 50, total: 1 } };
assert.equal(responseSucceeded(wrapped), true);
assert.equal(responseSucceeded({ status: 200, data: {} }), true);
assert.equal(responseSucceeded({ status: 500 }), false);
assert.deepEqual(responseData(wrapped)?.total, 1);

// —— 列表归一化（兼容下划线字段 + data 层直传）——
const items = normalizeComments({
	status: 1,
	data: {
		list: [
			{ id: 1, post_slug: "a", parent_id: null, name: "甲", email_hash: "abc", content: "正文", quote: "引用段", created_at: "2026-08-13T10:00:00Z" },
			{ id: 2, name: "乙", content: "无引用", createdAt: "2026-08-13T11:00:00Z" },
			{ bogus: true },
		],
	},
});
assert.equal(items.length, 2);
assert.equal(items[0].postSlug, "a");
assert.equal(items[0].quote, "引用段");
assert.equal(items[1].quote, null);
assert.equal(items[1].emailHash, "");

// data 层直传（getComments 的真实调用路径）
const itemsDataLayer = normalizeComments({
	list: [
		{ id: 9, name: "丙", content: "直传", createdAt: "2026-08-13T12:00:00Z" },
	],
	total: 1,
});
assert.equal(itemsDataLayer.length, 1);
assert.equal(itemsDataLayer[0].name, "丙");

// —— 日期格式化 ——
assert.equal(formatCommentDate("2026-08-13T10:00:00Z"), "2026-08-13");
assert.equal(formatCommentDate("bad-date"), "");

// —— 地址校验 ——
assert.equal(normalizeCommentApiBaseUrl(" https://api.hmb2011.bond/ "), "https://api.hmb2011.bond");
assert.equal(normalizeCommentApiBaseUrl("javascript:alert(1)"), "");
assert.equal(normalizeCommentApiBaseUrl("http://evil.example.com"), "");
assert.equal(COMMENT_API_ORIGIN, ""); // 云机就绪前保持离线

// —— 客户端请求形状（fetch stub）——
let listUrl = "";
let createMethod = "";
let createUrl = "";
let createContentType = "";
let createBody = "";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = String(input);
	if (url.includes("/comments?") && (init?.method ?? "GET") === "GET") {
		listUrl = url;
		return new Response(JSON.stringify({ status: 1, data: { list: [], page: 1, pageSize: 50, total: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
	}
	if (url.endsWith("/comments")) {
		createMethod = String(init?.method ?? "GET");
		createUrl = url;
		createContentType = String(new Headers(init?.headers).get("Content-Type") ?? "");
		createBody = String(init?.body ?? "");
		return new Response(JSON.stringify({ status: 1, data: { id: 42 } }), { status: 200, headers: { "Content-Type": "application/json" } });
	}
	return new Response(JSON.stringify({ status: 1, data: { ready: true } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
	const client = new CommentApiClient("https://api.hmb2011.bond");
	await client.getComments("my-post");
	assert.equal(listUrl, "https://api.hmb2011.bond/comments?post=my-post&page=1&pageSize=50");

	const created = await client.createComment({ post: "my-post", name: "访客", email: "a@b.c", content: "内容", quote: "> 引用" });
	assert.equal(created.id, 42);
	assert.equal(createMethod, "POST");
	assert.equal(createUrl, "https://api.hmb2011.bond/comments");
	assert.equal(createContentType, "application/json");
	const parsedBody = JSON.parse(createBody);
	assert.equal(parsedBody.post, "my-post");
	assert.equal(parsedBody.quote, "> 引用");

	// 未配置源 → 明确抛错而非发请求
	const unconfigured = new CommentApiClient("");
	let threw = false;
	try {
		await unconfigured.getComments("x");
	} catch (error) {
		threw = error instanceof CommentApiError;
	}
	assert.equal(threw, true);
} finally {
	globalThis.fetch = originalFetch;
}

console.log("comment-api contract tests: PASS");
