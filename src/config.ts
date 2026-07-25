import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "衡堕",
	subtitle: "学习笔记与项目记录",
	lang: "zh_CN",
	themeColor: {
		// 贴近原站暖橙 #d97757
		hue: 18,
		fixed: true, // 访客不可改主题色，保持品牌一致
	},
	banner: {
		enable: false,
		src: "assets/images/demo-banner.png",
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	favicon: [],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "GitHub",
			url: "https://github.com/Hongmingbo",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	// 使用 public 下的简单头像；无真人照片
	avatar: "/favicon.svg",
	name: "衡堕",
	bio: "学习笔记与项目记录。AI Agent、前端、自托管、知识管理。",
	links: [
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/Hongmingbo",
		},
		{
			name: "Email",
			icon: "fa6-solid:envelope",
			url: "mailto:hongmingbo2011@gmail.com",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
