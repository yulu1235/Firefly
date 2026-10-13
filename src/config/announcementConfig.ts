import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题，留空则走i18n默认标题
	title: "",

	// 公告内容
	content: "新文已上线：用一张图做一条宫崎骏风短片，附全部提示词和 7 个踩坑记录。",

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: true,
		// 链接文本
		text: "去看看",
		// 链接 URL
		url: "/posts/ai-ghibli-kwanxin-recipe/",
		// 内部链接
		external: false,
	},
};
