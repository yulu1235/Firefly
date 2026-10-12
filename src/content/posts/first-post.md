---
title: "我的第一篇（把标题改成你想写的）"
published: 2026-10-12
description: "一句话摘要，会显示在文章列表和分享卡片上。"
tags: []
category: ""
draft: true
---

> 这是一篇**草稿**：frontmatter 里 `draft: true`，所以它不会出现在文章列表、归档、标签和 RSS 里。
>
> 写完把 `draft` 改成 `false`，`git push` 之后 Cloudflare 会自动重建，1~2 分钟就正式上线。
> 想边写边看效果：在 `Firefly` 目录跑 `pnpm dev`（开发模式下草稿也会显示）。

上面那几个字段分别是：

| 字段 | 作用 |
| --- | --- |
| `title` | 文章标题 |
| `published` | 发布日期，格式 `YYYY-MM-DD` |
| `description` | 摘要，用于列表页和分享卡片 |
| `tags` | 标签数组，例如 `["ACG", "折腾"]` |
| `category` | 分类，一个字符串 |
| `draft` | `true` 是草稿（不发布），改成 `false` 才发布 |

正文从这里开始写。Markdown 语法都支持，这个主题另外还支持代码高亮、数学公式、Mermaid / PlantUML 图表、提示框、图片画廊等。

写完记得删掉上面这段说明。
