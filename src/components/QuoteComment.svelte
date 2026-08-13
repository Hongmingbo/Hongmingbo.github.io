<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "@iconify/svelte";

	export let slug: string;

	const DRAFT_KEY_PREFIX = "hengduo-comment-draft:";

	let quoteVisible = false;
	let quoteText = "";
	let quoteX = 0;
	let quoteY = 0;
	let draft = "";
	let draftOpen = false;

	const MIN_QUOTE_LENGTH = 2;

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
		// 选区必须在文章正文内，避免导航/侧栏选中也触发
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

	const hideQuote = () => {
		quoteVisible = false;
	};
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	const scheduleHideQuote = () => {
		if (hideTimer) clearTimeout(hideTimer);
		// 点击按钮时 mousedown 会先折叠选区；延迟隐藏让 click 能命中按钮。
		hideTimer = setTimeout(() => {
			quoteVisible = false;
		}, 200);
	};

	const quoteComment = () => {
		if (!quoteText) return;
		const quoted = `> ${quoteText.split("\n").join("\n> ")}`;
		draft = draft ? `${draft}\n\n${quoted}\n\n` : `${quoted}\n\n`;
		draftOpen = true;
		localStorage.setItem(getDraftKey(), draft);
		quoteVisible = false;
		// 滚动到草稿区并聚焦
		requestAnimationFrame(() => {
			document.querySelector(".quote-comment-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			(document.querySelector<HTMLTextAreaElement>(".quote-comment-textarea"))?.focus();
		});
	};

	const clearDraft = () => {
		draft = "";
		localStorage.removeItem(getDraftKey());
	};

	onMount(() => {
		draft = localStorage.getItem(getDraftKey()) ?? "";
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

<!-- 评论草稿面板（本地存储；评论系统接入后作为提交入口） -->
<div class="quote-comment-panel">
	<button
		class="quote-comment-toggle"
		type="button"
		aria-expanded={draftOpen}
		on:click={() => (draftOpen = !draftOpen)}
	>
		<span class="quote-comment-toggle__icon">
			<Icon icon="material-symbols:chat-bubble-outline-rounded" />
		</span>
		<span>
			<strong>评论草稿</strong>
			<small>{draft ? "已有内容，点击展开" : "选中文章文字后可引用到此处"}</small>
		</span>
		<Icon class="quote-comment-toggle__chevron" icon={draftOpen ? "material-symbols:keyboard-arrow-down-rounded" : "material-symbols:keyboard-arrow-up-rounded"} />
	</button>

	{#if draftOpen}
		<div class="quote-comment-body">
			<textarea
				class="quote-comment-textarea"
				bind:value={draft}
				placeholder="输入你的评论…（支持 &gt; 引用）"
				on:input={() => localStorage.setItem(getDraftKey(), draft)}
			></textarea>
			<div class="quote-comment-footer">
				<p>草稿仅保存在当前浏览器（localStorage）。评论系统上线后，这里的内容将作为评论提交。</p>
				<div class="quote-comment-actions">
					<button class="quote-comment-btn" type="button" on:click={clearDraft} disabled={!draft}>
						清空草稿
					</button>
				</div>
			</div>
		</div>
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

	.quote-comment-body { display: grid; gap: 0.6rem; padding: 0 0.9rem 0.9rem; }
	.quote-comment-textarea {
		width: 100%;
		min-height: 8rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 88%, transparent);
		border-radius: 0.7rem;
		outline: 0;
		color: inherit;
		background: color-mix(in oklch, var(--page-bg, #f8fafc) 70%, transparent);
		font: inherit;
		font-size: 0.78rem;
		line-height: 1.7;
		resize: vertical;
	}
	.quote-comment-textarea:focus {
		border-color: color-mix(in oklch, var(--primary) 60%, var(--card-border, #dce5e5));
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 14%, transparent);
	}
	.quote-comment-footer {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 0.8rem;
	}
	.quote-comment-footer p { margin: 0; color: var(--text-50, rgb(100 116 139)); font-size: 0.66rem; line-height: 1.55; }
	.quote-comment-actions { flex: 0 0 auto; }
	.quote-comment-btn {
		min-height: 2.1rem;
		padding: 0.4rem 0.7rem;
		border: 1px solid color-mix(in oklch, var(--card-border, #dce5e5) 95%, transparent);
		border-radius: 0.6rem;
		color: var(--text-60, rgb(71 85 105));
		background: transparent;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		transition: color 180ms ease, border-color 180ms ease, transform 180ms var(--ds-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	.quote-comment-btn:hover:not(:disabled) { color: var(--primary); border-color: color-mix(in oklch, var(--primary) 40%, var(--card-border, #dce5e5)); }
	.quote-comment-btn:disabled { cursor: not-allowed; opacity: 0.45; }

	:global(.dark) .quote-comment-panel { background: color-mix(in oklch, var(--card-bg, #172033) 78%, transparent); }
	:global(.dark) .quote-comment-textarea { background: rgb(255 255 255 / 0.05); }

	@keyframes quote-pop { from { opacity: 0; transform: translate(-50%, -100%) scale(0.92); } to { opacity: 1; transform: translate(-50%, -100%) scale(1); } }

	@media (max-width: 640px) {
		.quote-comment-float { min-height: 2.75rem; font-size: 0.78rem; }
		.quote-comment-footer { align-items: start; flex-direction: column; }
	}

	@media (prefers-reduced-motion: reduce) {
		.quote-comment-float { animation: none; transition: none; }
		.quote-comment-float:hover { transform: translate(-50%, -100%); }
	}
</style>
