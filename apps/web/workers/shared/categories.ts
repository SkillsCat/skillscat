/**
 * Predefined categories for skill classification
 * Synced with frontend: apps/web/src/lib/constants/categories.ts
 */

import type { Category } from './types';

export const CATEGORIES: Category[] = [
  // ===== Development =====
  {
    slug: 'code-generation',
    name: 'Code Generation',
    description: 'Generate code, boilerplate, scaffolding',
    emoji: '⚡',
    keywords: ['generate', 'scaffold', 'boilerplate', 'template', 'create', 'init', 'new']
  },
  {
    slug: 'refactoring',
    name: 'Refactoring',
    description: 'Code restructuring and optimization',
    emoji: '🔧',
    keywords: ['refactor', 'restructure', 'optimize', 'clean', 'improve', 'modernize']
  },
  {
    slug: 'debugging',
    name: 'Debugging',
    description: 'Find and fix bugs, error analysis',
    emoji: '🐛',
    keywords: ['debug', 'fix', 'error', 'bug', 'trace', 'diagnose', 'troubleshoot']
  },
  {
    slug: 'testing',
    name: 'Testing',
    description: 'Unit tests, integration tests, test automation',
    emoji: '🧪',
    keywords: ['test', 'unit', 'integration', 'e2e', 'spec', 'coverage', 'mock', 'jest', 'vitest']
  },
  {
    slug: 'code-review',
    name: 'Code Review',
    description: 'Automated code review and analysis',
    emoji: '👀',
    keywords: ['review', 'analyze', 'lint', 'check', 'inspect', 'audit', 'pr']
  },
  {
    slug: 'git',
    name: 'Git & VCS',
    description: 'Git operations, commit helpers, branch management',
    emoji: '🔀',
    keywords: ['git', 'commit', 'branch', 'merge', 'rebase', 'version control', 'changelog', 'github', 'gitlab']
  },

  // ===== Backend =====
  {
    slug: 'api',
    name: 'API Dev',
    description: 'API design, REST, GraphQL',
    emoji: '🔌',
    keywords: ['api', 'rest', 'graphql', 'openapi', 'swagger', 'endpoint', 'http', 'grpc']
  },
  {
    slug: 'database',
    name: 'Database',
    description: 'Database management and queries',
    emoji: '🗄️',
    keywords: ['database', 'sql', 'query', 'migration', 'schema', 'orm', 'prisma', 'drizzle', 'postgres', 'mysql', 'mongodb']
  },
  {
    slug: 'auth',
    name: 'Auth',
    description: 'Authentication and authorization',
    emoji: '🔐',
    keywords: ['auth', 'authentication', 'authorization', 'oauth', 'jwt', 'session', 'login', 'signup']
  },
  {
    slug: 'caching',
    name: 'Caching',
    description: 'Caching strategies and implementation',
    emoji: '💾',
    keywords: ['cache', 'redis', 'memcached', 'cdn', 'invalidation']
  },

  // ===== Frontend =====
  {
    slug: 'ui-components',
    name: 'UI Components',
    description: 'UI component generation and styling',
    emoji: '🎨',
    keywords: ['ui', 'component', 'css', 'style', 'design', 'tailwind', 'react', 'vue', 'svelte', 'html']
  },
  {
    slug: 'accessibility',
    name: 'Accessibility',
    description: 'Accessibility testing and improvements',
    emoji: '♿',
    keywords: ['a11y', 'accessibility', 'aria', 'wcag', 'screen reader']
  },
  {
    slug: 'animation',
    name: 'Animation',
    description: 'UI animations and transitions',
    emoji: '✨',
    keywords: ['animation', 'transition', 'motion', 'framer', 'gsap', 'css animation']
  },
  {
    slug: 'responsive',
    name: 'Responsive',
    description: 'Responsive design and mobile-first',
    emoji: '📱',
    keywords: ['responsive', 'mobile', 'breakpoint', 'media query', 'adaptive']
  },

  // ===== DevOps & Infra =====
  {
    slug: 'ci-cd',
    name: 'CI/CD',
    description: 'Continuous integration and deployment',
    emoji: '🔄',
    keywords: ['ci', 'cd', 'pipeline', 'deploy', 'github actions', 'jenkins', 'circleci']
  },
  {
    slug: 'docker',
    name: 'Docker',
    description: 'Containerization and Docker',
    emoji: '🐳',
    keywords: ['docker', 'container', 'dockerfile', 'compose', 'image']
  },
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    description: 'Kubernetes orchestration',
    emoji: '☸️',
    keywords: ['kubernetes', 'k8s', 'helm', 'pod', 'deployment', 'service']
  },
  {
    slug: 'cloud',
    name: 'Cloud',
    description: 'Cloud services and infrastructure',
    emoji: '☁️',
    keywords: ['aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify', 'terraform', 'pulumi']
  },
  {
    slug: 'monitoring',
    name: 'Monitoring',
    description: 'Logging, metrics, and observability',
    emoji: '📈',
    keywords: ['monitor', 'log', 'trace', 'metric', 'alert', 'observability', 'datadog', 'grafana']
  },

  // ===== Quality & Security =====
  {
    slug: 'security',
    name: 'Security',
    description: 'Security scanning and vulnerability detection',
    emoji: '🔒',
    keywords: ['security', 'vulnerability', 'scan', 'audit', 'owasp', 'penetration', 'xss', 'sql injection']
  },
  {
    slug: 'performance',
    name: 'Performance',
    description: 'Performance profiling and optimization',
    emoji: '🚀',
    keywords: ['performance', 'optimize', 'profile', 'benchmark', 'speed', 'memory', 'lighthouse']
  },
  {
    slug: 'linting',
    name: 'Linting',
    description: 'Code linting and formatting',
    emoji: '✅',
    keywords: ['lint', 'eslint', 'prettier', 'format', 'style', 'biome']
  },
  {
    slug: 'types',
    name: 'Types',
    description: 'Type checking and type generation',
    emoji: '📝',
    keywords: ['typescript', 'type', 'typing', 'zod', 'schema', 'validation']
  },

  // ===== Documentation =====
  {
    slug: 'documentation',
    name: 'Docs Gen',
    description: 'Generate and maintain documentation',
    emoji: '📚',
    keywords: ['doc', 'readme', 'api', 'comment', 'jsdoc', 'typedoc', 'swagger', 'markdown']
  },
  {
    slug: 'comments',
    name: 'Comments',
    description: 'Code comments and annotations',
    emoji: '💬',
    keywords: ['comment', 'annotation', 'docstring', 'explain']
  },
  {
    slug: 'i18n',
    name: 'i18n',
    description: 'Localization and translation',
    emoji: '🌍',
    keywords: ['i18n', 'l10n', 'translate', 'locale', 'language', 'internationalization']
  },

  // ===== Data =====
  {
    slug: 'data-processing',
    name: 'Processing',
    description: 'Data transformation and parsing',
    emoji: '📊',
    keywords: ['data', 'transform', 'parse', 'json', 'csv', 'xml', 'format', 'etl']
  },
  {
    slug: 'analytics',
    name: 'Analytics',
    description: 'Data analysis and visualization',
    emoji: '📉',
    keywords: ['analytics', 'chart', 'graph', 'visualization', 'dashboard', 'report']
  },
  {
    slug: 'scraping',
    name: 'Scraping',
    description: 'Web scraping and data extraction',
    emoji: '🕷️',
    keywords: ['scrape', 'crawl', 'extract', 'puppeteer', 'playwright', 'cheerio']
  },
  {
    slug: 'math',
    name: 'Math',
    description: 'Mathematical computations, formulas, statistics',
    emoji: '🔢',
    keywords: ['math', 'mathematics', 'calculation', 'formula', 'statistics', 'algebra', 'calculus', 'geometry', 'numerical']
  },

  // ===== AI & ML =====
  {
    slug: 'prompts',
    name: 'Prompts',
    description: 'Prompt engineering and templates',
    emoji: '💭',
    keywords: ['prompt', 'llm', 'gpt', 'claude', 'chatgpt', 'template', 'system prompt']
  },
  {
    slug: 'embeddings',
    name: 'Embeddings',
    description: 'Vector embeddings and similarity',
    emoji: '🧠',
    keywords: ['embedding', 'vector', 'similarity', 'rag', 'semantic', 'search']
  },
  {
    slug: 'agents',
    name: 'Agents',
    description: 'AI agents and automation',
    emoji: '🤖',
    keywords: ['agent', 'autonomous', 'chain', 'langchain', 'workflow']
  },
  {
    slug: 'ml-ops',
    name: 'ML Ops',
    description: 'Machine learning operations',
    emoji: '⚙️',
    keywords: ['mlops', 'model', 'training', 'inference', 'pipeline', 'jupyter']
  },

  // ===== Productivity =====
  {
    slug: 'automation',
    name: 'Automation',
    description: 'Task automation and scripting',
    emoji: '🔁',
    keywords: ['automate', 'script', 'task', 'workflow', 'batch', 'cron', 'schedule']
  },
  {
    slug: 'file-ops',
    name: 'File Ops',
    description: 'File manipulation and management',
    emoji: '📁',
    keywords: ['file', 'directory', 'folder', 'copy', 'move', 'rename', 'search', 'glob']
  },
  {
    slug: 'cli',
    name: 'CLI Tools',
    description: 'Command line utilities',
    emoji: '💻',
    keywords: ['cli', 'terminal', 'shell', 'bash', 'command', 'script']
  },
  {
    slug: 'templates',
    name: 'Templates',
    description: 'Project and code templates',
    emoji: '📋',
    keywords: ['template', 'starter', 'boilerplate', 'scaffold', 'cookiecutter']
  },

  // ===== Content =====
  {
    slug: 'writing',
    name: 'Writing',
    description: 'Content writing and editing',
    emoji: '✍️',
    keywords: ['write', 'content', 'blog', 'article', 'copy', 'edit', 'proofread']
  },
  {
    slug: 'email',
    name: 'Email',
    description: 'Email composition and templates',
    emoji: '📧',
    keywords: ['email', 'mail', 'newsletter', 'template', 'outreach']
  },
  {
    slug: 'social',
    name: 'Social',
    description: 'Social media content',
    emoji: '📱',
    keywords: ['social', 'twitter', 'linkedin', 'post', 'thread', 'hashtag']
  },
  {
    slug: 'seo',
    name: 'SEO',
    description: 'Search engine optimization',
    emoji: '🔍',
    keywords: ['seo', 'meta', 'keyword', 'search', 'ranking', 'sitemap']
  },

  // ===== Lifestyle =====
  {
    slug: 'finance',
    name: 'Finance',
    description: 'Personal finance, budgeting, financial tools',
    emoji: '💰',
    keywords: ['finance', 'budget', 'money', 'investment', 'expense', 'accounting', 'tax', 'banking']
  },
  {
    slug: 'web3-crypto',
    name: 'Web3 & Crypto',
    description: 'Blockchain, cryptocurrency, Web3 development',
    emoji: '🪙',
    keywords: ['web3', 'crypto', 'blockchain', 'ethereum', 'solidity', 'nft', 'defi', 'wallet', 'smart contract']
  },
  {
    slug: 'legal',
    name: 'Legal',
    description: 'Legal document generation and compliance',
    emoji: '⚖️',
    keywords: ['legal', 'law', 'contract', 'compliance', 'policy', 'terms', 'license', 'agreement']
  },
  {
    slug: 'academic',
    name: 'Academic',
    description: 'Academic writing, research, citations',
    emoji: '🎓',
    keywords: ['academic', 'research', 'paper', 'citation', 'thesis', 'dissertation', 'bibliography', 'scholarly']
  },
  {
    slug: 'game-dev',
    name: 'Game Dev',
    description: 'Game development and game engine tools',
    emoji: '🎮',
    keywords: ['game', 'gaming', 'unity', 'unreal', 'godot', 'gamedev', 'sprite', 'physics', 'level design']
  }
];

export function getCategorySlugs(): string[] {
  return CATEGORIES.map((c) => c.slug);
}

export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
