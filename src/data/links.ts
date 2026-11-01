/**
 * 友链数据。
 *
 * 只放真实存在的站点，不放占位/示例数据——空数组时页面会显示诚实的空态，
 * 而不是用假友链把版面填满。
 *
 * 添加一条：
 *   { name: "站点名", url: "https://example.com", avatar: "https://example.com/avatar.png", description: "一句话介绍" }
 *
 * avatar 可省略，省略时用首字母色块兜底。
 */
export interface FriendLink {
	name: string;
	url: string;
	avatar?: string;
	description?: string;
}

export const friendLinks: FriendLink[] = [];
