import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import { expressiveCodeConfig, siteConfig } from "@/config";
import {
	applyMoodToDocument,
	getMoodHue,
	readStoredMood,
} from "@utils/theme-mood";
import type { LIGHT_DARK_MODE } from "@/types/config";

export function getDefaultHue(): number {
	const fallback = "250";
	const configCarrier = document.getElementById("config-carrier");
	const fromDom = configCarrier?.dataset.hue;
	if (fromDom != null && fromDom !== "") {
		return Number.parseInt(fromDom, 10);
	}
	// SSR/hydration 兜底：与 src/config.ts 一致
	return siteConfig.themeColor.hue ?? Number.parseInt(fallback, 10);
}

/**
 * 主题色相：冷青跟随 config 的品牌色，暖橘用固定值。
 * 旧的 localStorage['hue'] 一律丢弃，避免历史版本写回的 hue 干扰。
 */
export function getHue(): number {
	return getMoodHue(readStoredMood(), getDefaultHue());
}

/**
 * 应用当前色调（冷青/暖橘）。
 * 参数保留是为了兼容旧调用点；实际色相由 mood 决定。
 */
export function setHue(_hue?: number): void {
	try {
		localStorage.removeItem("hue");
	} catch {
		/* ignore */
	}
	applyMoodToDocument(readStoredMood(), getDefaultHue());
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE) {
	switch (theme) {
		case LIGHT_MODE:
			document.documentElement.classList.remove("dark");
			break;
		case DARK_MODE:
			document.documentElement.classList.add("dark");
			break;
		case AUTO_MODE:
			if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
			break;
	}

	// Set the theme for Expressive Code
	document.documentElement.setAttribute(
		"data-theme",
		expressiveCodeConfig.theme,
	);
}

export function setTheme(theme: LIGHT_DARK_MODE): void {
	localStorage.setItem("theme", theme);
	applyThemeToDocument(theme);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	return (localStorage.getItem("theme") as LIGHT_DARK_MODE) || DEFAULT_THEME;
}
