<script lang="ts">
	/**
	 * 自定义下拉选择器（纯鼠标交互）。
	 *
	 * 为什么不用原生 <select>：原生弹层由操作系统绘制，圆角、阴影、高亮色
	 * 都跟本站主题无关，十个下拉排在一起会显得"格格不入"。
	 *
	 * 交互约定（按用户要求）：只做鼠标。点击开合、点击选项生效、点击外部关闭。
	 * 不注册任何键盘事件，避免与播放器已有的空格/方向键快捷键冲突。
	 */
	import Icon from "@iconify/svelte";
	import { onMount } from "svelte";

	export let value: string = "";
	export let options: Array<{ value: string; label: string }> = [];
	export let ariaLabel: string = "";
	export let onChange: (next: string) => void = () => {};
	/** 面板展开方向：靠右的控件用 right，避免弹层溢出容器 */
	export let align: "left" | "right" = "left";

	let open = false;
	let root: HTMLDivElement | null = null;

	$: current = options.find((item) => item.value === String(value)) ?? options[0] ?? null;

	function pick(next: string) {
		open = false;
		if (next !== String(value)) onChange(next);
	}

	function handleWindowClick(event: MouseEvent) {
		if (!open) return;
		const target = event.target as Node | null;
		if (root && target && !root.contains(target)) open = false;
	}

	// 用原生监听而不是 <svelte:window on:click>：后者在当前编译配置下会报
	// "This type of directive is not valid on components"。
	onMount(() => {
		window.addEventListener("click", handleWindowClick);
		return () => window.removeEventListener("click", handleWindowClick);
	});
</script>

<div class="msel" bind:this={root}>
	<button
		type="button"
		class="msel__button"
		aria-label={ariaLabel}
		aria-expanded={open}
		title={current?.label ?? ""}
		on:click|stopPropagation={() => (open = !open)}
	>
		<span class="msel__text">{current?.label ?? "—"}</span>
		<Icon
			icon="material-symbols:expand-more-rounded"
			class={`msel__chev${open ? " msel__chev--open" : ""}`}
		/>
	</button>

	{#if open}
		<div
			class="msel__panel"
			class:msel__panel--right={align === "right"}
			role="listbox"
			aria-label={ariaLabel}
		>
			{#each options as option (option.value)}
				<button
					type="button"
					role="option"
					aria-selected={String(value) === option.value}
					class="msel__option"
					class:msel__option--on={String(value) === option.value}
					on:click|stopPropagation={() => pick(option.value)}
				>
					<span class="msel__option-text">{option.label}</span>
					{#if String(value) === option.value}
						<Icon icon="material-symbols:check-rounded" class="msel__check" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.msel {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}

	.msel__button {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		max-width: 100%;
		min-height: 2.05rem;
		padding: 0.2rem 0.5rem 0.2rem 0.62rem;
		border: 1px solid color-mix(in oklch, var(--primary) 18%, var(--card-border, #dce5e5));
		border-radius: 0.62rem;
		background: color-mix(in oklch, var(--card-bg, #fff) 86%, transparent);
		color: var(--md-tone-body);
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		transition:
			border-color 0.25s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1)),
			background 0.25s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1)),
			box-shadow 0.25s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.msel__button:hover {
		border-color: color-mix(in oklch, var(--primary) 40%, transparent);
		background: color-mix(in oklch, var(--primary) 7%, var(--card-bg, #fff));
	}

	.msel__button[aria-expanded="true"] {
		border-color: color-mix(in oklch, var(--primary) 52%, transparent);
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--primary) 16%, transparent);
	}

	.msel__text {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.msel__chev {
		flex: 0 0 auto;
		font-size: 1rem;
		color: color-mix(in oklch, var(--primary) 70%, var(--md-tone-muted, #64748b));
		transition: transform 0.25s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.msel__chev--open {
		transform: rotate(180deg);
	}

	.msel__panel {
		position: absolute;
		top: calc(100% + 0.3rem);
		left: 0;
		z-index: 40;
		display: grid;
		gap: 0.1rem;
		min-width: 100%;
		max-height: 15rem;
		padding: 0.3rem;
		overflow: auto;
		border: 1px solid color-mix(in oklch, var(--primary) 22%, var(--card-border, #dce5e5));
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--card-bg, #fff) 96%, transparent);
		box-shadow:
			0 18px 40px -26px rgb(15 23 42 / 0.55),
			0 2px 8px -6px rgb(15 23 42 / 0.3);
	}

	.msel__panel--right {
		left: auto;
		right: 0;
	}

	.msel__option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 1.9rem;
		padding: 0.18rem 0.5rem;
		border: 0;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--md-tone-body);
		font: inherit;
		font-size: 0.72rem;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.18s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1)),
			color 0.18s var(--ease-tech, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.msel__option:hover {
		background: color-mix(in oklch, var(--primary) 10%, transparent);
		color: var(--primary);
	}

	.msel__option--on {
		color: var(--primary);
		font-weight: 600;
		background: color-mix(in oklch, var(--primary) 12%, transparent);
	}

	.msel__check {
		flex: 0 0 auto;
		font-size: 1rem;
		color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.msel__button,
		.msel__chev,
		.msel__option {
			transition: none;
		}
	}
</style>
