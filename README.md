# 衡堕

基于 [Fuwari](https://github.com/saicaca/fuwari) 的学习笔记站。

- 站点：https://hongmingbo.github.io
- 主题：Fuwari（Astro 5 + Svelte + Tailwind）
- 身份：衡堕 · 暖橙主题 · 无 Banner

## 本地开发

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
pnpm preview
```

## 写作

在 `src/content/posts/` 新增 Markdown，frontmatter 示例：

```yaml
---
title: 标题
published: 2026-07-26
description: 摘要
tags:
  - 标签
category: 分类
draft: false
---
```

## 归档

- `archive-v1/`：最早项目档案单页
- `archive-custom-v2/`：自研 Astro 深色文字流版本（Fuwari 迁移前）

## 配置

主配置：`src/config.ts`（站名、Profile、导航、主题色 hue、Banner）。
