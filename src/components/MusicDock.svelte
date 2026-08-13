<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "@iconify/svelte";
	import {
		getShanghaiDateKey,
		MusicApiClient,
		MusicApiError,
		MUSIC_BFF_ORIGIN,
		normalizeApiBaseUrl,
		responseData,
		responseErrorCode,
		runDailyVipFlow,
		type MusicSession,
		type MusicPlaylist,
		type MusicSong,
	} from "@utils/music-api";

	type ApiStatus = "idle" | "connecting" | "ready" | "error";
	type LoginMode = "qr" | "phone" | "password";
	type VipState = "idle" | "checking" | "claimed" | "risk" | "error";

	const VIP_DATE_PREFIX = "hengduo-music-vip-date:";
	const FAVORITES_KEY = "hengduo-music-favorites";
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
	let currentSong: MusicSong | null = null;
	let currentSongLoading = "";
	let audio: HTMLAudioElement | null = null;
	let isPlaying = false;
	let currentTime = 0;
	let duration = 0;
	let volume = 0.7;
	let lyricsOpen = false;
	let lyricsLoading = false;
	let lyricsLines: Array<{ time: number | null; text: string }> = [];
	let activeLyricIndex = -1;
	let lyricsMessage = "点击“歌词”加载当前歌曲歌词";
	let vipState: VipState = "idle";
	let vipMessage = "登录后自动检查今日权益";
	let notice = "";
	let favorites: Set<string> = new Set();
	let shuffleEnabled = false;
	let repeatMode: "list" | "one" | "off" = "list";
	let playGeneration = 0;
	let qrTimer: ReturnType<typeof setInterval> | null = null;
	let qrBusy = false;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;

	$: apiConfigured = Boolean(apiUrl.trim());
	$: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
	$: dockLabel = currentSong ? `${currentSong.name} · ${currentSong.author}` : "连接你的音乐平台";
	$: currentIndex = songs.findIndex((song) => song.hash === currentSong?.hash);
	$: isFavorite = currentSong ? favorites.has(currentSong.hash) : false;

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

	const errorCode = (error: unknown): number | string | undefined => {
		if (error instanceof MusicApiError && error.code !== undefined) return error.code;
		return responseErrorCode(error);
	};

	const errorMessage = (error: unknown, fallback: string): string => {
		const code = errorCode(error);
		if (String(code) === "131001") return "今日已经领取过 VIP";
		if (String(code) === "20028") return "当前账号需要在酷狗官方客户端完成验证";
		if (error instanceof MusicApiError && error.message) return error.message;
		return fallback;
	};

	const clearQrTimer = () => {
		if (qrTimer) clearInterval(qrTimer);
		qrTimer = null;
		qrBusy = false;
	};

	const clearCountdown = () => {
		if (countdownTimer) clearInterval(countdownTimer);
		countdownTimer = null;
	};

	const setNotice = (message: string) => {
		notice = message;
		window.setTimeout(() => {
			if (notice === message) notice = "";
		}, 4200);
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

	const playSong = async (song: MusicSong) => {
		if (!client || !auth || !audio) {
			showLogin = true;
			return;
		}
		const generation = ++playGeneration;
		currentSongLoading = song.hash;
		setNotice(`正在连接 BFF 播放流：「${song.name}」`);
		try {
			const audioUrl = await client.getStreamUrl(song.hash);
			if (!audioUrl) throw new MusicApiError("BFF 播放流不可用");
			currentSong = song;
			audio.src = audioUrl;
			audio.currentTime = 0;
			await audio.play();
			if (generation !== playGeneration) return;
			updateMediaSession();
			scrollActiveTrackIntoView();
			void claimDailyVip();
		} catch (error) {
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

	const togglePlay = async () => {
		if (!audio) return;
		if (!currentSong) {
			if (songs[0]) await playSong(songs[0]);
			else showLogin = true;
			return;
		}
		if (audio.paused) await audio.play();
		else audio.pause();
	};

	const playNext = async () => {
		if (!currentSong || songs.length === 0) return;
		if (shuffleEnabled && songs.length > 1) {
			let nextIndex = Math.floor(Math.random() * songs.length);
			const currentIndexNow = songs.findIndex((song) => song.hash === currentSong?.hash);
			if (nextIndex === currentIndexNow) nextIndex = (nextIndex + 1) % songs.length;
			await playSong(songs[nextIndex]);
			return;
		}
		const index = songs.findIndex((song) => song.hash === currentSong?.hash);
		await playSong(songs[(index + 1) % songs.length]);
	};

	const toggleFavorite = () => {
		if (!currentSong) return;
		const next = new Set(favorites);
		if (next.has(currentSong.hash)) {
			next.delete(currentSong.hash);
			setNotice("已取消收藏当前歌曲");
		} else {
			next.add(currentSong.hash);
			setNotice("已收藏当前歌曲");
		}
		favorites = next;
		localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
	};

	const toggleShuffle = () => {
		shuffleEnabled = !shuffleEnabled;
		localStorage.setItem(SHUFFLE_KEY, shuffleEnabled ? "1" : "0");
		setNotice(shuffleEnabled ? "随机播放已开启" : "随机播放已关闭");
	};

	const cycleRepeat = () => {
		repeatMode = repeatMode === "list" ? "one" : repeatMode === "one" ? "off" : "list";
		localStorage.setItem(REPEAT_KEY, repeatMode);
		setNotice(repeatMode === "list" ? "列表循环" : repeatMode === "one" ? "单曲循环" : "顺序播放");
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

	const parseLyrics = (raw: string): Array<{ time: number | null; text: string }> => {
		return raw
			.split(/\r?\n/)
			.map((line) => {
				const trimmed = line.trim();
				if (!trimmed) return null;
				const match = trimmed.match(/^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
				if (!match) return { time: null, text: trimmed.slice(0, 200) };
				const time =
					Number(match[1]) * 60 +
					Number(match[2]) +
					Number(match[3] ?? 0) / (match[3]?.length === 3 ? 1000 : 100);
				return { time, text: match[4].trim().slice(0, 200) };
			})
			.filter((x): x is { time: number | null; text: string } => x !== null && x.text !== "")
			.slice(0, 120);
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
		if (idx === activeLyricIndex) return;
		activeLyricIndex = idx;
		requestAnimationFrame(() => {
			const container = document.querySelector<HTMLElement>(".music-lyrics");
			const active = container?.querySelector<HTMLElement>(".music-lyric--active");
			active?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	};

	const loadLyrics = async () => {
		if (!client || !currentSong) return;
		lyricsOpen = true;
		lyricsLoading = true;
		lyricsMessage = "正在加载歌词…";
		try {
			lyricsLines = parseLyrics(await client.getLyrics(currentSong.hash));
			lyricsMessage = lyricsLines.length > 0 ? "" : "没有返回可显示的歌词";
		} catch (error) {
			lyricsLines = [];
			lyricsMessage = errorMessage(error, "歌词加载失败");
		} finally {
			lyricsLoading = false;
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
		loginBusy = true;
		loginMessage = "正在生成二维码…";
		try {
			const qr = await client.createQr();
			qrKey = qr.key;
			qrImage = qr.image;
			qrMessage = "请使用酷狗客户端扫码";
			loginBusy = false;
			qrTimer = setInterval(async () => {
				if (qrBusy || !client || !qrKey) return;
				qrBusy = true;
				try {
					const payload = await client.checkQr(qrKey);
					const data = responseData<any>(payload);
					const nestedData = data?.data ?? payload?.data ?? {};
					const state = Number(data?.status ?? nestedData?.status ?? payload?.status ?? 0);
					if (state === 4) {
						clearQrTimer();
						await setSession({ userid: data?.userid ?? nestedData?.userid, nickname: data?.nickname ?? nestedData?.nickname, pic: data?.pic ?? nestedData?.pic });
						return;
					}
					if (state === 2) qrMessage = `${data?.nickname ?? nestedData?.nickname ?? "用户"} 已扫码，等待确认`;
					if (state === 0) {
						clearQrTimer();
						qrMessage = "二维码已过期，请重新生成";
					}
				} catch (error) {
					clearQrTimer();
					loginMessage = errorMessage(error, "二维码状态检查失败");
				} finally {
					qrBusy = false;
				}
			}, 1200);
		} catch (error) {
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
		apiUrl = normalizeApiBaseUrl(isDev && devApiUrl ? devApiUrl : MUSIC_BFF_ORIGIN);
		const savedVolume = Number(localStorage.getItem("hengduo-music-volume"));
		if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) volume = savedVolume;
		try {
			const savedFavorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
			if (Array.isArray(savedFavorites)) favorites = new Set(savedFavorites.filter((item) => typeof item === "string"));
		} catch {
			favorites = new Set();
		}
		shuffleEnabled = localStorage.getItem(SHUFFLE_KEY) === "1";
		const savedRepeat = localStorage.getItem(REPEAT_KEY);
		repeatMode = savedRepeat === "one" || savedRepeat === "off" ? savedRepeat : "list";
		audio = new Audio();
		audio.crossOrigin = "use-credentials";
		audio.preload = "metadata";
		audio.volume = volume;
		audio.addEventListener("timeupdate", () => {
			currentTime = audio?.currentTime ?? 0;
			updateActiveLyric();
		});
		audio.addEventListener("loadedmetadata", () => (duration = audio?.duration ?? 0));
		audio.addEventListener("play", () => (isPlaying = true));
		audio.addEventListener("pause", () => (isPlaying = false));
		audio.addEventListener("ended", () => {
			if (repeatMode === "one" && currentSong) {
				audio.currentTime = 0;
				void audio.play();
				return;
			}
			if (repeatMode === "off") {
				const index = songs.findIndex((song) => song.hash === currentSong?.hash);
				if (index === songs.length - 1) return;
			}
			void playNext();
		});
		audio.addEventListener("error", () => setNotice("音频地址已失效，请重新点击歌曲"));

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
			audio?.pause();
		};
	});
</script>

<div class:music-dock--open={expanded} class="music-dock">
	{#if expanded}
		<section class="music-panel" aria-label="音乐播放器">
			<header class="music-panel__header">
				<div>
					<p class="music-kicker">PERSONAL RADIO</p>
					<h2>音乐空间</h2>
				</div>
				<button class="music-icon-button" type="button" aria-label="关闭音乐面板" on:click={() => (expanded = false)}>
					<Icon icon="material-symbols:close-rounded" />
				</button>
			</header>

			{#if notice}
				<div class="music-notice" role="status">{notice}</div>
			{/if}

			{#if apiStatus !== "ready" || showSettings}
				<div class="music-config-block">
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
							<button class:music-favorite--active={isFavorite} class="music-favorite" type="button" aria-label={isFavorite ? "取消收藏" : "收藏当前歌曲"} title={isFavorite ? "取消收藏" : "收藏"} on:click={toggleFavorite}>
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
						<button class:music-mode-button--active={shuffleEnabled} class="music-icon-button music-mode-button" type="button" aria-label={shuffleEnabled ? "关闭随机播放" : "开启随机播放"} title="随机播放" on:click={toggleShuffle}><Icon icon="material-symbols:shuffle-rounded" /></button>
						<button class="music-icon-button" type="button" aria-label="上一首" on:click={playPrevious}><Icon icon="material-symbols:skip-previous-rounded" /></button>
						<button class:music-play-button--playing={isPlaying} class="music-play-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} on:click={togglePlay}>
							<Icon icon={isPlaying ? "material-symbols:pause-rounded" : "material-symbols:play-arrow-rounded"} />
						</button>
						<button class="music-icon-button" type="button" aria-label="下一首" on:click={playNext}><Icon icon="material-symbols:skip-next-rounded" /></button>
						<button class:music-mode-button--active={repeatMode !== "list"} class="music-icon-button music-mode-button" type="button" aria-label={repeatMode === "list" ? "切换到单曲循环" : repeatMode === "one" ? "切换到顺序播放" : "切换到列表循环"} title={repeatMode === "one" ? "单曲循环" : repeatMode === "off" ? "顺序播放" : "列表循环"} on:click={cycleRepeat}>
							<Icon icon={repeatMode === "one" ? "material-symbols:repeat-one-rounded" : "material-symbols:repeat-rounded"} />
						</button>
					</div>
					<div class="music-volume-row">
						<label class="music-volume" aria-label="音量">
							<span class="music-volume-icon" aria-hidden="true"><Icon icon="material-symbols:volume-up-rounded" /></span>
							<input aria-label="调整音量" type="range" min="0" max="100" value={volume * 100} on:input={changeVolume} />
							<span class="music-volume-value" aria-hidden="true">{Math.round(volume * 100)}%</span>
						</label>
					</div>
				</div>

				<div class="music-account-row">
					<div>
						<span class="music-section-label">ACCOUNT / ACCESS</span>
						<strong>{auth ? (auth.nickname ?? `酷狗用户 ${auth.userid}`) : "未登录"}</strong>
					</div>
					<div class="music-actions">
						{#if auth}
							<button class="music-quiet" type="button" on:click={() => void claimDailyVip()}>{vipState === "checking" ? "检查中…" : "检查今日 VIP"}</button>
							<button class="music-quiet" type="button" on:click={logout}>退出</button>
						{:else}
							<button class="music-primary music-primary--small" type="button" on:click={() => (showLogin = true)}>登录酷狗</button>
						{/if}
						<button class="music-icon-button" type="button" aria-label="音乐服务设置" on:click={() => (showSettings = true)}><Icon icon="material-symbols:tune-rounded" /></button>
					</div>
				</div>
				<div class="music-vip-state" class:music-vip-state--ok={vipState === "claimed"} class:music-vip-state--risk={vipState === "risk"}>
					<span class="music-state-dot"></span>
					<span>{vipMessage}</span>
				</div>

				{#if auth}
					<label class="music-field music-playlist-field">
						<span>我的歌单</span>
						<select bind:value={selectedPlaylistId} on:change={onPlaylistChange}>
							{#each playlists as playlist}
								<option value={String(playlist.listid)}>{playlist.name}</option>
							{/each}
						</select>
					</label>
					<div class="music-song-list" aria-label="歌曲列表">
						{#if songsLoading}
							<p class="music-muted">正在读取歌单…</p>
						{:else if songsMessage}
							<div class="music-list-status">
								<p class="music-muted">{songsMessage}</p>
								<button class="music-quiet" type="button" on:click={() => void retryMusicLibrary()}>{playlists.length ? "重新加载歌曲" : "重新加载歌单"}</button>
							</div>
						{/if}
						{#each songs.slice(0, 30) as song}
							<button class:music-song--active={currentSong?.hash === song.hash} class="music-song" type="button" on:click={() => void playSong(song)}>
								<span class="music-song-index">{currentSongLoading === song.hash ? "…" : String(songs.indexOf(song) + 1).padStart(2, "0")}</span>
								{#if song.img}
									<img class="music-song-cover" src={song.img} alt="" loading="lazy" />
								{:else}
									<span class="music-song-cover music-song-cover--empty"><Icon icon="material-symbols:music-note-rounded" /></span>
								{/if}
								<span class="music-song-info"><strong>{song.name}</strong><small>{song.author}</small></span>
								<Icon icon={currentSongLoading === song.hash ? "material-symbols:more-horiz-rounded" : currentSong?.hash === song.hash && isPlaying ? "material-symbols:graphic-eq-rounded" : "material-symbols:play-arrow-rounded"} />
							</button>
						{/each}
					</div>
					<div class="music-secondary-actions">
						<button class="music-quiet" type="button" disabled={!currentSong || lyricsLoading} on:click={() => void loadLyrics()}>{lyricsLoading ? "歌词加载中…" : "歌词"}</button>
						{#if lyricsOpen}
							<button class="music-quiet" type="button" on:click={() => (lyricsOpen = false)}>收起歌词</button>
						{/if}
					</div>
					{#if lyricsOpen}
						<div class="music-lyrics" aria-live="polite">
							{#if lyricsLines.length > 0}
								<ul>
									{#each lyricsLines as line, i (i)}
										<li class:music-lyric--active={i === activeLyricIndex} class="music-lyric">{line.text}</li>
									{/each}
								</ul>
							{:else}
								<p class="music-muted">{lyricsMessage}</p>
							{/if}
						</div>
					{/if}
				{/if}
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
		</section>
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

	.music-panel { position: relative; max-height: min(38rem, calc(100vh - 6rem)); margin-bottom: 0.65rem; padding: 1rem; border-radius: 1.25rem; overflow: auto; animation: music-panel-in 280ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }
	.music-panel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.85rem; }
	.music-panel__header h2 { margin: 0.15rem 0 0; font-size: 1.25rem; line-height: 1.2; }
	.music-kicker, .music-section-label { margin: 0; color: var(--primary); font-family: var(--font-mono, monospace); font-size: 0.62rem; letter-spacing: 0.13em; }
	.music-section-label { display: block; margin-bottom: 0.35rem; color: var(--text-50, rgb(100 116 139)); }
	.music-icon-button { display: inline-grid; place-items: center; width: 2.2rem; height: 2.2rem; padding: 0; border: 0; border-radius: 0.65rem; color: var(--text-60, rgb(71 85 105)); background: transparent; cursor: pointer; font-size: 1.25rem; transition: color 180ms ease, background 180ms ease, transform 180ms ease; }
	.music-icon-button:hover { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); transform: translateY(-1px); }
	.music-notice { margin-bottom: 0.75rem; padding: 0.55rem 0.7rem; border-radius: 0.65rem; color: var(--primary); background: color-mix(in oklch, var(--primary) 9%, transparent); font-size: 0.72rem; }
	.music-config-block, .music-player-core, .music-account-row, .music-vip-state { padding: 0.8rem; border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 80%, transparent); border-radius: 0.9rem; background: color-mix(in oklch, var(--card-bg, #fff) 70%, transparent); }
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
	.music-track-copy strong, .music-track-copy span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.music-track-copy strong { font-size: 0.85rem; }
	.music-track-copy span:last-child { color: var(--text-50, rgb(100 116 139)); font-size: 0.72rem; }
	.music-track-status { display: inline-flex; align-items: center; gap: 0.35rem; }
	.music-favorite { flex: 0 0 auto; display: grid; place-items: center; width: 2.3rem; height: 2.3rem; margin-left: auto; padding: 0; border: 0; border-radius: 0.65rem; color: var(--text-45, rgb(148 163 184)); background: transparent; cursor: pointer; font-size: 1.3rem; transition: color 180ms ease, background 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-favorite:hover { color: var(--primary); background: color-mix(in oklch, var(--primary) 10%, transparent); transform: scale(1.06); }
	.music-favorite--active { color: var(--primary); }
	.music-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 0.7rem; }
	.music-eq i { display: block; width: 2.5px; border-radius: 2px; background: var(--primary); transform-origin: bottom; animation: music-eq-bounce 900ms ease-in-out infinite alternate; }
	.music-eq i:nth-child(2) { animation-delay: -300ms; }
	.music-eq i:nth-child(3) { animation-delay: -600ms; }
	.music-progress-row, .music-volume { display: grid; grid-template-columns: 2.3rem minmax(0, 1fr) 2.3rem; align-items: center; gap: 0.4rem; }
	.music-progress-row { margin-top: 0.85rem; color: var(--text-50, rgb(100 116 139)); font-family: var(--font-mono, monospace); font-size: 0.6rem; }
	.music-progress-row span:last-child { text-align: right; }
	input[type="range"] { width: 100%; accent-color: var(--primary); cursor: pointer; }
	.music-controls { margin-top: 0.55rem; justify-content: center; }
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
	.music-playlist-field { margin-top: 0.65rem; }
	.music-song-list { display: grid; gap: 0.25rem; max-height: 13rem; margin-top: 0.6rem; overflow: auto; }
	.music-list-status { display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; padding: 0.35rem 0.15rem; }
	.music-list-status .music-muted { flex: 1; }
	.music-list-status .music-quiet { flex: 0 0 auto; }
	.music-song { position: relative; display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 2.75rem; padding: 0.48rem 0.55rem; border: 1px solid transparent; border-radius: 0.65rem; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 180ms ease, border-color 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-song:hover, .music-song--active { border-color: color-mix(in oklch, var(--primary) 20%, transparent); background: color-mix(in oklch, var(--primary) 8%, transparent); }
	.music-song:hover { transform: translateX(2px); }
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
	.music-lyrics { max-height: 12rem; margin-top: 0.55rem; padding: 0.45rem; overflow: auto; border-radius: 0.7rem; background: color-mix(in oklch, var(--page-bg, #f8fafc) 82%, transparent); }
	.music-lyrics ul { display: grid; gap: 0.15rem; margin: 0; padding: 0; list-style: none; }
	.music-lyric { padding: 0.32rem 0.55rem; border-radius: 0.45rem; color: var(--text-60, rgb(71 85 105)); font-size: 0.74rem; line-height: 1.7; transition: color 180ms ease, background 180ms ease; }
	.music-lyric--active { color: var(--primary); background: color-mix(in oklch, var(--primary) 9%, transparent); font-weight: 600; }
	.music-login-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 1rem; background: rgb(15 23 42 / 0.28); backdrop-filter: blur(5px); }
	.music-login-card { width: min(27rem, 100%); max-height: calc(100vh - 2rem); padding: 1rem; overflow: auto; border: 1px solid color-mix(in oklch, var(--primary) 25%, var(--card-border, #dce5e5)); border-radius: 1.2rem; background: var(--card-bg, #fff); box-shadow: 0 30px 80px -35px rgb(15 23 42 / 0.65); animation: music-panel-in 280ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }
	.music-login-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.25rem; padding: 0.25rem; border-radius: 0.75rem; background: color-mix(in oklch, var(--primary) 7%, var(--page-bg, #f8fafc)); }
	.music-login-tabs button { min-height: 2.1rem; border: 0; border-radius: 0.55rem; color: var(--text-50, rgb(100 116 139)); background: transparent; font: inherit; font-size: 0.7rem; cursor: pointer; }
	.music-login-tab--active { color: var(--primary) !important; background: var(--card-bg, #fff) !important; box-shadow: 0 5px 12px -10px rgb(15 23 42 / 0.55); }
	.music-qr-block { display: grid; justify-items: center; gap: 0.65rem; padding: 1rem 0 0.35rem; text-align: center; }
	.music-qr-block img { width: 11rem; height: 11rem; padding: 0.45rem; border-radius: 0.8rem; background: #fff; }
	.music-qr-empty { display: grid; place-items: center; gap: 0.4rem; width: 11rem; height: 11rem; border: 1px dashed color-mix(in oklch, var(--primary) 35%, var(--card-border, #dce5e5)); border-radius: 0.8rem; color: var(--primary); font-size: 2.2rem; }
	.music-qr-empty span { color: var(--text-50, rgb(100 116 139)); font-size: 0.68rem; }
	.music-qr-block p { margin: 0; color: var(--text-60, rgb(71 85 105)); font-size: 0.72rem; }
	.music-code-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.5rem; }
	.music-account-options { display: grid; gap: 0.4rem; }
	.music-login-note { margin-top: 0.75rem; text-align: center; }

	:global(.dark) .music-dock-trigger, :global(.dark) .music-panel { color: var(--text-90, rgb(226 232 240)); background: color-mix(in oklch, var(--card-bg, #172033) 90%, transparent); }
	:global(.dark) .music-login-card { background: var(--card-bg, #172033); }
	:global(.dark) .music-field input, :global(.dark) .music-field select { background: rgb(255 255 255 / 0.05); }

	@keyframes music-panel-in { from { opacity: 0; transform: translateY(0.55rem) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@keyframes music-eq-bounce { from { transform: scaleY(0.45); } to { transform: scaleY(1); } }
	@keyframes music-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--primary) 12%, transparent); } }
	@keyframes music-spin { to { transform: rotate(360deg); } }
	@media (max-width: 640px) {
		.music-dock { right: 0; bottom: 0; left: 0; width: 100%; padding: 0 0.7rem 0.7rem; }
		.music-dock-trigger { width: 100%; min-height: 3.75rem; padding: 0.55rem 0.7rem 0.55rem 0.6rem; border-radius: 1rem; }
		.music-trigger-copy { display: flex; }
		:global(.music-trigger-chevron) { display: inline; }
		.music-panel { max-height: min(74vh, calc(100vh - 5.5rem)); margin-bottom: 0.65rem; border-radius: 1.4rem 1.4rem 0 0; }
		.music-panel::before { content: ""; display: block; width: 2.75rem; height: 0.28rem; margin: 0 auto 0.8rem; border-radius: 999px; background: color-mix(in oklch, var(--text-40, #94a3b8) 45%, transparent); }
		.music-volume-row { display: none; }
		.music-song { min-height: 3rem; }
		.music-play-button { width: 3.1rem; height: 3.1rem; font-size: 1.6rem; }
		.music-icon-button { width: 2.5rem; height: 2.5rem; }
	}
	@media (prefers-reduced-motion: reduce) { .music-panel, .music-login-card { animation: none; } .music-trigger-pulse, .music-trigger-cover { animation: none; } .music-eq i { animation: none; } .music-dock-trigger, .music-play-button, .music-song, .music-icon-button, .music-primary, .music-quiet, .music-favorite { transition: none; } }
</style>
