import assert from "node:assert/strict";
import {
	getShanghaiDateKey,
	MusicApiClient,
	MusicApiError,
	MUSIC_BFF_ORIGIN,
	MusicRiskVerifyError,
	musicErrorMessage,
	normalizeApiBaseUrl,
	normalizePlaylists,
	normalizeSongs,
	parseLyricsText,
	paginateSongs,
	sortSongs,
	centeredLyricScrollTop,
	isCurrentLyricsRequest,
	nextPlayMode,
	normalizePlayMode,
	shuffleSongs,
	isSongInPlaylist,
	responseData,
	responseSucceeded,
	classifyMusicRisk,
} from "../src/utils/music-api.ts";

const wrapped = { status: 1, data: { info: [{ listid: 1, name: "我喜欢" }] } };
assert.equal(responseSucceeded(wrapped), true);
assert.equal(classifyMusicRisk(23), "captcha");
assert.equal(classifyMusicRisk("32"), "sms");
assert.equal(classifyMusicRisk(38), "login");
assert.equal(classifyMusicRisk(999), "unsupported");
assert.equal(
	musicErrorMessage(new MusicApiError("音乐服务返回 HTTP 429", { error_code: "RATE_LIMITED" }, 429, "RATE_LIMITED"), "fallback"),
	"请求过于频繁，请稍后再试",
);
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
const parsedKrc = parseLyricsText("[ti:测试歌]\n[39674,6040]<0,460,0>北<460,430,0>风\n[01:02.50]普通歌词");
assert.deepEqual(parsedKrc, [
	{ time: 39.674, text: "北风" },
	{ time: 62.5, text: "普通歌词" },
]);
assert.equal(isCurrentLyricsRequest("A", "A", 3, 3), true);
assert.equal(isCurrentLyricsRequest("A", "B", 3, 3), false);
assert.equal(isCurrentLyricsRequest("A", "A", 2, 3), false);
assert.equal(centeredLyricScrollTop(500, 40, 300, 1200), 370);
assert.equal(centeredLyricScrollTop(20, 40, 300, 1200), 0);
assert.equal(centeredLyricScrollTop(1100, 40, 300, 1200), 900);
assert.deepEqual(paginateSongs([1, 2, 3, 4, 5], 2, 2), [3, 4]);
assert.deepEqual(paginateSongs([1, 2, 3], 0, 2), [1, 2]);
const librarySongs = [{ name: "Z", author: "B" }, { name: "A", author: "C" }] as any;
assert.deepEqual(sortSongs(librarySongs, "title").map((song) => song.name), ["A", "Z"]);
assert.deepEqual(sortSongs(librarySongs, "artist").map((song) => song.author), ["B", "C"]);
assert.equal(nextPlayMode("order"), "list");
assert.equal(nextPlayMode("list"), "one");
assert.equal(nextPlayMode("one"), "shuffle");
assert.equal(nextPlayMode("shuffle"), "order");
assert.equal(normalizePlayMode(true, "list"), "shuffle");
assert.equal(normalizePlayMode(false, "one"), "one");
assert.equal(normalizePlayMode(false, "off"), "list");
assert.equal(normalizePlayMode(false, "list"), "list");
const shuffleSource = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const shuffledOnce = shuffleSongs(shuffleSource);
const shuffledTwice = shuffleSongs(shuffleSource);
assert.equal(shuffledOnce.length, 10);
assert.deepEqual([...shuffledOnce].sort((a, b) => a - b), shuffleSource);
// 确定性实现：同一输入与随机种子产生相同输出；不同种子大概率不同顺序
assert.deepEqual(shuffleSongs(shuffleSource, 42), shuffleSongs(shuffleSource, 42));
assert.notDeepEqual(shuffleSongs(shuffleSource, 1), shuffleSongs(shuffleSource, 2));
assert.equal(normalizeApiBaseUrl(" https://api.example.test/ "), "https://api.example.test");
assert.equal(normalizeApiBaseUrl("javascript:alert(1)"), "");
assert.equal(MUSIC_BFF_ORIGIN, "https://music.hmb2011.bond");
const bff = new MusicApiClient(MUSIC_BFF_ORIGIN);

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
let prepareMethod = "";
let prepareUrl = "";
let qrStatusMethod = "";
let qrStatusUrl = "";
let recommendationUrl = "";
let recommendationMethod = "";
globalThis.fetch = async (input, init) => {
	const url = String(input);
	const method = String(init?.method ?? "GET");
	const contentType = String(new Headers(init?.headers).get("Content-Type") ?? "");
	const body = String(init?.body ?? "");
	if (url.endsWith("/auth/password")) {
		return new Response(JSON.stringify({ status: 0, error_code: "INVALID_CREDENTIALS", message: "账号或密码错误" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	} else if (url.endsWith("/auth/qr")) {
		qrUrl = url;
		qrMethod = method;
		qrContentType = contentType;
		qrBody = body;
	} else if (url.endsWith("/auth/qr/status?key=opaque-test-key")) {
		qrStatusUrl = url;
		qrStatusMethod = method;
		return new Response(JSON.stringify({ status: 1, data: { status: 4, userid: 7, nickname: "扫码用户" } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} else if (url.endsWith("/recommendations/daily")) {
		recommendationUrl = url;
		recommendationMethod = method;
		return new Response(JSON.stringify({ status: 1, data: { song_list: [{ hash: "REC_HASH", songname: "推荐曲", author_name: "推荐歌手", sizable_cover: "https://img/{size}.jpg", time_length: 187 }] } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
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
	} else if (url.endsWith("/tracks/abc123/prepare")) {
		prepareUrl = url;
		prepareMethod = method;
	} else if (url.endsWith("/tracks/risk/prepare")) {
		return new Response(JSON.stringify({
			status: 0,
			error_code: "RISK_VERIFY_REQUIRED",
			message: "本次请求需要验证",
			data: { eventid: "event-1", ssaCode: "event-1", edt: "edt-1", sid: "sid-1", hash: "risk" },
		}), { status: 423, headers: { "Content-Type": "application/json" } });
	}
	return new Response(JSON.stringify({ status: 1, data: { key: "opaque-test-key", image: "[screenshot]", info: [] } }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
await assert.rejects(
	() => bff.loginPassword("user", "wrong"),
	(error: unknown) => error instanceof MusicApiError && error.code === "INVALID_CREDENTIALS" && error.message === "账号或密码错误",
);
try {
	assert.equal(await bff.getStreamUrl("abc123"), "https://music.hmb2011.bond/tracks/abc123/stream");
	assert.equal(prepareMethod, "GET");
	assert.equal(prepareUrl, "https://music.hmb2011.bond/tracks/abc123/prepare");

	await assert.rejects(
		() => bff.getStreamUrl("risk"),
		(error: unknown) => error instanceof MusicRiskVerifyError && error.challenge.eventid === "event-1" && error.challenge.edt === "edt-1",
	);

	const qr = await bff.createQr();
	assert.equal(qrMethod, "POST");
	assert.equal(qrUrl, "https://music.hmb2011.bond/auth/qr");
	assert.equal(qrContentType, "application/json");
	assert.equal(qrBody, "{}");
	assert.equal(qr.key, "opaque-test-key");
	const qrPoll = await bff.checkQr(qr.key);
	assert.equal(qrStatusMethod, "GET");
	assert.equal(qrStatusUrl, "https://music.hmb2011.bond/auth/qr/status?key=opaque-test-key");
	assert.equal(qrPoll.status, 4);
	assert.equal(qrPoll.session?.userid, 7);
	assert.equal(qrPoll.session?.nickname, "扫码用户");
	const recommendations = await bff.getDailyRecommendations();
	assert.equal(recommendationMethod, "GET");
	assert.equal(recommendationUrl, "https://music.hmb2011.bond/recommendations/daily");
	assert.equal(recommendations[0].hash, "REC_HASH");
	assert.equal(recommendations[0].author, "推荐歌手");
	assert.equal(recommendations[0].img, "https://img/480.jpg");
	assert.equal(recommendations[0].timeLength, 187);

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
