/**
 * Predefined categories for skill classification
 * Two-level hierarchy: Sections (groups) -> Categories
 * AI will use these categories to classify skills during indexing
 */

export interface Category {
  slug: string;
  name: string;
  description: string;
  keywords: string[]; // Keywords for AI classification
}

export interface CategorySection {
  id: string;
  name: string;
  categories: Category[];
}

/**
 * Two-level category structure
 * Section -> Categories
 */
export const CATEGORY_SECTIONS: CategorySection[] = [
  // ===== Development =====
  {
    id: 'development',
    name: 'Development',
    categories: [
      {
        slug: 'code-generation',
        name: 'Code Gen',
        description: 'Generate code, boilerplate, scaffolding',
        keywords: ['generate', 'scaffold', 'boilerplate', 'template', 'create', 'init', 'new']
      },
      {
        slug: 'refactoring',
        name: 'Refactoring',
        description: 'Code restructuring and optimization',
        keywords: ['refactor', 'restructure', 'optimize', 'clean', 'improve', 'modernize']
      },
      {
        slug: 'debugging',
        name: 'Debugging',
        description: 'Find and fix bugs, error analysis',
        keywords: ['debug', 'fix', 'error', 'bug', 'trace', 'diagnose', 'troubleshoot']
      },
      {
        slug: 'testing',
        name: 'Testing',
        description: 'Unit tests, integration tests, test automation',
        keywords: ['test', 'unit', 'integration', 'e2e', 'spec', 'coverage', 'mock', 'jest', 'vitest']
      },
      {
        slug: 'code-review',
        name: 'Code Review',
        description: 'Automated code review and analysis',
        keywords: ['review', 'analyze', 'lint', 'check', 'inspect', 'audit', 'pr']
      },
      {
        slug: 'git',
        name: 'Git & VCS',
        description: 'Git operations, commit helpers, branch management',
        keywords: ['git', 'commit', 'branch', 'merge', 'rebase', 'version control', 'changelog', 'github', 'gitlab']
      }
    ]
  },

  // ===== Backend =====
  {
    id: 'backend',
    name: 'Backend',
    categories: [
      {
        slug: 'api',
        name: 'API Dev',
        description: 'API design, REST, GraphQL',
        keywords: ['api', 'rest', 'graphql', 'openapi', 'swagger', 'endpoint', 'http', 'grpc']
      },
      {
        slug: 'database',
        name: 'Database',
        description: 'Database management and queries',
        keywords: ['database', 'sql', 'query', 'migration', 'schema', 'orm', 'prisma', 'drizzle', 'postgres', 'mysql', 'mongodb']
      },
      {
        slug: 'auth',
        name: 'Auth',
        description: 'Authentication and authorization',
        keywords: ['auth', 'authentication', 'authorization', 'oauth', 'jwt', 'session', 'login', 'signup']
      },
      {
        slug: 'caching',
        name: 'Caching',
        description: 'Caching strategies and implementation',
        keywords: ['cache', 'redis', 'memcached', 'cdn', 'invalidation']
      }
    ]
  },

  // ===== Frontend =====
  {
    id: 'frontend',
    name: 'Frontend',
    categories: [
      {
        slug: 'ui-components',
        name: 'UI Components',
        description: 'UI component generation and styling',
        keywords: ['ui', 'component', 'css', 'style', 'design', 'tailwind', 'react', 'vue', 'svelte', 'html']
      },
      {
        slug: 'accessibility',
        name: 'Accessibility',
        description: 'Accessibility testing and improvements',
        keywords: ['a11y', 'accessibility', 'aria', 'wcag', 'screen reader']
      },
      {
        slug: 'animation',
        name: 'Animation',
        description: 'UI animations and transitions',
        keywords: ['animation', 'transition', 'motion', 'framer', 'gsap', 'css animation']
      },
      {
        slug: 'responsive',
        name: 'Responsive',
        description: 'Responsive design and mobile-first',
        keywords: ['responsive', 'mobile', 'breakpoint', 'media query', 'adaptive']
      }
    ]
  },

  // ===== DevOps & Infra =====
  {
    id: 'devops',
    name: 'DevOps',
    categories: [
      {
        slug: 'ci-cd',
        name: 'CI/CD',
        description: 'Continuous integration and deployment',
        keywords: ['ci', 'cd', 'pipeline', 'deploy', 'github actions', 'jenkins', 'circleci']
      },
      {
        slug: 'docker',
        name: 'Docker',
        description: 'Containerization and Docker',
        keywords: ['docker', 'container', 'dockerfile', 'compose', 'image']
      },
      {
        slug: 'kubernetes',
        name: 'Kubernetes',
        description: 'Kubernetes orchestration',
        keywords: ['kubernetes', 'k8s', 'helm', 'pod', 'deployment', 'service']
      },
      {
        slug: 'cloud',
        name: 'Cloud',
        description: 'Cloud services and infrastructure',
        keywords: ['aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify', 'terraform', 'pulumi']
      },
      {
        slug: 'monitoring',
        name: 'Monitoring',
        description: 'Logging, metrics, and observability',
        keywords: ['monitor', 'log', 'trace', 'metric', 'alert', 'observability', 'datadog', 'grafana']
      }
    ]
  },

  // ===== Quality & Security =====
  {
    id: 'quality',
    name: 'Quality',
    categories: [
      {
        slug: 'security',
        name: 'Security',
        description: 'Security scanning and vulnerability detection',
        keywords: ['security', 'vulnerability', 'scan', 'audit', 'owasp', 'penetration', 'xss', 'sql injection']
      },
      {
        slug: 'performance',
        name: 'Performance',
        description: 'Performance profiling and optimization',
        keywords: ['performance', 'optimize', 'profile', 'benchmark', 'speed', 'memory', 'lighthouse']
      },
      {
        slug: 'linting',
        name: 'Linting',
        description: 'Code linting and formatting',
        keywords: ['lint', 'eslint', 'prettier', 'format', 'style', 'biome']
      },
      {
        slug: 'types',
        name: 'Types',
        description: 'Type checking and type generation',
        keywords: ['typescript', 'type', 'typing', 'zod', 'schema', 'validation']
      }
    ]
  },

  // ===== Documentation =====
  {
    id: 'docs',
    name: 'Docs',
    categories: [
      {
        slug: 'documentation',
        name: 'Docs Gen',
        description: 'Generate and maintain documentation',
        keywords: ['doc', 'readme', 'api', 'comment', 'jsdoc', 'typedoc', 'swagger', 'markdown']
      },
      {
        slug: 'comments',
        name: 'Comments',
        description: 'Code comments and annotations',
        keywords: ['comment', 'annotation', 'docstring', 'explain']
      },
      {
        slug: 'i18n',
        name: 'i18n',
        description: 'Localization and translation',
        keywords: ['i18n', 'l10n', 'translate', 'locale', 'language', 'internationalization']
      }
    ]
  },

  // ===== Data =====
  {
    id: 'data',
    name: 'Data',
    categories: [
      {
        slug: 'data-processing',
        name: 'Processing',
        description: 'Data transformation and parsing',
        keywords: ['data', 'transform', 'parse', 'json', 'csv', 'xml', 'format', 'etl']
      },
      {
        slug: 'analytics',
        name: 'Analytics',
        description: 'Data analysis and visualization',
        keywords: ['analytics', 'chart', 'graph', 'visualization', 'dashboard', 'report']
      },
      {
        slug: 'scraping',
        name: 'Scraping',
        description: 'Web scraping and data extraction',
        keywords: ['scrape', 'crawl', 'extract', 'puppeteer', 'playwright', 'cheerio']
      }
    ]
  },

  // ===== AI & ML =====
  {
    id: 'ai',
    name: 'AI & ML',
    categories: [
      {
        slug: 'prompts',
        name: 'Prompts',
        description: 'Prompt engineering and templates',
        keywords: ['prompt', 'llm', 'gpt', 'claude', 'chatgpt', 'template', 'system prompt']
      },
      {
        slug: 'embeddings',
        name: 'Embeddings',
        description: 'Vector embeddings and similarity',
        keywords: ['embedding', 'vector', 'similarity', 'rag', 'semantic', 'search']
      },
      {
        slug: 'agents',
        name: 'Agents',
        description: 'AI agents and automation',
        keywords: ['agent', 'autonomous', 'chain', 'langchain', 'workflow']
      },
      {
        slug: 'ml-ops',
        name: 'ML Ops',
        description: 'Machine learning operations',
        keywords: ['mlops', 'model', 'training', 'inference', 'pipeline', 'jupyter']
      }
    ]
  },

  // ===== Productivity =====
  {
    id: 'productivity',
    name: 'Productivity',
    categories: [
      {
        slug: 'automation',
        name: 'Automation',
        description: 'Task automation and scripting',
        keywords: ['automate', 'script', 'task', 'workflow', 'batch', 'cron', 'schedule']
      },
      {
        slug: 'file-ops',
        name: 'File Ops',
        description: 'File manipulation and management',
        keywords: ['file', 'directory', 'folder', 'copy', 'move', 'rename', 'search', 'glob']
      },
      {
        slug: 'cli',
        name: 'CLI Tools',
        description: 'Command line utilities',
        keywords: ['cli', 'terminal', 'shell', 'bash', 'command', 'script']
      },
      {
        slug: 'templates',
        name: 'Templates',
        description: 'Project and code templates',
        keywords: ['template', 'starter', 'boilerplate', 'scaffold', 'cookiecutter']
      }
    ]
  },

  // ===== Content =====
  {
    id: 'content',
    name: 'Content',
    categories: [
      {
        slug: 'writing',
        name: 'Writing',
        description: 'Content writing and editing',
        keywords: ['write', 'content', 'blog', 'article', 'copy', 'edit', 'proofread']
      },
      {
        slug: 'email',
        name: 'Email',
        description: 'Email composition and templates',
        keywords: ['email', 'mail', 'newsletter', 'template', 'outreach']
      },
      {
        slug: 'social',
        name: 'Social',
        description: 'Social media content',
        keywords: ['social', 'twitter', 'linkedin', 'post', 'thread', 'hashtag']
      },
      {
        slug: 'seo',
        name: 'SEO',
        description: 'Search engine optimization',
        keywords: ['seo', 'meta', 'keyword', 'search', 'ranking', 'sitemap']
      }
    ]
  }
];

/**
 * Flat list of all categories for backward compatibility
 */
export const CATEGORIES: Category[] = CATEGORY_SECTIONS.flatMap(
  (section) => section.categories
);

// Helper functions
export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function getCategorySlugs(): string[] {
  return CATEGORIES.map((c) => c.slug);
}

export function getSectionBySlug(slug: string): CategorySection | undefined {
  return CATEGORY_SECTIONS.find((s) =>
    s.categories.some((c) => c.slug === slug)
  );
}

export function getSectionById(id: string): CategorySection | undefined {
  return CATEGORY_SECTIONS.find((s) => s.id === id);
}

// For display with skill counts (will be populated from DB)
export interface CategoryWithCount extends Category {
  skillCount: number;
}

export interface CategorySectionWithCount extends Omit<CategorySection, 'categories'> {
  categories: CategoryWithCount[];
  totalCount: number;
}
