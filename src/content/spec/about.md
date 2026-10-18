# 关于

学习笔记站点，整理 AI Agent、前端、自托管与知识管理相关的笔记与实践记录。

站点与配套服务自建在香港的一台轻量服务器上：静态博客、评论接口与音乐服务各自独立部署，反向代理与证书自动签发。写下这些实践，是因为其中不少问题是靠日志、抓包和真实设备验证解决的，而不是靠猜测。

## 联系

- GitHub: [Hongmingbo](https://github.com/Hongmingbo)
- Email: [hongmingbo2011@gmail.com](mailto:hongmingbo2011@gmail.com)

## 项目

### 站点基础设施

博客静态站、评论接口与音乐服务三件套，部署在一台境外轻量服务器上，由反向代理统一对外并自动管理证书。

`Caddy` · `Node.js` · `systemd` · `自托管`

### 域名可达性排查

国内访问境外站点时会遇到解析正常但连接被重置的情况。用抓包比对报文特征、用对照域名分离变量，能定位到底是域名、IP 还是端口层面的问题。

`抓包` · `TLS` · `DNS` · `排查方法`

### 音乐服务与播放器

博客内置播放器与独立后端服务，负责会话、歌单、播放流与状态反馈，登录态用 HttpOnly Cookie 承载。

`Svelte` · `Node.js` · `HttpOnly Cookie`

### Obsidian Vault

个人知识库工作流，结合 Obsidian 与 AI Agent，覆盖从采集到沉淀。

`Obsidian` · `Python` · `AI`

### Vibe Coding 研究

精读 Vibe Coding 相关材料，提炼意图驱动、产品变现与 GEO 等可迁移方法。

`AI` · `Prompt Engineering` · `GEO`

### 记忆系统

分层记忆、生命周期与长期沉淀的边界设计，降低重复解释成本。

`Hermes` · `Memory` · `架构`

### Lusion 风格研究

研究高端品牌站如何通过光效、空间层次和动效节奏建立高级感。

`3D` · `排版` · `动效`

### 自动化工作流

把采集、整理、输出和监控拆成稳定模块，避免一次性脚本无法维护。

`Playwright` · `RSS` · `监控`

### 自托管监控

Uptime Kuma 与 Healthchecks 的本地服务监控与告警方案。

`Docker` · `自托管`
