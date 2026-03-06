import type { SupportedLocale } from '$lib/i18n/config';
import type { DeepLocalized } from '$lib/i18n/catalog';

const en = {
  visibility: {
    public: 'Public',
    private: 'Private',
    unlisted: 'Unlisted',
  },
  badges: {
    uploaded: 'Uploaded',
    verified: 'Verified',
    organization: 'Organization',
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
    connected: 'Connected',
    github: 'GitHub',
  },
} as const;

type UiCopy = DeepLocalized<typeof en>;

const zhCN = {
  visibility: {
    public: '公开',
    private: '私有',
    unlisted: '未列出',
  },
  badges: {
    uploaded: '已上传',
    verified: '已验证',
    organization: '组织',
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    connected: '已连接',
    github: 'GitHub',
  },
} satisfies UiCopy;

const ja = {
  visibility: {
    public: '公開',
    private: '非公開',
    unlisted: '限定公開',
  },
  badges: {
    uploaded: 'アップロード済み',
    verified: '認証済み',
    organization: '組織',
    owner: 'オーナー',
    admin: '管理者',
    member: 'メンバー',
    connected: '接続済み',
    github: 'GitHub',
  },
} satisfies UiCopy;

const ko = {
  visibility: {
    public: '공개',
    private: '비공개',
    unlisted: '목록 비공개',
  },
  badges: {
    uploaded: '업로드됨',
    verified: '검증됨',
    organization: '조직',
    owner: '소유자',
    admin: '관리자',
    member: '멤버',
    connected: '연결됨',
    github: 'GitHub',
  },
} satisfies UiCopy;

const copyByLocale: Record<SupportedLocale, UiCopy> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
};

export function getUiCopy(locale: SupportedLocale): UiCopy {
  return copyByLocale[locale];
}
