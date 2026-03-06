import {
  CATEGORY_SECTIONS,
  CATEGORIES,
  type Category,
  type CategorySection,
  type CategoryWithCount,
} from '$lib/constants/categories';
import type { SupportedLocale } from '$lib/i18n/config';

type CategoryCopyMap = Record<string, { name: string; description: string }>;
type SectionNameMap = Record<string, string>;

interface CategoryLocaleCopy {
  sections: SectionNameMap;
  categories: CategoryCopyMap;
}

const categoryLocaleCopy: Record<SupportedLocale, CategoryLocaleCopy> = {
  en: {
    sections: {
      development: 'Development',
      backend: 'Backend',
      frontend: 'Frontend',
      devops: 'DevOps',
      quality: 'Quality',
      docs: 'Docs',
      data: 'Data',
      ai: 'AI',
      productivity: 'Productivity',
      content: 'Content',
      lifestyle: 'Lifestyle',
    },
    categories: Object.fromEntries(
      CATEGORIES.map((category) => [
        category.slug,
        { name: category.name, description: category.description },
      ])
    ),
  },
  'zh-CN': {
    sections: {
      development: '开发',
      backend: '后端',
      frontend: '前端',
      devops: 'DevOps',
      quality: '质量',
      docs: '文档',
      data: '数据',
      ai: 'AI',
      productivity: '效率',
      content: '内容',
      lifestyle: '生活方式',
    },
    categories: {
      git: { name: 'Git 与版本控制', description: 'Git 操作、提交助手与分支管理' },
      'code-generation': { name: '代码生成', description: '生成代码、脚手架和模板' },
      refactoring: { name: '重构', description: '代码重组与优化' },
      debugging: { name: '调试', description: '定位并修复问题，分析错误' },
      testing: { name: '测试', description: '单元测试、集成测试与测试自动化' },
      'code-review': { name: '代码评审', description: '自动化代码审查与分析' },
      api: { name: 'API 开发', description: 'API 设计、REST 与 GraphQL' },
      database: { name: '数据库', description: '数据库管理与查询' },
      auth: { name: '认证鉴权', description: '认证与授权' },
      caching: { name: '缓存', description: '缓存策略与实现' },
      'ui-components': { name: 'UI 组件', description: 'UI 组件生成与样式设计' },
      accessibility: { name: '无障碍', description: '无障碍测试与改进' },
      animation: { name: '动画', description: 'UI 动画与过渡效果' },
      responsive: { name: '响应式', description: '响应式设计与移动优先' },
      'ci-cd': { name: 'CI/CD', description: '持续集成与部署' },
      docker: { name: 'Docker', description: '容器化与 Docker' },
      kubernetes: { name: 'Kubernetes', description: 'Kubernetes 编排' },
      cloud: { name: '云服务', description: '云服务与基础设施' },
      monitoring: { name: '监控', description: '日志、指标与可观测性' },
      security: { name: '安全', description: '安全扫描与漏洞检测' },
      performance: { name: '性能', description: '性能分析与优化' },
      linting: { name: 'Lint 与格式化', description: '代码 lint 与格式化' },
      types: { name: '类型', description: '类型检查与类型生成' },
      documentation: { name: '文档生成', description: '生成并维护文档' },
      comments: { name: '注释', description: '代码注释与标注' },
      i18n: { name: '国际化', description: '国际化与本地化' },
      'data-processing': { name: '数据处理', description: '数据转换、清洗与 ETL' },
      analytics: { name: '分析', description: '分析、报表与可视化' },
      scraping: { name: '抓取', description: '网页抓取与数据提取' },
      math: { name: '数学', description: '数学计算与符号处理' },
      prompts: { name: '提示词', description: '提示词工程与模板' },
      embeddings: { name: '向量嵌入', description: '向量检索与嵌入工作流' },
      agents: { name: '智能体', description: 'Agent 规划、多步流程与编排' },
      'ml-ops': { name: 'MLOps', description: '模型部署、评估与运维' },
      automation: { name: '自动化', description: '工作流自动化与调度' },
      'file-ops': { name: '文件操作', description: '文件系统与批量文件任务' },
      cli: { name: 'CLI 工具', description: '命令行工具' },
      templates: { name: '模板', description: '项目与代码模板' },
      writing: { name: '写作', description: '内容写作与编辑' },
      email: { name: '邮件', description: '邮件撰写与模板' },
      social: { name: '社交媒体', description: '社交媒体内容' },
      seo: { name: 'SEO', description: '搜索引擎优化' },
      finance: { name: '金融', description: '个人理财、预算与财务工具' },
      'web3-crypto': { name: 'Web3 与加密', description: '区块链、加密货币与 Web3 开发' },
      legal: { name: '法律', description: '法律文档生成与合规' },
      academic: { name: '学术', description: '学术写作、研究与引用' },
      'game-dev': { name: '游戏开发', description: '游戏开发与引擎工具' },
    },
  },
  ja: {
    sections: {
      development: '開発',
      backend: 'バックエンド',
      frontend: 'フロントエンド',
      devops: 'DevOps',
      quality: '品質',
      docs: 'ドキュメント',
      data: 'データ',
      ai: 'AI',
      productivity: '生産性',
      content: 'コンテンツ',
      lifestyle: 'ライフスタイル',
    },
    categories: {
      git: { name: 'Git と VCS', description: 'Git 操作、コミット補助、ブランチ管理' },
      'code-generation': { name: 'コード生成', description: 'コード、ボイラープレート、ひな形の生成' },
      refactoring: { name: 'リファクタリング', description: 'コードの再構成と最適化' },
      debugging: { name: 'デバッグ', description: 'バグの特定と修正、エラー解析' },
      testing: { name: 'テスト', description: '単体テスト、統合テスト、自動テスト' },
      'code-review': { name: 'コードレビュー', description: '自動コードレビューと解析' },
      api: { name: 'API 開発', description: 'API 設計、REST、GraphQL' },
      database: { name: 'データベース', description: 'データベース管理とクエリ' },
      auth: { name: '認証', description: '認証と認可' },
      caching: { name: 'キャッシュ', description: 'キャッシュ戦略と実装' },
      'ui-components': { name: 'UI コンポーネント', description: 'UI コンポーネント生成とスタイリング' },
      accessibility: { name: 'アクセシビリティ', description: 'アクセシビリティの検証と改善' },
      animation: { name: 'アニメーション', description: 'UI アニメーションとトランジション' },
      responsive: { name: 'レスポンシブ', description: 'レスポンシブ設計とモバイルファースト' },
      'ci-cd': { name: 'CI/CD', description: '継続的インテグレーションとデプロイ' },
      docker: { name: 'Docker', description: 'コンテナ化と Docker' },
      kubernetes: { name: 'Kubernetes', description: 'Kubernetes オーケストレーション' },
      cloud: { name: 'クラウド', description: 'クラウドサービスとインフラ' },
      monitoring: { name: 'モニタリング', description: 'ログ、メトリクス、可観測性' },
      security: { name: 'セキュリティ', description: 'セキュリティスキャンと脆弱性検出' },
      performance: { name: 'パフォーマンス', description: '性能解析と最適化' },
      linting: { name: 'Lint / 整形', description: 'コードの lint と整形' },
      types: { name: '型', description: '型チェックと型生成' },
      documentation: { name: 'ドキュメント生成', description: 'ドキュメントの生成と保守' },
      comments: { name: 'コメント', description: 'コードコメントと注釈' },
      i18n: { name: '国際化', description: '国際化とローカライズ' },
      'data-processing': { name: 'データ処理', description: 'データ変換、クリーニング、ETL' },
      analytics: { name: '分析', description: '分析、レポート、可視化' },
      scraping: { name: 'スクレイピング', description: 'Web スクレイピングとデータ抽出' },
      math: { name: '数学', description: '数値計算と記号処理' },
      prompts: { name: 'プロンプト', description: 'プロンプト設計とテンプレート' },
      embeddings: { name: '埋め込み', description: 'ベクトル検索と埋め込みワークフロー' },
      agents: { name: 'エージェント', description: 'エージェント設計、マルチステップ処理、オーケストレーション' },
      'ml-ops': { name: 'MLOps', description: 'モデルのデプロイ、評価、運用' },
      automation: { name: '自動化', description: 'ワークフロー自動化とスケジューリング' },
      'file-ops': { name: 'ファイル操作', description: 'ファイルシステムと一括ファイル処理' },
      cli: { name: 'CLI ツール', description: 'コマンドラインユーティリティ' },
      templates: { name: 'テンプレート', description: 'プロジェクトとコードのテンプレート' },
      writing: { name: 'ライティング', description: 'コンテンツ作成と編集' },
      email: { name: 'メール', description: 'メール作成とテンプレート' },
      social: { name: 'ソーシャル', description: 'SNS コンテンツ' },
      seo: { name: 'SEO', description: '検索エンジン最適化' },
      finance: { name: 'ファイナンス', description: '家計管理、予算、金融ツール' },
      'web3-crypto': { name: 'Web3 と暗号資産', description: 'ブロックチェーン、暗号資産、Web3 開発' },
      legal: { name: 'リーガル', description: '法務ドキュメント生成とコンプライアンス' },
      academic: { name: '学術', description: '学術執筆、研究、引用' },
      'game-dev': { name: 'ゲーム開発', description: 'ゲーム開発とエンジンツール' },
    },
  },
  ko: {
    sections: {
      development: '개발',
      backend: '백엔드',
      frontend: '프론트엔드',
      devops: 'DevOps',
      quality: '품질',
      docs: '문서',
      data: '데이터',
      ai: 'AI',
      productivity: '생산성',
      content: '콘텐츠',
      lifestyle: '라이프스타일',
    },
    categories: {
      git: { name: 'Git 및 VCS', description: 'Git 작업, 커밋 도우미, 브랜치 관리' },
      'code-generation': { name: '코드 생성', description: '코드, 보일러플레이트, 스캐폴딩 생성' },
      refactoring: { name: '리팩터링', description: '코드 재구성과 최적화' },
      debugging: { name: '디버깅', description: '버그 탐지 및 수정, 오류 분석' },
      testing: { name: '테스트', description: '단위 테스트, 통합 테스트, 자동화 테스트' },
      'code-review': { name: '코드 리뷰', description: '자동 코드 리뷰와 분석' },
      api: { name: 'API 개발', description: 'API 설계, REST, GraphQL' },
      database: { name: '데이터베이스', description: '데이터베이스 관리와 쿼리' },
      auth: { name: '인증', description: '인증과 권한 부여' },
      caching: { name: '캐싱', description: '캐싱 전략과 구현' },
      'ui-components': { name: 'UI 컴포넌트', description: 'UI 컴포넌트 생성과 스타일링' },
      accessibility: { name: '접근성', description: '접근성 테스트와 개선' },
      animation: { name: '애니메이션', description: 'UI 애니메이션과 전환' },
      responsive: { name: '반응형', description: '반응형 디자인과 모바일 우선' },
      'ci-cd': { name: 'CI/CD', description: '지속적 통합과 배포' },
      docker: { name: 'Docker', description: '컨테이너화와 Docker' },
      kubernetes: { name: 'Kubernetes', description: 'Kubernetes 오케스트레이션' },
      cloud: { name: '클라우드', description: '클라우드 서비스와 인프라' },
      monitoring: { name: '모니터링', description: '로그, 메트릭, 관측성' },
      security: { name: '보안', description: '보안 스캔과 취약점 탐지' },
      performance: { name: '성능', description: '성능 프로파일링과 최적화' },
      linting: { name: 'Lint 및 포맷', description: '코드 린트와 포맷팅' },
      types: { name: '타입', description: '타입 검사와 타입 생성' },
      documentation: { name: '문서 생성', description: '문서 생성과 유지보수' },
      comments: { name: '주석', description: '코드 주석과 어노테이션' },
      i18n: { name: '국제화', description: '국제화와 현지화' },
      'data-processing': { name: '데이터 처리', description: '데이터 변환, 정제, ETL' },
      analytics: { name: '분석', description: '분석, 리포트, 시각화' },
      scraping: { name: '스크래핑', description: '웹 스크래핑과 데이터 추출' },
      math: { name: '수학', description: '수치 계산과 기호 처리' },
      prompts: { name: '프롬프트', description: '프롬프트 엔지니어링과 템플릿' },
      embeddings: { name: '임베딩', description: '벡터 검색과 임베딩 워크플로' },
      agents: { name: '에이전트', description: '에이전트 계획, 다단계 워크플로, 오케스트레이션' },
      'ml-ops': { name: 'MLOps', description: '모델 배포, 평가, 운영' },
      automation: { name: '자동화', description: '워크플로 자동화와 스케줄링' },
      'file-ops': { name: '파일 작업', description: '파일 시스템과 대량 파일 작업' },
      cli: { name: 'CLI 도구', description: '명령줄 유틸리티' },
      templates: { name: '템플릿', description: '프로젝트 및 코드 템플릿' },
      writing: { name: '글쓰기', description: '콘텐츠 작성과 편집' },
      email: { name: '이메일', description: '이메일 작성과 템플릿' },
      social: { name: '소셜', description: '소셜 미디어 콘텐츠' },
      seo: { name: 'SEO', description: '검색 엔진 최적화' },
      finance: { name: '재무', description: '개인 재무, 예산, 금융 도구' },
      'web3-crypto': { name: 'Web3 및 크립토', description: '블록체인, 암호화폐, Web3 개발' },
      legal: { name: '법률', description: '법률 문서 생성과 컴플라이언스' },
      academic: { name: '학술', description: '학술 글쓰기, 연구, 인용' },
      'game-dev': { name: '게임 개발', description: '게임 개발과 엔진 도구' },
    },
  },
};

function getCategoryCopy(locale: SupportedLocale): CategoryLocaleCopy {
  return categoryLocaleCopy[locale];
}

export function localizeCategory(category: Category, locale: SupportedLocale): Category {
  const copy = getCategoryCopy(locale).categories[category.slug];
  if (!copy) return category;
  return {
    ...category,
    name: copy.name,
    description: copy.description,
  };
}

export function localizeCategoryWithCount(
  category: CategoryWithCount,
  locale: SupportedLocale
): CategoryWithCount {
  return {
    ...localizeCategory(category, locale),
    skillCount: category.skillCount,
  };
}

export function localizeCategorySection(section: CategorySection, locale: SupportedLocale): CategorySection {
  const copy = getCategoryCopy(locale);
  return {
    ...section,
    name: copy.sections[section.id] || section.name,
    categories: section.categories.map((category) => localizeCategory(category, locale)),
  };
}

export function getLocalizedCategoryBySlug(slug: string, locale: SupportedLocale): Category | undefined {
  const category = CATEGORIES.find((entry) => entry.slug === slug);
  return category ? localizeCategory(category, locale) : undefined;
}

export function getLocalizedCategorySections(locale: SupportedLocale): CategorySection[] {
  return CATEGORY_SECTIONS.map((section) => localizeCategorySection(section, locale));
}
