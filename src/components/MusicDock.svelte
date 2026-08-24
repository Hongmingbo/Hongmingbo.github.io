<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "@iconify/svelte";
	import MusicRiskVerify from "./MusicRiskVerify.svelte";
	import {
		centeredLyricScrollTop,
		getShanghaiDateKey,
		isCurrentLyricsRequest,
		songFileId,
		MusicApiClient,
		MusicApiError,
		MusicRiskVerifyError,
		MUSIC_BFF_ORIGIN,
		isSongInPlaylist,
		musicErrorMessage,
		nextPlayMode,
		normalizePlayMode,
		normalizeApiBaseUrl,
		parseLyricsText,
		paginateSongs,
		runDailyVipFlow,
		sortSongs,
		shuffleSongs,
		type MusicSession,
		type MusicPlaylist,
		type MusicSong,
		type PlayMode,
	} from "@utils/music-api";

	type ApiStatus = "idle" | "connecting" | "ready" | "error";
	type LoginMode = "qr" | "phone" | "password";
	type VipState = "idle" | "checking" | "claimed" | "risk" | "error";
	type SearchScope = "all" | "playlist";
	type PanelTab = "songs" | "discover";
	type LibrarySort = "default" | "title" | "artist";
	type LibraryView = "library" | "daily";
	type PageSizeOption = 10 | 25 | 50;

	const VIP_DATE_PREFIX = "hengduo-music-vip-date:";
	const SHUFFLE_KEY = "hengduo-music-shuffle";
	const REPEAT_KEY = "hengduo-music-repeat";
	const isDev = import.meta.env.DEV;
	const devApiUrl = (isDev ? (import.meta.env.PUBLIC_MUSIC_DEV_API_URL as string | undefined) : "") ?? "";

	let apiUrl = "";
	let apiStatus: ApiStatus = "idle";
	let apiMessage = "尚未连接音乐服务";
	let expanded = false;
	let showSettings = false;
	let showLogin = false;
	let loginMode: LoginMode = "qr";
	let loginBusy = false;
	let loginMessage = "";
	let qrImage = "";
	let qrKey = "";
	let qrMessage = "点击生成二维码";
	let phone = "";
	let phoneCode = "";
	let phoneCountdown = 0;
	let username = "";
	let password = "";
	let accountOptions: Array<{ userid: string | number; nickname?: string; pic?: string }> = [];
	let selectedAccountId = "";
	let auth: MusicSession | null = null;
	let client: MusicApiClient | null = null;
	let playlists: MusicPlaylist[] = [];
	let selectedPlaylistId = "";
	let songs: MusicSong[] = [];
	let songsLoading = false;
	let songsMessage = "登录后加载你的歌单";
	let searchQuery = "";
	let searchScope: SearchScope = "all";
	let searchBusy = false;
	let searchMessage = "搜索全网歌曲，结果不会自动加入歌单";
	let searchResults: MusicSong[] = [];
	let dailySongs: MusicSong[] = [];
	let dailyLoading = false;
	let dailyMessage = "点击加载今日推荐";
	let addTargetSong: MusicSong | null = null;
	let addTargetPlaylistId = "";
	let addBusy = false;
	let batchMode = false;
	let batchSelectedVersion = 0;
	const batchSelected = new Map<string, MusicSong>();
	let batchBusy = false;
	// 待删除缓冲区：UI 立即变白但接口延迟执行，退出重进/点刷新才真正删除。
	const pendingRemovals = new Map<string, MusicSong>();
	let pendingRemovalsVersion = 0;
	// 居中卡片微弹窗（收藏反馈等）
	let toastVisible = false;
	let toastKind: "fav" | "unfav" | "info" | "error" = "info";
	let toastText = "";
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let currentSong: MusicSong | null = null;
	let currentSongLoading = "";
	let audio: HTMLAudioElement | null = null;
	// Swup 切页会销毁重建本组件；把 Audio 和"上次播放的歌"挂在 window 上，
	// 新实例直接接管旧 Audio，播放不中断，未选歌点播放则续播上一首。
	const sharedWindow = () => window as unknown as { __hengduoMusicAudio?: HTMLAudioElement; __hengduoMusicLast?: MusicSong | null };
	let isPlaying = false;
	let currentTime = 0;
	let duration = 0;
	let volume = 0.7;
	let lyricsOpen = false;
	let lyricsLoading = false;
	let panelTab: PanelTab = "songs";
	let fullscreen = false;
	let libraryOpen = false;
	let libraryPage = 1;
	let librarySort: LibrarySort = "default";
	let libraryView: LibraryView = "library";
	let libraryPageSize: PageSizeOption = 10;
	let dailyPage = 1;
	let libraryPageJump = "";
	let lyricsLines: Array<{ time: number | null; text: string }> = [];
	let activeLyricIndex = -1;
	let lyricsMessage = "点击“歌词”加载当前歌曲歌词";
	let lyricsRequestGeneration = 0;
	let fullscreenLyricsElement: HTMLElement | null = null;
	let lyricScrollGraceUntil = 0;
	let lyricAutoFollow = true;
	const lyricsCache = new Map<string, Array<{ time: number | null; text: string }>>();
	const lyricsPending = new Map<string, Promise<Array<{ time: number | null; text: string }>>>();
	let vipState: VipState = "idle";
	let vipMessage = "登录后自动检查今日权益";
	let notice = "";
	let riskChallenge: import("@utils/music-api").MusicRiskChallenge | null = null;
	let riskSong: MusicSong | null = null;
	let pendingRiskSong: MusicSong | null = null;
	let playMode: PlayMode = "list";
	let playGeneration = 0;
	let qrTimer: ReturnType<typeof setInterval> | null = null;
	let qrBusy = false;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;

	$: apiConfigured = Boolean(apiUrl.trim());
	$: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
	$: dockLabel = currentSong ? `${currentSong.name} · ${currentSong.author}` : "连接你的音乐平台";
	$: currentIndex = songs.findIndex((song) => song.hash === currentSong?.hash);
	$: isFavorite = currentSong ? (isSongInPlaylist(currentSong.hash, songs) && !pendingRemovals.has(currentSong.hash)) : false;
	// 响应式版本号：Map 原地变更后递增触发视图更新
	$: batchTick = batchSelectedVersion;
	$: pendingTick = pendingRemovalsVersion;
	$: librarySourceSongs = searchQuery.trim() ? searchResults : songs;
	$: librarySortedSongs = sortSongs(librarySourceSongs, librarySort);
	$: libraryTotalPages = Math.max(1, Math.ceil(librarySortedSongs.length / libraryPageSize));
	$: libraryPageSongs = paginateSongs(librarySortedSongs, Math.min(libraryPage, libraryTotalPages), libraryPageSize);
	$: dailySortedSongs = sortSongs(dailySongs, librarySort);
	$: dailyTotalPages = Math.max(1, Math.ceil(dailySortedSongs.length / libraryPageSize));
	$: dailyPageSongs = paginateSongs(dailySortedSongs, Math.min(dailyPage, dailyTotalPages), libraryPageSize);

	const isAllowedApiOrigin = (value: string): boolean => {
		const normalized = normalizeApiBaseUrl(value);
		if (!normalized) return false;
		try {
			const endpoint = new URL(normalized);
			return endpoint.protocol === "https:" || (import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname));
		} catch {
			return false;
		}
	};

	const isBrowser = () => typeof window !== "undefined";

	const formatTime = (seconds: number): string => {
		if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
		const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
		const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
		return `${mins}:${secs}`;
	};

	const errorMessage = (error: unknown, fallback: string): string => musicErrorMessage(error, fallback);

	const clearQrTimer = () => {
		if (qrTimer) clearInterval(qrTimer);
		qrTimer = null;
		qrBusy = false;
	};

	const clearCountdown = () => {
		if (countdownTimer) clearInterval(countdownTimer);
		countdownTimer = null;
	};

	const setSession = async (nextAuth: MusicSession) => {
		if (nextAuth?.userid === undefined || nextAuth?.userid === null) throw new MusicApiError("登录会话响应无效");
		// 酷狗 token、Cookie 与设备指纹均由 BFF 保管；前端只保留非敏感展示资料在内存。
		auth = nextAuth;
		showLogin = false;
		loginBusy = false;
		loginMessage = "";
		setNotice("已登录酷狗概念版，正在加载你的音乐数据");
		await loadUserData();
		const pending = pendingRiskSong;
		pendingRiskSong = null;
		if (pending) {
			setNotice("登录确认完成，正在继续播放…");
			void playSong(pending);
		}
	};

	const connectApi = async () => {
		const normalized = normalizeApiBaseUrl(apiUrl);
		if (!normalized) {
			apiStatus = "error";
			apiMessage = "受信音乐服务地址无效";
			return;
		}
		if (!isAllowedApiOrigin(normalized)) {
			apiStatus = "error";
			apiMessage = "公开博客只能连接 HTTPS 音乐 API；仅 localhost 可用于本地测试";
			return;
		}
		apiUrl = normalized;
		apiStatus = "connecting";
		apiMessage = "正在连接受信音乐服务…";
		try {
			client = new MusicApiClient(apiUrl);
			await client.health();
			apiStatus = "ready";
			apiMessage = "音乐服务已连接";
			showSettings = false;
			auth = await client.getSession();
			if (auth) await loadUserData();
		} catch (error) {
			apiStatus = "error";
			apiMessage = errorMessage(error, "音乐 API 无法连接");
			client = null;
		}
	};

	const claimDailyVip = async () => {
		if (!client || !auth?.userid) return;
		const dateKey = getShanghaiDateKey();
		const storageKey = `${VIP_DATE_PREFIX}${auth.userid}`;
		if (localStorage.getItem(storageKey) === dateKey) {
			vipState = "claimed";
			vipMessage = "今日 VIP 已检查";
			return;
		}

		vipState = "checking";
		vipMessage = "正在检查今日 VIP…";
		const result = await runDailyVipFlow({
			dateKey,
			claim: (day) => client.claimVip(day),
			upgrade: () => client.upgradeVip(),
		});
		vipMessage = result.message;
		if (result.status === "completed") {
			localStorage.setItem(storageKey, dateKey);
			vipState = "claimed";
		} else if (result.status === "risk") {
			vipState = "risk";
		} else {
			vipState = "error";
		}
	};

	const loadUserData = async () => {
		if (!client || !auth) return;
		// VIP is a best-effort background task. A transient Tunnel/VIP failure must not block playlists.
		void claimDailyVip();
		try {
			playlists = await client.getPlaylists();
			if (playlists.length > 0) {
				selectedPlaylistId = String(playlists[0].listid);
				await loadSongs();
			} else {
				songsMessage = "没有读取到可用歌单";
			}
		} catch (error) {
			songsMessage = errorMessage(error, "歌单加载失败");
		}
	};

	const retryMusicLibrary = async () => {
		if (playlists.length > 0 && selectedPlaylistId) {
			await loadSongs();
			return;
		}
		await loadUserData();
	};

	// 播放流失败时主动复核会话：BFF 会话 TTL 较短（默认 8h），过期后
	// 播放流会返回 401，此时应引导重新登录，而不是让用户看到误导性的“连接失败”。
	const recoverSessionAfterPlaybackFailure = async () => {
		if (!client || !auth) return;
		try {
			const session = await client.getSession();
			if (!session) {
				auth = null;
				playlists = [];
				songs = [];
				currentSong = null;
				isPlaying = false;
				setNotice("登录已过期，请重新登录后继续播放");
				showLogin = true;
			}
		} catch {
			// BFF 自身不可达（网络/隧道问题）时保持原提示，不重复打扰。
		}
	};

	const onPlaylistChange = (event: Event) => {
		selectedPlaylistId = (event.currentTarget as HTMLSelectElement).value;
		void loadSongs();
	};

	const loadSongs = async () => {
		if (!client || !selectedPlaylistId) return;
		songsLoading = true;
		songsMessage = "正在读取歌单…";
		try {
			songs = await client.getPlaylistSongs(selectedPlaylistId);
			songsMessage = songs.length ? "" : "这个歌单暂时没有可播放歌曲";
		} catch (error) {
			songs = [];
			songsMessage = errorMessage(error, "歌曲列表加载失败");
		} finally {
			songsLoading = false;
		}
	};

	const searchMusic = async () => {
		const keyword = searchQuery.trim();
		if (!keyword) {
			searchResults = [];
			searchMessage = "请输入歌曲名、歌手或关键词";
			return;
		}
		searchBusy = true;
		searchMessage = searchScope === "all" ? "正在搜索全网歌曲…" : "正在筛选当前歌单…";
		try {
			if (searchScope === "playlist") {
				const lower = keyword.toLocaleLowerCase();
				searchResults = songs.filter((song) => `${song.name} ${song.author}`.toLocaleLowerCase().includes(lower));
			} else if (client) {
				searchResults = await client.searchSongs(keyword, 1, 100);
			}
			searchMessage = searchResults.length ? `找到 ${searchResults.length} 首歌曲` : "没有找到匹配歌曲";
		} catch (error) {
			searchResults = [];
			searchMessage = errorMessage(error, "歌曲搜索失败");
		} finally {
			searchBusy = false;
		}
	};

	const openLibrary = () => {
		libraryOpen = true;
		libraryView = "library";
		libraryPage = 1;
		dailyPage = 1;
		libraryPageJump = "";
		pendingRemovals.clear();
		pendingRemovalsVersion += 1;
		searchQuery = "";
		searchScope = "playlist";
		searchResults = [];
		searchMessage = "搜索全网歌曲，结果不会自动加入歌单";
	};

	const openDailyModal = () => {
		libraryOpen = true;
		libraryView = "daily";
		libraryPage = 1;
		dailyPage = 1;
		libraryPageJump = "";
		if (dailySongs.length === 0 && !dailyLoading) void loadDailyRecommendations();
	};

	const setLibraryPageSize = (event: Event) => {
		libraryPageSize = Number((event.currentTarget as HTMLSelectElement).value) as PageSizeOption;
		libraryPage = 1;
		dailyPage = 1;
	};

	const jumpToLibraryPage = (event: Event) => {
		event.preventDefault();
		const target = Number(libraryPageJump);
		if (!Number.isFinite(target)) return;
		if (libraryView === "daily") dailyPage = Math.max(1, Math.min(Math.floor(target), dailyTotalPages));
		else libraryPage = Math.max(1, Math.min(Math.floor(target), libraryTotalPages));
		libraryPageJump = "";
	};

	const closeLibrary = () => {
		libraryOpen = false;
		addTargetSong = null;
	};

	const searchLibrary = async () => {
		libraryPage = 1;
		await searchMusic();
	};

	const setLibrarySort = (event: Event) => {
		librarySort = (event.currentTarget as HTMLSelectElement).value as LibrarySort;
		libraryPage = 1;
	};

	const searchSongAddData = (song: MusicSong) => {
		const albumId = Number(song.album_id ?? song.albumid ?? 0) || 0;
		const mixSongId = Number(song.mixsongid ?? song.mix_song_id ?? 0) || 0;
		return `${song.name}|${song.hash}|${albumId}|${mixSongId}`;
	};

	const openAddSong = (song: MusicSong) => {
		if (!auth || playlists.length === 0) {
			setNotice("请先登录并加载至少一个歌单");
			return;
		}
		addTargetSong = song;
		addTargetPlaylistId = selectedPlaylistId || String(playlists[0].listid);
	};

	const addSongToPlaylist = async () => {
		if (!client || !addTargetSong || !addTargetPlaylistId || addBusy) return;
		if (addTargetPlaylistId === selectedPlaylistId && isSongInPlaylist(addTargetSong.hash, songs)) {
			setNotice("这首歌已在当前歌单");
			addTargetSong = null;
			return;
		}
		addBusy = true;
		try {
			await client.addPlaylistTracks(addTargetPlaylistId, searchSongAddData(addTargetSong));
			const target = playlists.find((playlist) => String(playlist.listid) === addTargetPlaylistId);
			setNotice(`已添加到「${target?.name ?? "歌单"}」`);
			if (addTargetPlaylistId === selectedPlaylistId) await loadSongs();
			addTargetSong = null;
		} catch (error) {
			setNotice(errorMessage(error, "添加到歌单失败"));
		} finally {
			addBusy = false;
		}
	};

	const playSong = async (song: MusicSong) => {
		if (!client || !auth || !audio) {
			showLogin = true;
			return;
		}
		const generation = ++playGeneration;
		currentSongLoading = song.hash;
		try {
			const audioUrl = await client.getStreamUrl(song.hash);
			if (!audioUrl) throw new MusicApiError("BFF 播放流不可用");
			currentSong = song;
			sharedWindow().__hengduoMusicLast = song;
			lyricsRequestGeneration = generation;
			lyricsLines = [];
			activeLyricIndex = -1;
			if (lyricsOpen) {
				lyricsLoading = true;
				lyricsMessage = "正在加载歌词…";
			}
			audio.src = audioUrl;
			audio.currentTime = 0;
			await audio.play();
			if (generation !== playGeneration) return;
			updateMediaSession();
			scrollActiveTrackIntoView();
			void prefetchLyrics(song, generation);
			void claimDailyVip();
		} catch (error) {
			if (error instanceof MusicRiskVerifyError) {
				riskChallenge = error.challenge;
				riskSong = song;
				setNotice("VIP 播放需要完成一次人工安全验证");
				return;
			}
			// 快速切歌时浏览器会中断上一次 audio.play()，这是正常竞态而非失败。
			if (error instanceof DOMException && error.name === "AbortError") return;
			// 媒体加载失败（网络错误/资源不支持）时主动验证会话是否过期。
			const mediaErrorCode = audio?.error?.code;
			if (mediaErrorCode === 2 || mediaErrorCode === 4 || (error instanceof DOMException && error.name === "NotSupportedError")) {
				void recoverSessionAfterPlaybackFailure();
			}
			setNotice(errorMessage(error, "BFF 播放流连接失败"));
		} finally {
			if (generation === playGeneration) currentSongLoading = "";
		}
	};

	const handleRiskVerified = async () => {
		const song = riskSong;
		riskChallenge = null;
		riskSong = null;
		setNotice("安全验证通过，正在继续播放…");
		if (song) await playSong(song);
	};

	const handleRiskCancelled = () => {
		riskChallenge = null;
		riskSong = null;
		setNotice("已取消安全验证");
	};

	const handleRiskRelogin = () => {
		pendingRiskSong = riskSong;
		riskChallenge = null;
		riskSong = null;
		loginMode = "qr";
		qrImage = "";
		qrKey = "";
		qrMessage = "请重新扫码确认酷狗账号";
		loginMessage = "";
		showLogin = true;
		setNotice("酷狗要求登录确认，请重新扫码登录后继续播放");
	};

	const togglePlay = async () => {
		if (!audio) return;
		if (!currentSong) {
			// 已登录但还没选歌时，续播上一次听的歌曲（本会话内记忆）。
			const last = sharedWindow().__hengduoMusicLast;
			if (last && auth) {
				await playSong(last);
				return;
			}
			if (songs[0]) await playSong(songs[0]);
			else showLogin = true;
			return;
		}
		if (audio.paused) await audio.play();
		else audio.pause();
	};

	const playNext = async () => {
		if (!currentSong || songs.length === 0) return;
		if (playMode === "shuffle" && songs.length > 1) {
			let nextIndex = Math.floor(Math.random() * songs.length);
			const currentIndexNow = songs.findIndex((song) => song.hash === currentSong?.hash);
			if (nextIndex === currentIndexNow) nextIndex = (nextIndex + 1) % songs.length;
			await playSong(songs[nextIndex]);
			return;
		}
		const index = songs.findIndex((song) => song.hash === currentSong?.hash);
		await playSong(songs[(index + 1) % songs.length]);
	};

	const showToast = (kind: "fav" | "unfav" | "info" | "error", text: string) => {
		toastKind = kind;
		toastText = text;
		toastVisible = true;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastVisible = false), 2200);
	};

	const setNotice = (message: string) => {
		showToast("info", message);
	};

	const toggleFavorite = () => {
		if (!currentSong) return;
		if (isFavorite) {
			// 已收藏 → 进入待删除缓冲区：UI 立即变白，接口延迟到刷新/重进时执行
			pendingRemovals.set(currentSong.hash, currentSong);
			pendingRemovalsVersion += 1;
			showToast("unfav", `取消收藏「${currentSong.name}」，刷新后生效`);
			return;
		}
		if (pendingRemovals.has(currentSong.hash)) {
			// 待删除期间反悔：本地恢复，不调接口
			pendingRemovals.delete(currentSong.hash);
			pendingRemovalsVersion += 1;
			showToast("fav", `已恢复收藏「${currentSong.name}」`);
			return;
		}
		// 未收藏 → 打开添加卡片选择目标歌单（立即调接口）
		openAddSong(currentSong);
	};

	const flushPendingRemovals = async (): Promise<boolean> => {
		if (!client || !selectedPlaylistId || pendingRemovals.size === 0) return true;
		const entries = [...pendingRemovals.entries()].filter(([, song]) => songFileId(song));
		if (entries.length === 0) {
			pendingRemovals.clear();
			pendingRemovalsVersion += 1;
			return true;
		}
		try {
			const fileids = entries.map(([, song]) => String(songFileId(song)));
			await client.delPlaylistTracks(selectedPlaylistId, fileids);
			for (const [hash] of entries) pendingRemovals.delete(hash);
			pendingRemovalsVersion += 1;
			showToast("unfav", `已移除 ${fileids.length} 首，列表已刷新`);
			await loadSongs();
			return true;
		} catch (error) {
			showToast("error", errorMessage(error, "移除执行失败，已恢复收藏状态"));
			pendingRemovals.clear();
			pendingRemovalsVersion += 1;
			return false;
		}
	};

	const removeSongFromPlaylist = async (song: MusicSong) => {
		const fileid = songFileId(song);
		if (!client || !selectedPlaylistId) return;
		if (!fileid) {
			showToast("error", "这首歌缺少移除标识，请在歌曲库中管理");
			return;
		}
		try {
			await client.delPlaylistTracks(selectedPlaylistId, [fileid]);
			showToast("unfav", `已从当前歌单移除「${song.name}」`);
			await loadSongs();
		} catch (error) {
			showToast("error", errorMessage(error, "移除失败"));
		}
	};

	const refreshLibrary = async () => {
		libraryPage = 1;
		dailyPage = 1;
		await flushPendingRemovals();
	};

	const toggleFavoriteState = (song: MusicSong) => {
		// 弹窗内单爱心切换：已收藏→待删除缓冲区；待删除→本地恢复。均不立即调接口。
		if (pendingRemovals.has(song.hash)) {
			pendingRemovals.delete(song.hash);
			pendingRemovalsVersion += 1;
			showToast("fav", `已恢复收藏「${song.name}」`);
			return;
		}
		if (isSongInPlaylist(song.hash, songs)) {
			pendingRemovals.set(song.hash, song);
			pendingRemovalsVersion += 1;
			showToast("unfav", `取消收藏「${song.name}」，刷新后生效`);
			return;
		}
		addSongToCurrentPlaylist(song);
	};

	const addSongToCurrentPlaylist = async (song: MusicSong) => {
		if (!client || !selectedPlaylistId) return;
		try {
			await client.addPlaylistTracks(selectedPlaylistId, searchSongAddData(song));
			showToast("fav", `已收藏「${song.name}」到当前歌单`);
			await loadSongs();
		} catch (error) {
			showToast("error", errorMessage(error, "收藏失败"));
		}
	};

	const toggleBatchMode = () => {
		batchMode = !batchMode;
		batchSelected.clear();
		batchSelectedVersion += 1;
	};

	const toggleBatchSong = (song: MusicSong) => {
		const key = songFileId(song) ?? song.hash;
		if (batchSelected.has(key)) batchSelected.delete(key);
		else batchSelected.set(key, song);
		batchSelectedVersion += 1;
	};

	const deleteBatchSelected = async () => {
		if (!client || !selectedPlaylistId || batchSelected.size === 0 || batchBusy) return;
		const entries = [...batchSelected.entries()];
		const missing = entries.filter(([, song]) => !songFileId(song));
		if (missing.length === entries.length) {
			showToast("error", "所选歌曲缺少移除标识");
			return;
		}
		batchBusy = true;
		try {
			const fileids = entries.filter(([, song]) => songFileId(song)).map(([, song]) => String(songFileId(song)));
			await client.delPlaylistTracks(selectedPlaylistId, fileids);
			showToast("unfav", `已从歌单移除 ${fileids.length} 首歌曲`);
			batchSelected.clear();
			batchSelectedVersion += 1;
			batchMode = false;
			await loadSongs();
		} catch (error) {
			showToast("error", errorMessage(error, "批量移除失败"));
		} finally {
			batchBusy = false;
		}
	};

	const cycleRepeat = () => {
		playMode = nextPlayMode(playMode);
		localStorage.setItem(REPEAT_KEY, playMode);
		// 模式变化由图标+常驻标签直接体现，不再弹提示导致面板高度跳动。
	};

	const scrollActiveTrackIntoView = () => {
		requestAnimationFrame(() => {
			const list = document.querySelector<HTMLElement>(".music-song-list");
			const active = list?.querySelector<HTMLElement>(".music-song--active");
			active?.scrollIntoView({ block: "nearest" });
		});
	};

	const playPrevious = async () => {
		if (!currentSong || songs.length === 0) return;
		const index = songs.findIndex((song) => song.hash === currentSong?.hash);
		await playSong(songs[(index - 1 + songs.length) % songs.length]);
	};

	const seek = (event: Event) => {
		if (!audio || !duration) return;
		const target = event.currentTarget as HTMLInputElement;
		audio.currentTime = (Number(target.value) / 100) * duration;
	};

	const changeVolume = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		volume = Number(target.value) / 100;
		if (audio) audio.volume = volume;
		localStorage.setItem("hengduo-music-volume", String(volume));
	};

	const loadDailyRecommendations = async () => {
		if (!client || dailyLoading) return;
		dailyLoading = true;
		dailyMessage = "正在读取今日推荐…";
		try {
			const songs = await client.getDailyRecommendations();
			dailySongs = shuffleSongs(songs);
			dailyMessage = dailySongs.length > 0 ? "" : "今天暂时没有推荐歌曲";
		} catch (error) {
			dailySongs = [];
			dailyMessage = errorMessage(error, "每日推荐加载失败");
		} finally {
			dailyLoading = false;
		}
	};

	const reshuffleDailyRecommendations = () => {
		if (dailySongs.length > 0) {
			dailySongs = shuffleSongs(dailySongs);
			setNotice("已为你换一批推荐歌曲");
		} else {
			void loadDailyRecommendations();
		}
	};

	const seekToLyric = (time: number | null) => {
		if (!audio || time === null || !Number.isFinite(time)) return;
		audio.currentTime = Math.max(0, Math.min(time, duration || time));
		updateActiveLyric();
	};

	const parseLyrics = parseLyricsText;

	const syncLyricScroll = (force = false) => {
		if (!lyricAutoFollow && !force) return;
		if (!force && Date.now() < lyricScrollGraceUntil) return;
		requestAnimationFrame(() => {
			for (const container of [fullscreenLyricsElement]) {
				if (!container) continue;
				const active = container.querySelector<HTMLElement>(".music-lyric--active");
				if (!active) continue;
				const lineTop = active.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
				container.scrollTo({
					top: centeredLyricScrollTop(lineTop, active.offsetHeight, container.clientHeight, container.scrollHeight),
					behavior: "smooth",
				});
			}
		});
	};

	const markManualLyricsScroll = () => {
		// 用户手动滚动歌词后暂停自动跟随，4 秒后恢复。
		lyricScrollGraceUntil = Date.now() + 4000;
	};

	const updateActiveLyric = () => {
		const t = audio?.currentTime ?? 0;
		let idx = -1;
		for (let i = 0; i < lyricsLines.length; i++) {
			const line = lyricsLines[i];
			if (line.time === null) continue;
			if (t >= line.time) idx = i;
			else break;
		}
		if (idx === activeLyricIndex) {
			syncLyricScroll();
			return;
		}
		activeLyricIndex = idx;
		syncLyricScroll();
	};

	const requestLyricsForSong = (song: MusicSong): Promise<Array<{ time: number | null; text: string }>> => {
		if (!client) return Promise.reject(new MusicApiError("音乐服务尚未配置"));
		const cached = lyricsCache.get(song.hash);
		if (cached) return Promise.resolve(cached);
		const pending = lyricsPending.get(song.hash);
		if (pending) return pending;

		const requestClient = client;
		const pendingRequest = requestClient.getLyrics(song.hash)
			.then(parseLyrics)
			.then((lines) => {
				lyricsCache.set(song.hash, lines);
				if (lyricsCache.size > 48) lyricsCache.delete(lyricsCache.keys().next().value ?? "");
				return lines;
			})
			.finally(() => lyricsPending.delete(song.hash));
		lyricsPending.set(song.hash, pendingRequest);
		return pendingRequest;
	};

	const prefetchLyrics = async (song: MusicSong, generation: number) => {
		try {
			const lines = await requestLyricsForSong(song);
			if (!isCurrentLyricsRequest(song.hash, currentSong?.hash, generation, lyricsRequestGeneration)) return;
			if (lyricsOpen) {
				lyricsLines = lines;
				lyricsMessage = lines.length > 0 ? "" : "没有返回可显示的歌词";
				lyricsLoading = false;
				updateActiveLyric();
			}
		} catch (error) {
			if (!isCurrentLyricsRequest(song.hash, currentSong?.hash, generation, lyricsRequestGeneration) || !lyricsOpen) return;
			lyricsLines = [];
			lyricsMessage = errorMessage(error, "歌词加载失败");
			lyricsLoading = false;
		}
	};

	const toggleFullscreen = () => {
		fullscreen = !fullscreen;
		if (fullscreen) {
			if (currentSong && !lyricsOpen && !lyricsLoading) void loadLyrics();
			requestAnimationFrame(() => syncLyricScroll(true));
		}
	};

	const toggleSettings = () => {
		if (apiStatus !== "ready" || showSettings) showSettings = false;
		else showSettings = true;
	};

	const loadLyrics = async () => {
		const song = currentSong;
		const generation = lyricsRequestGeneration;
		if (!song || !client) return;
		lyricsOpen = true;
		lyricsLoading = true;
		lyricsMessage = "正在加载歌词…";
		try {
			const lines = await requestLyricsForSong(song);
			if (!isCurrentLyricsRequest(song.hash, currentSong?.hash, generation, lyricsRequestGeneration)) return;
			lyricsLines = lines;
			lyricsMessage = lines.length > 0 ? "" : "没有返回可显示的歌词";
			updateActiveLyric();
		} catch (error) {
			if (!isCurrentLyricsRequest(song.hash, currentSong?.hash, generation, lyricsRequestGeneration)) return;
			lyricsLines = [];
			lyricsMessage = errorMessage(error, "歌词加载失败");
		} finally {
			if (isCurrentLyricsRequest(song.hash, currentSong?.hash, generation, lyricsRequestGeneration)) lyricsLoading = false;
		}
	};

	const updateMediaSession = () => {
		if (!currentSong || !isBrowser() || !("mediaSession" in navigator)) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: currentSong.name,
				artist: currentSong.author,
				album: currentSong.album ?? "衡堕音乐空间",
				artwork: currentSong.img ? [{ src: currentSong.img }] : [],
			});
		} catch {
			// 部分浏览器不支持远程 artwork，不影响播放。
		}
	};

	const logout = async () => {
		clearQrTimer();
		try {
			await client?.logout();
		} catch {
			// 无法联系 BFF 时仍清除当前页面内存状态。
		}
		if (audio) {
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
		}
		auth = null;
		playlists = [];
		songs = [];
		currentSong = null;
		isPlaying = false;
		vipState = "idle";
		vipMessage = "登录后自动检查今日权益";
		setNotice("已退出音乐平台");
	};

	const startQrLogin = async () => {
		if (!client) return;
		clearQrTimer();
		qrImage = "";
		qrKey = "";
		qrMessage = "正在生成二维码…";
		loginBusy = true;
		loginMessage = "正在生成二维码…";
		try {
			const qr = await client.createQr();
			qrKey = qr.key;
			qrImage = qr.image;
			qrMessage = "请使用酷狗客户端扫码";
			loginMessage = "";
			loginBusy = false;
			qrTimer = setInterval(async () => {
				if (qrBusy || !client || !qrKey) return;
				qrBusy = true;
				try {
					const poll = await client.checkQr(qrKey);
					if (poll.status === 4) {
						if (!poll.session) throw new MusicApiError("二维码会话响应无效");
						clearQrTimer();
						await setSession(poll.session);
						return;
					}
					if (poll.status === 2) qrMessage = `${poll.nickname || "用户"} 已扫码，等待确认`;
					else if (poll.status === 1) qrMessage = "等待扫码";
					else if (poll.status === 0) {
						clearQrTimer();
						qrMessage = "二维码已过期，请重新生成";
					} else qrMessage = "正在等待酷狗确认";
				} catch (error) {
					clearQrTimer();
					loginMessage = errorMessage(error, "二维码状态检查失败");
				} finally {
					qrBusy = false;
				}
			}, 1200);
		} catch (error) {
			qrImage = "";
			qrKey = "";
			qrMessage = "二维码暂时无法生成，请稍后再试";
			loginBusy = false;
			loginMessage = errorMessage(error, "二维码生成失败");
		}
	};

	const sendPhoneCode = async () => {
		if (!client || !/^1\d{10}$/.test(phone)) {
			loginMessage = "请输入有效的手机号";
			return;
		}
		loginBusy = true;
		loginMessage = "正在发送验证码…";
		try {
			await client.sendCaptcha(phone);
			loginMessage = "验证码已发送";
			phoneCountdown = 60;
			clearCountdown();
			countdownTimer = setInterval(() => {
				phoneCountdown -= 1;
				if (phoneCountdown <= 0) clearCountdown();
			}, 1000);
		} catch (error) {
			loginMessage = errorMessage(error, "验证码发送失败");
		} finally {
			loginBusy = false;
		}
	};

	const phoneLogin = async (userid?: string | number) => {
		if (!client || !phone || !phoneCode) {
			loginMessage = "请输入手机号和验证码";
			return;
		}
		loginBusy = true;
		loginMessage = "正在登录…";
		try {
			const nextAuth = await client.loginPhone(phone, phoneCode, userid ? String(userid) : undefined);
			await setSession(nextAuth);
		} catch (error) {
			const payload = error instanceof MusicApiError ? error.payload as any : null;
			const list = payload?.data?.info_list ?? payload?.body?.data?.info_list;
			if (Array.isArray(list) && list.length && !userid) {
				accountOptions = list;
				loginMessage = "这个手机号绑定了多个账号，请选择";
			} else {
				loginMessage = errorMessage(error, "手机验证码登录失败");
			}
			loginBusy = false;
		}
	};

	const passwordLogin = async () => {
		if (!client || !username || !password) {
			loginMessage = "请输入账号和密码";
			return;
		}
		loginBusy = true;
		loginMessage = "正在登录…";
		try {
			const nextAuth = await client.loginPassword(username, password);
			password = "";
			await setSession(nextAuth);
		} catch (error) {
			password = "";
			loginMessage = errorMessage(error, "账号密码登录失败");
			loginBusy = false;
		}
	};

	const selectLoginMode = (mode: LoginMode) => {
		loginMode = mode;
		loginMessage = "";
		if (mode !== "qr") {
			clearQrTimer();
			qrImage = "";
		}
	};

	onMount(() => {
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (libraryOpen) {
				closeLibrary();
				return;
			}
			if (fullscreen) fullscreen = false;
		};
		window.addEventListener("keydown", onKeydown);
		return () => window.removeEventListener("keydown", onKeydown);
	});

	// 弹窗/全屏打开时锁定页面背景滚动，滑动手势只作用于面板自身。
	$: bodyScrollLocked = libraryOpen || fullscreen;
	$: if (isBrowser()) document.documentElement.style.overflow = bodyScrollLocked ? "hidden" : "";

	onMount(() => {
		apiUrl = normalizeApiBaseUrl(isDev && devApiUrl ? devApiUrl : MUSIC_BFF_ORIGIN);
		const savedVolume = Number(localStorage.getItem("hengduo-music-volume"));
		if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) volume = savedVolume;
		const savedShuffle = localStorage.getItem(SHUFFLE_KEY) === "1";
		const savedRepeat = localStorage.getItem(REPEAT_KEY);
		const savedRepeatMode = savedRepeat === "one" || savedRepeat === "off" ? savedRepeat : "list";
		playMode = normalizePlayMode(savedShuffle, savedRepeatMode);
		localStorage.setItem(REPEAT_KEY, playMode);
		localStorage.removeItem(SHUFFLE_KEY);
		lyricAutoFollow = localStorage.getItem("hengduo-music-lyric-follow") !== "0";
		const shared = sharedWindow();
		if (shared.__hengduoMusicAudio) {
			audio = shared.__hengduoMusicAudio;
			currentSong = shared.__hengduoMusicLast ?? null;
			isPlaying = !audio.paused;
			currentTime = audio.currentTime ?? 0;
			duration = audio.duration || 0;
		} else {
			audio = new Audio();
			shared.__hengduoMusicAudio = audio;
		}
		audio.crossOrigin = "use-credentials";
		audio.preload = "metadata";
		audio.volume = volume;
		const onTimeUpdate = () => {
			currentTime = audio?.currentTime ?? 0;
			updateActiveLyric();
		};
		const onLoadedMetadata = () => (duration = audio?.duration ?? 0);
		const onPlay = () => (isPlaying = true);
		const onPause = () => (isPlaying = false);
		const onEnded = () => {
			if (playMode === "one" && currentSong) {
				audio.currentTime = 0;
				void audio.play();
				return;
			}
			if (playMode === "order") {
				const index = songs.findIndex((song) => song.hash === currentSong?.hash);
				if (index === songs.length - 1) return;
			}
			void playNext();
		};
		const onError = () => setNotice("音频地址已失效，请重新点击歌曲");
		audio.addEventListener("timeupdate", onTimeUpdate);
		audio.addEventListener("loadedmetadata", onLoadedMetadata);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("ended", onEnded);
		audio.addEventListener("error", onError);

		if ("mediaSession" in navigator) {
			try {
				navigator.mediaSession.setActionHandler("play", () => void audio?.play());
				navigator.mediaSession.setActionHandler("pause", () => audio?.pause());
				navigator.mediaSession.setActionHandler("nexttrack", () => void playNext());
				navigator.mediaSession.setActionHandler("previoustrack", () => void playPrevious());
			} catch {
				// 不支持某个 Media Session action 时保留基础播放。
			}
		}

		if (apiUrl) void connectApi();

		return () => {
			clearQrTimer();
			clearCountdown();
			// 共享 Audio 继续播放；只移除本实例的监听器，避免重复回调。
			audio?.removeEventListener("timeupdate", onTimeUpdate);
			audio?.removeEventListener("loadedmetadata", onLoadedMetadata);
			audio?.removeEventListener("play", onPlay);
			audio?.removeEventListener("pause", onPause);
			audio?.removeEventListener("ended", onEnded);
			audio?.removeEventListener("error", onError);
		};
	});
</script>

<div class:music-dock--open={expanded} class="music-dock">
	{#if expanded}
		<section class="music-panel" aria-label="音乐播放器">
			<header class="music-panel__header">
				<div class="music-panel-title">
					<p class="music-kicker">PERSONAL RADIO</p>
					<h2>音乐空间</h2>
					<span class="music-title-status">{apiStatus === "ready" ? "SERVICE ONLINE" : "SERVICE OFFLINE"}</span>
				</div>
				<div class="music-panel-actions">
					<span class="music-header-account">{auth ? (auth.nickname ?? `酷狗用户 ${auth.userid}`) : "未登录"}</span>
					{#if vipState !== "idle"}
						<span class:music-vip-badge--ok={vipState === "claimed"} class:music-vip-badge--risk={vipState === "risk" || vipState === "error"} class="music-vip-badge" title={vipMessage}>{vipState === "checking" ? "VIP…" : vipState === "claimed" ? "VIP OK" : "需验证"}</span>
					{/if}
					{#if currentSong}
						<button class="music-icon-button" type="button" aria-label="全屏播放" title="全屏播放" on:click={toggleFullscreen}><Icon icon="material-symbols:fullscreen-rounded" /></button>
					{/if}
					{#if auth}
						<button class="music-icon-button" type="button" aria-label="退出登录" title="退出登录" on:click={logout}><Icon icon="material-symbols:logout-rounded" /></button>
					{:else}
						<button class="music-quiet music-quiet--tiny" type="button" on:click={() => (showLogin = true)}>登录</button>
					{/if}
					<button class="music-icon-button" type="button" aria-label={apiStatus !== "ready" || showSettings ? "返回播放器" : "音乐服务设置"} title={apiStatus !== "ready" || showSettings ? "返回播放器" : "音乐服务设置"} on:click={toggleSettings}><Icon icon="material-symbols:tune-rounded" /></button>
					<button class="music-icon-button" type="button" aria-label="关闭音乐面板" on:click={() => (expanded = false)}>
						<Icon icon="material-symbols:close-rounded" />
					</button>
				</div>
			</header>

			{#if apiStatus !== "ready" || showSettings}
				<div class="music-config-block music-config-block--full">
					<div class="music-section-label">SERVICE CONNECTION</div>
					<p class="music-muted">音乐登录只通过已配置的受信 HTTPS BFF 进行。BFF 保管酷狗账号令牌、设备标识和上游 Cookie；此页面不会保存它们。</p>
					{#if isDev}
						<p class="music-muted">本地开发可通过 <code>PUBLIC_MUSIC_DEV_API_URL</code> 配置 localhost Mock BFF。</p>
					{/if}
					<div class="music-actions">
						<button class="music-primary" type="button" disabled={apiStatus === "connecting"} on:click={connectApi}>
							{apiStatus === "connecting" ? "连接中…" : "重试连接"}
						</button>
						{#if showSettings && apiConfigured}
							<button class="music-quiet" type="button" on:click={() => (showSettings = false)}>返回播放器</button>
						{/if}
					</div>
					<p class:music-error={apiStatus === "error"} class="music-status-line">{apiMessage}</p>

					{#if showSettings}
						<div class="music-section-label">PLAYER PREFERENCES</div>
						<label class="music-setting-row">
							<span>歌词自动居中跟随<small>关闭后可自由滚动查看全屏歌词</small></span>
							<input type="checkbox" bind:checked={lyricAutoFollow} on:change={() => { localStorage.setItem("hengduo-music-lyric-follow", lyricAutoFollow ? "1" : "0"); if (lyricAutoFollow) syncLyricScroll(true); }} />
						</label>
						<label class="music-setting-row">
							<span>弹窗列表每页数量<small>歌曲库与每日推荐共用</small></span>
							<select value={libraryPageSize} aria-label="默认每页数量" on:change={setLibraryPageSize}><option value={10}>10 首</option><option value={25}>25 首</option><option value={50}>50 首</option></select>
						</label>
						<div class="music-setting-row">
							<span>歌词缓存<small>当前缓存 {lyricsCache.size} 首</small></span>
							<button class="music-quiet" type="button" on:click={() => { lyricsCache.clear(); setNotice("歌词缓存已清理"); }}>清理</button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="music-player-core">
					<div class="music-now-playing">
						{#if currentSong?.img}
							<img class="music-cover" src={currentSong.img} alt="当前歌曲封面" />
						{:else}
							<div class="music-cover music-cover--empty"><Icon icon="material-symbols:radio-outline-rounded" /></div>
						{/if}
						<div class="music-track-copy">
							<span class="music-track-status">
								{#if isPlaying}<span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
								<span class="music-status-line">{apiStatus === "ready" ? "SERVICE ONLINE" : "SERVICE OFFLINE"}</span>
							</span>
							<strong>{currentSong?.name ?? "还没有开始播放"}</strong>
							<span>{currentSong?.author ?? "登录后读取你的歌单"}{currentIndex >= 0 ? ` · ${currentIndex + 1}/${songs.length}` : ""}</span>
							</div>
							{#if currentSong}
							<button class:music-favorite--active={isFavorite} class="music-favorite" type="button" aria-label={isFavorite ? "已在当前歌单，选择其他歌单" : "添加当前歌曲到云端歌单"} title={isFavorite ? "已在当前歌单，选择其他歌单" : "添加到云端歌单"} on:click={toggleFavorite}>
								<Icon icon={isFavorite ? "material-symbols:favorite-rounded" : "material-symbols:favorite-outline-rounded"} />
							</button>
							{/if}
							</div>

					<div class="music-progress-row">
						<span>{formatTime(currentTime)}</span>
						<input aria-label="播放进度" type="range" min="0" max="100" value={progressPercent} on:input={seek} />
						<span>{formatTime(duration)}</span>
					</div>
					<div class="music-controls">
						<button class="music-icon-button" type="button" aria-label="上一首" on:click={playPrevious}><Icon icon="material-symbols:skip-previous-rounded" /></button>
						<button class:music-play-button--playing={isPlaying} class="music-play-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} on:click={togglePlay}>
							<Icon icon={isPlaying ? "material-symbols:pause-rounded" : "material-symbols:play-arrow-rounded"} />
						</button>
						<button class="music-icon-button" type="button" aria-label="下一首" on:click={playNext}><Icon icon="material-symbols:skip-next-rounded" /></button>
						<span class="music-mode-wrap">
							<button class:music-mode-button--active={playMode !== "list"} class="music-icon-button music-mode-button" type="button" aria-label="切换播放模式" title={playMode === "one" ? "单曲循环" : playMode === "shuffle" ? "随机播放" : playMode === "order" ? "顺序播放" : "列表循环"} on:click={cycleRepeat}>
								<Icon icon={playMode === "one" ? "material-symbols:repeat-one-rounded" : playMode === "shuffle" ? "material-symbols:shuffle-rounded" : playMode === "order" ? "material-symbols:format-list-numbered-rounded" : "material-symbols:repeat-rounded"} />
							</button>
							<small class="music-mode-label">{playMode === "one" ? "单曲" : playMode === "shuffle" ? "随机" : playMode === "order" ? "顺序" : "列表"}</small>
						</span>
					</div>
					<div class="music-volume-row">
						<label class="music-volume" aria-label="音量">
							<span class="music-volume-icon" aria-hidden="true"><Icon icon="material-symbols:volume-up-rounded" /></span>
							<input aria-label="调整音量" type="range" min="0" max="100" value={volume * 100} on:input={changeVolume} />
							<span class="music-volume-value" aria-hidden="true">{Math.round(volume * 100)}%</span>
						</label>
					</div>
				</div>

				<div class="music-entry-grid">
					<div class="music-entry-card">
						<div><span class="music-section-label">LIBRARY</span><strong>我的歌单</strong><small class="music-muted">{songsLoading ? "正在读取…" : `${songs.length} 首歌曲`}</small></div>
						{#if auth}
							<div class="music-entry-card__body">
								<select bind:value={selectedPlaylistId} on:change={onPlaylistChange} aria-label="选择当前歌单">
									{#each playlists as playlist}
										<option value={String(playlist.listid)}>{playlist.name}</option>
									{/each}
								</select>
								<button class="music-primary music-primary--small" type="button" on:click={openLibrary}>歌曲库</button>
							</div>
						{:else}
							<div class="music-entry-card__body">
								<span class="music-muted">登录后管理歌单</span>
								<button class="music-primary music-primary--small" type="button" on:click={() => (showLogin = true)}>登录酷狗</button>
							</div>
						{/if}
					</div>
					<div class="music-entry-card">
						<div><span class="music-section-label">DISCOVER / TODAY</span><strong>每日推荐</strong><small class="music-muted">{dailySongs.length > 0 ? `${dailySongs.length} 首今日推荐` : "每天 30 首新歌"}</small></div>
						<div class="music-entry-card__body">
							<span class="music-muted">{dailyLoading ? "正在读取…" : "为你挑选的每日新歌"}</span>
							<button class="music-primary music-primary--small" type="button" disabled={dailyLoading} on:click={openDailyModal}>{dailyLoading ? "加载中…" : "打开推荐"}</button>
						</div>
					</div>
				</div>
			{/if}

		</section>
	{/if}

	{#if libraryOpen}
		<div class="music-library-backdrop" role="presentation" on:click={(event) => event.target === event.currentTarget && closeLibrary()}>
			<section class="music-library-modal" role="dialog" aria-modal="true" aria-label={libraryView === "daily" ? "每日推荐" : "歌曲库"}>
				{#if libraryView === "daily"}
					<header class="music-library-header">
						<div><p class="music-kicker">DISCOVER / TODAY</p><h2>每日推荐</h2><span class="music-muted">{dailySongs.length > 0 ? `${dailySortedSongs.length} 首今日推荐` : "每天为你挑选 30 首新歌"}</span></div>
						<button class="music-icon-button" type="button" aria-label="关闭每日推荐" on:click={closeLibrary}><Icon icon="material-symbols:close-rounded" /></button>
					</header>
				<div class="music-library-toolbar">
						<span class="music-muted">{dailyLoading ? "正在读取今日推荐…" : dailyMessage || `${dailySortedSongs.length} 首推荐`}</span>
						<div class="music-library-toolbar__controls">
							<select value={librarySort} aria-label="推荐排序" on:change={setLibrarySort}><option value="default">默认顺序</option><option value="title">按歌名</option><option value="artist">按歌手</option></select>
							<select value={libraryPageSize} aria-label="每页显示数量" on:change={setLibraryPageSize}><option value={10}>10 首/页</option><option value={25}>25 首/页</option><option value={50}>50 首/页</option></select>
						</div>
					</div>
					<div class="music-library-list" aria-label="每日推荐列表">
						{#if dailyLoading}
							<p class="music-muted music-library-empty">正在加载今日推荐…</p>
						{:else if dailyPageSongs.length > 0}
							{#each dailyPageSongs as song, i}
								<div class="music-library-row">
									<button class:music-song--active={currentSong?.hash === song.hash} class="music-song" type="button" on:click={() => void playSong(song)}>
										<span class="music-song-index">{String((libraryPage - 1) * 10 + i + 1).padStart(2, "0")}</span>
										{#if song.img}<img class="music-song-cover" src={song.img} alt="" loading="lazy" />{:else}<span class="music-song-cover music-song-cover--empty"><Icon icon="material-symbols:music-note-rounded" /></span>{/if}
										<span class="music-song-info"><strong>{song.name}</strong><small>{song.author}{song.album ? ` · ${song.album}` : ""}</small></span><Icon icon={currentSong?.hash === song.hash && isPlaying ? "material-symbols:graphic-eq-rounded" : "material-symbols:play-arrow-rounded"} />
									</button>
									<button class:music-search-favorite--active={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash)} class="music-search-favorite" type="button" aria-label={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? `取消收藏 ${song.name}（刷新后生效）` : `收藏 ${song.name} 到当前歌单`} title={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? "点击取消收藏（刷新后生效）" : pendingRemovals.has(song.hash) ? "已取消收藏，刷新后生效；再点一次恢复" : "收藏到当前歌单"} on:click={() => (isSongInPlaylist(song.hash, songs) ? toggleFavoriteState(song) : addSongToCurrentPlaylist(song))}><Icon icon={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? "material-symbols:favorite-rounded" : "material-symbols:favorite-outline-rounded"} /></button>
								</div>
							{/each}
						{:else}
							<p class="music-muted music-library-empty">{dailyMessage || "今天暂时没有推荐歌曲"}</p>
						{/if}
					</div>
					<div class="music-library-footer">
						<span class="music-muted">第 {Math.min(dailyPage, dailyTotalPages)} / {dailyTotalPages} 页</span>
						<form class="music-library-jump" on:submit={jumpToLibraryPage}>
							<input bind:value={libraryPageJump} aria-label="跳转到指定页" placeholder="页码" inputmode="numeric" />
							<button class="music-quiet" type="submit">跳转</button>
						</form>
						<div class="music-actions">
							<button class="music-quiet" type="button" disabled={dailyPage <= 1} on:click={() => (dailyPage -= 1)}>上一页</button>
							<button class="music-quiet" type="button" disabled={dailyLoading || dailySortedSongs.length === 0} on:click={() => { reshuffleDailyRecommendations(); dailyPage = 1; }}>{dailyLoading ? "加载中…" : "换一批"}</button>
							<button class="music-quiet" type="button" disabled={dailyLoading} on:click={() => { dailyPage = 1; void loadDailyRecommendations(); }}>刷新</button>
							<button class="music-quiet" type="button" disabled={dailyPage >= dailyTotalPages} on:click={() => (dailyPage += 1)}>下一页</button>
						</div>
					</div>
				{:else}
					<header class="music-library-header">
						<div><p class="music-kicker">LIBRARY / SEARCH</p><h2>歌曲库</h2><span class="music-muted">{selectedPlaylistId ? playlists.find((playlist) => String(playlist.listid) === selectedPlaylistId)?.name : "我的音乐"}</span></div>
						<button class="music-icon-button" type="button" aria-label="关闭歌曲库" on:click={closeLibrary}><Icon icon="material-symbols:close-rounded" /></button>
					</header>
				<div class="music-library-search">
					<input bind:value={searchQuery} aria-label="搜索歌曲库" placeholder="搜索歌曲名或歌手" on:keydown={(event) => event.key === "Enter" && void searchLibrary()} />
					<select bind:value={searchScope} aria-label="搜索范围"><option value="playlist">当前歌单</option><option value="all">全网歌曲</option></select>
					<button class="music-primary music-primary--small" type="button" disabled={searchBusy} on:click={() => void searchLibrary()}>{searchBusy ? "搜索中…" : "搜索"}</button>
				</div>
				<div class="music-library-toolbar">
						<div class="music-library-toolbar__left">
							<span class="music-muted">{searchQuery.trim() ? searchMessage : `${songs.length} 首歌曲`}</span>
							{#if batchMode}<span class="music-muted">已选 {batchSelected.size}</span>{/if}
							{#if pendingRemovals.size > 0}<span class="music-pending-hint">待移除 {pendingRemovals.size} 首</span>{/if}
						</div>
						<div class="music-library-toolbar__controls">
							<button class="music-quiet" type="button" disabled={songsLoading || dailyLoading} on:click={() => void refreshLibrary()}>刷新</button>
							{#if batchMode}<button class:music-quiet--danger={batchSelected.size > 0} class="music-quiet" type="button" disabled={batchBusy || batchSelected.size === 0} on:click={() => void deleteBatchSelected()}>移除所选 ({batchSelected.size})</button>{/if}
							<button class="music-quiet" type="button" on:click={toggleBatchMode}>{batchMode ? "退出批量" : "批量管理"}</button>
							<select value={librarySort} aria-label="歌曲排序" on:change={setLibrarySort}><option value="default">默认顺序</option><option value="title">按歌名</option><option value="artist">按歌手</option></select>
							<select value={libraryPageSize} aria-label="每页显示数量" on:change={setLibraryPageSize}><option value={10}>10 首/页</option><option value={25}>25 首/页</option><option value={50}>50 首/页</option></select>
						</div>
					</div>
					<div class="music-library-list" aria-label="歌曲库列表">
						{#if searchBusy}
							<p class="music-muted music-library-empty">正在搜索歌曲…</p>
						{:else if libraryPageSongs.length > 0}
							{#each libraryPageSongs as song, i}
								<div class="music-library-row">
									<button class:music-song--active={currentSong?.hash === song.hash} class:music-song--selected={batchMode && batchSelected.has(songFileId(song) ?? song.hash)} class="music-song" type="button" on:click={() => (batchMode ? toggleBatchSong(song) : void playSong(song))}>
										{#if batchMode}
											<span class="music-batch-check" class:music-batch-check--on={batchSelected.has(songFileId(song) ?? song.hash)}>✓</span>
										{/if}
										<span class="music-song-index">{String((libraryPage - 1) * 10 + i + 1).padStart(2, "0")}</span>
									{#if song.img}<img class="music-song-cover" src={song.img} alt="" loading="lazy" />{:else}<span class="music-song-cover music-song-cover--empty"><Icon icon="material-symbols:music-note-rounded" /></span>{/if}
									<span class="music-song-info"><strong>{song.name}</strong><small>{song.author}{song.album ? ` · ${song.album}` : ""}</small></span><Icon icon={currentSong?.hash === song.hash && isPlaying ? "material-symbols:graphic-eq-rounded" : "material-symbols:play-arrow-rounded"} />
								</button>
								<button class:music-search-favorite--active={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash)} class="music-search-favorite" type="button" aria-label={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? `取消收藏 ${song.name}（刷新后生效）` : `收藏 ${song.name} 到当前歌单`} title={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? "点击取消收藏（刷新后生效）" : pendingRemovals.has(song.hash) ? "已取消收藏，刷新后生效；再点一次恢复" : "收藏到当前歌单"} on:click={() => (isSongInPlaylist(song.hash, songs) ? toggleFavoriteState(song) : addSongToCurrentPlaylist(song))}><Icon icon={isSongInPlaylist(song.hash, songs) && !pendingRemovals.has(song.hash) ? "material-symbols:favorite-rounded" : "material-symbols:favorite-outline-rounded"} /></button>
							</div>
						{/each}
					{:else}
						<p class="music-muted music-library-empty">{searchQuery.trim() ? searchMessage : songsMessage}</p>
					{/if}
				</div>
				<div class="music-library-footer">
					<span class="music-muted">第 {Math.min(libraryPage, libraryTotalPages)} / {libraryTotalPages} 页</span>
					<form class="music-library-jump" on:submit={jumpToLibraryPage}>
						<input bind:value={libraryPageJump} aria-label="跳转到指定页" placeholder="页码" inputmode="numeric" />
						<button class="music-quiet" type="submit">跳转</button>
					</form>
					<div class="music-actions">
						<button class="music-quiet" type="button" disabled={libraryPage <= 1} on:click={() => (libraryPage -= 1)}>上一页</button>
						<button class="music-quiet" type="button" disabled={libraryPage >= libraryTotalPages} on:click={() => (libraryPage += 1)}>下一页</button>
					</div>
				</div>
				{#if addTargetSong}
					<div class="music-add-song-card"><div><span class="music-section-label">ADD TO PLAYLIST</span><strong>{addTargetSong.name}</strong></div><select bind:value={addTargetPlaylistId} aria-label="选择目标歌单">{#each playlists as playlist}<option value={String(playlist.listid)}>{playlist.name}</option>{/each}</select><div class="music-actions"><button class="music-quiet" type="button" on:click={() => (addTargetSong = null)}>取消</button><button class="music-primary music-primary--small" type="button" disabled={addBusy} on:click={() => void addSongToPlaylist()}>{addBusy ? "添加中…" : "确认添加"}</button></div></div>
				{/if}
				{/if}
			</section>
		</div>
	{/if}

	{#if fullscreen && currentSong}
		<div class="music-fullscreen" role="dialog" aria-modal="true" aria-label="全屏播放">
			{#if currentSong.img}<div class="music-fullscreen__bg" style={`background-image:url(${currentSong.img})`} aria-hidden="true"></div>{/if}
			<div class="music-fullscreen__scrim" aria-hidden="true"></div>
			<button class="music-fullscreen__close" type="button" aria-label="退出全屏" title="退出全屏 (Esc)" on:click={() => (fullscreen = false)}><Icon icon="material-symbols:fullscreen-exit-rounded" /></button>
			<div class="music-fullscreen__content">
				<div class="music-fullscreen__left">
					{#if currentSong.img}
						<img class="music-fullscreen__cover" src={currentSong.img} alt="当前歌曲封面" />
					{:else}
						<div class="music-fullscreen__cover music-fullscreen__cover--empty"><Icon icon="material-symbols:radio-outline-rounded" /></div>
					{/if}
					<div class="music-fullscreen__copy">
						<strong>{currentSong.name}</strong>
						<span>{currentSong.author}</span>
					</div>
					<div class="music-progress-row">
						<span>{formatTime(currentTime)}</span>
						<input aria-label="播放进度" type="range" min="0" max="100" value={progressPercent} on:input={seek} />
						<span>{formatTime(duration)}</span>
					</div>
					<div class="music-controls">
						<button class="music-icon-button" type="button" aria-label={isFavorite ? "已在当前歌单" : "收藏到歌单"} title={isFavorite ? "已在当前歌单" : "收藏到歌单"} on:click={toggleFavorite}><Icon icon={isFavorite ? "material-symbols:favorite-rounded" : "material-symbols:favorite-outline-rounded"} /></button>
						<button class="music-icon-button" type="button" aria-label="上一首" title="上一首" on:click={playPrevious}><Icon icon="material-symbols:skip-previous-rounded" /></button>
						<button class:music-play-button--playing={isPlaying} class="music-play-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} title={isPlaying ? "暂停" : "播放"} on:click={togglePlay}>
							<Icon icon={isPlaying ? "material-symbols:pause-rounded" : "material-symbols:play-arrow-rounded"} />
						</button>
						<button class="music-icon-button" type="button" aria-label="下一首" title="下一首" on:click={playNext}><Icon icon="material-symbols:skip-next-rounded" /></button>
						<span class="music-mode-wrap">
							<button class:music-mode-button--active={playMode !== "list"} class="music-icon-button music-mode-button" type="button" aria-label="切换播放模式" title={playMode === "one" ? "单曲循环" : playMode === "shuffle" ? "随机播放" : playMode === "order" ? "顺序播放" : "列表循环"} on:click={cycleRepeat}>
								<Icon icon={playMode === "one" ? "material-symbols:repeat-one-rounded" : playMode === "shuffle" ? "material-symbols:shuffle-rounded" : playMode === "order" ? "material-symbols:format-list-numbered-rounded" : "material-symbols:repeat-rounded"} />
							</button>
							<small class="music-mode-label">{playMode === "one" ? "单曲" : playMode === "shuffle" ? "随机" : playMode === "order" ? "顺序" : "列表"}</small>
						</span>
					</div>
				</div>
				<div class="music-fullscreen__right">
					<div class="music-fullscreen__lyrics" bind:this={fullscreenLyricsElement} on:wheel={markManualLyricsScroll} on:touchstart|passive={markManualLyricsScroll} aria-live="polite">
						{#if lyricsLines.length > 0}
							<ul>
								{#each lyricsLines as line, i (i)}
									<button class:music-lyric--active={i === activeLyricIndex} class:music-lyric--past={activeLyricIndex >= 0 && i < activeLyricIndex} class:music-lyric--next={i === activeLyricIndex + 1} class="music-lyric music-lyric--fullscreen" type="button" disabled={line.time === null} on:click={() => seekToLyric(line.time)}>{line.text}</button>
								{/each}
							</ul>
						{:else}
							<p class="music-fullscreen__empty">{lyricsMessage || "还没有歌词"}</p>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if toastVisible}
		<div class="music-toast-backdrop" role="status" on:click={() => (toastVisible = false)}>
			<div class="music-toast-card music-toast-card--{toastKind}">
				<span class="music-toast-heart">
					<Icon icon={toastKind === "unfav" ? "material-symbols:heart-minus-rounded" : toastKind === "error" ? "material-symbols:error-rounded" : "material-symbols:favorite-rounded"} />
				</span>
				<strong>{toastText}</strong>
			</div>
		</div>
	{/if}
	{#if showLogin && apiStatus === "ready"}
		<div class="music-login-backdrop" role="presentation" on:click={(event) => event.target === event.currentTarget && (showLogin = false)}>
			<div class="music-login-card" role="dialog" aria-modal="true" aria-label="登录酷狗概念版">
				<header class="music-panel__header"><div><p class="music-kicker">ACCOUNT ACCESS</p><h2>登录酷狗概念版</h2></div><button class="music-icon-button" type="button" aria-label="关闭登录窗口" on:click={() => (showLogin = false)}><Icon icon="material-symbols:close-rounded" /></button></header>
				<div class="music-login-tabs">
					<button class:music-login-tab--active={loginMode === "qr"} type="button" on:click={() => selectLoginMode("qr")}>二维码</button>
					<button class:music-login-tab--active={loginMode === "phone"} type="button" on:click={() => selectLoginMode("phone")}>手机验证码</button>
					<button class:music-login-tab--active={loginMode === "password"} type="button" on:click={() => selectLoginMode("password")}>账号密码</button>
				</div>
				{#if loginMode === "qr"}
					<div class="music-qr-block">
						{#if qrImage}<img src={qrImage} alt="酷狗登录二维码" />{:else}<div class="music-qr-empty"><Icon icon="material-symbols:qr-code-2-rounded" /><span>点击生成登录二维码</span></div>{/if}
						<p>{qrMessage}</p>
						<button class="music-primary" type="button" disabled={loginBusy} on:click={() => void startQrLogin()}>{loginBusy ? "生成中…" : "生成二维码"}</button>
					</div>
				{:else if loginMode === "phone"}
					<div class="music-login-form">
						<label class="music-field"><span>手机号</span><input bind:value={phone} inputmode="numeric" autocomplete="tel" placeholder="请输入手机号" /></label>
						<div class="music-code-row"><label class="music-field"><span>验证码</span><input bind:value={phoneCode} inputmode="numeric" autocomplete="one-time-code" placeholder="短信验证码" /></label><button class="music-quiet" type="button" disabled={loginBusy || phoneCountdown > 0} on:click={() => void sendPhoneCode()}>{phoneCountdown ? `${phoneCountdown}s` : "发送验证码"}</button></div>
						{#if accountOptions.length}<div class="music-account-options"><span class="music-muted">请选择账号</span>{#each accountOptions as account}<button class="music-song" type="button" on:click={() => void phoneLogin(account.userid)}><span class="music-song-info"><strong>{account.nickname ?? `账号 ${account.userid}`}</strong><small>选择此账号登录</small></span><Icon icon="material-symbols:chevron-right-rounded" /></button>{/each}</div>{:else}<button class="music-primary" type="button" disabled={loginBusy} on:click={() => void phoneLogin()}>{loginBusy ? "登录中…" : "手机登录"}</button>{/if}
					</div>
				{:else}
					<div class="music-login-form">
						<p class="music-muted">密码仅用于本次请求，组件不会保存密码。建议优先使用二维码或手机验证码。</p>
						<label class="music-field"><span>账号</span><input bind:value={username} autocomplete="username" placeholder="酷狗账号" /></label>
						<label class="music-field"><span>密码</span><input bind:value={password} type="password" autocomplete="current-password" placeholder="不会保存" /></label>
						<button class="music-primary" type="button" disabled={loginBusy} on:click={() => void passwordLogin()}>{loginBusy ? "登录中…" : "账号登录"}</button>
					</div>
				{/if}
				{#if loginMessage}<p class="music-status-line music-error">{loginMessage}</p>{/if}
				<p class="music-login-note">仅连接你自己的音乐账号；博客不会保存密码或任何第三方登录会话。</p>
			</div>
		</div>
	{/if}
	<button class="music-dock-trigger" type="button" aria-expanded={expanded} aria-label="打开音乐播放器" on:click={() => (expanded = !expanded)}>
		<span class:music-trigger-pulse={isPlaying} class="music-trigger-icon">
			{#if currentSong?.img}
				<img class:music-trigger-spin={isPlaying} class="music-trigger-cover" src={currentSong.img} alt="" />
			{:else}
				<Icon icon={isPlaying ? "material-symbols:graphic-eq-rounded" : "material-symbols:radio-outline-rounded"} />
			{/if}
		</span>
		<span class="music-trigger-copy"><strong>音乐</strong><small>{expanded ? "收起" : dockLabel}</small></span>
		<Icon class="music-trigger-chevron" icon={expanded ? "material-symbols:keyboard-arrow-down-rounded" : "material-symbols:keyboard-arrow-up-rounded"} />
	</button>
</div>

{#if riskChallenge && client}
	<MusicRiskVerify client={client} challenge={riskChallenge} on:verified={handleRiskVerified} on:cancel={handleRiskCancelled} on:relogin={handleRiskRelogin} />
{/if}

<style>
	.music-dock {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 70;
		width: auto;
		font-family: var(--font-sans, "Noto Sans SC", sans-serif);
		color: var(--text-90, rgb(30 41 59));
	}

	.music-dock-trigger,
	.music-panel {
		border: 1px solid color-mix(in oklch, var(--primary) 22%, var(--card-border, #dce5e5));
		background: color-mix(in oklch, var(--card-bg, #fff) 92%, transparent);
		box-shadow: 0 18px 45px -25px rgb(15 23 42 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.24) inset;
		backdrop-filter: blur(18px) saturate(1.08);
		-webkit-backdrop-filter: blur(18px) saturate(1.08);
	}

	.music-dock-trigger {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: auto;
		min-height: 0;
		padding: 0.35rem;
		border-radius: 999px;
		text-align: left;
		cursor: pointer;
		transition: transform var(--ds-motion-base, 320ms) var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow var(--ds-motion-base, 320ms) var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.music-dock--open { width: min(32rem, calc(100vw - 2rem)); }
	.music-dock-trigger:hover { transform: translateY(-2px); box-shadow: 0 22px 48px -25px rgb(15 23 42 / 0.62), 0 0 0 1px color-mix(in oklch, var(--primary) 36%, transparent) inset; }
	.music-trigger-icon { position: relative; display: grid; place-items: center; width: 3.4rem; height: 3.4rem; overflow: hidden; border-radius: 50%; color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); font-size: 1.35rem; }
	.music-trigger-icon:has(img)::before { position: absolute; inset: 0; z-index: 1; border-radius: 50%; background: linear-gradient(135deg, rgb(255 255 255 / 0.22), transparent 46%); pointer-events: none; content: ""; }
	.music-trigger-icon:has(img)::after { position: absolute; inset: 0; z-index: 2; margin: auto; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: rgb(9 14 24 / 0.92); box-shadow: 0 0 0 2px rgb(255 255 255 / 0.28), 0 0 0 4px rgb(9 14 24 / 0.32); content: ""; }
	.music-trigger-cover { width: 100%; height: 100%; object-fit: cover; }
	.music-trigger-spin { animation: music-spin 16s linear infinite; }
	.music-trigger-pulse { animation: music-pulse 1.8s ease-in-out infinite; }
	.music-trigger-copy { display: none; min-width: 0; flex: 1; flex-direction: column; gap: 0.05rem; }
	.music-trigger-copy strong { font-size: 0.8rem; letter-spacing: 0.08em; }
	.music-trigger-copy small { overflow: hidden; color: var(--text-50, rgb(100 116 139)); font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }
	:global(.music-trigger-chevron) { display: none; color: var(--primary); font-size: 1.25rem; }

	.music-panel { position: relative; width: 100%; min-height: min(38rem, calc(100vh - 2rem)); margin-bottom: 0.65rem; padding: 1.1rem; border-radius: 1.25rem; overflow-x: hidden; overflow-y: auto; animation: music-panel-in 280ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }
	.music-panel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.85rem; }
	.music-panel-title { display: grid; gap: 0.1rem; }
	.music-panel-title .music-kicker { margin-bottom: 0; }
	.music-title-status { color: var(--text-40, rgb(148 163 184)); font-size: 0.58rem; letter-spacing: 0.08em; text-transform: uppercase; }
	.music-panel-actions { display: flex; align-items: center; gap: 0.3rem; }
	.music-header-account { max-width: 7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-50, rgb(100 116 139)); font-size: 0.66rem; }
	.music-vip-badge { display: inline-flex; align-items: center; min-height: 1.35rem; padding: 0.1rem 0.38rem; border: 1px solid color-mix(in oklch, var(--text-40, #94a3b8) 30%, transparent); border-radius: 999px; color: var(--text-50, #64748b); font-size: 0.56rem; letter-spacing: 0.02em; white-space: nowrap; }
	.music-vip-badge--ok { border-color: color-mix(in oklch, #2f9e72 36%, transparent); color: #2f9e72; background: color-mix(in oklch, #2f9e72 8%, transparent); }
	.music-vip-badge--risk { border-color: color-mix(in oklch, #c05640 36%, transparent); color: #c05640; background: color-mix(in oklch, #c05640 8%, transparent); }
	.music-quiet--tiny { min-height: 1.8rem; padding: 0.2rem 0.55rem; font-size: 0.66rem; }
	.music-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.3rem; margin-top: 0.75rem; padding: 0.22rem; border-radius: 0.8rem; background: color-mix(in oklch, var(--primary) 7%, var(--card-border, #dce5e5)); }
	.music-tab { min-height: 2rem; padding: 0.3rem 0.4rem; border: 0; border-radius: 0.6rem; color: var(--text-50, rgb(100 116 139)); background: transparent; font: inherit; font-size: 0.72rem; cursor: pointer; transition: color 200ms ease, background 200ms ease, box-shadow 200ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-tab:hover { color: var(--primary); }
	.music-tab--active { color: var(--primary); background: var(--card-bg, #fff); box-shadow: 0 2px 8px -4px rgb(15 23 42 / 0.35); }
	.music-lyrics-tab { margin-top: 0.65rem; }
	.music-entry-grid { display: grid; gap: 0.6rem; margin-top: 0.8rem; }
	.music-entry-card { display: grid; gap: 0.55rem; padding: 0.85rem; border: 1px solid color-mix(in oklch, var(--primary) 14%, var(--card-border, #dce5e5)); border-radius: 0.9rem; background: color-mix(in oklch, var(--primary) 5%, var(--card-bg, #fff)); }
	.music-entry-card > div:first-child { display: grid; gap: 0.1rem; }
	.music-entry-card strong { font-size: 0.86rem; }
	.music-entry-card small { font-size: 0.66rem; }
	.music-entry-card__body { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
	.music-entry-card__body select { min-width: 0; flex: 1; min-height: 2.25rem; padding: 0.4rem 0.55rem; border: 1px solid color-mix(in oklch, var(--primary) 26%, var(--card-border, #dce5e5)); border-radius: 0.6rem; color: inherit; background: var(--card-bg, #fff); font: inherit; font-size: 0.72rem; }
	.music-library-summary { display: grid; gap: 0.7rem; margin-top: 0.75rem; padding: 0.85rem; border: 1px solid color-mix(in oklch, var(--primary) 12%, var(--card-border, #dce5e5)); border-radius: 0.85rem; background: color-mix(in oklch, var(--primary) 4%, transparent); }
	.music-library-summary__footer { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
	.music-library-backdrop { position: fixed; inset: 0; z-index: 850; display: grid; place-items: center; padding: 1rem; background: rgb(8 12 20 / 0.42); backdrop-filter: blur(8px); animation: music-fade-in 180ms ease both; }
	.music-library-modal { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto auto; width: min(42rem, 100%); height: min(42rem, calc(100vh - 2rem)); max-height: calc(100vh - 2rem); padding: 1.1rem; overflow: hidden; border: 1px solid color-mix(in oklch, var(--primary) 24%, var(--card-border, #dce5e5)); border-radius: 1.2rem; color: inherit; background: var(--card-bg, #fff); box-shadow: 0 28px 80px -30px rgb(15 23 42 / 0.62); animation: music-modal-in 220ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }
	.music-library-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.music-library-header h2 { margin: 0.15rem 0 0.1rem; font-size: 1.15rem; }
	.music-library-search { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.4rem; margin-top: 0.9rem; }
	.music-library-search input, .music-library-search select, .music-library-toolbar select { min-width: 0; min-height: 2.25rem; padding: 0.4rem 0.9rem 0.4rem 0.55rem; border: 1px solid var(--card-border, #dce5e5); border-radius: 0.6rem; color: inherit; background: var(--card-bg, #fff); font: inherit; font-size: 0.72rem; }
	select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'%3E%3Cpath fill='%2364748b' d='M7.41 8.58 12 13.17l4.59-4.59L18 10l-6 6-6-6z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 0.45rem center; padding-right: 1.5rem; }
	.music-library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.7rem; margin-top: 0.65rem; }
	.music-library-toolbar__left { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
	.music-library-toolbar__controls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; }
	.music-library-jump { display: flex; align-items: center; gap: 0.3rem; }
	.music-library-jump input { width: 4.2rem; min-height: 1.9rem; padding: 0.25rem 0.45rem; border: 1px solid var(--card-border, #dce5e5); border-radius: 0.55rem; color: inherit; background: var(--card-bg, #fff); font: inherit; font-size: 0.68rem; text-align: center; }
	.music-library-toolbar select { min-height: 1.9rem; padding-block: 0.25rem; }
	.music-library-list { min-height: 12rem; margin-top: 0.55rem; overflow-y: auto; scrollbar-width: thin; padding-right: 0.5rem; }
	.music-library-row { display: flex; align-items: center; gap: 0.25rem; min-width: 0; padding-right: 0.35rem; }
	.music-library-row > .music-song { min-width: 0; flex: 1; }
	.music-library-row .music-search-favorite { flex: 0 0 2.1rem; margin-left: 0.45rem; }
	.music-pending-hint { padding: 0.12rem 0.45rem; border-radius: 999px; color: #c05640; background: color-mix(in oklch, #c05640 9%, transparent); font-size: 0.6rem; white-space: nowrap; }
	.music-library-empty { display: grid; min-height: 12rem; place-items: center; padding: 1rem; text-align: center; }
	.music-quiet--danger { color: #c05640; border-color: color-mix(in oklch, #c05640 36%, transparent); }
	.music-batch-check { display: grid; place-items: center; flex: 0 0 1.15rem; width: 1.15rem; height: 1.15rem; margin-right: 0.45rem; border: 1.5px solid var(--text-40, #94a3b8); border-radius: 50%; color: transparent; font-size: 0.7rem; line-height: 1; }
	.music-batch-check--on { border-color: var(--primary); color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); }
	.music-song--selected { border-color: color-mix(in oklch, var(--primary) 35%, transparent); background: color-mix(in oklch, var(--primary) 10%, transparent); }
	.music-library-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.7rem; margin-top: 0.7rem; padding-top: 0.7rem; border-top: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 75%, transparent); flex-wrap: wrap; }
	.music-library-footer .music-actions { display: flex; align-items: center; gap: 0.4rem; flex-direction: row; }
	.music-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding-top: 0.55rem; margin-top: 0.55rem; border-top: 1px dashed color-mix(in oklch, var(--card-border, #dce5e5) 70%, transparent); font-size: 0.74rem; }
	.music-setting-row span { display: grid; gap: 0.1rem; }
	.music-setting-row small { color: var(--text-45, rgb(148 163 184)); font-size: 0.62rem; }
	.music-setting-row select { min-height: 2rem; padding: 0.3rem 1.4rem 0.3rem 0.5rem; border: 1px solid var(--card-border, #dce5e5); border-radius: 0.55rem; color: inherit; background: var(--card-bg, #fff); font: inherit; font-size: 0.7rem; }
	.music-setting-row input[type="checkbox"] { width: 1.15rem; height: 1.15rem; accent-color: var(--primary); }
	@keyframes music-modal-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@keyframes music-fade-in { from { opacity: 0; } to { opacity: 1; } }
	.music-fullscreen { position: fixed; inset: 0; z-index: 990; display: flex; align-items: stretch; justify-content: center; overflow: hidden; overscroll-behavior: none; isolation: isolate; }
	.music-fullscreen__bg { position: absolute; inset: -3rem; background-size: cover; background-position: center; filter: blur(60px) saturate(1.35) brightness(0.85); opacity: 0.65; transform: scale(1.15); pointer-events: none; }
	.music-fullscreen__scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgb(10 15 24 / 0.6), rgb(8 12 20 / 0.92)); pointer-events: none; }
	.music-fullscreen__close { position: absolute; top: 1.1rem; right: 1.1rem; z-index: 2; display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border: 0; border-radius: 50%; color: var(--text-90, #e2e8f0); background: rgb(255 255 255 / 0.1); cursor: pointer; font-size: 1.3rem; backdrop-filter: blur(8px); transition: background 200ms ease, transform 200ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-fullscreen__close:hover { background: rgb(255 255 255 / 0.22); transform: scale(1.06); }
	.music-fullscreen__content { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(18rem, 26rem) minmax(20rem, 34rem); gap: clamp(1.5rem, 4vw, 4rem); align-items: center; width: min(72rem, 100%); padding: clamp(1.5rem, 4vw, 3.5rem); }
	.music-fullscreen__left { display: grid; gap: 1.1rem; justify-items: center; }
	.music-fullscreen__cover { width: min(22rem, 52vw); aspect-ratio: 1; border-radius: 1.3rem; object-fit: cover; box-shadow: 0 30px 70px -28px rgb(0 0 0 / 0.75); }
	.music-fullscreen__cover--empty { display: grid; place-items: center; color: var(--primary); background: color-mix(in oklch, var(--primary) 16%, transparent); font-size: 4.5rem; }
	.music-fullscreen__copy { display: grid; gap: 0.3rem; text-align: center; }
	.music-fullscreen__copy strong { max-width: 24rem; overflow: hidden; color: #f8fafc; font-size: 1.15rem; text-overflow: ellipsis; white-space: nowrap; }
	.music-fullscreen__copy span { color: rgb(203 213 225); font-size: 0.85rem; }
	.music-fullscreen__left .music-progress-row { width: 100%; max-width: 22rem; position: relative; z-index: 2; }
	.music-fullscreen__left .music-controls { margin-top: 0.9rem; position: relative; z-index: 3; }
	.music-fullscreen__left .music-icon-button { width: 2.6rem; height: 2.6rem; color: #fff; background: rgb(255 255 255 / 0.08); font-size: 1.25rem; backdrop-filter: blur(8px); }
	.music-fullscreen__left .music-icon-button:hover { color: var(--primary); background: color-mix(in oklch, var(--primary) 22%, transparent); }
	.music-fullscreen__left .music-icon-button.music-favorite--active,
	.music-fullscreen__left .music-icon-button.music-favorite--active:hover { color: #4fd1c5; background: color-mix(in oklch, #4fd1c5 22%, transparent); animation: music-heart-pop 420ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-fullscreen__left .music-play-button { width: 3.6rem; height: 3.6rem; font-size: 1.8rem; }
	.music-fullscreen__right { width: 100%; height: min(42rem, calc(100vh - 6rem)); min-height: 0; display: flex; justify-content: center; }
	.music-fullscreen__lyrics { box-sizing: border-box; width: 100%; height: 100%; max-width: 34rem; max-height: none; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; scroll-behavior: smooth; padding: 2.6rem 0.6rem; }
	.music-fullscreen__lyrics::-webkit-scrollbar { display: none; }
	.music-fullscreen__lyrics ul { display: grid; gap: 0.7rem; margin: 0; padding: 0; list-style: none; }
	.music-lyric--fullscreen { padding: 0.55rem 1rem; font-size: 1.3rem; line-height: 1.85; opacity: 0.42; }
	.music-fullscreen .music-lyric { color: rgb(226 232 240); }
	.music-fullscreen .music-lyric--active { color: var(--primary); opacity: 1; }
	.music-fullscreen .music-progress-row span { color: rgb(203 213 225); }
	.music-fullscreen .music-progress-row input { accent-color: var(--primary); }
	.music-fullscreen__empty { color: var(--text-50, rgb(148 163 184)); font-size: 0.9rem; text-align: center; }
	@media (max-width: 860px) {
		.music-fullscreen__content { grid-template-columns: 1fr; gap: 1.4rem; align-content: start; align-items: center; overflow-y: auto; text-align: center; }
		.music-fullscreen__cover { width: min(14rem, 60vw); }
		.music-fullscreen__right { width: 100%; height: min(40vh, 20rem); }
		.music-fullscreen__lyrics { max-height: none; padding: 1.2rem 0.4rem; }
		.music-lyric--fullscreen { font-size: 1.08rem; }
	}
	.music-panel__header h2 { margin: 0.15rem 0 0; font-size: 1.25rem; line-height: 1.2; }
	.music-kicker, .music-section-label { margin: 0; color: var(--primary); font-family: var(--font-mono, monospace); font-size: 0.62rem; letter-spacing: 0.13em; }
	.music-section-label { display: block; margin-bottom: 0.35rem; color: var(--text-50, rgb(100 116 139)); }
	.music-icon-button { display: inline-grid; place-items: center; width: 2.2rem; height: 2.2rem; padding: 0; border: 0; border-radius: 0.65rem; color: var(--text-60, rgb(71 85 105)); background: transparent; cursor: pointer; font-size: 1.25rem; transition: color 180ms ease, background 180ms ease, transform 180ms ease; }
	.music-icon-button:hover { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); transform: translateY(-1px); }
	.music-toast-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; background: rgb(8 12 20 / 0.32); animation: music-fade-in 150ms ease both; }
	.music-toast-card { display: grid; justify-items: center; gap: 0.6rem; width: min(20rem, calc(100vw - 3rem)); padding: 1.4rem 1.2rem; border-radius: 1.1rem; color: inherit; background: var(--card-bg, #fff); box-shadow: 0 24px 60px -24px rgb(15 23 42 / 0.55); animation: music-toast-in 240ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; text-align: center; }
	.music-toast-heart { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; font-size: 1.7rem; animation: music-toast-beat 900ms ease-in-out 2; }
	.music-toast-card--fav .music-toast-heart { color: #fff; background: var(--primary); }
	.music-toast-card--unfav .music-toast-heart { color: var(--text-45, rgb(148 163 184)); border: 1.5px dashed var(--text-40, #94a3b8); }
	.music-toast-card--error .music-toast-heart { color: #c05640; background: color-mix(in oklch, #c05640 10%, transparent); }
	.music-toast-card--info .music-toast-heart { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); }
	.music-toast-card strong { max-width: 100%; overflow-wrap: anywhere; font-size: 0.8rem; line-height: 1.5; }
	@keyframes music-toast-in { from { opacity: 0; transform: translateY(14px) scale(0.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@keyframes music-toast-beat { 0%, 100% { transform: scale(1) rotate(0deg); } 25% { transform: scale(1.18) rotate(-6deg); } 55% { transform: scale(0.94) rotate(5deg); } 80% { transform: scale(1.08) rotate(-3deg); } }
	.music-config-block, .music-player-core, .music-account-row, .music-vip-state { padding: 0.8rem; border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 80%, transparent); border-radius: 0.9rem; background: color-mix(in oklch, var(--card-bg, #fff) 70%, transparent); }
	.music-config-block--full { min-height: 38rem; align-content: start; }
	.music-config-block, .music-login-form { display: grid; gap: 0.7rem; }
	.music-muted, .music-status-line, .music-login-note { margin: 0; color: var(--text-50, rgb(100 116 139)); font-size: 0.72rem; line-height: 1.55; }
	.music-error { color: #c05640; }
	.music-field { display: grid; gap: 0.3rem; color: var(--text-60, rgb(71 85 105)); font-size: 0.7rem; }
	.music-field input, .music-field select { width: 100%; min-height: 2.25rem; padding: 0.45rem 0.65rem; border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 88%, transparent); border-radius: 0.6rem; outline: 0; color: inherit; background: color-mix(in oklch, var(--page-bg, #f8fafc) 70%, transparent); font: inherit; }
	.music-field input:focus, .music-field select:focus { border-color: color-mix(in oklch, var(--primary) 60%, var(--card-border, #dce5e5)); box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 14%, transparent); }
	.music-actions, .music-controls, .music-secondary-actions { display: flex; align-items: center; gap: 0.45rem; }
	.music-actions { flex-wrap: wrap; }
	.music-primary, .music-quiet { min-height: 2.25rem; padding: 0.45rem 0.75rem; border-radius: 0.6rem; font: inherit; font-size: 0.72rem; cursor: pointer; transition: transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), background 180ms ease, border-color 180ms ease; }
	.music-primary { border: 1px solid var(--primary); color: var(--primary-button-text, #fff); background: var(--primary); }
	.music-primary:hover:not(:disabled), .music-quiet:hover:not(:disabled) { transform: translateY(-1px); }
	.music-primary:disabled, .music-quiet:disabled { cursor: not-allowed; opacity: 0.5; }
	.music-primary--small { min-height: 2rem; }
	.music-quiet { border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 95%, transparent); color: var(--text-60, rgb(71 85 105)); background: transparent; }
	.music-now-playing { display: flex; align-items: center; gap: 0.75rem; }
	.music-cover { flex: 0 0 3.6rem; width: 3.6rem; height: 3.6rem; border-radius: 0.85rem; object-fit: cover; box-shadow: 0 8px 18px -12px rgb(15 23 42 / 0.7); }
	.music-cover--empty { display: grid; place-items: center; color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); font-size: 1.5rem; }
	.music-track-copy { min-width: 0; display: grid; gap: 0.12rem; }
	.music-track-copy .music-track-status { margin-bottom: 0.1rem; }
	.music-title-status { color: var(--text-40, rgb(148 163 184)); font-size: 0.58rem; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.2rem; }
	.music-track-copy strong, .music-track-copy span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.music-track-copy strong { font-size: 0.85rem; }
	.music-track-copy span:last-child { color: var(--text-50, rgb(100 116 139)); font-size: 0.72rem; }
	.music-track-status { display: inline-flex; align-items: center; gap: 0.35rem; }
	.music-favorite { flex: 0 0 auto; display: grid; place-items: center; width: 2.3rem; height: 2.3rem; margin-left: auto; padding: 0; border: 0; border-radius: 0.65rem; color: #fff; background: transparent; cursor: pointer; font-size: 1.3rem; transition: color 180ms ease, background 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-favorite:hover { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); transform: scale(1.06); }
	.music-favorite--active { color: var(--primary); animation: music-heart-pop 420ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	@keyframes music-heart-pop { 0% { transform: scale(0.7); } 45% { transform: scale(1.28); } 70% { transform: scale(0.92); } 100% { transform: scale(1); } }
	.music-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 0.7rem; }
	.music-eq i { display: block; width: 2.5px; border-radius: 2px; background: var(--primary); transform-origin: bottom; animation: music-eq-bounce 900ms ease-in-out infinite alternate; }
	.music-eq i:nth-child(2) { animation-delay: -300ms; }
	.music-eq i:nth-child(3) { animation-delay: -600ms; }
	.music-progress-row, .music-volume { display: grid; grid-template-columns: 2.3rem minmax(0, 1fr) 2.3rem; align-items: center; gap: 0.4rem; }
	.music-progress-row { margin-top: 0.85rem; color: var(--text-50, rgb(100 116 139)); font-family: var(--font-mono, monospace); font-size: 0.6rem; }
	.music-progress-row span:last-child { text-align: right; }
	input[type="range"] { width: 100%; accent-color: var(--primary); cursor: pointer; }
	.music-fullscreen__left .music-controls { margin-top: 0.9rem; gap: 0.7rem; }
	.music-mode-wrap { display: inline-flex; flex-direction: column; align-items: center; gap: 0.1rem; }
	.music-mode-label { color: var(--text-50, rgb(100 116 139)); font-size: 0.56rem; line-height: 1; letter-spacing: 0.04em; }
	.music-controls { margin-top: 0.55rem; justify-content: center; gap: 0.35rem; }
	.music-play-button { display: grid; place-items: center; width: 2.8rem; height: 2.8rem; border: 0; border-radius: 50%; color: #fff; background: var(--primary); cursor: pointer; font-size: 1.5rem; transition: transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 180ms ease; }
	.music-play-button:hover { transform: scale(1.05); }
	.music-play-button:active { transform: scale(0.94); }
	.music-play-button--playing { box-shadow: 0 0 0 4px color-mix(in oklch, var(--primary) 16%, transparent); }
	.music-mode-button--active { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); }
	.music-volume-row { margin-top: 0.55rem; }
	.music-volume { width: 100%; color: var(--text-50, rgb(100 116 139)); font-family: var(--font-mono, monospace); font-size: 0.66rem; }
	.music-volume-icon { display: grid; place-items: center; justify-self: start; width: 2.3rem; color: var(--text-60, rgb(71 85 105)); font-family: inherit; font-size: 1rem; }
	.music-volume-value { justify-self: end; min-width: 2.3rem; color: var(--text-50, rgb(100 116 139)); text-align: right; }
	.music-volume input { min-width: 0; }
	.music-account-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 0.65rem; }
	.music-account-row strong { display: block; max-width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
	.music-vip-state { display: flex; align-items: center; gap: 0.45rem; margin-top: 0.65rem; color: var(--text-50, rgb(100 116 139)); font-size: 0.7rem; }
	.music-state-dot { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #a3a3a3; }
	.music-vip-state--ok .music-state-dot { background: #36a269; box-shadow: 0 0 0 4px rgb(54 162 105 / 0.12); }
	.music-vip-state--risk .music-state-dot { background: #d18b3d; }
	.music-recommend-bar { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.75rem; margin-top: 0.65rem; padding: 0.8rem; border: 1px solid color-mix(in oklch, var(--primary) 18%, var(--card-border, #dce5e5)); border-radius: 0.9rem; background: color-mix(in oklch, var(--primary) 5%, var(--card-bg, #fff)); }
	.music-recommend-bar strong { display: block; margin-top: 0.2rem; font-size: 0.78rem; }
	.music-recommend-box { max-height: 14rem; margin-top: 0.45rem; padding: 0.35rem; overflow: auto; border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 80%, transparent); border-radius: 0.8rem; background: color-mix(in oklch, var(--page-bg, #f8fafc) 72%, transparent); }
	.music-recommend-list { display: grid; gap: 0.2rem; }
	.music-playlist-field { margin-top: 0.65rem; }
	.music-search-box { display: grid; gap: 0.25rem; margin-top: 0.75rem; }
	.music-search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.35rem; align-items: center; }
	.music-search-row input, .music-search-row select, .music-add-song-card select { min-width: 0; min-height: 2rem; padding: 0.35rem 0.5rem; border: 1px solid var(--card-border, #dce5e5); border-radius: 0.55rem; color: inherit; background: var(--card-bg, #fff); font: inherit; font-size: 0.68rem; }
	.music-search-message { margin: 0; color: var(--text-50, rgb(100 116 139)); font-size: 0.64rem; }
	.music-song-list { display: grid; gap: 0.25rem; max-height: 13rem; margin-top: 0.6rem; overflow-x: hidden; overflow-y: auto; scrollbar-width: none; }
	.music-song-list::-webkit-scrollbar { display: none; }
	.music-list-status { display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; padding: 0.35rem 0.15rem; }
	.music-list-status .music-muted { flex: 1; }
	.music-list-status .music-quiet { flex: 0 0 auto; }
	.music-song { position: relative; display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 2.75rem; padding: 0.48rem 0.55rem; border: 1px solid transparent; border-radius: 0.65rem; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 180ms ease, border-color 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-song:hover, .music-song--active { border-color: color-mix(in oklch, var(--primary) 20%, transparent); background: color-mix(in oklch, var(--primary) 8%, transparent); }
	.music-search-results { margin-top: 0.55rem; }
	.music-search-result { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
	.music-search-result .music-song { min-width: 0; flex: 1; }
	.music-search-favorite { display: grid; place-items: center; flex: 0 0 2.2rem; width: 2.2rem; height: 2.2rem; padding: 0; border: 1px solid color-mix(in oklch, var(--text-40, #94a3b8) 45%, transparent); border-radius: 0.6rem; color: var(--text-45, rgb(120 134 156)); background: var(--card-bg, #fff); cursor: pointer; font-size: 1.1rem; transition: color 180ms ease, background 180ms ease, border-color 180ms ease; }
	.music-search-favorite:hover { border-color: color-mix(in oklch, var(--primary) 30%, transparent); color: var(--primary); background: color-mix(in oklch, var(--primary) 8%, transparent); }
	.music-search-favorite--active { color: #fff; border-color: var(--primary); background: var(--primary); }
	.music-add-song-card { display: grid; gap: 0.55rem; margin-top: 0.6rem; padding: 0.7rem; border: 1px solid color-mix(in oklch, var(--primary) 22%, var(--card-border, #dce5e5)); border-radius: 0.75rem; background: color-mix(in oklch, var(--primary) 5%, transparent); }
	.music-add-song-card strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; }
	.music-song--active::before { position: absolute; left: -1px; top: 24%; bottom: 24%; width: 3px; border-radius: 3px; background: var(--primary); content: ""; }
	.music-song--active .music-song-index { color: var(--primary); }
	.music-song-cover { flex: 0 0 2.1rem; width: 2.1rem; height: 2.1rem; border-radius: 0.45rem; object-fit: cover; background: color-mix(in oklch, var(--primary) 10%, transparent); }
	.music-song-cover--empty { display: grid; place-items: center; color: var(--primary); font-size: 1rem; }
	.music-song-index { width: 1.6rem; color: var(--text-35, rgb(148 163 184)); font-family: var(--font-mono, monospace); font-size: 0.62rem; }
	.music-song-info { min-width: 0; display: grid; flex: 1; gap: 0.08rem; }
	.music-song-info strong, .music-song-info small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.music-song-info strong { font-size: 0.74rem; font-weight: 650; }
	.music-song-info small { color: var(--text-50, rgb(100 116 139)); font-size: 0.64rem; }
	.music-song > :global(svg) { color: var(--primary); font-size: 1.1rem; }
	.music-secondary-actions { justify-content: flex-end; margin-top: 0.5rem; }
	.music-lyrics { max-height: 15rem; margin-top: 0.55rem; padding: 3.2rem 0.45rem; overflow: auto; scroll-padding-block: 5.5rem; scroll-behavior: smooth; scrollbar-width: none; border: 1px solid color-mix(in oklch, var(--primary) 10%, var(--card-border, #dce5e5)); border-radius: 0.9rem; background: linear-gradient(180deg, color-mix(in oklch, var(--primary) 4%, var(--page-bg, #f8fafc)), color-mix(in oklch, var(--page-bg, #f8fafc) 90%, transparent)); }
	.music-lyrics::-webkit-scrollbar { display: none; }
	.music-lyrics ul { display: grid; gap: 0.22rem; margin: 0; padding: 0; list-style: none; }
	.music-lyric { display: block; width: 100%; padding: 0.42rem 0.72rem; border: 0; border-radius: 0.55rem; color: var(--text-40, rgb(148 163 184)); background: transparent; font: inherit; font-size: 0.76rem; line-height: 1.75; opacity: 0.52; transform: scale(0.98); text-align: center; cursor: pointer; transition: color 220ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), background 220ms ease, opacity 220ms ease, transform 220ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-lyric:disabled { cursor: default; }
		.music-lyric--past { opacity: 0.38; }
		.music-lyric--next { color: var(--text-60, rgb(71 85 105)); opacity: 0.7; }
		.music-lyric--active { color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); font-size: 0.86rem; font-weight: 700; opacity: 1; transform: scale(1); }
	.music-login-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 1rem; background: rgb(15 23 42 / 0.28); backdrop-filter: blur(5px); }
	.music-login-card { width: min(27rem, 100%); max-height: calc(100vh - 2rem); padding: 1.25rem 1.35rem 1.15rem; overflow: auto; border: 1px solid color-mix(in oklch, var(--primary) 25%, var(--card-border, #dce5e5)); border-radius: 1.2rem; background: var(--card-bg, #fff); box-shadow: 0 30px 80px -35px rgb(15 23 42 / 0.65); animation: music-panel-in 280ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }
	.music-login-card > .music-panel__header { margin-bottom: 1.05rem; }
	.music-login-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.25rem; padding: 0.25rem; border-radius: 0.75rem; background: color-mix(in oklch, var(--primary) 7%, var(--page-bg, #f8fafc)); }
	.music-login-tabs button { min-height: 2.1rem; border: 0; border-radius: 0.55rem; color: var(--text-50, rgb(100 116 139)); background: transparent; font: inherit; font-size: 0.7rem; cursor: pointer; }
	.music-login-tab--active { color: var(--primary) !important; background: var(--card-bg, #fff) !important; box-shadow: 0 5px 12px -10px rgb(15 23 42 / 0.55); }
	.music-qr-block { display: grid; justify-items: center; gap: 0.85rem; padding: 1.25rem 0 0.75rem; text-align: center; }
	.music-qr-block img { width: 13rem; height: 13rem; padding: 0.45rem; border-radius: 0.8rem; background: #fff; }
	.music-qr-empty { display: grid; place-items: center; gap: 0.55rem; width: 13rem; height: 13rem; border: 1px dashed color-mix(in oklch, var(--primary) 35%, var(--card-border, #dce5e5)); border-radius: 0.8rem; color: var(--primary); font-size: 2.4rem; }
	.music-qr-empty span { color: var(--text-50, rgb(100 116 139)); font-size: 0.68rem; }
	.music-qr-block p { margin: 0; color: var(--text-60, rgb(71 85 105)); font-size: 0.72rem; }
	.music-code-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.5rem; }
	.music-account-options { display: grid; gap: 0.4rem; }
	.music-login-note { margin: 1rem 0 0; padding: 0 0.35rem; text-align: center; line-height: 1.6; }

	:global(.dark) .music-dock-trigger, :global(.dark) .music-panel { color: var(--text-90, rgb(226 232 240)); background: color-mix(in oklch, var(--card-bg, #172033) 90%, transparent); }
	:global(.dark) .music-muted, :global(.dark) .music-status-line, :global(.dark) .music-login-note { color: rgb(160 174 192); }
	:global(.dark) .music-title-status { color: rgb(148 163 184); }
	:global(.dark) .music-song-info small { color: rgb(165 180 195); }
	:global(.dark) .music-login-card { background: var(--card-bg, #172033); }
	:global(.dark) .music-field input, :global(.dark) .music-field select { background: rgb(255 255 255 / 0.05); }

	@keyframes music-panel-in { from { opacity: 0; transform: translateY(0.55rem) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@keyframes music-eq-bounce { from { transform: scaleY(0.45); } to { transform: scaleY(1); } }
	@keyframes music-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--primary) 12%, transparent); } }
	@keyframes music-spin { to { transform: rotate(360deg); } }
	@media (min-width: 641px) {
		.music-panel { scrollbar-width: none; }
		.music-panel::-webkit-scrollbar { display: none; }
	}
	@media (max-width: 640px) {
		.music-dock { right: 0; bottom: 0; left: 0; width: 100%; padding: 0 0.7rem 0.7rem; }
		.music-dock-trigger { width: 100%; min-height: 3.75rem; padding: 0.55rem 0.7rem 0.55rem 0.6rem; border-radius: 1rem; }
		.music-trigger-copy { display: flex; }
		:global(.music-trigger-chevron) { display: inline; }
		.music-panel { max-height: min(74vh, calc(100vh - 5.5rem)); margin-bottom: 0.65rem; padding: 1rem; border-radius: 1.4rem 1.4rem 0 0; }
		.music-panel::before { content: ""; display: block; width: 2.75rem; height: 0.28rem; margin: 0 auto 0.8rem; border-radius: 999px; background: color-mix(in oklch, var(--text-40, #94a3b8) 45%, transparent); }
		.music-volume-row { display: none; }
		.music-song { min-height: 3rem; }
		.music-play-button { width: 3.1rem; height: 3.1rem; font-size: 1.6rem; }
		.music-icon-button { width: 2.5rem; height: 2.5rem; }
	}
	@media (prefers-reduced-motion: reduce) { .music-panel, .music-login-card { animation: none; } .music-trigger-pulse, .music-trigger-cover { animation: none; } .music-eq i { animation: none; } .music-dock-trigger, .music-play-button, .music-song, .music-icon-button, .music-primary, .music-quiet, .music-favorite { transition: none; } }
</style>
