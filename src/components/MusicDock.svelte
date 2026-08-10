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
	let lyricsText = "";
	let lyricsMessage = "点击“歌词”加载当前歌曲歌词";
	let vipState: VipState = "idle";
	let vipMessage = "登录后自动检查今日权益";
	let notice = "";
	let qrTimer: ReturnType<typeof setInterval> | null = null;
	let qrBusy = false;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;

	$: apiConfigured = Boolean(apiUrl.trim());
	$: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
	$: dockLabel = currentSong ? `${currentSong.name} · ${currentSong.author}` : "连接你的音乐平台";

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
		await claimDailyVip();
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
		currentSongLoading = song.hash;
		setNotice(`正在连接 BFF 播放流：「${song.name}」`);
		try {
			const audioUrl = await client.getStreamUrl(song.hash);
			if (!audioUrl) throw new MusicApiError("BFF 播放流不可用");
			currentSong = song;
			audio.src = audioUrl;
			audio.currentTime = 0;
			await audio.play();
			updateMediaSession();
			void claimDailyVip();
		} catch (error) {
			setNotice(errorMessage(error, "BFF 播放流连接失败"));
		} finally {
			currentSongLoading = "";
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
		const index = songs.findIndex((song) => song.hash === currentSong?.hash);
		await playSong(songs[(index + 1) % songs.length]);
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

	const parseLyrics = (raw: string): string => {
		return raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.replace(/^\[[^\]]+\]/, "").trim())
			.filter(Boolean)
			.slice(0, 120)
			.join("\n");
	};

	const loadLyrics = async () => {
		if (!client || !currentSong) return;
		lyricsOpen = true;
		lyricsLoading = true;
		lyricsMessage = "正在加载歌词…";
		try {
			lyricsText = parseLyrics(await client.getLyrics(currentSong.hash));
			lyricsMessage = lyricsText ? "" : "没有返回可显示的歌词";
		} catch (error) {
			lyricsText = "";
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
		audio = new Audio();
		audio.crossOrigin = "use-credentials";
		audio.preload = "metadata";
		audio.volume = volume;
		audio.addEventListener("timeupdate", () => (currentTime = audio?.currentTime ?? 0));
		audio.addEventListener("loadedmetadata", () => (duration = audio?.duration ?? 0));
		audio.addEventListener("play", () => (isPlaying = true));
		audio.addEventListener("pause", () => (isPlaying = false));
		audio.addEventListener("ended", () => void playNext());
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
							<span class="music-status-line">{apiStatus === "ready" ? "SERVICE ONLINE" : "SERVICE OFFLINE"}</span>
							<strong>{currentSong?.name ?? "还没有开始播放"}</strong>
							<span>{currentSong?.author ?? "登录后读取你的歌单"}</span>
						</div>
					</div>

					<div class="music-progress-row">
						<span>{formatTime(currentTime)}</span>
						<input aria-label="播放进度" type="range" min="0" max="100" value={progressPercent} on:input={seek} />
						<span>{formatTime(duration)}</span>
					</div>
					<div class="music-controls">
						<button class="music-icon-button" type="button" aria-label="上一首" on:click={playPrevious}><Icon icon="material-symbols:skip-previous-rounded" /></button>
						<button class="music-play-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} on:click={togglePlay}>
							<Icon icon={isPlaying ? "material-symbols:pause-rounded" : "material-symbols:play-arrow-rounded"} />
						</button>
						<button class="music-icon-button" type="button" aria-label="下一首" on:click={playNext}><Icon icon="material-symbols:skip-next-rounded" /></button>
						<label class="music-volume" aria-label="音量"><Icon icon="material-symbols:volume-up-rounded" /><input type="range" min="0" max="100" value={volume * 100} on:input={changeVolume} /></label>
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
						{#if songsLoading || songsMessage}
							<p class="music-muted">{songsLoading ? "正在读取歌单…" : songsMessage}</p>
						{/if}
						{#each songs.slice(0, 30) as song}
							<button class:music-song--active={currentSong?.hash === song.hash} class="music-song" type="button" on:click={() => void playSong(song)}>
								<span class="music-song-index">{currentSongLoading === song.hash ? "…" : String(songs.indexOf(song) + 1).padStart(2, "0")}</span>
								<span class="music-song-info"><strong>{song.name}</strong><small>{song.author}</small></span>
								<Icon icon="material-symbols:play-arrow-rounded" />
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
							{#if lyricsText}<pre>{lyricsText}</pre>{:else}<p class="music-muted">{lyricsMessage}</p>{/if}
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
		<span class:music-trigger-pulse={isPlaying} class="music-trigger-icon"><Icon icon={isPlaying ? "material-symbols:graphic-eq-rounded" : "material-symbols:radio-outline-rounded"} /></span>
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
		width: min(25rem, calc(100vw - 2rem));
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
		width: 100%;
		min-height: 3.75rem;
		padding: 0.55rem 0.7rem 0.55rem 0.6rem;
		border-radius: 1rem;
		text-align: left;
		cursor: pointer;
		transition: transform var(--ds-motion-base, 320ms) var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow var(--ds-motion-base, 320ms) var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.music-dock-trigger:hover { transform: translateY(-2px); box-shadow: 0 22px 48px -25px rgb(15 23 42 / 0.62), 0 0 0 1px color-mix(in oklch, var(--primary) 36%, transparent) inset; }
	.music-trigger-icon { display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border-radius: 0.8rem; color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); font-size: 1.35rem; }
	.music-trigger-pulse { animation: music-pulse 1.8s ease-in-out infinite; }
	.music-trigger-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 0.05rem; }
	.music-trigger-copy strong { font-size: 0.8rem; letter-spacing: 0.08em; }
	.music-trigger-copy small { overflow: hidden; color: var(--text-50, rgb(100 116 139)); font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }
	.music-trigger-chevron { color: var(--primary); font-size: 1.25rem; }

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
	.music-cover { flex: 0 0 3.3rem; width: 3.3rem; height: 3.3rem; border-radius: 0.7rem; object-fit: cover; box-shadow: 0 8px 18px -12px rgb(15 23 42 / 0.7); }
	.music-cover--empty { display: grid; place-items: center; color: var(--primary); background: color-mix(in oklch, var(--primary) 12%, transparent); font-size: 1.5rem; }
	.music-track-copy { min-width: 0; display: grid; gap: 0.12rem; }
	.music-track-copy strong, .music-track-copy span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.music-track-copy strong { font-size: 0.85rem; }
	.music-track-copy span:last-child { color: var(--text-50, rgb(100 116 139)); font-size: 0.72rem; }
	.music-progress-row { display: grid; grid-template-columns: 2.3rem minmax(0, 1fr) 2.3rem; align-items: center; gap: 0.4rem; margin-top: 0.85rem; color: var(--text-50, rgb(100 116 139)); font-family: var(--font-mono, monospace); font-size: 0.6rem; }
	.music-progress-row span:last-child { text-align: right; }
	input[type="range"] { width: 100%; accent-color: var(--primary); cursor: pointer; }
	.music-controls { margin-top: 0.55rem; justify-content: center; }
	.music-play-button { display: grid; place-items: center; width: 2.65rem; height: 2.65rem; border: 0; border-radius: 50%; color: #fff; background: var(--primary); cursor: pointer; font-size: 1.45rem; transition: transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-play-button:hover { transform: scale(1.05); }
	.music-volume { display: flex; align-items: center; gap: 0.25rem; margin-left: 0.7rem; color: var(--text-50, rgb(100 116 139)); font-size: 0.95rem; }
	.music-volume input { width: 4.5rem; }
	.music-account-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 0.65rem; }
	.music-account-row strong { display: block; max-width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
	.music-vip-state { display: flex; align-items: center; gap: 0.45rem; margin-top: 0.65rem; color: var(--text-50, rgb(100 116 139)); font-size: 0.7rem; }
	.music-state-dot { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #a3a3a3; }
	.music-vip-state--ok .music-state-dot { background: #36a269; box-shadow: 0 0 0 4px rgb(54 162 105 / 0.12); }
	.music-vip-state--risk .music-state-dot { background: #d18b3d; }
	.music-playlist-field { margin-top: 0.65rem; }
	.music-song-list { display: grid; gap: 0.25rem; max-height: 13rem; margin-top: 0.6rem; overflow: auto; }
	.music-song { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.48rem 0.55rem; border: 1px solid transparent; border-radius: 0.65rem; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 180ms ease, border-color 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
	.music-song:hover, .music-song--active { border-color: color-mix(in oklch, var(--primary) 20%, transparent); background: color-mix(in oklch, var(--primary) 8%, transparent); }
	.music-song:hover { transform: translateX(2px); }
	.music-song-index { width: 1.6rem; color: var(--text-35, rgb(148 163 184)); font-family: var(--font-mono, monospace); font-size: 0.62rem; }
	.music-song-info { min-width: 0; display: grid; flex: 1; gap: 0.08rem; }
	.music-song-info strong, .music-song-info small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.music-song-info strong { font-size: 0.74rem; font-weight: 650; }
	.music-song-info small { color: var(--text-50, rgb(100 116 139)); font-size: 0.64rem; }
	.music-song > :global(svg) { color: var(--primary); font-size: 1.1rem; }
	.music-secondary-actions { justify-content: flex-end; margin-top: 0.5rem; }
	.music-lyrics { max-height: 12rem; margin-top: 0.55rem; padding: 0.7rem; overflow: auto; border-radius: 0.7rem; background: color-mix(in oklch, var(--page-bg, #f8fafc) 82%, transparent); }
	.music-lyrics pre { margin: 0; white-space: pre-wrap; color: var(--text-60, rgb(71 85 105)); font: 0.7rem/1.8 var(--font-sans, "Noto Sans SC", sans-serif); }
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
	@keyframes music-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--primary) 12%, transparent); } }
	@media (max-width: 640px) { .music-dock { right: 0.7rem; bottom: 0.7rem; width: calc(100vw - 1.4rem); } .music-panel { max-height: calc(100vh - 5.5rem); } .music-volume { display: none; } }
	@media (prefers-reduced-motion: reduce) { .music-panel, .music-login-card { animation: none; } .music-trigger-pulse { animation: none; } .music-dock-trigger, .music-play-button, .music-song, .music-icon-button, .music-primary, .music-quiet { transition: none; } }
</style>
