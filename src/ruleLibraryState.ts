import type { CustomRuleLibrary, Project } from './project';
import { ZHONGXING_CONTEXT } from './zhongxing-context.js';
import {legacyPortraitRules} from './legacyPortraitRules';
import legacyRuleDefaults from './legacyRuleDefaults.json';

function isUntouchedDefault(saved: CustomRuleLibrary, current: CustomRuleLibrary) {
  if(saved.name !== current.name) return false;
  const old = legacyRuleDefaults[saved.id as keyof typeof legacyRuleDefaults];
  return (old !== undefined && saved.content.trim() === old) ||
    (saved.id === 'character-poster' && saved.content.trim() === legacyPortraitRules);
}

export function commonRules(project: Pick<Project,'commonRulesText'>) {return project.commonRulesText ?? ZHONGXING_CONTEXT;}
export function effectiveRules(project: Pick<Project,'commonRulesText'>, library: {label:string;rules:string}) {
  return [commonRules(project).trim() ? `# 众行通用底层规则\n${commonRules(project).trim()}` : '',`# ${library.label}\n${library.rules}`].filter(Boolean).join('\n\n');
}

export const presetIds = ['social-poster','character-poster','3d-ip-poster','product-key-visual','resource-slot-material'];
export function availableRules(project: Pick<Project,'customRuleLibraries'|'deletedRuleLibraryIds'>, defaults: CustomRuleLibrary[]) {
  const overrides = new Map((project.customRuleLibraries || []).map(rule => [rule.id,rule]));
  return [...defaults.map(rule => {const saved=overrides.get(rule.id);return saved&&!isUntouchedDefault(saved,rule)?saved:rule;}), ...(project.customRuleLibraries || []).filter(rule => !defaults.some(item => item.id === rule.id))]
    .filter(rule => !project.deletedRuleLibraryIds?.includes(rule.id));
}
export function applyRules(project: Project, libraries: CustomRuleLibrary[], defaults: CustomRuleLibrary[]): Project {
  const ids = new Set(libraries.map(rule => rule.id));
  const ruleLibraryId = ids.has(project.ruleLibraryId || '') ? project.ruleLibraryId! : libraries[0]?.id || '';
  return {...project, ruleLibraryId, customRuleLibraries: libraries, deletedRuleLibraryIds: defaults.filter(rule => !ids.has(rule.id)).map(rule => rule.id), customKnowledge:'',customKnowledgeName:'',aiOptions:[],aiProposal:'',aiImagePrompt:''};
}
