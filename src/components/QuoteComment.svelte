<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "@iconify/svelte";
	import {
		CommentApiClient,
		CommentApiError,
		COMMENT_API_ORIGIN,
		formatCommentDate,
		normalizeCommentApiBaseUrl,
		type CommentItem,
	} from "@utils/comment-api";

	export let slug: string;

	const DRAFT_KEY_PREFIX = "hengduo-comment-draft:";
	const isDev = import.meta.env.DEV;
	const devApiUrl = (isDev ? (import.meta.env.PUBLIC_COMMENT_DEV_API_URL as string | undefined) : "") ?? "";

	let apiUrl = "";
	let client: CommentApiClient | null = null;
	let panelOpen = false;

	// 选区引用
	let quoteVisible = false;
	let quoteText = "";
	let quoteX = 0;
	let quoteY = 0;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// 离线草稿（API 未配置时）
	let draft = "";

	// 在线评论
	let comments: CommentItem[] = [];
	let commentsLoading = false;
	let commentsMessage = "";
	let formOpen = false;
	let name = "";
	let email = "";
	let content = "";
	let submitting = false;
	let submitMessage = "";
	let submitError = false;

	const MIN_QUOTE_LENGTH = 2;
	const MAX_CONTENT_LENGTH = 2000;

	const getDraftKey = () => `${DRAFT_KEY_PREFIX}${slug}`;

	const handleSelection = () => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			quoteVisible = false;
			return;
		}
		const text = selection.toString().trim();
		if (text.length < MIN_QUOTE_LENGTH) {
			quoteVisible = false;
			return;
		}
		const container = document.querySelector("#post-container");
		const range = selection.getRangeAt(0);
		if (!container?.contains(range.commonAncestorContainer)) {
			quoteVisible = false;
			return;
		}
		const rect = range.getBoundingClientRect();
		quoteText = text;
		quoteX = Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 8));
		quoteY = rect.top - 8;
		quoteVisible = true;
	};

	const scheduleHideQuote = () => {
		if (hideTimer) clearTimeout(hideTimer);
		// 点击按钮时 mousedown 会先折叠选区；延迟隐藏让 click 能命中按钮。
		hideTimer = setTimeout(() => {
			quoteVisible = false;
		}, 200);
	};

	const hideQuote = () => {
		quoteVisible = false;
	};

	const focusFormTextarea = () => {
		requestAnimationFrame(() => {
			document.querySelector(".comment-form-textarea")?.scrollIntoView({ behavior: "smooth", block: "center" });
			(document.querySelector<HTMLTextAreaElement>(".comment-form-textarea"))?.focus();
		});
	};

	const quoteComment = () => {
		if (!quoteText) return;
		const quoted = `> ${quoteText.split("\n").join("\n> ")}`;
		if (apiUrl) {
			// 在线模式：填入评论表单
			formOpen = true;
			content = content ? `${content}\n\n${quoted}\n\n` : `${quoted}\n\n`;
			focusFormTextarea();
		} else {
			// 离线模式：写入草稿
			draft = draft ? `${draft}\n\n${quoted}\n\n` : `${quoted}\n\n`;
			panelOpen = true;
			localStorage.setItem(getDraftKey(), draft);
			focusFormTextarea();
		}
		quoteVisible = false;
	};

	const clearDraft = () => {
		draft = "";
		localStorage.removeItem(getDraftKey());
	};

	const loadComments = async () => {
		if (!client) return;
		commentsLoading = true;
		commentsMessage = "";
		try {
			const result = await client.getComments(slug);
			comments = result.list;
			if (result.total === 0) commentsMessage = "还没有评论，来抢沙发";
		} catch (error) {
			comments = [];
			commentsMessage = error instanceof CommentApiError ? error.message : "评论列表加载失败";
		} finally {
			commentsLoading = false;
		}
	};

	const submitComment = async () => {
		if (!client) return;
		const trimmedName = name.trim();
		const trimmedContent = content.trim();
		if (!trimmedName) {
			submitMessage = "请填写昵称";
			submitError = true;
			return;
		}
		if (trimmedName.length > 30) {
			submitMessage = "昵称最长 30 个字符";
			submitError = true;
			return;
		}
		if (!trimmedContent) {
			submitMessage = "请填写评论内容";
			submitError = true;
			return;
		}
		if (trimmedContent.length > MAX_CONTENT_LENGTH) {
			submitMessage = `评论内容最长 ${MAX_CONTENT_LENGTH} 个字符`;
			submitError = true;
			return;
		}
		submitting = true;
		submitMessage = "";
		submitError = false;
		try {
			await client.createComment({
				post: slug,
				name: trimmedName,
				email: email.trim() || undefined,
				content: trimmedContent,
			});
			content = "";
			email = "";
			submitMessage = "评论已提交，审核通过后显示";
			submitError = false;
			void loadComments();
		} catch (error) {
			submitMessage = error instanceof CommentApiError ? error.message : "评论提交失败，请稍后重试";
			submitError = true;
		} finally {
			submitting = false;
		}
	};

	onMount(() => {
		apiUrl = normalizeCommentApiBaseUrl(isDev && devApiUrl ? devApiUrl : COMMENT_API_ORIGIN);
		if (apiUrl) {
			client = new CommentApiClient(apiUrl);
			void loadComments();
		} else {
			draft = localStorage.getItem(getDraftKey()) ?? "";
		}
		document.addEventListener("mouseup", handleSelection);
		document.addEventListener("selectionchange", () => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) scheduleHideQuote();
		});
		document.addEventListener("scroll", hideQuote, { passive: true });
		window.addEventListener("resize", hideQuote);
		return () => {
			document.removeEventListener("mouseup", handleSelection);
			document.removeEventListener("scroll", hideQuote);
			window.removeEventListener("resize", hideQuote);
			if (hideTimer) clearTimeout(hideTimer);
		};
	});
</script>

<!-- 浮动「引用评论」按钮 -->
{#if quoteVisible}
	<button
		class="quote-comment-float"
		type="button"
		style={`left: ${quoteX}px; top: ${quoteY}px; transform: translate(-50%, -100%);`}
		on:click={quoteComment}
	>
		<Icon icon="material-symbols:format-quote-rounded" />
		<span>引用评论</span>
	</button>
{/if}

<!-- 评论区面板 -->
<div class="quote-comment-panel">
	<button
		class="quote-comment-toggle"
		type="button"
		aria-expanded={panelOpen}
		on:click={() => (panelOpen = !panelOpen)}
	>
		<span class="quote-comment-toggle__icon">
			<Icon icon="material-symbols:chat-bubble-outline-rounded" />
		</span>
		<span>
			<strong>评论{apiUrl ? (comments.length > 0 ? ` (${comments.length})` : "") : ""}</strong>
			<small>{apiUrl ? (commentsMessage || "点击展开参与讨论") : (draft ? "已有草稿，点击展开" : "评论服务建设中，可先撰写草稿")}</small>
		</span>
		<Icon class="quote-comment-toggle__chevron" icon={panelOpen ? "material-symbols:keyboard-arrow-down-rounded" : "material-symbols:keyboard-arrow-up-rounded"} />
	</button>

	{#if panelOpen}
		{#if apiUrl}
			<div class="comment-section">
				{#if commentsLoading}
					<p class="comment-muted">正在加载评论…</p>
				{:else if comments.length === 0}
					<p class="comment-muted">{commentsMessage}</p>
				{:else}
					<ul class="comment-list">
						{#each comments as item, i (item.id)}
							<li class="comment-item">
								<div class="comment-item__meta">
									<span class="comment-item__avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>
									<strong>{item.name}</strong>
									<time>{formatCommentDate(item.createdAt)}</time>
								</div>
								{#if item.quote}
									<blockquote class="comment-item__quote">{item.quote}</blockquote>
								{/if}
								<p class="comment-item__content">{item.content}</p>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="comment-form-wrap">
					<button class="comment-form-toggle" type="button" on:click={() => (formOpen = !formOpen)}>
						<Icon icon="material-symbols:add-comment-outline-rounded" />
						<span>{formOpen ? "收起评论框" : "写评论"}</span>
					</button>

					{#if formOpen}
						<form class="comment-form" on:submit={(event) => {
							event.preventDefault();
							void submitComment();
						}}>
							<div class="comment-form__row">
								<label class="comment-field">
									<span>昵称 *</span>
									<input bind:value={name} type="text" maxlength="30" autocomplete="nickname" placeholder="怎么称呼你" />
								</label>
								<label class="comment-field">
									<span>邮箱（可选，仅用于头像）</span>
									<input bind:value={email} type="email" autocomplete="email" placeholder="不会公开" />
								</label>
							</div>
							<label class="comment-field">
								<span>内容 *</span>
								<textarea class="comment-form-textarea" bind:value={content} maxlength={MAX_CONTENT_LENGTH} placeholder="写下你的看法…（支持 &gt; 引用）"></textarea>
							</label>
							<div class="comment-form__footer">
								<p class="comment-form__note">评论会先经过审核再公开显示。引用内容来自文章原文。</p>
								<button class="comment-submit" type="submit" disabled={submitting}>
									{submitting ? "提交中…" : "提交评论"}
								</button>
							</div>
							{#if submitMessage}
								<p class:comment-error={submitError} class="comment-status">{submitMessage}</p>
							{/if}
						</form>
					{/if}
				</div>
			</div>
		{:else}
			<div class="comment-section">
				<p class="comment-muted">评论服务正在接入中。你可以先撰写引用草稿，评论系统上线后一键提交。</p>
				<textarea
					class="comment-form-textarea"
					bind:value={draft}
					placeholder="输入你的评论…（支持 &gt; 引用）"
					on:input={() => localStorage.setItem(getDraftKey(), draft)}
				></textarea>
				<div class="comment-offline-actions">
					<button class="comment-clear" type="button" on:click={clearDraft} disabled={!draft}>
						清空草稿
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.quote-comment-float {
		position: fixed;
		z-index: 90;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.4rem;
		padding: 0.45rem 0.8rem;
		border: 1px solid color-mix(in oklch, var(--primary) 40%, var(--card-border, #dce5e5));
		border-radius: 999px;
		color: var(--primary);
		background: color-mix(in oklch, var(--card-bg, #fff) 94%, transparent);
		box-shadow: 0 10px 26px -14px rgb(15 23 42 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.2) inset;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		animation: quote-pop 160ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
		transition: transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 180ms ease;
	}
	.quote-comment-float:hover {
		transform: translate(-50%, -100%) scale(1.05);
		box-shadow: 0 12px 30px -14px color-mix(in oklch, var(--primary) 55%, transparent);
	}
	.quote-comment-float:active { transform: translate(-50%, -100%) scale(0.96); }

	.quote-comment-panel {
		margin-top: 1rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 82%, transparent);
		border-radius: var(--radius-large);
		background: color-mix(in oklch, var(--card-bg, #fff) 78%, transparent);
		overflow: hidden;
	}
	.quote-comment-toggle {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		min-height: 3.4rem;
		padding: 0.55rem 0.9rem;
		border: 0;
		color: inherit;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.quote-comment-toggle__icon {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 0.65rem;
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 10%, transparent);
		font-size: 1.15rem;
	}
	.quote-comment-toggle > span:nth-child(2) { display: grid; gap: 0.08rem; min-width: 0; flex: 1; }
	.quote-comment-toggle strong { font-size: 0.82rem; }
	.quote-comment-toggle small { color: var(--text-50, rgb(100 116 139)); font-size: 0.68rem; }
	:global(.quote-comment-toggle__chevron) { color: var(--primary); font-size: 1.2rem; }

	.comment-section { display: grid; gap: 0.7rem; padding: 0 0.9rem 0.9rem; }
	.comment-muted { margin: 0; color: var(--text-50, rgb(100 116 139)); font-size: 0.72rem; line-height: 1.6; }
	.comment-list { display: grid; gap: 0.6rem; margin: 0; padding: 0; list-style: none; max-height: 22rem; overflow: auto; }
	.comment-item {
		padding: 0.65rem 0.75rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 78%, transparent);
		border-radius: 0.7rem;
		background: color-mix(in oklch, var(--card-bg, #fff) 60%, transparent);
	}
	.comment-item__meta { display: flex; align-items: center; gap: 0.5rem; }
	.comment-item__avatar {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 50%;
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 12%, transparent);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.comment-item__meta strong { font-size: 0.75rem; }
	.comment-item__meta time { margin-left: auto; color: var(--text-40, rgb(148 163 184)); font-family: var(--font-mono, monospace); font-size: 0.58rem; }
	.comment-item__quote {
		margin: 0.45rem 0 0;
		padding: 0.4rem 0.55rem;
		border-left: 3px solid color-mix(in oklch, var(--primary) 45%, transparent);
		border-radius: 0 0.4rem 0.4rem 0;
		color: var(--text-60, rgb(71 85 105));
		background: color-mix(in oklch, var(--primary) 6%, transparent);
		font-size: 0.68rem;
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.comment-item__content { margin: 0.45rem 0 0; color: var(--text-80, rgb(51 65 85)); font-size: 0.76rem; line-height: 1.75; white-space: pre-wrap; }

	.comment-form-wrap { display: grid; gap: 0.55rem; margin-top: 0.3rem; padding-top: 0.6rem; border-top: 1px dashed color-mix(in oklch, var(--card-border, #dce5e5) 85%, transparent); }
	.comment-form-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		justify-self: start;
		min-height: 2.2rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid color-mix(in oklch, var(--primary) 30%, var(--card-border, #dce5e5));
		border-radius: 0.6rem;
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 7%, transparent);
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		transition: background 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	.comment-form-toggle:hover { background: color-mix(in oklch, var(--primary) 12%, transparent); }
	.comment-form-toggle:active { transform: scale(0.96); }
	.comment-form { display: grid; gap: 0.55rem; }
	.comment-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; }
	.comment-field { display: grid; gap: 0.28rem; color: var(--text-60, rgb(71 85 105)); font-size: 0.68rem; }
	.comment-field input,
	.comment-form-textarea {
		width: 100%;
		padding: 0.55rem 0.65rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 88%, transparent);
		border-radius: 0.6rem;
		outline: 0;
		color: inherit;
		background: color-mix(in oklch, var(--page-bg, #f8fafc) 70%, transparent);
		font: inherit;
		font-size: 0.76rem;
	}
	.comment-field input:focus,
	.comment-form-textarea:focus {
		border-color: color-mix(in oklch, var(--primary) 60%, var(--card-border, #dce5e5));
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 14%, transparent);
	}
	.comment-form-textarea { min-height: 7rem; line-height: 1.7; resize: vertical; }
	.comment-form__footer { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; }
	.comment-form__note { margin: 0; color: var(--text-50, rgb(100 116 139)); font-size: 0.64rem; line-height: 1.5; }
	.comment-submit {
		flex: 0 0 auto;
		min-height: 2.3rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--primary);
		border-radius: 0.6rem;
		color: var(--primary-button-text, #fff);
		background: var(--primary);
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
		transition: transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), opacity 180ms ease;
	}
	.comment-submit:hover:not(:disabled) { transform: translateY(-1px); }
	.comment-submit:disabled { cursor: not-allowed; opacity: 0.55; }
	.comment-status { margin: 0; font-size: 0.7rem; }
	.comment-error { color: #c05640; }
	.comment-clear {
		justify-self: end;
		min-height: 2.1rem;
		padding: 0.4rem 0.7rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 95%, transparent);
		border-radius: 0.6rem;
		color: var(--text-60, rgb(71 85 105));
		background: transparent;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}
	.comment-clear:hover:not(:disabled) { color: var(--primary); border-color: color-mix(in oklch, var(--primary) 40%, var(--card-border, #dce5e5)); }
	.comment-clear:disabled { cursor: not-allowed; opacity: 0.45; }
	.comment-offline-actions { display: flex; justify-content: flex-end; }

	:global(.dark) .quote-comment-panel { background: color-mix(in oklch, var(--card-bg, #172033) 78%, transparent); }
	:global(.dark) .comment-item { background: color-mix(in oklch, var(--card-bg, #172033) 60%, transparent); }
	:global(.dark) .comment-field input,
	:global(.dark) .comment-form-textarea { background: rgb(255 255 255 / 0.05); }
	:global(.dark) .comment-item__content { color: var(--text-90, rgb(226 232 240)); }

	@keyframes quote-pop { from { opacity: 0; transform: translate(-50%, -100%) scale(0.92); } to { opacity: 1; transform: translate(-50%, -100%) scale(1); } }

	@media (max-width: 640px) {
		.quote-comment-float { min-height: 2.75rem; font-size: 0.78rem; }
		.comment-form__row { grid-template-columns: 1fr; }
		.comment-form__footer { align-items: start; flex-direction: column; }
	}

	@media (prefers-reduced-motion: reduce) {
		.quote-comment-float { animation: none; transition: none; }
		.quote-comment-float:hover { transform: translate(-50%, -100%); }
	}
</style>
