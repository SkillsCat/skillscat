/**
 * Predefined categories for skill classification
 * AI will use these categories to classify skills during indexing
 */

export interface Category {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  keywords: string[]; // Keywords for AI classification
}

export const CATEGORIES: Category[] = [
  // Development Workflow
  {
    slug: 'git',
    name: 'Git & Version Control',
    description: 'Git operations, commit helpers, branch management',
    emoji: '🔀',
    keywords: ['git', 'commit', 'branch', 'merge', 'rebase', 'version control', 'changelog']
  },
  {
    slug: 'code-generation',
    name: 'Code Generation',
    description: 'Generate code, boilerplate, scaffolding',
    emoji: '⚡',
    keywords: ['generate', 'scaffold', 'boilerplate', 'template', 'create', 'init']
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

  // Code Quality
  {
    slug: 'code-review',
    name: 'Code Review',
    description: 'Automated code review and analysis',
    emoji: '👀',
    keywords: ['review', 'analyze', 'lint', 'check', 'inspect', 'audit']
  },
  {
    slug: 'testing',
    name: 'Testing',
    description: 'Unit tests, integration tests, test automation',
    emoji: '🧪',
    keywords: ['test', 'unit', 'integration', 'e2e', 'spec', 'coverage', 'mock']
  },
  {
    slug: 'security',
    name: 'Security',
    description: 'Security scanning and vulnerability detection',
    emoji: '🔒',
    keywords: ['security', 'vulnerability', 'scan', 'audit', 'owasp', 'penetration']
  },
  {
    slug: 'performance',
    name: 'Performance',
    description: 'Performance profiling and optimization',
    emoji: '🚀',
    keywords: ['performance', 'optimize', 'profile', 'benchmark', 'speed', 'memory']
  },

  // Documentation
  {
    slug: 'documentation',
    name: 'Documentation',
    description: 'Generate and maintain documentation',
    emoji: '📚',
    keywords: ['doc', 'readme', 'api', 'comment', 'jsdoc', 'typedoc', 'swagger']
  },
  {
    slug: 'i18n',
    name: 'Internationalization',
    description: 'Localization and translation tools',
    emoji: '🌍',
    keywords: ['i18n', 'l10n', 'translate', 'locale', 'language', 'internationalization']
  },

  // API & Data
  {
    slug: 'api',
    name: 'API Development',
    description: 'API design, documentation, and testing',
    emoji: '🔌',
    keywords: ['api', 'rest', 'graphql', 'openapi', 'swagger', 'endpoint', 'http']
  },
  {
    slug: 'database',
    name: 'Database',
    description: 'Database management and optimization',
    emoji: '🗄️',
    keywords: ['database', 'sql', 'query', 'migration', 'schema', 'orm', 'prisma', 'drizzle']
  },
  {
    slug: 'data-processing',
    name: 'Data Processing',
    description: 'Data transformation and analysis',
    emoji: '📊',
    keywords: ['data', 'transform', 'parse', 'json', 'csv', 'xml', 'format']
  },

  // Frontend
  {
    slug: 'ui-components',
    name: 'UI Components',
    description: 'UI component generation and styling',
    emoji: '🎨',
    keywords: ['ui', 'component', 'css', 'style', 'design', 'tailwind', 'react', 'vue', 'svelte']
  },
  {
    slug: 'accessibility',
    name: 'Accessibility',
    description: 'Accessibility testing and improvements',
    emoji: '♿',
    keywords: ['a11y', 'accessibility', 'aria', 'wcag', 'screen reader']
  },

  // DevOps & Infrastructure
  {
    slug: 'devops',
    name: 'DevOps',
    description: 'CI/CD, deployment, infrastructure',
    emoji: '🛠️',
    keywords: ['devops', 'ci', 'cd', 'deploy', 'docker', 'kubernetes', 'terraform', 'ansible']
  },
  {
    slug: 'monitoring',
    name: 'Monitoring',
    description: 'Application monitoring and observability',
    emoji: '📈',
    keywords: ['monitor', 'log', 'trace', 'metric', 'alert', 'observability']
  },

  // Utilities
  {
    slug: 'file-operations',
    name: 'File Operations',
    description: 'File manipulation and management',
    emoji: '📁',
    keywords: ['file', 'directory', 'folder', 'copy', 'move', 'rename', 'search']
  },
  {
    slug: 'automation',
    name: 'Automation',
    description: 'Task automation and scripting',
    emoji: '🤖',
    keywords: ['automate', 'script', 'task', 'workflow', 'batch', 'cron']
  },
  {
    slug: 'productivity',
    name: 'Productivity',
    description: 'General productivity tools',
    emoji: '✨',
    keywords: ['productivity', 'tool', 'helper', 'utility', 'assistant']
  }
];

// Helper functions
export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function getCategorySlugs(): string[] {
  return CATEGORIES.map((c) => c.slug);
}

// For display with skill counts (will be populated from DB)
export interface CategoryWithCount extends Category {
  skillCount: number;
}
