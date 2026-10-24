import type { SupportedLocale } from './config';

const en = {
  "index": {
    "title": "SkillsCat Documentation",
    "description": "Documentation hub for SkillsCat: understand the product, learn the CLI, and connect OpenClaw to SkillsCat.",
    "eyebrow": "Documentation",
    "summary": "Find your next skill, make it part of your workflow, and keep it up to date. Start with the CLI or connect SkillsCat to OpenClaw.",
    "imageAlt": "SkillsCat documentation hub preview",
    "pagesLabel": "Documentation guides",
    "overview": "About SkillsCat",
    "cliSummary": "Search, install, update, and publish skills from your terminal.",
    "cliFeatures": [
      "Find and inspect skills",
      "Manage installs and publish your own"
    ],
    "openclawSummary": "Bring SkillsCat skills into your OpenClaw workspace.",
    "openclawFeatures": [
      "Connect the compatible registry",
      "Set up bundles and installation paths"
    ],
    "githubTitle": "Built in the open",
    "githubSummary": "Help SkillsCat grow.",
    "githubAction": "Star on GitHub"
  },
  "readGuide": "Read guide",
  "tocTitle": "On this page",
  "tocLabel": "Table of contents",
  "cliSummary": "Search, install, update, and publish with the native SkillsCat CLI and its primary registry.",
  "openclawSummary": "Install with the SkillsCat CLI, or connect your ClawHub workflow through the OpenClaw compatibility registry.",
  "cliToc": {
      "quick-start": "Quick Start",
      "search-and-inspect": "Search and Inspect",
      "install-skills": "Install Skills",
      "manage-installs": "Manage Installs",
      "auth-and-config": "Auth and Config",
      "publish-and-submit": "Publish and Submit",
      "command-reference": "Command Reference"
  },
  "openclawToc": {
      "auto-install": "Compatibility Auto-Install",
      "host-cli-install": "Host CLI Install",
      "registry-override": "Override Site and Registry",
      "paths-and-layout": "Paths and Bundle Layout",
      "private-skills": "Private Skills and Tokens",
      "troubleshooting": "Troubleshooting"
  }
};

type DocsPresentation = typeof en;

const zhCN = {
  "index": {
    "title": "SkillsCat 使用文档",
    "description": "了解 SkillsCat、学习 CLI，并将完整技能包接入 OpenClaw。",
    "eyebrow": "使用文档",
    "summary": "找到适合的技能，将它融入工作流，并持续更新。从 CLI 开始，或将 SkillsCat 接入 OpenClaw。",
    "imageAlt": "SkillsCat 使用文档预览",
    "pagesLabel": "使用指南",
    "overview": "关于 SkillsCat",
    "cliSummary": "在终端中搜索、安装、更新和发布技能。",
    "cliFeatures": [
      "发现并检查技能",
      "管理安装，发布自己的技能"
    ],
    "openclawSummary": "将 SkillsCat 技能接入你的 OpenClaw 工作区。",
    "openclawFeatures": [
      "连接兼容 registry",
      "配置技能包与安装目录"
    ],
    "githubTitle": "一起完善 SkillsCat",
    "githubSummary": "让好用的技能被更多人发现。",
    "githubAction": "在 GitHub 上点星"
  },
  "readGuide": "阅读指南",
  "tocTitle": "本页目录",
  "tocLabel": "文档目录",
  "cliSummary": "通过原生 SkillsCat CLI 和主 registry 完成搜索、安装、更新与发布。",
  "openclawSummary": "使用 SkillsCat CLI 安装，或通过 OpenClaw 兼容 registry 接入已有的 ClawHub 工作流。",
  "cliToc": {
      "quick-start": "快速开始",
      "search-and-inspect": "搜索与检查",
      "install-skills": "安装技能",
      "manage-installs": "管理安装",
      "auth-and-config": "认证与配置",
      "publish-and-submit": "发布与提交",
      "command-reference": "命令参考"
  },
  "openclawToc": {
      "auto-install": "兼容模式安装",
      "host-cli-install": "原生 CLI 安装",
      "registry-override": "配置站点与 registry",
      "paths-and-layout": "目录与技能包结构",
      "private-skills": "私有技能与令牌",
      "troubleshooting": "问题排查"
  }
} satisfies DocsPresentation;

const ca = {
  "index": {
    "title": "Documentació de SkillsCat",
    "description": "Coneix SkillsCat, aprèn a utilitzar la CLI i connecta paquets complets amb OpenClaw.",
    "eyebrow": "Documentació",
    "summary": "Troba el teu proper skill, incorpora’l al teu flux de treball i mantén-lo al dia. Comença amb la CLI o connecta SkillsCat amb OpenClaw.",
    "imageAlt": "Vista prèvia de la documentació de SkillsCat",
    "pagesLabel": "Guies de documentació",
    "overview": "Sobre SkillsCat",
    "cliSummary": "Cerca, instal·la, actualitza i publica skills des del terminal.",
    "cliFeatures": [
      "Troba i inspecciona skills",
      "Gestiona instal·lacions i publica skills propis"
    ],
    "openclawSummary": "Incorpora skills de SkillsCat al teu espai de treball d’OpenClaw.",
    "openclawFeatures": [
      "Connecta el registre compatible",
      "Configura paquets i directoris d’instal·lació"
    ],
    "githubTitle": "Un projecte obert",
    "githubSummary": "Ajuda SkillsCat a créixer.",
    "githubAction": "Dona una estrella a GitHub"
  },
  "readGuide": "Llegeix la guia",
  "tocTitle": "En aquesta pàgina",
  "tocLabel": "Taula de continguts",
  "cliSummary": "Cerca, instal·la, actualitza i publica amb la CLI nativa de SkillsCat i el seu registre principal.",
  "openclawSummary": "Instal·la amb la CLI de SkillsCat o connecta el teu flux de ClawHub mitjançant el registre compatible amb OpenClaw.",
  "cliToc": {
      "quick-start": "Inici ràpid",
      "search-and-inspect": "Cerca i inspecciona",
      "install-skills": "Instal·la skills",
      "manage-installs": "Gestiona les instal·lacions",
      "auth-and-config": "Autenticació i configuració",
      "publish-and-submit": "Publicació i propostes",
      "command-reference": "Referència de les ordres"
  },
  "openclawToc": {
      "auto-install": "Instal·lació compatible",
      "host-cli-install": "Instal·la amb la CLI",
      "registry-override": "Configura el registre",
      "paths-and-layout": "Directoris i estructura",
      "private-skills": "Skills privats i permisos",
      "troubleshooting": "Resolució de problemes"
  }
} satisfies DocsPresentation;

// Japanese and Korean currently use the English documentation fallback.
// Keep presentation and content on the same locale until their guides exist.
export function getDocsPresentation(locale: SupportedLocale) {
  return locale === 'ca' ? ca : locale === 'zh-CN' ? zhCN : en;
}

const cliSectionIds = ['quick-start', 'search-and-inspect', 'install-skills', 'manage-installs', 'auth-and-config', 'publish-and-submit', 'command-reference'] as const;
const openclawSectionIds = ['auto-install', 'host-cli-install', 'registry-override', 'paths-and-layout', 'private-skills', 'troubleshooting'] as const;

export function getDocsToc(kind: 'cli' | 'openclaw', locale: SupportedLocale) {
  const copy = getDocsPresentation(locale);
  return kind === 'cli'
    ? cliSectionIds.map((id) => ({ id, label: copy.cliToc[id] }))
    : openclawSectionIds.map((id) => ({ id, label: copy.openclawToc[id] }));
}
