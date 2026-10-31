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
	songFileId,
	centeredLyricScrollTop,
	isCurrentLyricsRequest,
	nextPlayMode,
	normalizePlayMode,
	coercePlayMode,
	PLAY_MODE_ORDER,
	shuffleSongs,
	isSongInPlaylist,
	normalizeAudioQuality,
	qualityLabel,
	sanitizeDownloadFilename,
	audioExtensionFor,
	buildDownloadName,
	clampDownloadConcurrency,
	createDownloadRecord,
	enqueueDownloads,
	nextDownloadBatch,
	updateDownloadRecord,
	pruneDownloadHistory,
	summarizeDownloads,
	downloadProgressPercent,
	formatBytes,
	isDownloadActive,
	DOWNLOAD_QUEUE_LIMIT,
	DOWNLOAD_HISTORY_LIMIT,
	pushSearchHistory,
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
assert.deepEqual(normalizeSongs(tracks), [{ FileHash: "ABC", songname: "测试曲", singername: "测试者", pic: "https://img/{size}.jpg", timelen: 3210, hash: "abc", name: "测试曲", author: "测试者", img: "https://img/480.jpg", timeLength: 3210, album: "" }]);
// hash 必须统一为小写：歌单曲目接口返回大写、搜索接口返回小写，
// 不归一会让搜索行收藏状态永远匹配不上（这正是搜索收藏空心的根因）。
const caseTracks = {
	status: 1,
	data: {
		info: [
			{ hash: "ABC123def", songname: "大写混", singername: "x" },
			{ FileHash: "FEDCBA", songname: "全大写", singername: "y" },
		],
	},
};
const caseNormalised = normalizeSongs(caseTracks);
assert.equal(caseNormalised[0].hash, "abc123def");
assert.equal(caseNormalised[1].hash, "fedcba");
assert.equal(isSongInPlaylist("fedcba", caseNormalised), true);
assert.equal(isSongInPlaylist("FEDCBA".toLowerCase(), caseNormalised), true);

// 音质：白名单归一 + 显示标签（存储可能被写入任意值，播放前必须归一）。
assert.equal(normalizeAudioQuality("320"), "320");
assert.equal(normalizeAudioQuality("flac"), "flac");
assert.equal(normalizeAudioQuality("128"), "128");
assert.equal(normalizeAudioQuality("999"), "128"); // 非法值回落默认
assert.equal(normalizeAudioQuality(""), "128");
assert.equal(normalizeAudioQuality(undefined), "128");
assert.equal(qualityLabel("flac"), "无损");
assert.equal(qualityLabel("320"), "320k");
assert.equal(qualityLabel("128"), "128k");

// 搜索历史：去重（大小写/空白不敏感）、置顶、截断到上限。
const h1 = pushSearchHistory([], " 晴天 ");
assert.deepEqual(h1, ["晴天"]);
const h2 = pushSearchHistory(h1, "晴天");
assert.deepEqual(h2, ["晴天"]); // 重复不增长
const h3 = pushSearchHistory(h2, "稻香");
assert.deepEqual(h3, ["稻香", "晴天"]); // 新词置顶
let h4 = [];
for (let i = 0; i < 15; i += 1) h4 = pushSearchHistory(h4, `k${i}`);
assert.equal(h4.length, 10);
assert.equal(h4[0], "k14");
assert.deepEqual(pushSearchHistory(["a"], "   "), ["a"]); // 空白忽略
assert.deepEqual(pushSearchHistory(null as unknown as string[], "x"), ["x"]); // 坏存储容错

// 下载文件名：必须过滤文件系统保留字符/控制符，且不能以点开头（隐藏文件/相对路径）。
assert.equal(sanitizeDownloadFilename("晴天"), "晴天");
assert.equal(sanitizeDownloadFilename("AC/DC - Back"), "AC DC - Back");
assert.equal(sanitizeDownloadFilename('a\\b:c*d?e"f<g>h|i'), "a b c d e f g h i");
assert.equal(sanitizeDownloadFilename("  ..hidden  "), "hidden");
assert.equal(sanitizeDownloadFilename(""), "track");
assert.equal(sanitizeDownloadFilename("   "), "track");
assert.equal(sanitizeDownloadFilename("x".repeat(200)).length, 120);
assert.equal(sanitizeDownloadFilename("a\u0000b\u001fc"), "a b c");

// 扩展名：按上游 Content-Type 判定，未知时回落到音质档位。
assert.equal(audioExtensionFor("audio/mpeg"), "mp3");
assert.equal(audioExtensionFor("audio/flac"), "flac");
assert.equal(audioExtensionFor("audio/x-flac"), "flac");
assert.equal(audioExtensionFor("audio/mp4"), "m4a");
assert.equal(audioExtensionFor("audio/aac"), "m4a");
assert.equal(audioExtensionFor(undefined, "flac"), "flac");
assert.equal(audioExtensionFor("", "128"), "mp3");
assert.equal(audioExtensionFor("application/octet-stream", "320"), "mp3");

// 组合文件名：歌手缺失时不留尾随分隔符；扩展名只允许白名单。
assert.equal(buildDownloadName("晴天", "周杰伦", "mp3"), "晴天 - 周杰伦.mp3");
assert.equal(buildDownloadName("晴天", "", "mp3"), "晴天.mp3");
assert.equal(buildDownloadName("", "", "mp3"), "track.mp3");
assert.equal(buildDownloadName("晴天", "周杰伦", "FLAC"), "晴天 - 周杰伦.flac");
assert.equal(buildDownloadName("晴天", "周杰伦", "exe"), "晴天 - 周杰伦.mp3");
assert.equal(buildDownloadName("A/B", "C:D", "flac"), "A B - C D.flac");

// ===== 下载队列模型 =====
// 并发上限：只允许 1..4，越界一律归一到边界值（0/负数/小数/NaN 都不能变成 0 并发）。
assert.equal(clampDownloadConcurrency(2), 2);
assert.equal(clampDownloadConcurrency(1), 1);
assert.equal(clampDownloadConcurrency(4), 4);
assert.equal(clampDownloadConcurrency(0), 1);
assert.equal(clampDownloadConcurrency(-3), 1);
assert.equal(clampDownloadConcurrency(99), 4);
assert.equal(clampDownloadConcurrency("3"), 3);
assert.equal(clampDownloadConcurrency("abc"), 2);
assert.equal(clampDownloadConcurrency(undefined), 2);
assert.equal(clampDownloadConcurrency(2.7), 2);

// 字节可读化
assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(512), "512 B");
assert.equal(formatBytes(2048), "2.0 KB");
assert.equal(formatBytes(4003831), "3.8 MB");
assert.equal(formatBytes(-5), "0 B");

// 进度百分比：未知总长时返回 null（UI 显示 indeterminate），并且始终夹在 0..100。
assert.equal(downloadProgressPercent(0, 0), null);
assert.equal(downloadProgressPercent(50, 100), 50);
assert.equal(downloadProgressPercent(100, 100), 100);
assert.equal(downloadProgressPercent(150, 100), 100);
assert.equal(downloadProgressPercent(-5, 100), 0);

// 记录创建：同一首歌重复下载时 hash 相同但 id 必须不同（历史要能保留多条）。
const rec1 = createDownloadRecord({ hash: "abc123", name: "晴天", author: "周杰伦", quality: "320" }, 1);
const rec2 = createDownloadRecord({ hash: "abc123", name: "晴天", author: "周杰伦", quality: "320" }, 2);
assert.equal(rec1.status, "queued");
assert.equal(rec1.attempt, 1);
assert.equal(rec1.loaded, 0);
assert.equal(rec1.total, 0);
assert.notEqual(rec1.id, rec2.id);
assert.equal(rec1.hash, "abc123");
assert.equal(rec1.name, "晴天");
assert.equal(rec1.quality, "320");

// 状态机：只有 progressed/failed/done 这些显式事件才能推进；进度只增不减。
const recProg = updateDownloadRecord(rec1, { loaded: 100, total: 400 });
assert.equal(recProg.loaded, 100);
assert.equal(recProg.status, "running");
const recBack = updateDownloadRecord(recProg, { loaded: 40 });
assert.equal(recBack.loaded, 100, "进度不能倒退");
const recDone = updateDownloadRecord(recProg, { status: "done", size: 400 });
assert.equal(recDone.status, "done");
assert.ok(recDone.finishedAt > 0);
const recFail = updateDownloadRecord(recProg, { status: "failed", error: "NO_URL" });
assert.equal(recFail.status, "failed");
assert.equal(recFail.error, "NO_URL");
// 终态不可再被改成 running（避免迟到回调把失败覆盖成进行中）
assert.equal(updateDownloadRecord(recDone, { status: "running" }).status, "done");

// isDownloadActive：排队中与进行中都算「占槽」
assert.equal(isDownloadActive({ status: "queued" }), true);
assert.equal(isDownloadActive({ status: "running" }), true);
assert.equal(isDownloadActive({ status: "done" }), false);
assert.equal(isDownloadActive({ status: "failed" }), false);
assert.equal(isDownloadActive({ status: "canceled" }), false);

// enqueueDownloads：去重（同 hash 已在校验/队列中则跳过）、跳过已完成、受上限截断。
const existing = [createDownloadRecord({ hash: "aaa", name: "A", author: "", quality: "128" }, 1)];
const queued = enqueueDownloads(existing, [
	{ hash: "aaa", name: "A", author: "", quality: "128" },
	{ hash: "bbb", name: "B", author: "", quality: "128" },
], 10);
assert.equal(queued.added.length, 1);
assert.equal(queued.added[0].hash, "bbb");
assert.equal(queued.skipped.length, 1);
assert.equal(queued.skipped[0].hash, "aaa");

// 队列上限：超出 DOWNLOAD_QUEUE_LIMIT 的部分不入队并计入 rejected。
const many = Array.from({ length: DOWNLOAD_QUEUE_LIMIT + 5 }, (_, i) => ({ hash: `h${i}`, name: `n${i}`, author: "", quality: "128" }));
const capped = enqueueDownloads([], many, 10);
assert.equal(capped.added.length, DOWNLOAD_QUEUE_LIMIT);
assert.equal(capped.rejected.length, 5);

// nextDownloadBatch：按剩余槽位取出待跑任务（先入先出），不做任何网络动作。
const q = [
	createDownloadRecord({ hash: "q1", name: "1", author: "", quality: "128" }, 1),
	createDownloadRecord({ hash: "q2", name: "2", author: "", quality: "128" }, 2),
	createDownloadRecord({ hash: "q3", name: "3", author: "", quality: "128" }, 3),
];
assert.deepEqual(nextDownloadBatch(q, 2).map((r) => r.hash), ["q1", "q2"]);
assert.deepEqual(nextDownloadBatch(q, 0).map((r) => r.hash), []);
const mixed = [updateDownloadRecord(q[0], { status: "done" }), q[1], q[2]];
assert.deepEqual(nextDownloadBatch(mixed, 2).map((r) => r.hash), ["q2", "q3"]);

// summarizeDownloads：给面板显示 x/y 与活动数
const summary = summarizeDownloads([
	updateDownloadRecord(q[0], { status: "done", size: 100 }),
	updateDownloadRecord(q[1], { status: "running", loaded: 50, total: 100 }),
	q[2],
]);
assert.equal(summary.total, 3);
assert.equal(summary.done, 1);
assert.equal(summary.active, 2);
assert.equal(summary.running, 1);
assert.equal(summary.queued, 1);
assert.equal(summary.failed, 0);

// 历史裁剪：只保留最近 DOWNLOAD_HISTORY_LIMIT 条，且优先保留未完成的
let hist = [];
for (let i = 0; i < DOWNLOAD_HISTORY_LIMIT + 8; i += 1) {
	hist.push(updateDownloadRecord(createDownloadRecord({ hash: `h${i}`, name: `n${i}`, author: "", quality: "128" }, i), { status: "done" }));
}
const active = createDownloadRecord({ hash: "still-going", name: "x", author: "", quality: "128" }, 999);
hist.push(active);
const pruned = pruneDownloadHistory(hist);
assert.equal(pruned.length, DOWNLOAD_HISTORY_LIMIT);
assert.ok(pruned.some((r) => r.hash === "still-going"), "未完成任务不能被裁剪掉");

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
const parsedKrc = parseLyricsText("[ti:测试歌]\n[39674,6040]<0,460,0>北<460,430,0>风\n[01:02.50]普通歌词\n[qq:123456]\n[total:261773]\n[language:eyJjb250ZW50IjpbXSwidmVyc2lvbiI6MX0=\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
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
assert.equal(songFileId({ id: 42 } as any), "42");
assert.equal(songFileId({ fileid: "7" } as any), "7");
assert.equal(songFileId({ hash: "X" } as any), null);
// 搜索结果只有 audio_id / album_audio_id / sourceid，没有删除接口要的 fileid。
// 契约明确：这些字段不能当 fileid 用（删除接口 playlist_tracks_del 只收 fileid），
// 所以 songFileId 必须对它们返回 null，逼调用方去歌单里反查而不是瞎猜一个 id。
assert.equal(songFileId({ audio_id: 20505418, album_audio_id: 32100650, sourceid: 0 } as any), null);
assert.equal(songFileId({ id: 0, fileid: 0 } as any), null);
assert.equal(songFileId({ id: -5 } as any), null);
assert.equal(songFileId({} as any), null);
// 播放模式合并为 3 种：列表循环 -> 单曲循环 -> 随机 -> 回到列表循环
assert.equal(nextPlayMode("list"), "one");
assert.equal(nextPlayMode("one"), "shuffle");
assert.equal(nextPlayMode("shuffle"), "list");
assert.equal(normalizePlayMode(true, "list"), "shuffle");
assert.equal(normalizePlayMode(false, "one"), "one");
assert.equal(normalizePlayMode(false, "off"), "list");
assert.equal(normalizePlayMode(false, "list"), "list");
// 历史存储值迁移：旧的 "order" 已合并进 "list"
assert.equal(coercePlayMode("order"), "list");
assert.equal(coercePlayMode("list"), "list");
assert.equal(coercePlayMode("one"), "one");
assert.equal(coercePlayMode("shuffle"), "shuffle");
assert.equal(coercePlayMode(null), "list");
assert.equal(coercePlayMode("garbage"), "list");
// 三种模式构成闭环，不会出现第 4 种
assert.deepEqual(PLAY_MODE_ORDER, ["list", "one", "shuffle"]);
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
assert.equal(MUSIC_BFF_ORIGIN, "https://music.hmb2011.dpdns.org");
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
// 账号密码登录已下线（上游对任何凭据形态都拒绝），契约要求该方法不存在。
assert.equal(
	(bff as unknown as Record<string, unknown>).loginPassword,
	undefined,
	"account+password login must no longer exist on the client",
);
try {
	assert.equal(await bff.getStreamUrl("abc123"), "https://music.hmb2011.dpdns.org/tracks/abc123/stream");
	assert.equal(prepareMethod, "GET");
	assert.equal(prepareUrl, "https://music.hmb2011.dpdns.org/tracks/abc123/prepare");

	await assert.rejects(
		() => bff.getStreamUrl("risk"),
		(error: unknown) => error instanceof MusicRiskVerifyError && error.challenge.eventid === "event-1" && error.challenge.edt === "edt-1",
	);

	const qr = await bff.createQr();
	assert.equal(qrMethod, "POST");
	assert.equal(qrUrl, "https://music.hmb2011.dpdns.org/auth/qr");
	assert.equal(qrContentType, "application/json");
	assert.equal(qrBody, "{}");
	assert.equal(qr.key, "opaque-test-key");
	const qrPoll = await bff.checkQr(qr.key);
	assert.equal(qrStatusMethod, "GET");
	assert.equal(qrStatusUrl, "https://music.hmb2011.dpdns.org/auth/qr/status?key=opaque-test-key");
	assert.equal(qrPoll.status, 4);
	assert.equal(qrPoll.session?.userid, 7);
	assert.equal(qrPoll.session?.nickname, "扫码用户");
	const recommendations = await bff.getDailyRecommendations();
	assert.equal(recommendationMethod, "GET");
	assert.equal(recommendationUrl, "https://music.hmb2011.dpdns.org/recommendations/daily");
	assert.equal(recommendations[0].hash, "rec_hash"); // normalizeSongs 统一小写
	assert.equal(recommendations[0].author, "推荐歌手");
	assert.equal(recommendations[0].img, "https://img/480.jpg");
	assert.equal(recommendations[0].timeLength, 187);

	await bff.upgradeVip();
	assert.equal(upgradeMethod, "POST");
	assert.equal(upgradeUrl, "https://music.hmb2011.dpdns.org/vip/daily/upgrade");
	assert.equal(upgradeContentType, "application/json");
	assert.equal(upgradeBody, "{}");

	await bff.searchSongs("未收藏歌曲", 2, 50);
	assert.equal(searchMethod, "GET");
	assert.equal(searchUrl, "https://music.hmb2011.dpdns.org/search/songs?keyword=%E6%9C%AA%E6%94%B6%E8%97%8F%E6%AD%8C%E6%9B%B2&page=2&pagesize=50");
	assert.equal(searchBody, "");

	await bff.addPlaylistTracks("123", "歌曲名|HASH123|42|99");
	assert.equal(addMethod, "POST");
	assert.equal(addUrl, "https://music.hmb2011.dpdns.org/playlists/123/add");
	assert.equal(addBody, JSON.stringify({ data: "歌曲名|HASH123|42|99" }));
} finally {
	globalThis.fetch = originalFetch;
}

// This instant remains on the next calendar day in Asia/Shanghai, guarding against UTC-date VIP claims.
assert.equal(getShanghaiDateKey(new Date("2026-08-09T18:00:00.000Z")), "2026-08-10");
console.log("music-api contract tests: PASS");
