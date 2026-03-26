import type { SupportedLocale } from '$lib/i18n/config';
import { formatMessage } from '$lib/i18n/messages';
import { normalizeLocale, resolveRequestLocale } from '$lib/i18n/resolve';

const en = {
  databaseNotAvailable: 'The submit service is temporarily unavailable.',
  authRequired: 'Please sign in to submit a skill.',
  repositoryUrlRequired: 'Repository URL is required.',
  invalidRepositoryUrl: 'Invalid repository URL. Only GitHub repositories are supported.',
  repositoryNotFound: 'Repository not found.',
  requestBodyTooLarge: 'Request body is too large.',
  requestBodyRequired: 'Request body is required.',
  invalidJsonBody: 'Invalid JSON body.',
  invalidGitHubUrlFormat: 'Invalid GitHub URL format. Please use the repository root or the default branch ({defaultBranch}).',
  commitSpecificUrlNotSupported: 'Commit-specific URLs are not supported. Please submit the repository root or the default branch ({defaultBranch}).',
  defaultBranchOnlySupported: 'Only the default branch ({defaultBranch}) is supported for submission.',
  dotFolderRequiresStars: 'Skills from IDE-specific folders are only accepted from repositories with 500+ stars.',
  noSkillMdFound: 'No SKILL.md file was found in the repository.',
  indexingQueueNotConfigured: 'The indexing queue is not configured right now. Please try again later.',
  failedToQueueSkill: 'Failed to queue the skill for processing. Please try again later.',
  skillResurrected: 'This archived skill has been restored and is now available again.',
  skillArchivedResurrectionFailed: 'This skill is archived, but we could not restore it right now.',
  skillAlreadyExists: 'This skill already exists.',
  skillAlreadyExistsRefreshQueued: 'This skill already exists. We queued a refresh check.',
  skillSubmitted: 'Skill submitted successfully. It will appear in the catalog once processing finishes.',
  skillsQueued: 'Submitted {count} skill(s) for processing.',
  skillsAlreadyExist: '{count} already exist.',
  skillsResurrected: 'Restored {count} archived skill(s).',
  skillsRefreshQueued: '{count} existing skill(s) were queued for refresh.',
  skillsSkippedDueToLimit: 'Some skills were skipped because of the submission limit.',
  archivedWillBeResurrected: 'This archived skill will be restored when you submit it.',
  failedToValidateUrl: 'Failed to validate the repository URL.',
  githubRateLimited: 'GitHub is rate limiting requests right now. Please try again later.',
  githubRateLimitedWithRetryAfter: 'GitHub is rate limiting requests right now. Please try again in about {retryAfterSeconds} seconds.',
  githubUpstreamFailure: 'GitHub is temporarily unavailable. Please try again later.',
  submitFailed: 'Failed to submit the skill. Please try again later.',
  forkNoUniqueCommits: 'This fork has no commits ahead of upstream {upstream}. Submit the original repository or add your own changes first.',
  forkBehindUpstream: 'This fork is {behind} commit(s) behind upstream {upstream}. Sync it with upstream before submitting.',
  forkVerificationFailed: 'We could not verify this fork against its upstream right now. Please try again later.',
} as const;

export type SubmitApiMessageKey = keyof typeof en;
export type SubmitApiMessageValues = Record<string, string | number>;

export interface SubmitApiMessageDescriptor {
  key: SubmitApiMessageKey;
  values?: SubmitApiMessageValues;
}

const zhCN: Record<SubmitApiMessageKey, string> = {
  databaseNotAvailable: '收录服务暂时不可用。',
  authRequired: '请先登录后再提交 skill。',
  repositoryUrlRequired: '必须提供仓库 URL。',
  invalidRepositoryUrl: '仓库 URL 无效，目前只支持 GitHub 仓库。',
  repositoryNotFound: '未找到该仓库。',
  requestBodyTooLarge: '请求体过大。',
  requestBodyRequired: '请求体不能为空。',
  invalidJsonBody: 'JSON 请求体格式无效。',
  invalidGitHubUrlFormat: 'GitHub URL 格式不正确，请使用仓库根目录或默认分支（{defaultBranch}）上的链接。',
  commitSpecificUrlNotSupported: '暂不支持提交指定 commit 的链接，请使用仓库根目录或默认分支（{defaultBranch}）上的链接。',
  defaultBranchOnlySupported: '只支持提交默认分支（{defaultBranch}）。',
  dotFolderRequiresStars: '位于 IDE 专用点目录中的 skill 仅接受 500 星以上仓库提交。',
  noSkillMdFound: '仓库中没有找到 SKILL.md 文件。',
  indexingQueueNotConfigured: '索引队列当前不可用，请稍后再试。',
  failedToQueueSkill: '加入处理队列失败，请稍后再试。',
  skillResurrected: '这个已归档的 skill 已恢复上线。',
  skillArchivedResurrectionFailed: '这个 skill 已归档，但暂时无法恢复。',
  skillAlreadyExists: '这个 skill 已经存在。',
  skillAlreadyExistsRefreshQueued: '这个 skill 已经存在，我们已加入刷新队列。',
  skillSubmitted: '提交成功，处理完成后会出现在目录中。',
  skillsQueued: '已提交 {count} 个 skill 进入处理队列。',
  skillsAlreadyExist: '其中 {count} 个已存在。',
  skillsResurrected: '其中 {count} 个已从归档中恢复。',
  skillsRefreshQueued: '其中 {count} 个已加入刷新队列。',
  skillsSkippedDueToLimit: '有部分 skill 因数量限制未被提交。',
  archivedWillBeResurrected: '这个已归档的 skill 会在提交后恢复。',
  failedToValidateUrl: '校验仓库 URL 失败。',
  githubRateLimited: 'GitHub 当前触发了限流，请稍后再试。',
  githubRateLimitedWithRetryAfter: 'GitHub 当前触发了限流，请大约 {retryAfterSeconds} 秒后再试。',
  githubUpstreamFailure: 'GitHub 服务暂时不可用，请稍后再试。',
  submitFailed: '提交 skill 失败，请稍后再试。',
  forkNoUniqueCommits: '这个 fork 相比上游 {upstream} 没有新增提交。请提交原仓库，或先在 fork 上完成修改后再提交。',
  forkBehindUpstream: '这个 fork 相比上游 {upstream} 落后了 {behind} 个提交，请先同步上游后再提交。',
  forkVerificationFailed: '暂时无法校验这个 fork 与上游的关系，请稍后再试。',
};

const ja: Record<SubmitApiMessageKey, string> = {
  databaseNotAvailable: '投稿サービスは一時的に利用できません。',
  authRequired: 'スキルを投稿するにはサインインしてください。',
  repositoryUrlRequired: 'リポジトリ URL は必須です。',
  invalidRepositoryUrl: 'リポジトリ URL が無効です。現在は GitHub リポジトリのみ対応しています。',
  repositoryNotFound: 'リポジトリが見つかりません。',
  requestBodyTooLarge: 'リクエスト本文が大きすぎます。',
  requestBodyRequired: 'リクエスト本文が必要です。',
  invalidJsonBody: 'JSON リクエスト本文が不正です。',
  invalidGitHubUrlFormat: 'GitHub URL の形式が正しくありません。リポジトリのルート、またはデフォルトブランチ ({defaultBranch}) を指定してください。',
  commitSpecificUrlNotSupported: '特定コミットの URL はサポートしていません。リポジトリのルート、またはデフォルトブランチ ({defaultBranch}) を指定してください。',
  defaultBranchOnlySupported: '投稿に対応しているのはデフォルトブランチ ({defaultBranch}) のみです。',
  dotFolderRequiresStars: 'IDE 用ドットフォルダ内の skill は、500 スター以上のリポジトリのみ受け付けます。',
  noSkillMdFound: 'リポジトリ内に SKILL.md が見つかりませんでした。',
  indexingQueueNotConfigured: '現在インデックスキューを利用できません。後でもう一度お試しください。',
  failedToQueueSkill: '処理キューへの登録に失敗しました。後でもう一度お試しください。',
  skillResurrected: 'このアーカイブ済み skill は復元され、再び利用可能になりました。',
  skillArchivedResurrectionFailed: 'この skill はアーカイブ済みですが、今は復元できませんでした。',
  skillAlreadyExists: 'この skill はすでに存在します。',
  skillAlreadyExistsRefreshQueued: 'この skill はすでに存在するため、再確認キューに追加しました。',
  skillSubmitted: '投稿が完了しました。処理が終わり次第カタログに表示されます。',
  skillsQueued: '{count} 件の skill を処理キューに追加しました。',
  skillsAlreadyExist: '{count} 件はすでに存在します。',
  skillsResurrected: '{count} 件のアーカイブ済み skill を復元しました。',
  skillsRefreshQueued: '既存の {count} 件を再確認キューに追加しました。',
  skillsSkippedDueToLimit: '一部の skill は件数上限のためスキップされました。',
  archivedWillBeResurrected: 'このアーカイブ済み skill は投稿時に復元されます。',
  failedToValidateUrl: 'リポジトリ URL の検証に失敗しました。',
  githubRateLimited: 'GitHub が現在レート制限をかけています。しばらくしてから再試行してください。',
  githubRateLimitedWithRetryAfter: 'GitHub が現在レート制限をかけています。約 {retryAfterSeconds} 秒後に再試行してください。',
  githubUpstreamFailure: 'GitHub が一時的に利用できません。後でもう一度お試しください。',
  submitFailed: 'skill の投稿に失敗しました。後でもう一度お試しください。',
  forkNoUniqueCommits: 'この fork には upstream {upstream} を超える独自コミットがありません。元のリポジトリを投稿するか、fork に変更を加えてから再試行してください。',
  forkBehindUpstream: 'この fork は upstream {upstream} より {behind} コミット遅れています。upstream を取り込んでから投稿してください。',
  forkVerificationFailed: 'この fork と upstream の関係を今は確認できません。後でもう一度お試しください。',
};

const ko: Record<SubmitApiMessageKey, string> = {
  databaseNotAvailable: '제출 서비스를 지금 사용할 수 없습니다.',
  authRequired: '스킬을 제출하려면 먼저 로그인해 주세요.',
  repositoryUrlRequired: '저장소 URL이 필요합니다.',
  invalidRepositoryUrl: '저장소 URL이 올바르지 않습니다. 현재는 GitHub 저장소만 지원합니다.',
  repositoryNotFound: '저장소를 찾을 수 없습니다.',
  requestBodyTooLarge: '요청 본문이 너무 큽니다.',
  requestBodyRequired: '요청 본문이 필요합니다.',
  invalidJsonBody: 'JSON 요청 본문이 올바르지 않습니다.',
  invalidGitHubUrlFormat: 'GitHub URL 형식이 올바르지 않습니다. 저장소 루트 또는 기본 브랜치({defaultBranch})를 사용해 주세요.',
  commitSpecificUrlNotSupported: '특정 커밋 URL은 지원하지 않습니다. 저장소 루트 또는 기본 브랜치({defaultBranch})를 사용해 주세요.',
  defaultBranchOnlySupported: '제출은 기본 브랜치({defaultBranch})만 지원합니다.',
  dotFolderRequiresStars: 'IDE 전용 점 폴더의 skill은 별 500개 이상 저장소만 허용됩니다.',
  noSkillMdFound: '저장소에서 SKILL.md 파일을 찾지 못했습니다.',
  indexingQueueNotConfigured: '인덱싱 큐를 지금 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  failedToQueueSkill: '처리 큐에 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  skillResurrected: '보관된 이 skill이 복원되어 다시 사용할 수 있게 되었습니다.',
  skillArchivedResurrectionFailed: '이 skill은 보관 상태이지만 지금은 복원할 수 없습니다.',
  skillAlreadyExists: '이 skill은 이미 존재합니다.',
  skillAlreadyExistsRefreshQueued: '이 skill은 이미 존재하며, 새로 확인하도록 대기열에 추가했습니다.',
  skillSubmitted: '제출이 완료되었습니다. 처리가 끝나면 카탈로그에 표시됩니다.',
  skillsQueued: '{count}개의 skill을 처리 큐에 넣었습니다.',
  skillsAlreadyExist: '{count}개는 이미 존재합니다.',
  skillsResurrected: '보관된 skill {count}개를 복원했습니다.',
  skillsRefreshQueued: '기존 skill {count}개를 새로 확인하도록 대기열에 추가했습니다.',
  skillsSkippedDueToLimit: '일부 skill은 제출 한도 때문에 건너뛰었습니다.',
  archivedWillBeResurrected: '이 보관된 skill은 제출 시 복원됩니다.',
  failedToValidateUrl: '저장소 URL 확인에 실패했습니다.',
  githubRateLimited: '현재 GitHub 요청 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
  githubRateLimitedWithRetryAfter: '현재 GitHub 요청 제한에 걸렸습니다. 약 {retryAfterSeconds}초 후 다시 시도해 주세요.',
  githubUpstreamFailure: 'GitHub를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  submitFailed: 'skill 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  forkNoUniqueCommits: '이 fork에는 upstream {upstream}보다 앞선 고유 커밋이 없습니다. 원본 저장소를 제출하거나 fork에 변경을 만든 뒤 다시 시도해 주세요.',
  forkBehindUpstream: '이 fork는 upstream {upstream}보다 {behind}커밋 뒤처져 있습니다. upstream을 먼저 동기화한 뒤 제출해 주세요.',
  forkVerificationFailed: '지금은 이 fork와 upstream의 관계를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

const submitApiMessages: Record<SupportedLocale, Record<SubmitApiMessageKey, string>> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
};

export function resolveSubmitApiLocale(request: Request, fallbackLocale?: SupportedLocale): SupportedLocale {
  const explicitLocale = normalizeLocale(request.headers.get('x-skillscat-locale'));
  if (explicitLocale) {
    return explicitLocale;
  }

  if (fallbackLocale) {
    return fallbackLocale;
  }

  return resolveRequestLocale({
    acceptLanguage: request.headers.get('accept-language'),
  }).locale;
}

export function formatSubmitApiMessage(
  locale: SupportedLocale,
  descriptor: SubmitApiMessageDescriptor
): string {
  return formatMessage(submitApiMessages[locale][descriptor.key], descriptor.values);
}
