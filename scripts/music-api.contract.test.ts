import assert from "node:assert/strict";
import {
	getShanghaiDateKey,
	MusicApiClient,
	MUSIC_BFF_ORIGIN,
	normalizeApiBaseUrl,
	normalizePlaylists,
	normalizeSongs,
	responseData,
	responseSucceeded,
} from "../src/utils/music-api.ts";

const wrapped = { status: 1, data: { info: [{ listid: 1, name: "我喜欢" }] } };
assert.equal(responseSucceeded(wrapped), true);
assert.deepEqual(responseData(wrapped), { info: [{ listid: 1, name: "我喜欢" }] });
assert.deepEqual(normalizePlaylists(wrapped), [{ listid: 1, name: "我喜欢", count: undefined, cover: "" }]);

const tracks = {
	status: 1,
	data: {
		info: [{ FileHash: "ABC", songname: "测试曲", singername: "测试者", pic: "https://img/{size}.jpg", timelen: 3210 }],
	},
};
assert.deepEqual(normalizeSongs(tracks), [{ FileHash: "ABC", songname: "测试曲", singername: "测试者", pic: "https://img/{size}.jpg", timelen: 3210, hash: "ABC", name: "测试曲", author: "测试者", img: "https://img/480.jpg", timeLength: 3210, album: "" }]);
assert.equal(normalizeApiBaseUrl(" https://api.example.test/ "), "https://api.example.test");
assert.equal(normalizeApiBaseUrl("javascript:alert(1)"), "");
assert.equal(MUSIC_BFF_ORIGIN, "https://music.hmb2011.bond");
const bff = new MusicApiClient(MUSIC_BFF_ORIGIN);
assert.equal(await bff.getStreamUrl("abc123"), "https://music.hmb2011.bond/tracks/abc123/stream");

const originalFetch = globalThis.fetch;
let qrMethod = "";
let qrUrl = "";
globalThis.fetch = async (input, init) => {
	qrUrl = String(input);
	qrMethod = String(init?.method ?? "GET");
	return new Response(JSON.stringify({ status: 1, data: { key: "opaque-test-key", image: "data:image/png;base64,test" } }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
try {
	const qr = await bff.createQr();
	assert.equal(qrMethod, "POST");
	assert.equal(qrUrl, "https://music.hmb2011.bond/auth/qr");
	assert.equal(qr.key, "opaque-test-key");
} finally {
	globalThis.fetch = originalFetch;
}

// This instant remains on the next calendar day in Asia/Shanghai, guarding against UTC-date VIP claims.
assert.equal(getShanghaiDateKey(new Date("2026-08-09T18:00:00.000Z")), "2026-08-10");
console.log("music-api contract tests: PASS");
