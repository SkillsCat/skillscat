# SkillsCat UI 设计指南

## 一、设计理念

### 1.1 核心风格
**"专业但不失可爱，简约但有温度"**

我们追求的是：
- **简约清爽**: 参考 Notion、Linear 的极简美学
- **温暖亲切**: 淡米黄色背景营造舒适氛围
- **灵动可爱**: 手绘风格插画和圆润的设计元素
- **专业可信**: 保持开发者工具应有的专业感

### 1.2 设计参考

| 参考来源 | 借鉴元素 |
|---------|---------|
| [cursor.com](https://cursor.com) | 淡米黄色背景、专业感 |
| [anuneko.com](https://anuneko.com) | 手绘风格、可爱元素 |
| [Notion](https://notion.so) | 极简布局、隐藏复杂性 |
| [Linear](https://linear.app) | 键盘优先、无杂乱 |
| [99designs Kawaii](https://99designs.com/inspiration/designs/kawaii) | 可爱设计灵感 |

---

## 二、配色系统 (OKLCH)

### 2.1 为什么选择 OKLCH？

OKLCH 是感知均匀的色彩空间，优势包括：
- 调整亮度不会导致色相漂移
- 更容易创建无障碍配色
- 生成的颜色过渡更自然

### 2.2 基础色板

```css
:root {
  /* ===== 背景色 ===== */
  /* 淡米黄色基准背景 (参考 cursor.com) */
  --bg-base: oklch(97% 0.02 85);           /* 最浅背景 */
  --bg-subtle: oklch(95% 0.025 85);        /* 卡片背景 */
  --bg-muted: oklch(92% 0.03 85);          /* 悬停状态 */
  --bg-emphasis: oklch(88% 0.04 85);       /* 强调区域 */

  /* ===== 前景色 ===== */
  --fg-default: oklch(25% 0.02 85);        /* 主文字 */
  --fg-muted: oklch(45% 0.02 85);          /* 次要文字 */
  --fg-subtle: oklch(60% 0.02 85);         /* 辅助文字 */
  --fg-on-emphasis: oklch(98% 0.01 85);    /* 强调背景上的文字 */

  /* ===== 主题色 (可爱橙黄) ===== */
  --primary: oklch(75% 0.15 70);           /* 主色 */
  --primary-hover: oklch(70% 0.17 70);     /* 悬停 */
  --primary-active: oklch(65% 0.18 70);    /* 按下 */
  --primary-subtle: oklch(92% 0.06 70);    /* 淡色背景 */

  /* ===== 强调色 (可爱粉) ===== */
  --accent: oklch(75% 0.12 350);           /* 强调色 */
  --accent-subtle: oklch(94% 0.04 350);    /* 淡色背景 */

  /* ===== 功能色 ===== */
  --success: oklch(70% 0.15 145);          /* 成功 - 清新绿 */
  --warning: oklch(80% 0.14 85);           /* 警告 - 暖黄 */
  --error: oklch(65% 0.18 25);             /* 错误 - 柔红 */
  --info: oklch(70% 0.12 240);             /* 信息 - 天蓝 */

  /* ===== 边框 ===== */
  --border-default: oklch(88% 0.02 85);
  --border-muted: oklch(92% 0.015 85);
  --border-emphasis: oklch(80% 0.03 85);
}

/* ===== 暗色主题 ===== */
:root.dark {
  --bg-base: oklch(18% 0.02 85);
  --bg-subtle: oklch(22% 0.025 85);
  --bg-muted: oklch(26% 0.03 85);
  --bg-emphasis: oklch(32% 0.04 85);

  --fg-default: oklch(92% 0.02 85);
  --fg-muted: oklch(70% 0.02 85);
  --fg-subtle: oklch(55% 0.02 85);

  --primary: oklch(78% 0.14 70);
  --primary-hover: oklch(82% 0.15 70);
  --primary-subtle: oklch(30% 0.08 70);

  --accent: oklch(78% 0.11 350);
  --accent-subtle: oklch(28% 0.06 350);

  --border-default: oklch(30% 0.02 85);
  --border-muted: oklch(25% 0.015 85);
  --border-emphasis: oklch(40% 0.03 85);
}
```

### 2.3 语义化颜色 Token

```css
:root {
  /* 文字层级 */
  --text-primary: var(--fg-default);
  --text-secondary: var(--fg-muted);
  --text-tertiary: var(--fg-subtle);

  /* 交互状态 */
  --interactive-default: var(--primary);
  --interactive-hover: var(--primary-hover);
  --interactive-active: var(--primary-active);

  /* 表面层级 */
  --surface-page: var(--bg-base);
  --surface-card: var(--bg-subtle);
  --surface-overlay: var(--bg-muted);
}
```

---

## 三、字体系统

### 3.1 字体栈

```css
:root {
  /* 主字体 - 系统字体栈 (参考 Notion) */
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  /* 等宽字体 - 代码展示 */
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code",
    "Roboto Mono", Menlo, Monaco, Consolas, monospace;

  /* 手写风格字体 - 可爱元素 (可选) */
  --font-handwritten: "Comic Neue", "Patrick Hand", cursive;
}
```

### 3.2 字号比例

基于 1.25 的模数比例 (Major Third):

```css
:root {
  --text-xs: 0.64rem;    /* 10.24px */
  --text-sm: 0.8rem;     /* 12.8px */
  --text-base: 1rem;     /* 16px */
  --text-lg: 1.25rem;    /* 20px */
  --text-xl: 1.563rem;   /* 25px */
  --text-2xl: 1.953rem;  /* 31.25px */
  --text-3xl: 2.441rem;  /* 39px */
  --text-4xl: 3.052rem;  /* 48.8px */
}
```

### 3.3 行高与字重

```css
:root {
  /* 行高 */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* 字重 */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

---

## 四、间距系统

### 4.1 间距比例

基于 4px 基准单位:

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */
}
```

### 4.2 圆角

可爱风格偏好大圆角:

```css
:root {
  --radius-sm: 0.375rem;   /* 6px - 小按钮 */
  --radius-md: 0.5rem;     /* 8px - 输入框 */
  --radius-lg: 0.75rem;    /* 12px - 卡片 */
  --radius-xl: 1rem;       /* 16px - 大卡片 */
  --radius-2xl: 1.5rem;    /* 24px - 模态框 */
  --radius-full: 9999px;   /* 圆形 - 头像/标签 */
}
```

---

## 五、图标系统

### 5.1 主图标库: Hugeicons

选择理由：
- 46,000+ 图标，覆盖广泛
- 10 种风格，包括 Stroke、Twotone、Bulk 等
- 支持 Svelte
- MIT 许可证

**安装:**
```bash
pnpm add hugeicons-svelte
```

**使用示例:**
```svelte
<script>
  import { Home01Icon, SearchIcon } from 'hugeicons-svelte';
</script>

<Home01Icon size={24} strokeWidth={1.5} />
```

**推荐风格:**
- **默认**: Stroke Rounded (线条圆角) - 日常图标
- **强调**: Twotone (双色) - 重要操作
- **填充**: Bulk (批量填充) - 选中状态

### 5.2 可爱装饰图标

除了 Hugeicons，我们使用手绘风格的装饰性插画：

**来源选项:**
1. **自制 SVG 插画** - 品牌一致性最好
2. **[Flaticon Kawaii](https://www.flaticon.com/search?word=kawaii)** - 可爱风格图标
3. **[Undraw](https://undraw.co/)** - 可自定义颜色的插画
4. **[Open Doodles](https://www.opendoodles.com/)** - 手绘人物

### 5.3 图标使用规范

```
尺寸规范:
├── 16px - 内联小图标 (文字旁)
├── 20px - 按钮图标
├── 24px - 导航图标 (默认)
├── 32px - 卡片图标
└── 48px+ - 装饰性大图标

颜色规范:
├── 交互图标: currentColor (继承文字颜色)
├── 装饰图标: 使用主题色或强调色
└── 状态图标: 使用对应功能色
```

---

## 六、组件设计规范

### 6.1 按钮 (Button)

```
变体:
├── Primary   - 主要操作 (橙黄背景)
├── Secondary - 次要操作 (透明/淡色背景)
├── Ghost     - 幽灵按钮 (无背景)
├── Outline   - 边框按钮
└── Cute      - 可爱风格 (圆润 + 阴影)

尺寸:
├── sm: h-8 px-3 text-sm
├── md: h-10 px-4 text-base (默认)
└── lg: h-12 px-6 text-lg

状态:
├── default → hover → active → focus → disabled
└── 过渡: transition-all duration-200 ease-out
```

**可爱按钮特点:**
- 较大圆角 (radius-lg 或 radius-full)
- 柔和阴影 (shadow-sm)
- 悬停时轻微上浮 (-translate-y-0.5)
- 可添加小图标或 emoji

### 6.2 卡片 (Card)

```
层级:
├── surface-card 背景
├── border-default 边框 (可选)
├── radius-lg 圆角
└── shadow-sm 阴影 (悬停时 shadow-md)

内边距:
├── Compact: p-3
├── Default: p-4
└── Spacious: p-6

交互卡片:
├── 悬停: 轻微上浮 + 阴影增强
├── 过渡: transition-all duration-200
└── 光标: cursor-pointer
```

### 6.3 输入框 (Input)

```
样式:
├── 背景: bg-base (浅) 或 bg-subtle
├── 边框: border border-default
├── 圆角: radius-md
├── 聚焦: ring-2 ring-primary/30 border-primary

状态:
├── placeholder: text-tertiary
├── focus: 环形高亮
├── error: border-error
└── disabled: opacity-50 cursor-not-allowed
```

### 6.4 标签 (Tag/Badge)

```
变体:
├── Default  - 灰色背景
├── Primary  - 主题色淡背景
├── Success  - 绿色淡背景
├── Warning  - 黄色淡背景
├── Error    - 红色淡背景
└── Cute     - 圆润 + 渐变 + 小图标

样式:
├── 圆角: radius-full
├── 内边距: px-2.5 py-0.5
├── 字号: text-xs 或 text-sm
└── 字重: font-medium
```

---

## 七、动效规范

### 7.1 时长规范

```css
:root {
  --duration-fast: 150ms;     /* 微交互 */
  --duration-normal: 200ms;   /* 常规过渡 */
  --duration-slow: 300ms;     /* 复杂动画 */
  --duration-slower: 500ms;   /* 大范围变化 */
}
```

### 7.2 缓动函数

```css
:root {
  /* 标准缓动 */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);

  /* 弹性 - 可爱感 */
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* 进入 */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);

  /* 退出 */
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
}
```

### 7.3 可爱微交互

```
按钮悬停:
└── transform: translateY(-2px)
    box-shadow: 增强
    transition: var(--duration-fast) var(--ease-bounce)

卡片悬停:
└── transform: translateY(-4px)
    box-shadow: 0 8px 25px rgba(0,0,0,0.1)
    transition: var(--duration-normal) var(--ease-out)

图标旋转:
└── :hover svg { transform: rotate(15deg) }

数字跳动:
└── 计数变化时的弹跳动画 (如 star 数量)

加载动画:
└── 可爱风格的骨架屏 + 呼吸效果
```

---

## 八、布局规范

### 8.1 页面最大宽度

```css
:root {
  --max-width-prose: 65ch;       /* 文章内容 */
  --max-width-content: 1200px;   /* 主内容区 */
  --max-width-wide: 1400px;      /* 宽布局 */
  --max-width-full: 100%;        /* 全宽 */
}
```

### 8.2 响应式断点

```css
/* UnoCSS 断点配置 */
breakpoints: {
  'sm': '640px',   /* 手机横屏 */
  'md': '768px',   /* 平板 */
  'lg': '1024px',  /* 小桌面 */
  'xl': '1280px',  /* 桌面 */
  '2xl': '1536px', /* 大桌面 */
}
```

### 8.3 Grid 布局

Skills 卡片 Grid:
```
手机 (< 640px):  1 列
平板 (< 1024px): 2 列
桌面 (< 1280px): 3 列
大桌面:          4 列

间距: gap-4 (16px) 或 gap-6 (24px)
```

---

## 九、可爱元素使用指南

### 9.1 何时使用可爱元素

**适合:**
- 空状态插画
- 成功/完成提示
- 引导性说明
- 品牌吉祥物
- 加载动画
- 节日/特殊活动

**不适合:**
- 核心信息展示
- 数据密集区域
- 错误/警告提示
- 正式法律文本

### 9.2 可爱元素清单

```
装饰性:
├── 猫咪吉祥物 (SkillsCat 品牌)
├── 手绘星星/爱心
├── 可爱云朵
├── 小花/植物
└── 彩虹/气泡

功能性:
├── 可爱空状态图 (没有找到结果)
├── 欢迎插画 (首次访问)
├── 完成庆祝动画 (安装成功)
└── 加载中猫咪动画
```

### 9.3 品牌吉祥物: SkillsCat

**设计要点:**
- 简约线条风格
- 圆润的身体
- 大眼睛
- 表情丰富 (开心/思考/惊讶)
- 可以出现在各种场景

**出现场景:**
- Logo 旁
- 空状态
- 加载状态
- 成功提示
- 404 页面

---

## 十、无障碍设计

### 10.1 颜色对比度

确保所有文字与背景的对比度符合 WCAG 2.1 AA 标准：
- 正常文字: ≥ 4.5:1
- 大文字 (18px+): ≥ 3:1
- UI 组件: ≥ 3:1

### 10.2 焦点状态

所有可交互元素必须有清晰的焦点状态:
```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
```

### 10.3 键盘导航

- 所有功能可通过键盘访问
- Tab 顺序合理
- 支持 Escape 关闭弹窗
- 支持 Enter/Space 触发按钮

---

## 十一、设计资源

### 11.1 工具

| 工具 | 用途 |
|------|------|
| [oklch.fyi](https://oklch.fyi/) | OKLCH 颜色选择器 |
| [Atmos](https://atmos.style/playground) | UI 调色板生成 |
| [Hugeicons](https://hugeicons.com/) | 图标库 |
| [Figma](https://figma.com) | 设计稿 |

### 11.2 灵感来源

| 网站 | 借鉴点 |
|------|--------|
| [Dribbble Kawaii](https://dribbble.com/tags/kawaii) | 可爱设计灵感 |
| [99designs Hand-drawn](https://99designs.com/inspiration/websites/hand-drawn) | 手绘风格 |
| [Awwwards](https://www.awwwards.com/) | 优秀网页设计 |
| [Mobbin](https://mobbin.com/) | UI 模式参考 |

### 11.3 参考阅读

- [Hand-Drawing Style In Web Design - Smashing Magazine](https://www.smashingmagazine.com/2008/06/hand-drawing-style-in-modern-web-design-volume-2/)
- [OKLCH in CSS - Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [The Internet's Best Hand Drawn Websites - Creative Market](https://creativemarket.com/blog/the-internets-best-hand-drawn-websites)
