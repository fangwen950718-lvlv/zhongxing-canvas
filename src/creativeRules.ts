import socialPosterRules from "../knowledge/aesthetic-rules/01_社媒海报_审美判断_V2.md?raw";
import characterPosterRules from "../knowledge/aesthetic-rules/02_人物海报_审美判断_V2.md?raw";
import threeDIpPosterRules from "../knowledge/aesthetic-rules/03_三维IP海报_审美判断_V2.md?raw";
import productKeyVisualRules from "../knowledge/aesthetic-rules/04_产品主K_审美判断_V2.md?raw";
import resourceSlotRules from "../knowledge/aesthetic-rules/05_资源位物料_审美判断_V2.md?raw";

export interface RuleLibrary {
  id: string;
  label: string;
  description: string;
  rules: string;
  source: "built-in" | "uploaded";
  sourceFile?: string;
}

export const rulePresets = {
  "social-poster": {
    id: "social-poster",
    label: "社媒海报",
    description: "节点传播、品牌社媒单图与日常营销海报。",
    rules: socialPosterRules,
    source: "built-in",
    sourceFile: "01_社媒海报_审美判断_V2.md",
  },
  "character-poster": {
    id: "character-poster",
    label: "人物海报",
    description: "代言人、嘉宾、角色官宣与人物系列视觉。",
    rules: characterPosterRules,
    source: "built-in",
    sourceFile: "02_人物海报_审美判断_V2.md",
  },
  "3d-ip-poster": {
    id: "3d-ip-poster",
    label: "三维 IP 海报",
    description: "品牌吉祥物、三维玩偶与 IP 联合视觉。",
    rules: threeDIpPosterRules,
    source: "built-in",
    sourceFile: "03_三维IP海报_审美判断_V2.md",
  },
  "product-key-visual": {
    id: "product-key-visual",
    label: "产品主 K",
    description: "新品上市、产品卖点与品牌产品广告。",
    rules: productKeyVisualRules,
    source: "built-in",
    sourceFile: "04_产品主K_审美判断_V2.md",
  },
  "resource-slot-material": {
    id: "resource-slot-material",
    label: "资源位物料",
    description: "App 资源位、Banner、活动入口与促销卡片。",
    rules: resourceSlotRules,
    source: "built-in",
    sourceFile: "05_资源位物料_审美判断_V2.md",
  },
} as const satisfies Record<string, RuleLibrary>;

export type RulePresetId = keyof typeof rulePresets;
export const defaultRulePreset: RulePresetId = "social-poster";

export function isRulePresetId(value: unknown): value is RulePresetId {
  return typeof value === "string" && Object.hasOwn(rulePresets, value);
}

const legacyRuleMap: Record<string, RulePresetId> = {
  "general-poster": "social-poster",
  "illustration-poster": "social-poster",
  "photography-poster": "character-poster",
  "3d-poster": "3d-ip-poster",
  banner: "resource-slot-material",
  "resource-slot": "resource-slot-material",
};

export function migrateRulePreset(value: unknown): RulePresetId {
  if (isRulePresetId(value)) return value;
  return typeof value === "string" && legacyRuleMap[value]
    ? legacyRuleMap[value]
    : defaultRulePreset;
}
