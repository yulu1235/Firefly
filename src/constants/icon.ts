import type { Favicon } from "@/types/config.ts";

// 站点图标兜底（原本指向本主题的萤火虫图标，已换成自己的图标）。
// 只有在 siteConfig.favicon 为空、或 OG 图 / 结构化数据需要兜底时才会用到；
// light / dark 两套用同一张图（新图标本身是深色夜画面，两种主题下都成立）。
export const defaultFavicons: Favicon[] = [
	{
		src: "/favicon/site-32.png",
		theme: "light",
		sizes: "32x32",
	},
	{
		src: "/favicon/site-128.png",
		theme: "light",
		sizes: "128x128",
	},
	{
		src: "/favicon/site-180.png",
		theme: "light",
		sizes: "180x180",
	},
	{
		src: "/favicon/site-192.png",
		theme: "light",
		sizes: "192x192",
	},
	{
		src: "/favicon/site-32.png",
		theme: "dark",
		sizes: "32x32",
	},
	{
		src: "/favicon/site-128.png",
		theme: "dark",
		sizes: "128x128",
	},
	{
		src: "/favicon/site-180.png",
		theme: "dark",
		sizes: "180x180",
	},
	{
		src: "/favicon/site-192.png",
		theme: "dark",
		sizes: "192x192",
	},
];
