// ============================================
// 项目数据
// ============================================
const projects = {
  'obsidian-vault': {
    title: 'Obsidian Vault',
    type: '知识管理',
    tags: ['Obsidian', 'Python', 'AI', 'Markdown', '知识管理'],
    detail: `
      <h4>项目概述</h4>
      <p>个人知识库与内容创作工作流，结合 Obsidian + Hermes Agent，实现从内容采集到知识沉淀的全链路自动化。</p>
      <h4>核心功能</h4>
      <ul>
        <li>4 文件夹结构：选题 / 竞品 / 方法论 / 灵感</li>
        <li>三层记忆体系：Global / Important / Temporary</li>
        <li>Markdown → Word / HTML / PDF 输出流水线</li>
        <li>零凭证规则 + 安全记忆管理</li>
      </ul>
      <h4>技术亮点</h4>
      <ul>
        <li>Hermes Agent 集成：skills、profiles、memory store 全链路打通</li>
        <li>Playwright WebKit 截图 + 内容提取</li>
        <li>多格式文档转换（mdstyle skill）</li>
        <li>Obsidian vault 作为单一事实来源</li>
      </ul>
      <h4>链接</h4>
      <p><a href="https://github.com/Hongmingbo/obsidian-vault" target="_blank" rel="noreferrer">项目仓库</a></p>
    `
  },
  'monitoring': {
    title: '监控系统',
    type: '基础设施',
    tags: ['Docker', '监控', '自托管', 'Uptime', 'Healthchecks'],
    detail: `
      <h4>项目概述</h4>
      <p>围绕自托管服务建立监控、告警和备份机制，确保本地服务稳定可见。</p>
      <h4>组成</h4>
      <ul>
        <li>Uptime Kuma 监控</li>
        <li>Healthchecks 心跳</li>
        <li>Docker Compose 编排</li>
        <li>Windows 环境下的可重复部署</li>
      </ul>
    `
  },
  'cloudflared': {
    title: 'Cloudflare Tunnel',
    type: '网络 / 部署',
    tags: ['Cloudflare', 'Tunnel', 'WARP', 'Docker'],
    detail: `
      <h4>项目概述</h4>
      <p>使用 Cloudflare Tunnel 将 Docker 服务安全暴露到公网，减少端口暴露与手工配置成本。</p>
      <h4>价值</h4>
      <ul>
        <li>避免直接开放端口</li>
        <li>更适合自托管服务长期运行</li>
        <li>便于和多个后台服务统一管理</li>
      </ul>
    `
  },
  'memory-system': {
    title: '记忆系统',
    type: '架构研究',
    tags: ['Hermes', '记忆', '知识沉淀', '架构'],
    detail: `
      <h4>项目概述</h4>
      <p>分层记忆、生命周期、会话结束和长期沉淀之间的边界设计。</p>
      <h4>目标</h4>
      <ul>
        <li>减少重复解释</li>
        <li>保留可复用经验</li>
        <li>让未来项目更少返工</li>
      </ul>
    `
  },
  'vibe-coding': {
    title: 'Vibe Coding',
    type: '方法论研究',
    tags: ['AI', 'Prompt Engineering', 'Claude', 'GEO', '自媒体'],
    detail: `
      <h4>项目概述</h4>
      <p>AI 编程方法论研究：精读 14 个 Vibe Coding 教程文件，提取 38 条可迁移方法论，涵盖意图驱动编程、产品变现、SEO/GEO 优化、自媒体运营四大维度。</p>
      <h4>核心原则</h4>
      <ul>
        <li><strong>意图驱动</strong>：从“怎么做”转向“做什么”，母语比语法重要</li>
        <li><strong>先做再学</strong>：完成第一个项目后按需补知识</li>
        <li><strong>小步快跑</strong>：每轮对话提 1-5 个具体需求</li>
        <li><strong>AGENTS.md 约束</strong>：项目级规则文件自动遵守约定</li>
      </ul>
    `
  }
};

// ============================================
// Research Data
// ============================================
const research = {
  'lusion-study': {
    title: 'Lusion 风格研究',
    type: '设计研究',
    tags: ['3D', '氛围', '排版'],
    detail: `
      <h4>研究范围</h4>
      <p>研究高端品牌站如何通过光效、空间层次、动效节奏和中文排版建立高级感。</p>
      <h4>可迁移原则</h4>
      <ul>
        <li>首屏不塞满内容，留出呼吸空间</li>
        <li>标题大、正文短、按钮少而准</li>
        <li>深浅背景都要控制光效和对比</li>
      </ul>
    `
  },
  'automation-workflow': {
    title: '自动化工作流',
    type: '工作流研究',
    tags: ['Playwright', 'RSS', '监控'],
    detail: `
      <h4>研究范围</h4>
      <p>把采集、整理、输出和监控拆成稳定的模块，避免一次性脚本无法维护。</p>
      <h4>结论</h4>
      <ul>
        <li>可重复比一次性更重要</li>
        <li>结果可验证比描述可看更重要</li>
        <li>故障时先保留数据，再谈优化</li>
      </ul>
    `
  },
  'android-reverse': {
    title: 'Android 逆向与分析',
    type: '技术研究',
    tags: ['Android', 'JADX', 'Apktool', '调试'],
    detail: `
      <h4>项目概述</h4>
      <p>Android APK 结构分析与调试工作流，覆盖反编译、资源提取、主 Activity 和方法定位。</p>
      <h4>价值</h4>
      <ul>
        <li>更快理解第三方 APK 的结构</li>
        <li>为后续自动化分析提供模板</li>
        <li>对 Android 工具链工程化有帮助</li>
      </ul>
    `
  },
  'memory-ops': {
    title: '记忆操作协议',
    type: '治理研究',
    tags: ['Hermes', '记忆', '流程'],
    detail: `
      <h4>研究范围</h4>
      <p>整理长期记忆、会话总结和技能沉淀之间的分工，降低上下文污染。</p>
      <h4>目标</h4>
      <ul>
        <li>减少重复解释</li>
        <li>保留可复用经验</li>
        <li>让未来项目更少返工</li>
      </ul>
    `
  }
};

// ============================================
// 渲染
// ============================================
function cardHtml(items, kind) {
  return Object.entries(items).map(([id, item]) => `
    <article class="project-card reveal" onclick="openProject('${id}')">
      <div class="project-topline">
        <span>${item.type}</span>
        <span>${kind}</span>
      </div>
      <h3 class="project-title">${item.title}</h3>
      <div class="project-tags-top">
        ${item.tags.map((tag) => `<span>${tag}</span>`).join('')}
      </div>
      <p class="project-desc">${item.detail.replace(/<[^>]+>/g, '').slice(0, 96)}…</p>
      <div class="project-view">查看详情 <span class="arrow">→</span></div>
    </article>
  `).join('');
}

document.getElementById('projectGrid').innerHTML = cardHtml(projects, '项目');
document.getElementById('researchGrid').innerHTML = cardHtml(research, '研究');

// ============================================
// Project Modal
// ============================================
function openProject(id) {
  const all = { ...projects, ...research };
  const p = all[id];
  const modal = document.getElementById('projectModal');
  const body = document.getElementById('projectModalBody');
  body.innerHTML = `
    <div class="modal-head">
      <p class="modal-type">${p.type}</p>
      <h3>${p.title}</h3>
    </div>
    <div class="modal-tags">${p.tags.map((tag) => `<span>${tag}</span>`).join('')}</div>
    <div class="modal-detail">${p.detail}</div>
  `;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeProject() {
  const modal = document.getElementById('projectModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.getElementById('closeProject').addEventListener('click', closeProject);

// ============================================
// 粒子背景
// ============================================
class ParticleField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.resize();
    this.init();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(() => this.animate());
  }

  resize() {
    this.width = this.canvas.width = window.innerWidth * devicePixelRatio;
    this.height = this.canvas.height = window.innerHeight * devicePixelRatio;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  init() {
    const total = Math.min(120, Math.floor(window.innerWidth / 16));
    this.particles = Array.from({ length: total }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: Math.random() * 2.2 + 0.6,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      a: Math.random() * 0.7 + 0.2,
    }));
  }

  animate() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = this.width + 20;
      if (p.x > this.width + 20) p.x = -20;
      if (p.y < -20) p.y = this.height + 20;
      if (p.y > this.height + 20) p.y = -20;
      ctx.globalAlpha = p.a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(() => this.animate());
  }
}

// ============================================
// Loader / Scroll / Cursor
// ============================================
(function loader() {
  const loader = document.getElementById('loader');
  const fill = document.getElementById('loaderFill');
  const num = document.getElementById('loaderNum');
  const percent = document.getElementById('loaderPercent');
  let progress = 0;
  function step() {
    progress += (100 - progress) * 0.06 + 0.5;
    const value = Math.min(100, Math.floor(progress));
    fill.style.width = value + '%';
    num.textContent = value;
    percent.textContent = value + '%';
    if (value < 100) requestAnimationFrame(step);
    else setTimeout(() => loader.classList.add('hidden'), 240);
  }
  requestAnimationFrame(step);
})();

window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 60);
  const progress = document.getElementById('scrollProgress');
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? window.scrollY / docHeight : 0;
  progress.style.transform = `scaleX(${pct})`;
  document.getElementById('scrollHint').classList.toggle('hidden', window.scrollY > window.innerHeight * 0.3);
}, { passive: true });

document.addEventListener('mousemove', (e) => {
  const cursor = document.getElementById('cursor');
  const dot = document.getElementById('cursorDot');
  if (cursor) cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  if (dot) dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('particles');
  if (canvas) new ParticleField(canvas);
  document.getElementById('projectModal').addEventListener('click', (e) => {
    if (e.target.id === 'projectModal') closeProject();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProject();
  });
});
