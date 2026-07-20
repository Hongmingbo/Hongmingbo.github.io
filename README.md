# Hmingbo 个人博客

> 深色文字流中文博客 · Astro 5 · 部署在 GitHub Pages

**在线访问**: https://hongmingbo.github.io

## 内容结构

- `/` 首页 — Hero + 精选文章 + 最新文章 + 精选项目
- `/blog/` 文章列表 — 按时间倒序,支持标签筛选
- `/blog/<slug>/` 文章详情 — Markdown 渲染 + 阅读进度
- `/tags/` 标签聚合
- `/projects/` 项目展示
- `/about/` 关于
- `/rss.xml` RSS 订阅
- `/sitemap-index.xml` 站点地图

## 本地开发

```bash
npm install
npm run dev       # http://localhost:4321
```

## 构建与部署

```bash
npm run build     # 产物在 dist/
npm run preview   # 本地预览构建产物
```

push 到 `main` 分支后,GitHub Actions (`.github/workflows/deploy.yml`) 会自动构建并部署到 GitHub Pages。

## 写作

在 `src/content/blog/` 新增 `.md` 文件,带 frontmatter:

```markdown
---
title: 文章标题
description: 一句话描述,用于列表页摘要与 SEO
pubDate: 2026-07-20
tags:
  - AI Agent
  - 方法论
featured: false   # true 则显示在首页"精选"
draft: false      # true 则不出现在构建产物
---

正文...
```

## 旧版归档

`archive-v1/` 保留了 2026-07-20 之前的纯 HTML/CSS/JS 项目档案站,仅作历史保留。

## 技术栈

- [Astro 5](https://astro.build) — 静态站点生成
- Content Collections — Markdown 内容管理
- @astrojs/rss — RSS 订阅
- @astrojs/sitemap — 站点地图
- GitHub Actions — 自动部署
