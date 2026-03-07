export interface SkillscatInstallTarget {
  slug: string;
}

export function buildSkillscatInstallCommand(target: SkillscatInstallTarget): string {
  return `npx skillscat add ${target.slug}`;
}
