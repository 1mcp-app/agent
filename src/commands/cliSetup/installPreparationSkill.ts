import { installManagedSkill } from './installManagedSkill.js';
import { preparationSkillFiles } from './preparationSkill.generated.js';

export type { SkillInstallResult } from './installManagedSkill.js';

export function installPreparationSkill(
  scopeRoot: string,
  skillsRelativePath: string,
  files: Readonly<Record<string, string>> = preparationSkillFiles,
) {
  return installManagedSkill(scopeRoot, skillsRelativePath, '1mcp-preparation-setup', files);
}
