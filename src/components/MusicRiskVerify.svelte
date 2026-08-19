<script lang="ts">
	import { createEventDispatcher, onMount } from "svelte";
	import type { MusicApiClient, MusicRiskChallenge } from "@utils/music-api";
	import { classifyMusicRisk, type MusicRiskMode } from "@utils/music-api";

	export let client: MusicApiClient;
	export let challenge: MusicRiskChallenge;

	const dispatch = createEventDispatcher<{ verified: void; cancel: void; relogin: void }>();

	let loading = true;
	let submitting = false;
	let message = "正在获取安全验证信息…";
	let errorMessage = "";
	let verifyType = 23;
	let riskMode: MusicRiskMode = "captcha";
	let txAppId = "";
	let smsCode = "";
	let captchaLoading: Promise<void> | null = null;

	async function loadTencentCaptcha() {
		if ((window as any).TencentCaptcha) return;
		if (captchaLoading) return captchaLoading;
		captchaLoading = new Promise<void>((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "https://turing.captcha.qcloud.com/TCaptcha.js";
			script.async = true;
			script.onload = () => ((window as any).TencentCaptcha ? resolve() : reject(new Error("腾讯验证码加载失败")));
			script.onerror = () => reject(new Error("腾讯验证码加载失败"));
			document.head.appendChild(script);
		});
		return captchaLoading;
	}

	function openTencentCaptcha(appId: string): Promise<{ ticket: string; randstr: string }> {
		return new Promise((resolve, reject) => {
			try {
				const Captcha = (window as any).TencentCaptcha;
				const captcha = new Captcha(appId, (result: any) => {
					if (Number(result?.ret) === 0 && result.ticket && result.randstr) {
						resolve({ ticket: String(result.ticket), randstr: String(result.randstr) });
						return;
					}
					const cancelled = new Error(result?.ret === 2 ? "已取消安全验证" : "验证码未通过");
					(cancelled as Error & { cancelled?: boolean }).cancelled = result?.ret === 2;
					reject(cancelled);
				}, { type: "", showHeader: false });
				captcha.show();
			} catch (error) {
				reject(error);
			}
		});
	}

	async function submitCode(code: string) {
		const encoded = encodeURIComponent(code);
		await client.submitRiskVerification({
			eventid: challenge.eventid,
			vType: verifyType,
			verifycode: encoded,
			sid: challenge.sid,
			edt: challenge.edt,
		});
		dispatch("verified");
	}

	async function start() {
		try {
			const payload = await client.getRiskInfo(challenge.eventid);
			const data = payload?.data ?? payload;
			verifyType = Number(data?.v_type ?? 23);
			riskMode = classifyMusicRisk(verifyType);
			txAppId = String(data?.txappid ?? "").trim();
			if (riskMode === "login") {
				loading = false;
				message = "酷狗要求重新确认登录，请使用二维码登录一次";
				return;
			}
			if (riskMode === "sms") {
				loading = false;
				message = "酷狗要求短信验证，请输入验证码";
				return;
			}
			if (riskMode === "unsupported") {
				throw new Error(`当前需要酷狗验证类型 ${verifyType}，网页端暂不支持`);
			}
			if (!txAppId) throw new Error("未获取到腾讯验证码配置");
			message = "正在打开人工滑块，请完成验证";
			await loadTencentCaptcha();
			const result = await openTencentCaptcha(txAppId);
			message = "正在提交验证结果…";
			await submitCode(`KGCodeTX|${JSON.stringify({ ticket: result.ticket, randstr: result.randstr, txappid: txAppId })}`);
		} catch (error) {
			if ((error as { cancelled?: boolean })?.cancelled) {
				dispatch("cancel");
				return;
			}
			loading = false;
			errorMessage = error instanceof Error ? error.message : "安全验证失败";
		}
	}

	async function submitSms() {
		if (!smsCode.trim() || submitting) return;
		submitting = true;
		errorMessage = "";
		try {
			await submitCode(smsCode.trim());
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "验证码提交失败";
		} finally {
			submitting = false;
		}
	}

	onMount(start);
</script>

<div class="music-risk-backdrop" role="presentation">
	<section class="music-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="music-risk-title">
		<div class="music-risk-kicker">KUGOU · RISK CHECK</div>
		<h2 id="music-risk-title">需要完成安全验证</h2>
		<p class="music-risk-copy">这是酷狗对 VIP 播放的人工验证。不会读取或保存你的验证码，请在弹窗中手动完成。</p>
		{#if loading}
			<div class="music-risk-status"><span class="music-risk-spinner"></span>{message}</div>
		{:else if riskMode === "login"}
			<p class="music-risk-status">{message}</p>
			<p class="music-risk-copy">这是酷狗的“登录确认”类型，当前挑战没有腾讯验证码配置。重新扫码登录会建立新的受信会话，不会读取或保存密码。</p>
			<button class="music-risk-primary" on:click={() => dispatch("relogin")}>重新扫码登录</button>
		{:else if riskMode === "sms"}
			<p class="music-risk-status">{message}</p>
			<input bind:value={smsCode} class="music-risk-input" inputmode="numeric" autocomplete="one-time-code" placeholder="输入短信验证码" on:keydown={(event) => event.key === "Enter" && submitSms()} />
			<button class="music-risk-primary" disabled={submitting || !smsCode.trim()} on:click={submitSms}>{submitting ? "提交中…" : "提交验证码"}</button>
		{:else}
			<p class="music-risk-error">{errorMessage || "验证未完成，请重试"}</p>
			<button class="music-risk-primary" on:click={() => { errorMessage = ""; loading = true; void start(); }}>重新验证</button>
		{/if}
		{#if errorMessage && riskMode === "sms"}<p class="music-risk-error">{errorMessage}</p>{/if}
		<button class="music-risk-cancel" disabled={submitting} on:click={() => dispatch("cancel")}>取消播放</button>
	</section>
</div>

<style>
	.music-risk-backdrop {
		position: fixed;
		inset: 0;
		z-index: 12000;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(5 19 25 / 56%);
		backdrop-filter: blur(8px);
	}
	.music-risk-dialog {
		width: min(420px, calc(100vw - 40px));
		padding: 26px;
		border: 1px solid rgb(92 211 191 / 32%);
		border-radius: 18px;
		background: var(--card-bg, #f7fbfa);
		box-shadow: 0 24px 80px rgb(0 25 30 / 30%);
		color: var(--text-color, #173a3a);
	}
	.music-risk-kicker { color: #168d80; font: 700 10px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .14em; }
	.music-risk-dialog h2 { margin: 8px 0 10px; font-size: 20px; }
	.music-risk-copy, .music-risk-status, .music-risk-error { margin: 0 0 16px; font-size: 13px; line-height: 1.65; }
	.music-risk-copy, .music-risk-status { color: color-mix(in srgb, currentColor 68%, transparent); }
	.music-risk-error { color: #b64545; }
	.music-risk-spinner { display: inline-block; width: 12px; height: 12px; margin-right: 8px; border: 2px solid rgb(22 141 128 / 24%); border-top-color: #168d80; border-radius: 50%; vertical-align: -2px; animation: music-risk-spin .7s linear infinite; }
	.music-risk-input { box-sizing: border-box; width: 100%; height: 42px; margin-bottom: 12px; padding: 0 12px; border: 1px solid rgb(22 141 128 / 30%); border-radius: 10px; background: transparent; color: inherit; }
	.music-risk-primary, .music-risk-cancel { width: 100%; min-height: 40px; border: 0; border-radius: 10px; cursor: pointer; font-weight: 650; }
	.music-risk-primary { background: #168d80; color: #fff; }
	.music-risk-primary:disabled, .music-risk-cancel:disabled { cursor: not-allowed; opacity: .55; }
	.music-risk-cancel { margin-top: 10px; background: transparent; color: color-mix(in srgb, currentColor 62%, transparent); }
	@keyframes music-risk-spin { to { transform: rotate(360deg); } }
</style>
