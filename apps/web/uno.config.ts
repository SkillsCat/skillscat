import { defineConfig, presetWind, presetIcons } from 'unocss';
import transformerDirectives from '@unocss/transformer-directives';

export default defineConfig({
  presets: [
    presetWind(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/'
    })
  ],
  transformers: [transformerDirectives()],
  theme: {
    colors: {
      // 语义化颜色 - 使用 CSS 变量
      bg: {
        base: 'var(--bg-base)',
        subtle: 'var(--bg-subtle)',
        muted: 'var(--bg-muted)',
        emphasis: 'var(--bg-emphasis)'
      },
      fg: {
        DEFAULT: 'var(--fg-default)',
        muted: 'var(--fg-muted)',
        subtle: 'var(--fg-subtle)',
        'on-emphasis': 'var(--fg-on-emphasis)'
      },
      primary: {
        DEFAULT: 'var(--primary)',
        hover: 'var(--primary-hover)',
        active: 'var(--primary-active)',
        subtle: 'var(--primary-subtle)'
      },
      accent: {
        DEFAULT: 'var(--accent)',
        subtle: 'var(--accent-subtle)'
      },
      success: 'var(--success)',
      warning: 'var(--warning)',
      error: 'var(--error)',
      info: 'var(--info)',
      border: {
        DEFAULT: 'var(--border-default)',
        muted: 'var(--border-muted)',
        emphasis: 'var(--border-emphasis)'
      }
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      '2xl': 'var(--radius-2xl)',
      full: 'var(--radius-full)'
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)'
    }
  },
  shortcuts: {
    // 按钮基础
    'btn': 'inline-flex items-center justify-center font-medium transition-all duration-150 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-sm': 'h-8 px-3 text-sm',
    'btn-md': 'h-10 px-4 text-base',
    'btn-lg': 'h-12 px-6 text-lg',
    'btn-primary': 'bg-primary text-fg-on-emphasis hover:bg-primary-hover active:bg-primary-active hover:-translate-y-0.5',
    'btn-secondary': 'bg-bg-subtle text-fg hover:bg-bg-muted border border-border',
    'btn-ghost': 'bg-transparent text-fg hover:bg-bg-muted',

    // 卡片
    'card': 'bg-bg-subtle rounded-lg border border-border p-4 transition-all duration-200',
    'card-interactive': 'card hover:shadow-md hover:-translate-y-1 cursor-pointer',

    // 输入框
    'input': 'w-full h-10 px-3 bg-bg-base border border-border rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',

    // 标签
    'tag': 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    'tag-primary': 'bg-primary-subtle text-primary',
    'tag-accent': 'bg-accent-subtle text-accent'
  }
});
