export type ProjectStatus = "production" | "active" | "research" | "private";
export type ProjectKind = "site" | "service" | "tool" | "research";

export type Project = {
	name: string;
	kind: ProjectKind;
	status: ProjectStatus;
	provenance: "original" | "research";
	description: string;
	stack: string[];
	updated: string;
	links?: Array<{ label: string; href: string; external?: boolean }>;
	article?: { label: string; href: string };
};

export const projectStatusLabel: Record<ProjectStatus, string> = {
	production: "PRODUCTION",
	active: "ACTIVE",
	research: "RESEARCH",
	private: "PRIVATE",
};

export const projectKindLabel: Record<ProjectKind, string> = {
	site: "SITE",
	service: "SERVICE",
	tool: "TOOL",
	research: "RESEARCH",
};

export const projects: Project[] = [
	{
		name: "衡堕 · 个人博客",
		kind: "site",
		status: "production",
		provenance: "original",
		description: "以 Astro 与 Fuwari 为基础的学习笔记、项目记录与公开档案站。",
		stack: ["Astro", "Fuwari", "Svelte", "Pagefind"],
		updated: "2026.08",
		links: [
			{ label: "在线站点", href: "https://hmb2011.bond/", external: true },
			{ label: "GitHub", href: "https://github.com/Hongmingbo/Hongmingbo.github.io", external: true },
		],
	},
	{
		name: "MusicDock / Music BFF",
		kind: "service",
		status: "production",
		provenance: "original",
		description: "博客内置音乐播放器与独立音乐服务后端，负责会话、歌单、播放流和状态反馈。",
		stack: ["Svelte", "Node.js", "HttpOnly Cookie", "Cloudflare Tunnel"],
		updated: "2026.08",
		links: [{ label: "音乐入口", href: "https://hmb2011.bond/", external: true }],
		article: { label: "博客中的音乐播放器", href: "/" },
	},
	{
		name: "Checkin Studio",
		kind: "tool",
		status: "active",
		provenance: "original",
		description: "面向自有账号的可视化签到工作台，统一管理多种站点登录、验证、状态探测与失败诊断。",
		stack: ["Flask", "Playwright", "Python", "Windows"],
		updated: "2026.08",
		article: { label: "相关实践记录", href: "/archive/?tag=自托管" },
	},
	{
		name: "视频与媒体处理工具链",
		kind: "tool",
		status: "active",
		provenance: "original",
		description: "围绕视频转写、字幕生成与格式转换整理的本地工具链，优先验证真实输出而不是只完成脚本。",
		stack: ["FunASR", "FFmpeg", "Python", "视频处理"],
		updated: "2026.08",
		article: { label: "相关实践记录", href: "/archive/?tag=开发实践" },
	},
	{
		name: "AI Agent 记忆与知识工作流",
		kind: "research",
		status: "research",
		provenance: "research",
		description: "围绕记忆边界、知识分层、技能复用与验证闭环，整理可迁移的 Agent 工作方法。",
		stack: ["Obsidian", "Hermes", "Markdown", "知识管理"],
		updated: "2026.08",
		article: { label: "阅读 Agent 文章", href: "/posts/ai-agent-operating-system/" },
	},
	{
		name: "Obsidian 知识库工作流",
		kind: "research",
		status: "research",
		provenance: "research",
		description: "把资料采集、结构化整理、长期记忆与公开写作连接起来的个人知识库工作流。",
		stack: ["Obsidian", "Markdown", "Python", "知识管理"],
		updated: "2026.08",
	},
	{
		name: "Android 无 Root 工具研究",
		kind: "research",
		status: "research",
		provenance: "research",
		description: "在无 Root 约束下研究 Shizuku、ADB 与系统工具的可行边界，强调真实设备验证。",
		stack: ["Android", "ADB", "Shizuku", "设备验收"],
		updated: "2026.08",
	},
	{
		name: "Vibe Coding 研究",
		kind: "research",
		status: "research",
		provenance: "research",
		description: "记录 AI 编程中的意图表达、边界设计、产品判断与验证方法。",
		stack: ["AI 编程", "Prompt Engineering", "产品方法论"],
		updated: "2026.07",
		article: { label: "阅读相关文章", href: "/posts/vibe-coding-needs-boundaries/" },
	},
];

export const projectGroups: Array<{ id: ProjectStatus; title: string; note: string }> = [
	{ id: "production", title: "正在运行", note: "已经进入日常使用或公开访问链路的系统。" },
	{ id: "active", title: "持续开发", note: "正在迭代，功能和边界仍在快速收敛。" },
	{ id: "research", title: "研究与工作流", note: "以方法、实验和可迁移经验为主要产出。" },
];