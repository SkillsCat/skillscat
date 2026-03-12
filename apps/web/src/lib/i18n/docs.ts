import type { SupportedLocale } from '$lib/i18n/config';
import type { DeepLocalized } from '$lib/i18n/catalog';

const en = {
  common: {
    backToDocsAriaLabel: 'Back to docs',
    docsBreadcrumb: 'Docs',
    links: {
      cliDocs: 'CLI docs',
      openclawDocs: 'OpenClaw docs',
      openclawGuide: 'OpenClaw guide',
    },
  },
  cli: {
    title: 'SkillsCat CLI',
    description:
      'Detailed SkillsCat CLI documentation for search, install, update, auth, config, and publish workflows.',
    imageAlt: 'SkillsCat CLI documentation preview',
    eyebrow: 'CLI Reference',
    heading: 'SkillsCat CLI',
    breadcrumb: 'CLI',
  },
  openclaw: {
    title: 'Use SkillsCat inside OpenClaw',
    description:
      'Use SkillsCat with OpenClaw through the native SkillsCat CLI or the ClawHub-compatible /openclaw registry endpoint for clawhub CLI.',
    imageAlt: 'SkillsCat OpenClaw documentation preview',
    eyebrow: 'OpenClaw Guide',
    heading: 'Use SkillsCat inside OpenClaw',
    breadcrumb: 'OpenClaw',
    howToSteps: {
      point: {
        name: 'Point OpenClaw or ClawHub to SkillsCat',
        text: 'Set the site to https://skills.cat and the registry to https://skills.cat/openclaw so clawhub CLI uses the compatibility layer instead of the native SkillsCat registry.',
      },
      inspect: {
        name: 'Search or inspect the skill',
        text: 'Use clawhub search or the SkillsCat CLI to confirm the skill you want to install.',
      },
      install: {
        name: 'Install into the OpenClaw layout',
        text: 'Install with clawhub install or npx skillscat add --agent openclaw so the bundle lands in the correct skills directory.',
      },
    },
  },
} as const;

type DocsCopy = DeepLocalized<typeof en>;

const zhCN = {
  common: {
    backToDocsAriaLabel: '返回文档',
    docsBreadcrumb: '文档',
    links: {
      cliDocs: 'CLI 文档',
      openclawDocs: 'OpenClaw 文档',
      openclawGuide: 'OpenClaw 指南',
    },
  },
  cli: {
    title: 'SkillsCat CLI',
    description: 'SkillsCat CLI 详细文档，涵盖搜索、安装、更新、认证、配置和发布流程。',
    imageAlt: 'SkillsCat CLI 文档预览',
    eyebrow: 'CLI 参考',
    heading: 'SkillsCat CLI',
    breadcrumb: 'CLI',
  },
  openclaw: {
    title: '在 OpenClaw 中使用 SkillsCat',
    description: '通过原生 SkillsCat CLI 或供 clawhub CLI 使用的 ClawHub 兼容 /openclaw registry，在 OpenClaw 中接入 SkillsCat。',
    imageAlt: 'SkillsCat OpenClaw 文档预览',
    eyebrow: 'OpenClaw 指南',
    heading: '在 OpenClaw 中使用 SkillsCat',
    breadcrumb: 'OpenClaw',
    howToSteps: {
      point: {
        name: '把 OpenClaw 或 ClawHub 指到 SkillsCat',
        text: '把 site 设为 https://skills.cat，把 registry 设为 https://skills.cat/openclaw，让 clawhub CLI 走兼容层而不是 SkillsCat 原生 registry。',
      },
      inspect: {
        name: '先搜索或检查 skill',
        text: '用 clawhub search 或 SkillsCat CLI 先确认你要安装的 skill。',
      },
      install: {
        name: '按 OpenClaw 目录结构安装',
        text: '用 clawhub install 或 npx skillscat add --agent openclaw 安装，确保 bundle 落到正确的 skills 目录。',
      },
    },
  },
} satisfies DocsCopy;

const ja = {
  common: {
    backToDocsAriaLabel: 'ドキュメントに戻る',
    docsBreadcrumb: 'Docs',
    links: {
      cliDocs: 'CLI docs',
      openclawDocs: 'OpenClaw ドキュメント',
      openclawGuide: 'OpenClaw ガイド',
    },
  },
  cli: {
    title: 'SkillsCat CLI',
    description:
      '検索、インストール、更新、認証、設定、公開フローを含む SkillsCat CLI の詳細ドキュメント。',
    imageAlt: 'SkillsCat CLI ドキュメントのプレビュー',
    eyebrow: 'CLI リファレンス',
    heading: 'SkillsCat CLI',
    breadcrumb: 'CLI',
  },
  openclaw: {
    title: 'OpenClaw で SkillsCat を使う',
    description:
      'ネイティブの SkillsCat CLI または clawhub CLI 向けの ClawHub 互換 /openclaw registry を通じて OpenClaw で SkillsCat を使う方法。',
    imageAlt: 'SkillsCat OpenClaw ドキュメントのプレビュー',
    eyebrow: 'OpenClaw ガイド',
    heading: 'OpenClaw で SkillsCat を使う',
    breadcrumb: 'OpenClaw',
    howToSteps: {
      point: {
        name: 'OpenClaw または ClawHub を SkillsCat に向ける',
        text: 'site を https://skills.cat、registry を https://skills.cat/openclaw に設定し、clawhub CLI が SkillsCat のネイティブ registry ではなく互換レイヤーを使うようにします。',
      },
      inspect: {
        name: 'スキルを検索または確認する',
        text: 'clawhub search または SkillsCat CLI を使って、インストールしたいスキルを確認します。',
      },
      install: {
        name: 'OpenClaw のレイアウトにインストールする',
        text: 'clawhub install または npx skillscat add --agent openclaw を使い、bundle を正しい skills ディレクトリに配置します。',
      },
    },
  },
} satisfies DocsCopy;

const ko = {
  common: {
    backToDocsAriaLabel: '문서로 돌아가기',
    docsBreadcrumb: '문서',
    links: {
      cliDocs: 'CLI 문서',
      openclawDocs: 'OpenClaw 문서',
      openclawGuide: 'OpenClaw 가이드',
    },
  },
  cli: {
    title: 'SkillsCat CLI',
    description: '검색, 설치, 업데이트, 인증, 설정, 게시 흐름을 다루는 SkillsCat CLI 상세 문서입니다.',
    imageAlt: 'SkillsCat CLI 문서 미리보기',
    eyebrow: 'CLI 레퍼런스',
    heading: 'SkillsCat CLI',
    breadcrumb: 'CLI',
  },
  openclaw: {
    title: 'OpenClaw에서 SkillsCat 사용하기',
    description:
      '기본 SkillsCat CLI 또는 clawhub CLI용 ClawHub 호환 /openclaw 레지스트리를 통해 OpenClaw에서 SkillsCat을 사용하는 방법입니다.',
    imageAlt: 'SkillsCat OpenClaw 문서 미리보기',
    eyebrow: 'OpenClaw 가이드',
    heading: 'OpenClaw에서 SkillsCat 사용하기',
    breadcrumb: 'OpenClaw',
    howToSteps: {
      point: {
        name: 'OpenClaw 또는 ClawHub를 SkillsCat으로 연결하기',
        text: 'site를 https://skills.cat, registry를 https://skills.cat/openclaw 로 설정해 clawhub CLI가 SkillsCat 기본 레지스트리 대신 호환 레이어를 사용하게 합니다.',
      },
      inspect: {
        name: '스킬을 검색하거나 확인하기',
        text: 'clawhub search 또는 SkillsCat CLI로 설치할 스킬을 먼저 확인합니다.',
      },
      install: {
        name: 'OpenClaw 레이아웃으로 설치하기',
        text: 'clawhub install 또는 npx skillscat add --agent openclaw 로 설치해 bundle 이 올바른 skills 디렉터리에 들어가게 합니다.',
      },
    },
  },
} satisfies DocsCopy;

const copyByLocale: Record<SupportedLocale, DocsCopy> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
};

export function getDocsCopy(locale: SupportedLocale): DocsCopy {
  return copyByLocale[locale];
}
