/**
 * 博客色调（mood）：冷青 ↔ 暖橘。
 *
 * 为什么单独抽一层：全站 20 多个颜色令牌都由单一 `--hue` 驱动
 * （--primary / --page-bg / --btn-* / --deep-text …），所以「换色调」
 * 本质是换 hue。但只换 hue 会让中性底还是原来的冷调，看起来像"换了个强调色"，
 * 因此这里同时给 html 打 `data-mood`，由 variables.styl 提供一套暖中性底，
 * 才算是一套独立的样式。
 *
 * 持久化在 localStorage['theme-mood']，并在 Layout 的 pre-paint 内联脚本里
 * 优先执行，避免首屏先闪一下冷青再变暖橘。
 */

export type ThemeMood = "cool" | "warm";

export interface MoodPreset {
	/** 展示名 */
	label: string;
	/** 该色调的基准色相（写进 --hue） */
	hue: number;
}

export const MOOD_STORAGE_KEY = "theme-mood";
export const DEFAULT_MOOD: ThemeMood = "cool";

export const MOOD_PRESETS: Record<ThemeMood, MoodPreset> = {
	cool: { label: "冷青", hue: 200 },
	warm: { label: "暖橘", hue: 52 },
};

/** 任何脏值都收敛到 cool，绝不把非法 hue 写进样式。 */
export function normalizeMood(value: unknown): ThemeMood {
	return value === "warm" ? "warm" : "cool";
}

export function getMoodHue(mood: ThemeMood, fallbackHue?: number): number {
	const preset = MOOD_PRESETS[normalizeMood(mood)];
	// cool 允许跟随 config 里配置的品牌色相；warm 用固定暖橘
	if (normalizeMood(mood) === "cool" && Number.isFinite(fallbackHue)) {
		return Number(fallbackHue);
	}
	return preset.hue;
}

export function readStoredMood(): ThemeMood {
	try {
		return normalizeMood(localStorage.getItem(MOOD_STORAGE_KEY));
	} catch {
		return DEFAULT_MOOD;
	}
}

/** 只负责把状态写到 DOM，不做持久化。 */
export function applyMoodToDocument(mood: ThemeMood, fallbackHue?: number): void {
	const m = normalizeMood(mood);
	const root = document.documentElement;
	root.setAttribute("data-mood", m);
	root.style.setProperty("--hue", String(getMoodHue(m, fallbackHue)));
}

export function setMood(mood: ThemeMood, fallbackHue?: number): void {
	const m = normalizeMood(mood);
	try {
		localStorage.setItem(MOOD_STORAGE_KEY, m);
	} catch {
		/* 隐私模式写不进去也不影响本次生效 */
	}
	applyMoodToDocument(m, fallbackHue);
}
