# SkillsCat 开发计划

## 阶段一：项目初始化

### 1.1 Monorepo 搭建
- [ ] 初始化 Turborepo
- [ ] 配置 pnpm workspace
- [ ] 创建 apps/web (SvelteKit 主站)
- [ ] 创建 packages/shared (共享类型和工具)
- [ ] 创建 packages/db (Drizzle schema)

### 1.2 SvelteKit 项目配置
- [ ] 初始化 SvelteKit 项目
- [ ] 配置 Cloudflare adapter
- [ ] 配置 UnoCSS + Tailwind preset
- [ ] 配置 Vite 构建
- [ ] 配置 TypeScript

### 1.3 样式系统
- [ ] 定义 OKLCH 色彩变量
- [ ] 配置亮色/暗色主题
- [ ] 设置淡米黄色基准背景
- [ ] 配置 Bits UI
- [ ] 创建基础 CSS reset

---

## 阶段二：数据层

### 2.1 数据库设计
- [ ] 创建 Drizzle schema
- [ ] 配置 D1 数据库
- [ ] 编写 migration 脚本
- [ ] 创建种子数据

### 2.2 认证系统
- [ ] 配置 Better Auth
- [ ] 实现 GitHub OAuth
- [ ] 实现 Google OAuth
- [ ] 创建 session 管理

### 2.3 R2 存储
- [ ] 配置 R2 bucket
- [ ] 实现文件上传/下载工具
- [ ] 创建缓存策略

---

## 阶段三：核心组件

### 3.1 布局组件
- [ ] Navbar 组件
- [ ] Footer 组件
- [ ] 页面布局模板
- [ ] 响应式设计

### 3.2 Skills 卡片
- [ ] 标准卡片组件
- [ ] Compact 卡片组件
- [ ] 卡片 Grid 组件
- [ ] 加载骨架屏

### 3.3 通用组件
- [ ] 搜索框组件
- [ ] 分页组件
- [ ] 按钮组件
- [ ] 下拉菜单组件
- [ ] 对话框组件
- [ ] Toast 通知

---

## 阶段四：页面开发

### 4.1 首页
- [ ] 统计横幅
- [ ] Trending 区块
- [ ] Recent 区块
- [ ] Top 区块

### 4.2 列表页面
- [ ] /trending 页面
- [ ] /recent 页面
- [ ] /top 页面
- [ ] 无限滚动实现

### 4.3 详情页
- [ ] 双栏布局
- [ ] 文件浏览器组件
- [ ] Markdown 渲染
- [ ] Shiki 代码高亮
- [ ] 安装模块
- [ ] 相关推荐

### 4.4 分类页面
- [ ] 分类总览页
- [ ] 分类列表页

### 4.5 用户页面
- [ ] 登录对话框
- [ ] 收藏页面
- [ ] 用户菜单

### 4.6 法律页面
- [ ] Privacy Policy
- [ ] Terms of Service

---

## 阶段五：API 开发

### 5.1 公开 API
- [ ] Skills CRUD
- [ ] 搜索 API
- [ ] 分类 API
- [ ] 作者 API
- [ ] 统计 API

### 5.2 用户 API
- [ ] 收藏管理
- [ ] Skills 提交
- [ ] 行为记录

---

## 阶段六：后台 Workers

### 6.1 消息队列配置
- [ ] 配置 Cloudflare Queues
- [ ] 创建队列: indexing, classification

### 6.2 GitHub Events Worker
- [ ] 轮询逻辑
- [ ] 事件过滤
- [ ] 消息发送

### 6.3 Indexing Worker
- [ ] GitHub API 集成
- [ ] 数据入库
- [ ] R2 缓存

### 6.4 Classification Worker
- [ ] OpenRouter 集成
- [ ] DeepSeek 备用
- [ ] 分类逻辑

### 6.5 Trending Worker
- [ ] Cron 配置
- [ ] 指数计算

---

## 阶段七：功能完善

### 7.1 安装功能
- [ ] File System Access API
- [ ] 命令生成
- [ ] 打包下载

### 7.2 搜索优化
- [ ] 全文搜索
- [ ] 搜索建议
- [ ] 搜索历史

### 7.3 SEO
- [ ] Meta 标签
- [ ] Open Graph
- [ ] 结构化数据
- [ ] Sitemap

---

## 阶段八：测试与部署

### 8.1 测试
- [ ] 单元测试
- [ ] E2E 测试
- [ ] 性能测试

### 8.2 部署
- [ ] Wrangler 配置
- [ ] CI/CD 流程
- [ ] 环境变量管理

---

## 技术决策记录

### UnoCSS 配置
使用 `@unocss/preset-wind` (Tailwind 兼容)，不使用 Tailwind v4。

### 状态管理
使用 Svelte 5 的 runes ($state, $derived) 进行状态管理。

### 数据获取
使用 SvelteKit 的 load 函数进行 SSR 数据获取。

### 图标
使用 `@iconify/svelte` 或 UnoCSS icons preset。
