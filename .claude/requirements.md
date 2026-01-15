# SkillsCat 详细需求文档

## 项目概述

SkillsCat 是一个 Claude Code Skills 收集与分享平台，允许用户发现、安装和分享 AI Agent Skills。

### 技术栈

| 类别 | 技术选型 |
|------|----------|
| 框架 | SvelteKit 2.x |
| UI 组件 | Bits UI + Radix Svelte |
| 样式 | UnoCSS (Tailwind preset, 非 v4) |
| 构建 | Vite + Wrangler |
| 部署 | Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| 存储 | Cloudflare R2 |
| 消息队列 | Cloudflare Queues |
| ORM | Drizzle ORM |
| 认证 | Better Auth (Google + GitHub OAuth) |
| Monorepo | Turborepo |

### 设计风格

- **主题**: 可爱、灵动、有质感
- **配色**: 基于 OKLCH 色彩空间
- **基准背景色**: 淡米黄色 (参考 cursor.com)
- **主题支持**: 亮色/暗色双主题

---

## 一、页面结构

### 1.1 全局组件

#### Navbar
- **左侧**: Logo + 站点标题 "SkillsCat"
- **中部**: 搜索框、分类导航
- **右侧**:
  - 未登录: 登录按钮
  - 已登录: Submit 按钮 + 用户头像下拉菜单

#### Footer
- GitHub 仓库链接
- 相关项目引用: Claude Skills, Codex Skills, Cursor Skills
- 法律页面: Privacy Policy, Terms of Service
- 版权信息

### 1.2 首页 (/)

#### 统计横幅
- 长条卡片展示收录数量
- 文案: "SkillsCat already found {count} agent skills"
- 动态数字动画效果

#### Skills 展示区域

**Trending 区块**
- 标题: "Trending"
- 展示: 4列 × 3行 = 12个卡片
- 排序: 按 trending 指数 (近期 star 增量)
- 查看更多: 链接到 /trending

**Recent 区块**
- 标题: "Recently Added"
- 展示: 4列 × 3行 = 12个卡片
- 排序: 按入库时间倒序
- 查看更多: 链接到 /recent

**Top 区块**
- 标题: "Top Rated"
- 展示: 4列 × 3行 = 12个卡片
- 排序: 按总 star 数倒序
- 查看更多: 链接到 /top

### 1.3 列表页面 (/trending, /recent, /top)

- 页面标题框
- 全局搜索框 (搜索所有 skills，结果在当前页展示)
- 无限滚动 Grid 布局
- 分页支持 (cursor-based pagination)

### 1.4 Skill 详情页 (/:author/:skill)

#### 左栏 (主内容区)

**头部信息**
- 标题 (skill 名称)
- 元信息: stars, forks, 最近更新日期
- 简介描述
- 操作按钮: 收藏、分享

**文件浏览器**
- 树状目录结构
- 文件/文件夹图标区分
- 文件大小显示
- 默认选中 SKILL.md

**内容展示区**
- Markdown 文件: 渲染为 HTML
- 代码文件: Shiki 语法高亮
- 支持文件切换

#### 右栏 (侧边栏)

**作者信息卡片**
- GitHub 头像
- 昵称
- Bio
- 统计: 创建的 skills 数量, 总 star 数

**安装模块**
- 主按钮: Install (Anthropic 格式)
- 下拉选项: Codex, Cursor 等
- 浏览器支持 File System Access API 时:
  - 选择目录安装
- 不支持时:
  - 复制 wget/curl 命令
  - Windows: PowerShell 命令
  - 打包下载按钮
- 移动端: 仅显示复制命令

**GitHub 引导**
- 引导用户去原仓库 star

**相关推荐**
- 最多 10 个相关 skills
- Compact 卡片样式
- 按 star 数排序

### 1.5 分类页面

#### 分类总览 (/categories)
- 一级分类标题
- 二级分类 Grid 卡片
- 每个卡片显示分类名称和 skills 数量

#### 分类列表 (/category/:slug)
- 分类标题
- 搜索框
- Skills Grid (无限滚动)

### 1.6 用户页面

#### 收藏页 (/favorites)
- 用户收藏的 skills Grid
- 需要登录

#### 个人设置 (/settings)
- 账户信息
- 登出选项

### 1.7 法律页面

- /privacy - 隐私政策
- /terms - 服务条款

---

## 二、数据模型

### 2.1 数据库表结构 (D1)

```sql
-- 用户表 (Better Auth 管理)
-- skills 表
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  github_url TEXT NOT NULL UNIQUE,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  star_history TEXT, -- JSON: [{date, count}]
  trending_score REAL DEFAULT 0,
  file_structure TEXT, -- JSON: 目录结构
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

-- 作者表
CREATE TABLE authors (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  skills_count INTEGER DEFAULT 0,
  total_stars INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 分类表
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES categories(id),
  description TEXT,
  skills_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- Skills-分类关联表
CREATE TABLE skill_categories (
  skill_id TEXT REFERENCES skills(id),
  category_id TEXT REFERENCES categories(id),
  PRIMARY KEY (skill_id, category_id)
);

-- 用户收藏表
CREATE TABLE favorites (
  user_id TEXT NOT NULL,
  skill_id TEXT REFERENCES skills(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

-- 用户行为记录表
CREATE TABLE user_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  skill_id TEXT REFERENCES skills(id),
  action_type TEXT NOT NULL, -- 'install', 'copy_command', 'download'
  created_at INTEGER NOT NULL
);
```

### 2.2 R2 存储结构

```
/skills/{author}/{skill}/
  ├── SKILL.md
  ├── ... (其他文件缓存)
  └── _meta.json (元数据)
```

---

## 三、API 设计

### 3.1 公开 API

```
GET  /api/skills                    # 获取 skills 列表
GET  /api/skills/trending           # Trending 列表
GET  /api/skills/recent             # Recent 列表
GET  /api/skills/top                # Top 列表
GET  /api/skills/:author/:skill     # Skill 详情
GET  /api/skills/:author/:skill/files/:path  # 获取文件内容
GET  /api/categories                # 分类列表
GET  /api/categories/:slug          # 分类下的 skills
GET  /api/authors/:username         # 作者信息
GET  /api/search                    # 全局搜索
GET  /api/stats                     # 站点统计
```

### 3.2 认证 API

```
POST /api/auth/signin/google        # Google 登录
POST /api/auth/signin/github        # GitHub 登录
POST /api/auth/signout              # 登出
GET  /api/auth/session              # 获取会话
```

### 3.3 用户 API (需认证)

```
POST /api/skills/submit             # 提交 skill
GET  /api/user/favorites            # 获取收藏
POST /api/user/favorites/:skillId   # 添加收藏
DELETE /api/user/favorites/:skillId # 取消收藏
```

---

## 四、后台 Workers

### 4.1 GitHub Events Worker

**触发方式**: Cloudflare Queue (定时触发)

**功能**:
1. 轮询 GitHub Public Events API
2. 按 x-poll-interval 间隔执行
3. 筛选包含 SKILL.md 的事件
4. 发送入库消息到 Queue

### 4.2 Indexing Worker

**触发方式**: Cloudflare Queue 消息

**功能**:
1. 接收 GitHub URL
2. 获取仓库/文件夹结构
3. 获取作者信息
4. 写入 D1 数据库
5. 缓存文件到 R2
6. 发送分类消息到 Queue

### 4.3 Classification Worker

**触发方式**: Cloudflare Queue 消息

**功能**:
1. 读取 SKILL.md 内容
2. 调用 AI 模型进行分类
3. 主渠道: OpenRouter 免费模型
4. 备用: DeepSeek V3.2
5. 更新 skill_categories 表

### 4.4 Trending Calculator Worker

**触发方式**: Cron Trigger (每小时)

**功能**:
1. 获取所有 skills 的 star 历史
2. 计算 trending 指数
3. 更新 trending_score 字段

---

## 五、分类体系

### 5.1 按用途 (Usage)

- Coding (代码编写)
- Debugging (调试)
- DevOps (运维部署)
- Testing (测试)
- Security (安全)
- Documentation (文档)
- Content Creation (内容创作)
- Research (研究)
- Database Management (数据库管理)
- Code Review (代码审查)
- Refactoring (重构)

### 5.2 按技术栈 (Stack)

- Frontend (前端)
- Backend (后端)
- Mobile (移动端)
- AI/ML (人工智能/机器学习)
- Data Analysis (数据分析)
- Infrastructure (基础设施)

### 5.3 按语言 (Language)

- JavaScript/TypeScript
- Python
- Go
- Rust
- Java
- C/C++
- Ruby
- PHP
- Swift
- Kotlin
- Other

---

## 六、SEO 策略

### 6.1 目标关键词

- 主关键词: "skills collection", "agent skills collection"
- 长尾关键词: "claude code skills", "ai agent skills", "coding assistant skills"

### 6.2 Meta 标签

每个页面需要:
- title (包含关键词)
- description
- keywords
- og:title, og:description, og:image
- twitter:card, twitter:title, twitter:description

### 6.3 结构化数据

- JSON-LD for SoftwareApplication
- Breadcrumb navigation
- Organization schema

---

## 七、安全考虑

### 7.1 敏感信息保护

**不提交到 Git 的文件**:
- wrangler.toml (使用 wrangler.toml.example)
- .env, .env.local, .env.production
- .dev.vars

**环境变量**:
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- OPENROUTER_API_KEY
- DEEPSEEK_API_KEY
- BETTER_AUTH_SECRET

### 7.2 Rate Limiting

- Skills 提交: 10/hour per user
- API 请求: 100/minute per IP
- 搜索: 30/minute per IP

---

## 八、性能优化

### 8.1 缓存策略

- 静态资源: 1 year (immutable)
- API 响应: 5 minutes (stale-while-revalidate)
- Skill 文件: R2 缓存 + CDN

### 8.2 数据库优化

- 索引: slug, github_url, trending_score, stars
- 分页: Cursor-based pagination
- 批量查询: 减少 N+1 问题

---

## 九、监控与日志

### 9.1 Cloudflare Analytics

- 页面访问量
- API 调用统计
- 错误率监控

### 9.2 自定义指标

- Skills 安装次数
- 搜索热词
- 用户行为分析
