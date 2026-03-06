import type { SupportedLocale } from '$lib/i18n/config';

export interface LegalSubsection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
  subsections?: LegalSubsection[];
}

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  lead: string;
  sections: LegalSection[];
}

interface LegalCopy {
  privacy: LegalDocument;
  terms: LegalDocument;
}

const GITHUB_REPO_LINK =
  '<a href="https://github.com/backrunner/skillscat" target="_blank" rel="noopener noreferrer">GitHub repository</a>';

const en = {
  privacy: {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: February 14, 2026',
    lead:
      'SkillsCat ("we", "our", or "us") is an open platform for discovering, sharing, and installing AI agent skills. This Privacy Policy explains how we collect, use, and safeguard your information when you use our website and services.',
    sections: [
      {
        title: '1. Information We Collect',
        subsections: [
          {
            title: '1.1 Information You Provide',
            paragraphs: ['When you use SkillsCat, we may collect:'],
            items: [
              '<strong>Account Information:</strong> When you sign in using GitHub OAuth, we receive account data such as your username, email address, profile image, and GitHub account identifier.',
              '<strong>Submitted Content:</strong> Skills you submit, including repository URLs, uploaded SKILL.md content, and related metadata.',
              '<strong>Sharing and Collaboration Data:</strong> If you share private skills or manage organizations, we store the user IDs or email addresses needed to enforce those permissions.',
              '<strong>User Preferences and Credentials:</strong> Your favorites, API token metadata, and account/session records.',
            ],
          },
          {
            title: '1.2 Information Collected Automatically',
            paragraphs: ['We automatically collect certain information when you visit our website:'],
            items: [
              '<strong>Security and Session Data:</strong> Request metadata such as IP address and user-agent may be processed for authentication security, abuse prevention, and rate limiting.',
              '<strong>Usage Events:</strong> We record product events such as submissions, installs, downloads, favorites, and unfavorites with timestamps.',
              '<strong>Infrastructure Logs:</strong> Cloudflare infrastructure may generate operational logs for reliability and security.',
            ],
          },
        ],
      },
      {
        title: '2. How We Use Your Information',
        paragraphs: ['We use the collected information to:'],
        items: [
          'Provide and maintain our services',
          'Authenticate your identity and manage your account',
          'Process skill submissions or uploads and maintain our catalog',
          'Enforce access controls for private, unlisted, and shared skills',
          'Generate aggregate usage statistics such as trending and download metrics',
          'Provide account features such as API tokens, notifications, and organization permissions',
          'Detect and prevent fraud or abuse',
        ],
      },
      {
        title: '3. Information Sharing',
        paragraphs: [
          'We do not sell, trade, or rent your personal information to third parties. We may share information in the following circumstances:',
        ],
        items: [
          '<strong>Public Content:</strong> Public skills and related public profile metadata are visible to other users.',
          '<strong>Service Providers:</strong> We use providers such as Cloudflare (hosting and infrastructure), GitHub (OAuth and repository APIs), optional OpenRouter or DeepSeek model APIs (for automated skill classification when enabled), and Google Fonts (font delivery).',
          '<strong>Collaboration Features:</strong> If you share a private skill with another user or email address, that permission data is stored and used to grant access.',
          '<strong>Legal Requirements:</strong> When required by law or to protect our rights.',
        ],
      },
      {
        title: '4. Data Storage and Security',
        paragraphs: [
          'Your data is stored primarily on Cloudflare infrastructure, including D1, KV, and R2. We implement reasonable technical and organizational measures to protect personal information against unauthorized access, alteration, disclosure, or destruction.',
        ],
      },
      {
        title: '5. Third-Party Services',
        paragraphs: ['Our service integrates with:'],
        items: [
          '<strong>GitHub:</strong> For OAuth authentication and repository metadata or content access.',
          '<strong>Cloudflare:</strong> For hosting, CDN, D1, KV, R2, and security services.',
          '<strong>OpenRouter / DeepSeek (optional):</strong> For automated skill classification if these providers are configured.',
          '<strong>Google Fonts:</strong> For web font delivery.',
        ],
      },
      {
        title: '6. Your Rights',
        paragraphs: ['You can:'],
        items: [
          'Delete your account from account settings. This removes sessions, tokens, favorites, private skills, and related account data.',
          'Understand that public skills are preserved as public records and detached from your account after deletion; signing in again with the same GitHub account can relink them.',
          'Manage favorites, API tokens, and shared-skill permissions through product settings.',
          'Update core profile information through your GitHub account.',
          `Contact us through the ${GITHUB_REPO_LINK} for additional privacy requests.`,
        ],
      },
      {
        title: '7. Cookies',
        paragraphs: [
          'We use essential cookies for authentication, session management, and UI preferences such as language selection. We do not use advertising cookies or third-party tracking cookies.',
        ],
      },
      {
        title: "8. Children's Privacy",
        paragraphs: [
          'Our service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13.',
        ],
      },
      {
        title: '9. Changes to This Policy',
        paragraphs: [
          'We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the last updated date.',
        ],
      },
      {
        title: '10. Contact Us',
        paragraphs: [
          `If you have any questions about this Privacy Policy, please contact us through our ${GITHUB_REPO_LINK}.`,
        ],
      },
      {
        title: '11. Open Source',
        paragraphs: [
          `SkillsCat is open source software licensed under AGPL-3.0. You can review our source code and data handling practices on our ${GITHUB_REPO_LINK}.`,
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    lastUpdated: 'Last updated: February 14, 2026',
    lead:
      'By accessing or using SkillsCat, you agree to these Terms of Service. Please read them carefully before using the website and related services.',
    sections: [
      {
        title: '1. Acceptance of Terms',
        paragraphs: [
          'By accessing or using SkillsCat, you agree to these Terms and our Privacy Policy. If you do not agree to them, you may not use our services.',
        ],
      },
      {
        title: '2. Description of Service',
        paragraphs: ['SkillsCat is an open platform for discovering, sharing, and installing AI agent skills. We provide:'],
        items: [
          'A catalog of AI agent skills from the community',
          'Tools to browse, search, and install skills',
          'The ability to submit and share your own skills',
        ],
      },
      {
        title: '3. User Accounts',
        subsections: [
          {
            title: '3.1 Account Creation',
            paragraphs: [
              'To access certain features, you must sign in using GitHub OAuth. Some API and CLI features also require API tokens generated from your account. You are responsible for maintaining the security of your account and tokens.',
            ],
          },
          {
            title: '3.2 Account Responsibilities',
            paragraphs: ['You agree to:'],
            items: [
              'Provide accurate information',
              'Keep your account credentials secure',
              'Notify us of any unauthorized access',
              'Be responsible for all activities under your account',
            ],
          },
        ],
      },
      {
        title: '4. User Content',
        subsections: [
          {
            title: '4.1 Submitted Skills',
            paragraphs: ['When you submit a skill to SkillsCat, you represent that:'],
            items: [
              'You have the right to share the content',
              'The content does not violate any laws or third-party rights',
              'The content is not malicious, harmful, or deceptive',
            ],
          },
          {
            title: '4.2 License Grant',
            paragraphs: [
              'By submitting content, you grant SkillsCat a non-exclusive, worldwide, royalty-free license to display, distribute, and promote your submitted skills on our platform.',
            ],
          },
          {
            title: '4.3 Content Removal',
            paragraphs: [
              'We reserve the right to remove any content that violates these Terms or that we deem inappropriate, without prior notice.',
            ],
          },
        ],
      },
      {
        title: '5. Acceptable Use',
        paragraphs: ['You agree not to:'],
        items: [
          'Use the service for any illegal purpose',
          'Submit malicious code or content',
          'Attempt to gain unauthorized access to our systems',
          'Interfere with or disrupt the service',
          'Scrape or collect data without permission',
          'Impersonate others or misrepresent your affiliation',
          'Violate any applicable laws or regulations',
        ],
      },
      {
        title: '6. Intellectual Property',
        subsections: [
          {
            title: '6.1 Our Content',
            paragraphs: [
              'The SkillsCat website, logo, and original content are protected by copyright and other intellectual property laws. SkillsCat is open source software licensed under AGPL-3.0.',
            ],
          },
          {
            title: '6.2 Third-Party Content',
            paragraphs: [
              'Skills listed on SkillsCat are owned by their respective creators. We do not claim ownership of user-submitted content.',
            ],
          },
        ],
      },
      {
        title: '7. Third-Party Services',
        paragraphs: [
          'Our service integrates with third-party services including GitHub (authentication and repository data), Cloudflare (hosting and infrastructure), and optional model providers used for automated classification. Your use of these services is subject to their respective terms and policies.',
        ],
      },
      {
        title: '8. Disclaimer of Warranties',
        paragraphs: [
          'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE.',
          'We do not guarantee the accuracy, completeness, or usefulness of any skills listed on our platform. Users install and use skills at their own risk.',
        ],
      },
      {
        title: '9. Limitation of Liability',
        paragraphs: [
          'TO THE MAXIMUM EXTENT PERMITTED BY LAW, SKILLSCAT SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.',
        ],
      },
      {
        title: '10. Indemnification',
        paragraphs: [
          'You agree to indemnify and hold harmless SkillsCat and its operators from any claims, damages, or expenses arising from your use of the service or violation of these Terms.',
        ],
      },
      {
        title: '11. Changes to Terms',
        paragraphs: [
          'We may modify these Terms at any time. We will notify users of significant changes by posting a notice on our website. Continued use of the service after changes constitutes acceptance of the new Terms.',
        ],
      },
      {
        title: '12. Termination',
        paragraphs: [
          'We may terminate or suspend your access to the service at any time, without prior notice, for conduct that we believe violates these Terms or is harmful to other users or the service.',
        ],
      },
      {
        title: '13. Governing Law',
        paragraphs: [
          'These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.',
        ],
      },
      {
        title: '14. Contact',
        paragraphs: [
          `For questions about these Terms, please contact us through our ${GITHUB_REPO_LINK}.`,
        ],
      },
      {
        title: '15. Open Source',
        paragraphs: [
          `SkillsCat is open source software. The source code is available under the AGPL-3.0 license. By contributing to the project, you agree that your contributions will be licensed under the same license.`,
        ],
      },
    ],
  },
} as const satisfies LegalCopy;

const zhCN = {
  privacy: {
    title: '隐私政策',
    lastUpdated: '最后更新：2026 年 2 月 14 日',
    lead:
      'SkillsCat（“我们”）是一个用于发现、分享和安装 AI agent skills 的开放平台。本隐私政策说明你在使用我们的网站和服务时，我们如何收集、使用并保护你的信息。',
    sections: [
      {
        title: '1. 我们收集的信息',
        subsections: [
          {
            title: '1.1 你主动提供的信息',
            paragraphs: ['当你使用 SkillsCat 时，我们可能会收集：'],
            items: [
              '<strong>账号信息：</strong>当你通过 GitHub OAuth 登录时，我们会接收用户名、邮箱地址、头像和 GitHub 账号标识等信息。',
              '<strong>提交内容：</strong>你提交的技能，包括仓库地址、上传的 SKILL.md 内容及相关元数据。',
              '<strong>分享与协作数据：</strong>如果你分享私有技能或管理组织，我们会保存执行这些权限所需的用户 ID 或邮箱地址。',
              '<strong>偏好与凭据：</strong>你的收藏、API Token 元数据，以及账号和会话记录。',
            ],
          },
          {
            title: '1.2 自动收集的信息',
            paragraphs: ['当你访问我们的网站时，我们会自动收集部分信息：'],
            items: [
              '<strong>安全与会话数据：</strong>为了认证安全、防滥用和限流，我们可能会处理 IP 地址、User-Agent 等请求元数据。',
              '<strong>使用事件：</strong>我们会记录提交、安装、下载、收藏和取消收藏等产品事件及其时间戳。',
              '<strong>基础设施日志：</strong>Cloudflare 基础设施可能会出于可靠性和安全性生成运行日志。',
            ],
          },
        ],
      },
      {
        title: '2. 我们如何使用你的信息',
        paragraphs: ['我们会将收集到的信息用于：'],
        items: [
          '提供并维护我们的服务',
          '验证你的身份并管理账号',
          '处理技能提交或上传并维护目录',
          '为私有、未列出和共享技能执行访问控制',
          '生成聚合统计，例如热门趋势和下载数据',
          '提供 API Token、通知和组织权限等账号功能',
          '检测并防止欺诈或滥用行为',
        ],
      },
      {
        title: '3. 信息共享',
        paragraphs: ['我们不会出售、交易或出租你的个人信息。在以下情形下，我们可能会共享信息：'],
        items: [
          '<strong>公开内容：</strong>公开技能及相关公开资料信息对其他用户可见。',
          '<strong>服务提供方：</strong>我们使用 Cloudflare（托管与基础设施）、GitHub（OAuth 与仓库 API）、可选的 OpenRouter 或 DeepSeek 模型 API（用于自动分类）以及 Google Fonts（字体分发）等服务。',
          '<strong>协作功能：</strong>如果你将私有技能分享给其他用户或邮箱地址，我们会保存并使用相应授权数据。',
          '<strong>法律要求：</strong>在法律要求或保护我们权利时，我们可能会披露必要信息。',
        ],
      },
      {
        title: '4. 数据存储与安全',
        paragraphs: [
          '你的数据主要存储在 Cloudflare 基础设施上，包括 D1、KV 和 R2。我们会采取合理的技术和组织措施，防止个人信息被未授权访问、篡改、披露或销毁。',
        ],
      },
      {
        title: '5. 第三方服务',
        paragraphs: ['我们的服务集成了以下第三方服务：'],
        items: [
          '<strong>GitHub：</strong>用于 OAuth 登录、仓库元数据和内容访问。',
          '<strong>Cloudflare：</strong>用于托管、CDN、D1、KV、R2 以及安全服务。',
          '<strong>OpenRouter / DeepSeek（可选）：</strong>在启用时用于自动技能分类。',
          '<strong>Google Fonts：</strong>用于网页字体分发。',
        ],
      },
      {
        title: '6. 你的权利',
        paragraphs: ['你可以：'],
        items: [
          '在账号设置中删除账号。删除后会清除会话、Token、收藏、私有技能以及相关账号数据。',
          '了解公开技能会作为公开记录保留，并在删除账号后与账号解绑；若你以后使用同一个 GitHub 账号重新登录，可以重新关联这些技能。',
          '通过产品设置管理收藏、API Token 和共享技能权限。',
          '通过 GitHub 账号更新核心资料信息。',
          `如有进一步的隐私请求，可通过 ${GITHUB_REPO_LINK} 联系我们。`,
        ],
      },
      {
        title: '7. Cookies',
        paragraphs: [
          '我们使用必要 Cookie 进行认证、会话管理以及语言等 UI 偏好保存。我们不使用广告 Cookie 或第三方跟踪 Cookie。',
        ],
      },
      {
        title: '8. 儿童隐私',
        paragraphs: ['我们的服务不面向 13 岁以下儿童。我们不会在知情情况下收集 13 岁以下儿童的个人信息。'],
      },
      {
        title: '9. 政策更新',
        paragraphs: ['我们可能会不时更新本隐私政策。若有更新，我们会在本页发布新版政策，并同步更新最后更新时间。'],
      },
      {
        title: '10. 联系我们',
        paragraphs: [`如果你对本隐私政策有任何疑问，请通过我们的 ${GITHUB_REPO_LINK} 联系我们。`],
      },
      {
        title: '11. 开源',
        paragraphs: [`SkillsCat 是基于 AGPL-3.0 许可的开源软件。你可以在我们的 ${GITHUB_REPO_LINK} 查看源代码和数据处理方式。`],
      },
    ],
  },
  terms: {
    title: '服务条款',
    lastUpdated: '最后更新：2026 年 2 月 14 日',
    lead: '访问或使用 SkillsCat 即表示你同意遵守本服务条款。在使用网站和相关服务前，请仔细阅读。',
    sections: [
      {
        title: '1. 条款接受',
        paragraphs: ['访问或使用 SkillsCat 即表示你同意本条款和我们的隐私政策。如果你不同意，则不得使用我们的服务。'],
      },
      {
        title: '2. 服务说明',
        paragraphs: ['SkillsCat 是一个用于发现、分享和安装 AI agent skills 的开放平台。我们提供：'],
        items: ['社区 AI agent skills 目录', '用于浏览、搜索和安装技能的工具', '提交和分享你自己的技能的能力'],
      },
      {
        title: '3. 用户账号',
        subsections: [
          {
            title: '3.1 账号创建',
            paragraphs: ['要访问部分功能，你必须使用 GitHub OAuth 登录。某些 API 和 CLI 功能还需要从账号中生成 API Token。你有责任保护好账号和 Token 的安全。'],
          },
          {
            title: '3.2 账号责任',
            paragraphs: ['你同意：'],
            items: ['提供准确的信息', '妥善保管账号凭据', '及时通知未授权访问', '对账号下的所有活动负责'],
          },
        ],
      },
      {
        title: '4. 用户内容',
        subsections: [
          {
            title: '4.1 提交的技能',
            paragraphs: ['当你向 SkillsCat 提交技能时，即表示你声明：'],
            items: ['你有权分享该内容', '该内容不违反任何法律或第三方权利', '该内容不包含恶意、有害或误导性信息'],
          },
          {
            title: '4.2 许可授权',
            paragraphs: ['通过提交内容，你授予 SkillsCat 一项非独占、全球范围、免版税的许可，用于在平台上展示、分发和推广你提交的技能。'],
          },
          {
            title: '4.3 内容移除',
            paragraphs: ['对于违反本条款或我们认为不适当的内容，我们保留在不事先通知的情况下移除的权利。'],
          },
        ],
      },
      {
        title: '5. 可接受使用',
        paragraphs: ['你同意不会：'],
        items: [
          '将服务用于任何非法目的',
          '提交恶意代码或内容',
          '尝试未授权访问我们的系统',
          '干扰或破坏服务运行',
          '未经许可抓取或收集数据',
          '冒充他人或虚假陈述关联关系',
          '违反任何适用法律或法规',
        ],
      },
      {
        title: '6. 知识产权',
        subsections: [
          {
            title: '6.1 我们的内容',
            paragraphs: ['SkillsCat 网站、Logo 和原创内容受版权及其他知识产权法律保护。SkillsCat 是基于 AGPL-3.0 许可的开源软件。'],
          },
          {
            title: '6.2 第三方内容',
            paragraphs: ['SkillsCat 上展示的技能归各自创作者所有。我们不主张拥有用户提交内容的所有权。'],
          },
        ],
      },
      {
        title: '7. 第三方服务',
        paragraphs: ['我们的服务集成了 GitHub（认证和仓库数据）、Cloudflare（托管和基础设施）以及用于自动分类的可选模型服务商。你对这些服务的使用需遵守其各自条款和政策。'],
      },
      {
        title: '8. 免责声明',
        paragraphs: [
          '本服务按“现状”和“可用”提供，不附带任何明示或默示保证。我们不保证服务不会中断、绝对安全或完全无错误。',
          '我们不保证平台所列技能的准确性、完整性或实用性。用户需自行承担安装和使用技能的风险。',
        ],
      },
      {
        title: '9. 责任限制',
        paragraphs: ['在法律允许的最大范围内，Skillscat 不对因你使用服务而产生的任何间接、附带、特殊、后果性或惩罚性损害承担责任。'],
      },
      {
        title: '10. 赔偿',
        paragraphs: ['你同意就因你使用服务或违反本条款而产生的任何索赔、损害或费用，对 SkillsCat 及其运营方进行赔偿并使其免责。'],
      },
      {
        title: '11. 条款变更',
        paragraphs: ['我们可随时修改本条款。若有重大变更，我们会在网站上发布通知。你在变更后继续使用服务即表示接受新条款。'],
      },
      {
        title: '12. 终止',
        paragraphs: ['若我们认为你的行为违反本条款，或对其他用户或服务有害，我们可在不事先通知的情况下终止或暂停你对服务的访问。'],
      },
      {
        title: '13. 适用法律',
        paragraphs: ['本条款应依据适用法律解释和适用，不考虑法律冲突原则。'],
      },
      {
        title: '14. 联系方式',
        paragraphs: [`如果你对本条款有任何疑问，请通过我们的 ${GITHUB_REPO_LINK} 联系我们。`],
      },
      {
        title: '15. 开源',
        paragraphs: ['SkillsCat 是开源软件，源代码依据 AGPL-3.0 许可发布。向项目提交贡献即表示你同意以相同许可发布你的贡献。'],
      },
    ],
  },
} as const satisfies LegalCopy;

const ja = {
  privacy: {
    title: 'プライバシーポリシー',
    lastUpdated: '最終更新日: 2026年2月14日',
    lead:
      'SkillsCat（以下「当社」）は、AI agent skills を見つけ、共有し、インストールできるオープンプラットフォームです。このプライバシーポリシーでは、当社サイトおよびサービスの利用時に、どのような情報を収集、利用、保護するかを説明します。',
    sections: [
      {
        title: '1. 収集する情報',
        subsections: [
          {
            title: '1.1 お客様が提供する情報',
            paragraphs: ['SkillsCat を利用する際、当社は次の情報を収集する場合があります。'],
            items: [
              '<strong>アカウント情報:</strong> GitHub OAuth でサインインすると、ユーザー名、メールアドレス、プロフィール画像、GitHub アカウント識別子などを受け取ります。',
              '<strong>投稿コンテンツ:</strong> 提出したスキル、リポジトリ URL、アップロードした SKILL.md の内容、および関連メタデータ。',
              '<strong>共有とコラボレーション情報:</strong> 非公開スキルを共有したり組織を管理したりする場合、その権限を適用するために必要なユーザー ID やメールアドレスを保存します。',
              '<strong>設定と認証情報:</strong> お気に入り、API トークンのメタデータ、アカウントおよびセッション記録。',
            ],
          },
          {
            title: '1.2 自動的に収集される情報',
            paragraphs: ['当サイトにアクセスすると、一部の情報を自動で収集します。'],
            items: [
              '<strong>セキュリティおよびセッション情報:</strong> IP アドレスや User-Agent などのリクエストメタデータは、認証セキュリティ、不正利用防止、レート制限のために処理される場合があります。',
              '<strong>利用イベント:</strong> 投稿、インストール、ダウンロード、お気に入り追加や解除などのイベントと、そのタイムスタンプを記録します。',
              '<strong>インフラログ:</strong> Cloudflare インフラは、信頼性とセキュリティのために運用ログを生成する場合があります。',
            ],
          },
        ],
      },
      {
        title: '2. 情報の利用方法',
        paragraphs: ['収集した情報は次の目的で利用します。'],
        items: [
          'サービスの提供および維持',
          '本人確認とアカウント管理',
          'スキル投稿またはアップロードの処理とカタログ維持',
          '非公開、限定公開、共有スキルのアクセス制御',
          'トレンドやダウンロード指標などの集計統計の生成',
          'API トークン、通知、組織権限などのアカウント機能の提供',
          '不正または濫用の検知と防止',
        ],
      },
      {
        title: '3. 情報共有',
        paragraphs: ['当社は個人情報を第三者に販売、交換、賃貸しません。次の場合に限り情報を共有することがあります。'],
        items: [
          '<strong>公開コンテンツ:</strong> 公開スキルと関連する公開プロフィール情報は他のユーザーに表示されます。',
          '<strong>サービス提供者:</strong> Cloudflare（ホスティングとインフラ）、GitHub（OAuth とリポジトリ API）、任意の OpenRouter / DeepSeek モデル API（自動分類用）、Google Fonts（フォント配信）などを利用します。',
          '<strong>コラボレーション機能:</strong> 非公開スキルを他ユーザーやメールアドレスと共有すると、その権限データを保存してアクセス制御に使用します。',
          '<strong>法的要件:</strong> 法令に基づく場合、または当社の権利を保護するために必要な場合。',
        ],
      },
      {
        title: '4. データ保存とセキュリティ',
        paragraphs: ['データは主に Cloudflare インフラ（D1、KV、R2 を含む）に保存されます。当社は個人情報を不正アクセス、改ざん、開示、破壊から守るため、合理的な技術的・組織的措置を講じます。'],
      },
      {
        title: '5. 第三者サービス',
        paragraphs: ['当サービスは次の外部サービスと連携します。'],
        items: [
          '<strong>GitHub:</strong> OAuth 認証、リポジトリのメタデータおよび内容取得。',
          '<strong>Cloudflare:</strong> ホスティング、CDN、D1、KV、R2、およびセキュリティサービス。',
          '<strong>OpenRouter / DeepSeek（任意）:</strong> 設定されている場合の自動スキル分類。',
          '<strong>Google Fonts:</strong> Web フォント配信。',
        ],
      },
      {
        title: '6. お客様の権利',
        paragraphs: ['お客様は次のことができます。'],
        items: [
          'アカウント設定からアカウントを削除する。削除により、セッション、トークン、お気に入り、非公開スキル、関連データが削除されます。',
          '公開スキルは公開記録として保持され、削除後はアカウントとの紐付けのみ解除されることを理解する。同じ GitHub アカウントで再ログインすると再リンクできます。',
          'お気に入り、API トークン、共有スキルの権限を製品設定から管理する。',
          'GitHub アカウントを通じて基本プロフィール情報を更新する。',
          `追加のプライバシー要請については ${GITHUB_REPO_LINK} から連絡する。`,
        ],
      },
      {
        title: '7. Cookie',
        paragraphs: ['当社は認証、セッション管理、および言語設定などの UI 設定保存のために必須 Cookie を使用します。広告 Cookie や第三者トラッキング Cookie は使用しません。'],
      },
      {
        title: '8. 児童のプライバシー',
        paragraphs: ['当サービスは 13 歳未満の児童を対象としていません。当社は 13 歳未満の児童から個人情報を故意に収集しません。'],
      },
      {
        title: '9. ポリシーの変更',
        paragraphs: ['当社は本ポリシーを随時更新する場合があります。変更があった場合は、このページに新しいプライバシーポリシーを掲載し、最終更新日を更新します。'],
      },
      {
        title: '10. お問い合わせ',
        paragraphs: [`本ポリシーに関するご質問は、${GITHUB_REPO_LINK} からお問い合わせください。`],
      },
      {
        title: '11. オープンソース',
        paragraphs: [`SkillsCat は AGPL-3.0 ライセンスのオープンソースソフトウェアです。ソースコードおよびデータ処理の実践は ${GITHUB_REPO_LINK} で確認できます。`],
      },
    ],
  },
  terms: {
    title: '利用規約',
    lastUpdated: '最終更新日: 2026年2月14日',
    lead: 'SkillsCat にアクセスまたはこれを利用することで、本利用規約に同意したものとみなされます。ご利用前に必ずお読みください。',
    sections: [
      {
        title: '1. 規約への同意',
        paragraphs: ['SkillsCat にアクセスまたはこれを利用することで、本規約およびプライバシーポリシーに同意したものとみなされます。同意しない場合はサービスを利用できません。'],
      },
      {
        title: '2. サービス概要',
        paragraphs: ['SkillsCat は、AI agent skills を見つけ、共有し、インストールできるオープンプラットフォームです。当社は以下を提供します。'],
        items: ['コミュニティによる AI agent skills カタログ', 'スキルの閲覧、検索、インストールのためのツール', '自分のスキルを投稿し共有する機能'],
      },
      {
        title: '3. ユーザーアカウント',
        subsections: [
          {
            title: '3.1 アカウント作成',
            paragraphs: ['一部機能を利用するには GitHub OAuth でのサインインが必要です。API や CLI の一部機能では、アカウントから生成した API トークンも必要です。アカウントとトークンの安全管理は利用者の責任です。'],
          },
          {
            title: '3.2 アカウントの責任',
            paragraphs: ['利用者は次に同意します。'],
            items: ['正確な情報を提供すること', '認証情報を安全に保つこと', '不正アクセスがあれば通知すること', 'アカウントで行われたすべての活動に責任を負うこと'],
          },
        ],
      },
      {
        title: '4. ユーザーコンテンツ',
        subsections: [
          {
            title: '4.1 投稿されたスキル',
            paragraphs: ['SkillsCat にスキルを投稿することで、利用者は次を表明します。'],
            items: ['そのコンテンツを共有する権利を有すること', '法令または第三者の権利を侵害しないこと', '悪意ある、有害な、または誤解を招く内容ではないこと'],
          },
          {
            title: '4.2 ライセンスの付与',
            paragraphs: ['コンテンツを投稿することで、利用者は SkillsCat に対し、投稿したスキルを当プラットフォーム上で表示、配布、宣伝するための非独占的、全世界的、ロイヤリティフリーのライセンスを付与します。'],
          },
          {
            title: '4.3 コンテンツの削除',
            paragraphs: ['当社は、本規約に違反する内容、または不適切と判断した内容を事前通知なく削除する権利を留保します。'],
          },
        ],
      },
      {
        title: '5. 許容される利用',
        paragraphs: ['利用者は次の行為を行わないことに同意します。'],
        items: [
          '違法な目的でサービスを利用すること',
          '悪意あるコードやコンテンツを投稿すること',
          '当社システムへの不正アクセスを試みること',
          'サービスを妨害または中断させること',
          '許可なくデータをスクレイピングまたは収集すること',
          '他者になりすます、または関係を偽ること',
          '適用法令に違反すること',
        ],
      },
      {
        title: '6. 知的財産',
        subsections: [
          {
            title: '6.1 当社コンテンツ',
            paragraphs: ['SkillsCat のウェブサイト、ロゴ、および独自コンテンツは著作権その他の知的財産法で保護されています。SkillsCat は AGPL-3.0 ライセンスのオープンソースソフトウェアです。'],
          },
          {
            title: '6.2 第三者コンテンツ',
            paragraphs: ['SkillsCat に掲載されるスキルは各作成者に帰属します。当社はユーザー投稿コンテンツの所有権を主張しません。'],
          },
        ],
      },
      {
        title: '7. 第三者サービス',
        paragraphs: ['当サービスは GitHub（認証とリポジトリデータ）、Cloudflare（ホスティングとインフラ）、および自動分類に使用する任意のモデルプロバイダーと連携します。これらサービスの利用は、それぞれの規約とポリシーに従います。'],
      },
      {
        title: '8. 保証の否認',
        paragraphs: [
          '本サービスは「現状有姿」かつ「提供可能な範囲」で提供され、明示または黙示を問わず一切の保証を行いません。当社は、サービスが中断せず、安全で、エラーがないことを保証しません。',
          '当プラットフォームに掲載されたスキルの正確性、完全性、有用性も保証しません。スキルのインストールと利用は利用者自身の責任で行ってください。',
        ],
      },
      {
        title: '9. 責任の制限',
        paragraphs: ['法令で認められる最大限の範囲で、SkillsCat は、サービス利用に起因する間接的、付随的、特別、結果的、懲罰的損害について責任を負いません。'],
      },
      {
        title: '10. 補償',
        paragraphs: ['利用者は、サービス利用または本規約違反に起因する請求、損害、費用について、SkillsCat および運営者を補償し、免責することに同意します。'],
      },
      {
        title: '11. 規約の変更',
        paragraphs: ['当社はいつでも本規約を変更できます。重要な変更がある場合は、サイト上に通知を掲載します。変更後もサービスを継続利用することで、新しい規約を受け入れたものとみなされます。'],
      },
      {
        title: '12. 利用終了',
        paragraphs: ['当社は、本規約に違反すると判断した場合、または他のユーザーやサービスに有害だと判断した場合、事前通知なくアクセスを停止または終了することがあります。'],
      },
      {
        title: '13. 準拠法',
        paragraphs: ['本規約は、法の抵触原則にかかわらず、適用される法令に従って解釈されます。'],
      },
      {
        title: '14. 連絡先',
        paragraphs: [`本規約に関するご質問は ${GITHUB_REPO_LINK} からご連絡ください。`],
      },
      {
        title: '15. オープンソース',
        paragraphs: ['SkillsCat はオープンソースソフトウェアです。ソースコードは AGPL-3.0 ライセンスで公開されています。プロジェクトへの貢献は、同じライセンスで提供されることに同意したものとみなされます。'],
      },
    ],
  },
} as const satisfies LegalCopy;

const ko = {
  privacy: {
    title: '개인정보 처리방침',
    lastUpdated: '최종 업데이트: 2026년 2월 14일',
    lead:
      'SkillsCat(이하 "당사")는 AI agent skills를 찾고, 공유하고, 설치할 수 있는 오픈 플랫폼입니다. 이 개인정보 처리방침은 웹사이트와 서비스를 사용할 때 당사가 정보를 어떻게 수집, 사용, 보호하는지 설명합니다.',
    sections: [
      {
        title: '1. 수집하는 정보',
        subsections: [
          {
            title: '1.1 사용자가 제공하는 정보',
            paragraphs: ['SkillsCat을 사용할 때 당사는 다음 정보를 수집할 수 있습니다.'],
            items: [
              '<strong>계정 정보:</strong> GitHub OAuth로 로그인하면 사용자 이름, 이메일 주소, 프로필 이미지, GitHub 계정 식별자 등을 받습니다.',
              '<strong>제출한 콘텐츠:</strong> 제출한 스킬, 저장소 URL, 업로드한 SKILL.md 내용과 관련 메타데이터.',
              '<strong>공유 및 협업 데이터:</strong> 비공개 스킬을 공유하거나 조직을 관리하는 경우, 해당 권한을 적용하는 데 필요한 사용자 ID 또는 이메일 주소를 저장합니다.',
              '<strong>환경설정 및 자격 정보:</strong> 즐겨찾기, API 토큰 메타데이터, 계정 및 세션 기록.',
            ],
          },
          {
            title: '1.2 자동으로 수집되는 정보',
            paragraphs: ['웹사이트를 방문하면 일부 정보를 자동으로 수집합니다.'],
            items: [
              '<strong>보안 및 세션 데이터:</strong> IP 주소와 User-Agent 등의 요청 메타데이터는 인증 보안, 남용 방지, 속도 제한을 위해 처리될 수 있습니다.',
              '<strong>사용 이벤트:</strong> 제출, 설치, 다운로드, 즐겨찾기 추가 및 해제 등의 제품 이벤트와 타임스탬프를 기록합니다.',
              '<strong>인프라 로그:</strong> Cloudflare 인프라는 안정성과 보안을 위해 운영 로그를 생성할 수 있습니다.',
            ],
          },
        ],
      },
      {
        title: '2. 정보 이용 목적',
        paragraphs: ['수집한 정보는 다음과 같은 목적으로 사용됩니다.'],
        items: [
          '서비스 제공 및 유지',
          '사용자 신원 확인 및 계정 관리',
          '스킬 제출 또는 업로드 처리 및 카탈로그 유지',
          '비공개, 목록 비공개, 공유 스킬의 접근 제어',
          '트렌드와 다운로드 지표 등의 집계 통계 생성',
          'API 토큰, 알림, 조직 권한 등 계정 기능 제공',
          '사기 또는 남용 탐지와 방지',
        ],
      },
      {
        title: '3. 정보 공유',
        paragraphs: ['당사는 개인정보를 제3자에게 판매, 거래 또는 임대하지 않습니다. 다만 다음 상황에서는 정보를 공유할 수 있습니다.'],
        items: [
          '<strong>공개 콘텐츠:</strong> 공개 스킬과 관련 공개 프로필 정보는 다른 사용자에게 보입니다.',
          '<strong>서비스 제공업체:</strong> Cloudflare(호스팅 및 인프라), GitHub(OAuth 및 저장소 API), 선택적 OpenRouter / DeepSeek 모델 API(자동 분류용), Google Fonts(폰트 제공) 등을 사용합니다.',
          '<strong>협업 기능:</strong> 비공개 스킬을 다른 사용자나 이메일 주소와 공유하면 해당 권한 데이터가 저장되어 접근 제어에 사용됩니다.',
          '<strong>법적 요구:</strong> 법률에 따라 요구되거나 당사의 권리를 보호하기 위해 필요한 경우.',
        ],
      },
      {
        title: '4. 데이터 저장 및 보안',
        paragraphs: ['데이터는 주로 Cloudflare 인프라(D1, KV, R2 포함)에 저장됩니다. 당사는 개인정보를 무단 접근, 변경, 공개, 파기로부터 보호하기 위해 합리적인 기술적·조직적 조치를 시행합니다.'],
      },
      {
        title: '5. 제3자 서비스',
        paragraphs: ['당사 서비스는 다음과 같은 제3자 서비스와 연동됩니다.'],
        items: [
          '<strong>GitHub:</strong> OAuth 인증과 저장소 메타데이터 또는 콘텐츠 접근.',
          '<strong>Cloudflare:</strong> 호스팅, CDN, D1, KV, R2 및 보안 서비스.',
          '<strong>OpenRouter / DeepSeek(선택 사항):</strong> 설정된 경우 자동 스킬 분류.',
          '<strong>Google Fonts:</strong> 웹 폰트 제공.',
        ],
      },
      {
        title: '6. 사용자의 권리',
        paragraphs: ['사용자는 다음을 수행할 수 있습니다.'],
        items: [
          '계정 설정에서 계정을 삭제할 수 있습니다. 삭제 시 세션, 토큰, 즐겨찾기, 비공개 스킬 및 관련 계정 데이터가 제거됩니다.',
          '공개 스킬은 공개 기록으로 유지되며 계정 삭제 후 계정과의 연결만 해제된다는 점을 이해할 수 있습니다. 이후 같은 GitHub 계정으로 다시 로그인하면 다시 연결할 수 있습니다.',
          '제품 설정에서 즐겨찾기, API 토큰, 공유 스킬 권한을 관리할 수 있습니다.',
          'GitHub 계정을 통해 핵심 프로필 정보를 업데이트할 수 있습니다.',
          `추가적인 개인정보 요청은 ${GITHUB_REPO_LINK}를 통해 문의할 수 있습니다.`,
        ],
      },
      {
        title: '7. 쿠키',
        paragraphs: ['당사는 인증, 세션 관리, 언어 선택과 같은 UI 환경설정 저장을 위해 필수 쿠키를 사용합니다. 광고 쿠키나 제3자 추적 쿠키는 사용하지 않습니다.'],
      },
      {
        title: '8. 아동의 개인정보',
        paragraphs: ['당사 서비스는 13세 미만 아동을 대상으로 하지 않습니다. 당사는 13세 미만 아동의 개인정보를 고의로 수집하지 않습니다.'],
      },
      {
        title: '9. 정책 변경',
        paragraphs: ['당사는 이 개인정보 처리방침을 수시로 업데이트할 수 있습니다. 변경 시 이 페이지에 새 정책을 게시하고 최종 업데이트 날짜를 수정합니다.'],
      },
      {
        title: '10. 문의하기',
        paragraphs: [`이 개인정보 처리방침에 대한 질문이 있다면 ${GITHUB_REPO_LINK}를 통해 문의해 주세요.`],
      },
      {
        title: '11. 오픈소스',
        paragraphs: [`SkillsCat은 AGPL-3.0 라이선스의 오픈소스 소프트웨어입니다. 소스 코드와 데이터 처리 관행은 ${GITHUB_REPO_LINK}에서 확인할 수 있습니다.`],
      },
    ],
  },
  terms: {
    title: '서비스 약관',
    lastUpdated: '최종 업데이트: 2026년 2월 14일',
    lead: 'SkillsCat에 접근하거나 이를 이용함으로써 본 서비스 약관에 동의하게 됩니다. 사이트와 관련 서비스를 사용하기 전에 주의 깊게 읽어 주세요.',
    sections: [
      {
        title: '1. 약관 수락',
        paragraphs: ['SkillsCat에 접근하거나 이를 이용함으로써 본 약관과 개인정보 처리방침에 동의하게 됩니다. 동의하지 않으면 서비스를 이용할 수 없습니다.'],
      },
      {
        title: '2. 서비스 설명',
        paragraphs: ['SkillsCat은 AI agent skills를 찾고, 공유하고, 설치할 수 있는 오픈 플랫폼입니다. 당사는 다음을 제공합니다.'],
        items: ['커뮤니티 AI agent skills 카탈로그', '스킬 탐색, 검색, 설치 도구', '자신의 스킬을 제출하고 공유하는 기능'],
      },
      {
        title: '3. 사용자 계정',
        subsections: [
          {
            title: '3.1 계정 생성',
            paragraphs: ['일부 기능에 접근하려면 GitHub OAuth로 로그인해야 합니다. 일부 API 및 CLI 기능은 계정에서 생성한 API 토큰도 필요합니다. 계정과 토큰 보안은 사용자의 책임입니다.'],
          },
          {
            title: '3.2 계정 책임',
            paragraphs: ['사용자는 다음에 동의합니다.'],
            items: ['정확한 정보를 제공할 것', '계정 자격 정보를 안전하게 보관할 것', '무단 접근이 발생하면 통지할 것', '계정에서 발생한 모든 활동에 책임을 질 것'],
          },
        ],
      },
      {
        title: '4. 사용자 콘텐츠',
        subsections: [
          {
            title: '4.1 제출된 스킬',
            paragraphs: ['SkillsCat에 스킬을 제출하면 다음을 진술하는 것으로 간주됩니다.'],
            items: ['해당 콘텐츠를 공유할 권리가 있음', '콘텐츠가 법률이나 제3자 권리를 침해하지 않음', '콘텐츠가 악성, 유해, 기만적이지 않음'],
          },
          {
            title: '4.2 라이선스 부여',
            paragraphs: ['콘텐츠를 제출하면 플랫폼에서 해당 스킬을 표시, 배포, 홍보하기 위한 비독점적이고 전 세계적이며 로열티 없는 라이선스를 SkillsCat에 부여하게 됩니다.'],
          },
          {
            title: '4.3 콘텐츠 삭제',
            paragraphs: ['당사는 본 약관을 위반하거나 부적절하다고 판단되는 콘텐츠를 사전 통지 없이 제거할 권리를 보유합니다.'],
          },
        ],
      },
      {
        title: '5. 허용되는 사용',
        paragraphs: ['사용자는 다음 행위를 하지 않기로 동의합니다.'],
        items: [
          '불법적인 목적으로 서비스를 사용하는 행위',
          '악성 코드나 콘텐츠를 제출하는 행위',
          '당사 시스템에 무단 접근을 시도하는 행위',
          '서비스를 방해하거나 중단시키는 행위',
          '허가 없이 데이터를 스크래핑하거나 수집하는 행위',
          '타인을 사칭하거나 소속을 허위로 표시하는 행위',
          '적용 가능한 법률 또는 규정을 위반하는 행위',
        ],
      },
      {
        title: '6. 지식재산권',
        subsections: [
          {
            title: '6.1 당사 콘텐츠',
            paragraphs: ['SkillsCat 웹사이트, 로고 및 원본 콘텐츠는 저작권 및 기타 지식재산권 법률의 보호를 받습니다. SkillsCat은 AGPL-3.0 라이선스의 오픈소스 소프트웨어입니다.'],
          },
          {
            title: '6.2 제3자 콘텐츠',
            paragraphs: ['SkillsCat에 등록된 스킬의 소유권은 각 제작자에게 있습니다. 당사는 사용자 제출 콘텐츠의 소유권을 주장하지 않습니다.'],
          },
        ],
      },
      {
        title: '7. 제3자 서비스',
        paragraphs: ['당사 서비스는 GitHub(인증 및 저장소 데이터), Cloudflare(호스팅 및 인프라), 자동 분류에 사용되는 선택적 모델 제공업체와 연동됩니다. 이러한 서비스 사용은 각 서비스의 약관과 정책을 따릅니다.'],
      },
      {
        title: '8. 보증 부인',
        paragraphs: [
          '본 서비스는 "있는 그대로" 그리고 "제공 가능한 범위" 내에서 제공되며, 명시적이든 묵시적이든 어떠한 보증도 제공하지 않습니다. 당사는 서비스가 중단되지 않거나 안전하거나 오류가 없을 것이라고 보증하지 않습니다.',
          '플랫폼에 등록된 스킬의 정확성, 완전성, 유용성도 보장하지 않습니다. 스킬 설치와 사용은 사용자 본인의 책임입니다.',
        ],
      },
      {
        title: '9. 책임 제한',
        paragraphs: ['법이 허용하는 최대 한도 내에서, SkillsCat은 서비스 사용으로 인해 발생하는 간접적, 부수적, 특별, 결과적 또는 징벌적 손해에 대해 책임을 지지 않습니다.'],
      },
      {
        title: '10. 면책',
        paragraphs: ['사용자는 서비스 사용 또는 본 약관 위반으로 인해 발생하는 모든 청구, 손해, 비용에 대해 SkillsCat과 운영자를 면책하고 보호하는 데 동의합니다.'],
      },
      {
        title: '11. 약관 변경',
        paragraphs: ['당사는 언제든지 본 약관을 수정할 수 있습니다. 중요한 변경이 있을 경우 웹사이트에 공지합니다. 변경 후에도 서비스를 계속 사용하면 새로운 약관에 동의한 것으로 간주됩니다.'],
      },
      {
        title: '12. 종료',
        paragraphs: ['당사는 사용자의 행위가 본 약관을 위반하거나 다른 사용자 또는 서비스에 해롭다고 판단되는 경우 사전 통지 없이 서비스 접근을 종료하거나 중단할 수 있습니다.'],
      },
      {
        title: '13. 준거법',
        paragraphs: ['본 약관은 법률 충돌 원칙과 관계없이 적용 가능한 법률에 따라 해석되고 적용됩니다.'],
      },
      {
        title: '14. 연락처',
        paragraphs: [`본 약관에 관한 질문은 ${GITHUB_REPO_LINK}를 통해 문의해 주세요.`],
      },
      {
        title: '15. 오픈소스',
        paragraphs: ['SkillsCat은 오픈소스 소프트웨어입니다. 소스 코드는 AGPL-3.0 라이선스로 제공됩니다. 프로젝트에 기여함으로써 동일한 라이선스로 기여물이 배포되는 것에 동의하게 됩니다.'],
      },
    ],
  },
} as const satisfies LegalCopy;

const copyByLocale: Record<SupportedLocale, LegalCopy> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
};

export function getLegalDocument(locale: SupportedLocale, type: keyof LegalCopy): LegalDocument {
  return copyByLocale[locale][type];
}
