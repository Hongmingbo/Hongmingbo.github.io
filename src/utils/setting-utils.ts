import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import { expressiveCodeConfig, siteConfig } from "@/config";
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
 * 主题色：始终以 config 为准（fixed 品牌色）。
 * 忽略 localStorage 中的旧 hue，避免「闪一下冷青又变回 18」。
 */
export function getHue(): number {
	return getDefaultHue();
}

export function setHue(_hue: number): void {
	const h = getDefaultHue();
	try {
		localStorage.removeItem("hue");
	} catch {
		/* ignore */
	}
	const r = document.querySelector(":root") as HTMLElement;
	if (!r) {
		return;
	}
	r.style.setProperty("--hue", String(h));
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
