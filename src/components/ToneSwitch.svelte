<script lang="ts">
import {
	DEFAULT_MOOD,
	MOOD_EVENT,
	MOOD_PRESETS,
	SOURCE_EVENT,
	moodForSource,
	readStoredMood,
	setMood,
	type ThemeMood,
} from "@utils/theme-mood";
import { onMount } from "svelte";

let mood: ThemeMood = DEFAULT_MOOD;

onMount(() => {
	mood = readStoredMood();
	// 反向联动：播放器里换了平台，博客色调跟着换。
	// 这里只更新状态、不再派发 MOOD_EVENT，否则两个组件会互相触发成环。
	const onSourceChanged = (event: Event) => {
		const source = (event as CustomEvent<{ source?: string }>).detail?.source;
		if (!source) return;
		const next = moodForSource(source);
		if (next === mood) return;
		mood = next;
		setMood(next);
	};
	window.addEventListener(SOURCE_EVENT, onSourceChanged);
	return () => window.removeEventListener(SOURCE_EVENT, onSourceChanged);
});

function toggleTone() {
	mood = mood === "cool" ? "warm" : "cool";
	setMood(mood);
	// 正向联动：色调变了就通知播放器换到对应平台。
	window.dispatchEvent(new CustomEvent(MOOD_EVENT, { detail: { mood } }));
}
</script>

<button
	class="tone-switch"
	class:tone-switch--warm={mood === "warm"}
	type="button"
	role="switch"
	aria-checked={mood === "warm"}
	aria-label={`色调：${MOOD_PRESETS[mood].label}，点击切换`}
	title={`色调：${MOOD_PRESETS[mood].label}`}
	onclick={toggleTone}
>
	<span class="tone-switch__opts" aria-hidden="true">
		<span class="tone-switch__dot tone-switch__dot--cool"></span>
		<span class="tone-switch__dot tone-switch__dot--warm"></span>
	</span>
	<span class="tone-switch__thumb" aria-hidden="true"></span>
</button>

<style>
	/* 与播放器里的「源切换」同款滑钮：轨道 + 滑动拇指。
	   两个圆点是图标替代物 —— 冷青/暖橘本身就是色相，用色点比用字形更直观。 */
	.tone-switch {
		position: relative;
		display: inline-block;
		width: 3.05rem;
		height: 1.85rem;
		padding: 0.16rem;
		border: 1px solid
			color-mix(in oklch, var(--primary) 26%, var(--card-border, #dce5e5));
		border-radius: 999px;
		background: color-mix(in oklch, var(--primary) 10%, var(--page-bg, #f8fafc));
		cursor: pointer;
		vertical-align: middle;
		transition:
			background 0.4s cubic-bezier(0.16, 1, 0.3, 1),
			border-color 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.tone-switch:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.tone-switch__opts {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		height: 100%;
		align-items: center;
		justify-items: center;
	}
	.tone-switch__dot {
		width: 0.86rem;
		height: 0.86rem;
		border-radius: 999px;
		opacity: 0.5;
		transition:
			opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.tone-switch__dot--cool {
		background: oklch(0.70 0.14 200);
	}
	.tone-switch__dot--warm {
		background: oklch(0.70 0.15 52);
	}
	.tone-switch:not(.tone-switch--warm) .tone-switch__dot--cool,
	.tone-switch--warm .tone-switch__dot--warm {
		opacity: 1;
		transform: scale(1.08);
	}
	.tone-switch__thumb {
		position: absolute;
		top: 0.16rem;
		left: 0.16rem;
		z-index: 0;
		width: calc(50% - 0.16rem);
		height: calc(100% - 0.32rem);
		border-radius: 999px;
		background: var(--card-bg, #fff);
		box-shadow:
			0 4px 12px -10px rgb(15 23 42 / 0.7),
			0 0 0 1px color-mix(in oklch, var(--primary) 28%, transparent);
		transform: translateX(0);
		transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.tone-switch--warm .tone-switch__thumb {
		transform: translateX(100%);
	}
	@media (prefers-reduced-motion: reduce) {
		.tone-switch,
		.tone-switch__dot,
		.tone-switch__thumb {
			transition: none;
		}
	}
</style>
