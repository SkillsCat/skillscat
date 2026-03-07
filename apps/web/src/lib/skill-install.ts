export interface SkillscatInstallTarget {
  name: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  visibility: 'public' | 'private' | 'unlisted';
  sourceType: 'github' | 'upload';
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`;
}

export function shouldScopeSkillscatInstall(target: SkillscatInstallTarget): boolean {
  if (target.visibility !== 'public' || target.sourceType !== 'github') {
    return false;
  }

  return target.slug !== `${target.repoOwner}/${target.repoName}`;
}

export function buildSkillscatInstallCommand(target: SkillscatInstallTarget): string {
  if (target.visibility !== 'public' || target.sourceType === 'upload') {
    return `npx skillscat add ${target.slug}`;
  }

  const baseCommand = `npx skillscat add ${target.repoOwner}/${target.repoName}`;
  if (!shouldScopeSkillscatInstall(target)) {
    return baseCommand;
  }

  return `${baseCommand} --skill ${quoteShellArg(target.name)}`;
}
