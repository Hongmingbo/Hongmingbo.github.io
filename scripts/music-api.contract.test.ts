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

const filenameTracks = {
	status: 1,
	data: {
		info: [
			{ FileHash: "DEF", songname: "周杰伦 - 晴天.mp3" },
			{ FileHash: "GHI", FileName: "林俊杰+江南.mp3", SingerName: "林俊杰" },
		],
	},
};
const cleanedFilenameTracks = normalizeSongs(filenameTracks);
assert.equal(cleanedFilenameTracks[0].name, "晴天");
assert.equal(cleanedFilenameTracks[0].author, "周杰伦");
assert.equal(cleanedFilenameTracks[1].name, "江南");
assert.equal(cleanedFilenameTracks[1].author, "林俊杰");
assert.equal(normalizeApiBaseUrl(" https://api.example.test/ "), "https://api.example.test");
assert.equal(normalizeApiBaseUrl("javascript:alert(1)"), "");
assert.equal(MUSIC_BFF_ORIGIN, "https://music.hmb2011.bond");
const bff = new MusicApiClient(MUSIC_BFF_ORIGIN);
assert.equal(await bff.getStreamUrl("abc123"), "https://music.hmb2011.bond/tracks/abc123/stream");

const originalFetch = globalThis.fetch;
let qrMethod = "";
let qrUrl = "";
let qrContentType = "";
let qrBody = "";
let upgradeMethod = "";
let upgradeUrl = "";
let upgradeContentType = "";
let upgradeBody = "";
globalThis.fetch = async (input, init) => {
	const url = String(input);
	const method = String(init?.method ?? "GET");
	const contentType = String(new Headers(init?.headers).get("Content-Type") ?? "");
	const body = String(init?.body ?? "");
	if (url.endsWith("/auth/qr")) {
		qrUrl = url;
		qrMethod = method;
		qrContentType = contentType;
		qrBody = body;
	} else if (url.endsWith("/vip/daily/upgrade")) {
		upgradeUrl = url;
		upgradeMethod = method;
		upgradeContentType = contentType;
		upgradeBody = body;
	}
	return new Response(JSON.stringify({ status: 1, data: { key: "opaque-test-key", image: "[screenshot]" } }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
try {
	const qr = await bff.createQr();
	assert.equal(qrMethod, "POST");
	assert.equal(qrUrl, "https://music.hmb2011.bond/auth/qr");
	assert.equal(qrContentType, "application/json");
	assert.equal(qrBody, "{}");
	assert.equal(qr.key, "opaque-test-key");

	await bff.upgradeVip();
	assert.equal(upgradeMethod, "POST");
	assert.equal(upgradeUrl, "https://music.hmb2011.bond/vip/daily/upgrade");
	assert.equal(upgradeContentType, "application/json");
	assert.equal(upgradeBody, "{}");
} finally {
	globalThis.fetch = originalFetch;
}

// This instant remains on the next calendar day in Asia/Shanghai, guarding against UTC-date VIP claims.
assert.equal(getShanghaiDateKey(new Date("2026-08-09T18:00:00.000Z")), "2026-08-10");
console.log("music-api contract tests: PASS");
