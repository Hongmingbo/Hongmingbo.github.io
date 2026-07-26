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
		// 冷青 teal；与原先暖橙 hue 18 区分
		hue: 200,
		fixed: true, // 访客不可改主题色，保持品牌一致
	},
	banner: {
			enable: false,
			src: "", // banner 关闭；demo 资产已删除
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
	// Profile 头像：GitHub avatar 本地缓存
	avatar: "/avatar.jpg",
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
