<script lang="ts">
import { AUTO_MODE, DARK_MODE, LIGHT_MODE } from "@constants/constants.ts";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import {
	applyThemeToDocument,
	getStoredTheme,
	setTheme,
} from "@utils/setting-utils.ts";
import { onMount } from "svelte";
import type { LIGHT_DARK_MODE } from "@/types/config.ts";

/**
 * 配色模式：亮｜暗｜跟随系统。
 *
 * 原先是一个圆形图标按钮 + hover 浮层，三选一要点两次。
 * 现在改成和播放器「源切换」同款的三档滑钮：三段并排、白色拇指滑到当前档，
 * 一次点击直达。三态无法用二值 switch 表达，因此语义上用 aria-pressed 的
 * 分段按钮组，而不是 role="switch"（那会谎报只有两种状态）。
 */
const ORDER: LIGHT_DARK_MODE[] = [LIGHT_MODE, DARK_MODE, AUTO_MODE];

const LABELS: Record<LIGHT_DARK_MODE, string> = {
	[LIGHT_MODE]: i18n(I18nKey.lightMode),
	[DARK_MODE]: i18n(I18nKey.darkMode),
	[AUTO_MODE]: i18n(I18nKey.systemMode),
};

let mode: LIGHT_DARK_MODE = $state(AUTO_MODE);

onMount(() => {
	mode = getStoredTheme();
	const darkModePreference = window.matchMedia("(prefers-color-scheme: dark)");
	const changeThemeWhenSchemeChanged: Parameters<
		typeof darkModePreference.addEventListener<"change">
	>[1] = () => {
		applyThemeToDocument(mode);
	};
	darkModePreference.addEventListener("change", changeThemeWhenSchemeChanged);
	return () => {
		darkModePreference.removeEventListener(
			"change",
			changeThemeWhenSchemeChanged,
		);
	};
});

function switchScheme(next: LIGHT_DARK_MODE) {
	if (next === mode) return;
	mode = next;
	setTheme(next);
}
</script>

<div
	class="mode-switch"
	class:mode-switch--dark={mode === DARK_MODE}
	class:mode-switch--auto={mode === AUTO_MODE}
	role="group"
	aria-label="配色模式"
>
	<span class="mode-switch__thumb" aria-hidden="true"></span>
	{#each ORDER as value (value)}
		<button
			class="mode-switch__item"
			class:mode-switch__item--on={mode === value}
			type="button"
			aria-pressed={mode === value}
			aria-label={LABELS[value]}
			title={LABELS[value]}
			onclick={() => switchScheme(value)}
		>
			<Icon
				icon={value === LIGHT_MODE
					? "material-symbols:wb-sunny-outline-rounded"
					: value === DARK_MODE
						? "material-symbols:dark-mode-outline-rounded"
						: "material-symbols:radio-button-partial-outline"}
				class="mode-switch__icon"
			/>
		</button>
	{/each}
</div>

<style>
	.mode-switch {
		position: relative;
		display: inline-grid;
		grid-template-columns: repeat(3, 1fr);
		width: 4.6rem;
		height: 1.85rem;
		padding: 0.16rem;
		border: 1px solid
			color-mix(in oklch, var(--primary) 26%, var(--card-border, #dce5e5));
		border-radius: 999px;
		background: color-mix(in oklch, var(--primary) 10%, var(--page-bg, #f8fafc));
		vertical-align: middle;
		transition:
			background 0.4s cubic-bezier(0.16, 1, 0.3, 1),
			border-color 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.mode-switch__item {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: rgb(100 116 139);
		cursor: pointer;
		transition: color 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	:global(html.dark) .mode-switch__item {
		color: rgb(203 213 225 / 0.75);
	}
	.mode-switch__item--on {
		color: var(--primary);
	}
	.mode-switch__item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}
	.mode-switch__icon {
		font-size: 1rem;
	}
	.mode-switch__thumb {
		position: absolute;
		top: 0.16rem;
		left: 0.16rem;
		z-index: 0;
		width: calc((100% - 0.32rem) / 3);
		height: calc(100% - 0.32rem);
		border-radius: 999px;
		background: var(--card-bg, #fff);
		box-shadow:
			0 4px 12px -10px rgb(15 23 42 / 0.7),
			0 0 0 1px color-mix(in oklch, var(--primary) 28%, transparent);
		transform: translateX(0);
		transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.mode-switch--dark .mode-switch__thumb {
		transform: translateX(100%);
	}
	.mode-switch--auto .mode-switch__thumb {
		transform: translateX(200%);
	}
	@media (prefers-reduced-motion: reduce) {
		.mode-switch,
		.mode-switch__item,
		.mode-switch__thumb {
			transition: none;
		}
	}
</style>
