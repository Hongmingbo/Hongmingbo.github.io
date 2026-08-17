import assert from "node:assert/strict";
import {
	getShanghaiDateKey,
	MusicApiClient,
	MUSIC_BFF_ORIGIN,
	normalizeApiBaseUrl,
	normalizePlaylists,
	normalizeSongs,
	isSongInPlaylist,
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
assert.equal(isSongInPlaylist("ABC", normalizeSongs(tracks)), true);
assert.equal(isSongInPlaylist("NOT_IN_PLAYLIST", normalizeSongs(tracks)), false);
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
let searchMethod = "";
let searchUrl = "";
let searchBody = "";
let addMethod = "";
let addUrl = "";
let addBody = "";
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
	} else if (url.includes("/search")) {
		searchUrl = url;
		searchMethod = method;
		searchBody = body;
	} else if (url.endsWith("/playlists/123/add")) {
		addUrl = url;
		addMethod = method;
		addBody = body;
	}
	return new Response(JSON.stringify({ status: 1, data: { key: "opaque-test-key", image: "[screenshot]", info: [] } }), {
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

	await bff.searchSongs("未收藏歌曲", 2, 50);
	assert.equal(searchMethod, "GET");
	assert.equal(searchUrl, "https://music.hmb2011.bond/search/songs?keyword=%E6%9C%AA%E6%94%B6%E8%97%8F%E6%AD%8C%E6%9B%B2&page=2&pagesize=50");
	assert.equal(searchBody, "");

	await bff.addPlaylistTracks("123", "歌曲名|HASH123|42|99");
	assert.equal(addMethod, "POST");
	assert.equal(addUrl, "https://music.hmb2011.bond/playlists/123/add");
	assert.equal(addBody, JSON.stringify({ data: "歌曲名|HASH123|42|99" }));
} finally {
	globalThis.fetch = originalFetch;
}

// This instant remains on the next calendar day in Asia/Shanghai, guarding against UTC-date VIP claims.
assert.equal(getShanghaiDateKey(new Date("2026-08-09T18:00:00.000Z")), "2026-08-10");
console.log("music-api contract tests: PASS");
