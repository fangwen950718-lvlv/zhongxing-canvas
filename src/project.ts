import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { ZHONGXING_CONTEXT } from "./zhongxing-context.js";
import packageInfo from '../package.json';
import { presetIds } from './ruleLibraryState';

const defaultRulePreset = "social-poster";
const legacyRuleMap: Record<string, string> = {
  "general-poster": "social-poster",
  "illustration-poster": "social-poster",
  "photography-poster": "character-poster",
  "3d-poster": "3d-ip-poster",
  banner: "resource-slot-material",
  "resource-slot": "resource-slot-material",
};
function migrateRulePreset(value: unknown) {
  if (typeof value !== "string") return defaultRulePreset;
  if (["social-poster", "character-poster", "3d-ip-poster", "product-key-visual", "resource-slot-material"].includes(value)) return value;
  return legacyRuleMap[value] || defaultRulePreset;
}

export const BUILD = `V${packageInfo.version} · 自包含插件`;
export const levels = ["方向级", "demo级", "提案级"] as const;
export type Level = (typeof levels)[number];
export const fields = {
  brand: "品牌 / 客户",
  background: "项目背景",
  materials: "物料",
  theme: "主题",
  extra: "补充要求",
} as const;
export type Brief = Record<keyof typeof fields, string> & { level: Level };
export interface Project {
  format: "zhongxing-canvas";
  version: 1;
  name: string;
  savedAt: string;
  imageJobReceipts?: string[];
  creativeBrief?: string;
  aiProposal?: string;
  aiImagePrompt?: string;
  aiOptions?: CreativeOption[];
  aiSelectedOption?: number;
  rulePreset?: string;
  ruleLibraryId?: string;
  customRuleLibraries?: CustomRuleLibrary[];
  deletedRuleLibraryIds?: string[];
  commonRulesText?: string;
  /** V1.4 legacy fields, migrated to customRuleLibraries when loaded. */
  customKnowledgeName?: string;
  customKnowledge?: string;
  brief: Brief;
  scene: {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    files: BinaryFiles;
  };
}
export interface CreativeOption {
  title: string;
  proposal: string;
  sections?: ProposalSection[];
  imagePrompt: string;
}
export interface ProposalSection {
  label: string;
  content: string;
}
export interface CustomRuleLibrary {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}
export const rules = ZHONGXING_CONTEXT;
export const levelRules: Record<Level, string> = {
  方向级:
    "解决“往哪走”。每个 OP 约 300 字：方向名、一句话概念、创意核心点、基本画面想象、适配原因、风险提示。各方向有真正的创意或视觉区隔。",
  demo级:
    "解决“长什么样”。包含方向级全部内容，再逐项补充：主体、场景、构图、前中后景、色彩、光感、文案区 / logo 区、整体气质，让设计师可以开始做图。",
  提案级:
    "解决“为什么这样走、为什么这样长”。包含方向级与 demo 级全部内容，再补充：项目理解、客户调性、创意主轴、主推理由、多物料视觉体系。",
};
export function missingFields(brief: Brief) {
  return (Object.keys(fields) as (keyof typeof fields)[]).filter(
    (k) => k !== "extra" && !brief[k].trim(),
  );
}
export function makePrompt(brief: Brief) {
  if (missingFields(brief).length)
    throw new Error("请先补齐品牌 / 客户、项目背景、物料和主题。");
  return `# 众行视觉提案 · ${brief.level}\n\n## 内置业务规则\n${rules}\n\n## 本次输出要求\n只输出本次所选的「${brief.level}」内容；其他层级仅作为边界参考。\n${levelRules[brief.level]}\n\n## 用户 brief（项目资料）\n${Object.entries(
    fields,
  )
    .map(
      ([k, label]) =>
        `${label}：${brief[k as keyof typeof fields].trim() || "无补充"}`,
    )
    .join(
      "\n",
    )}\n\n默认给出三个方向，质量与差异优先于数量。不得编造客户事实；不确定的信息明确列为待确认。`;
}
export function emptyProject(): Project {
  return {
    format: "zhongxing-canvas",
    version: 1,
    name: "未命名视觉项目",
    savedAt: new Date().toISOString(),
    creativeBrief: "",
    aiProposal: "",
    aiImagePrompt: "",
    aiOptions: [],
    aiSelectedOption: 0,
    rulePreset: defaultRulePreset,
    ruleLibraryId: defaultRulePreset,
    customRuleLibraries: [],
    customKnowledgeName: "",
    customKnowledge: "",
    brief: {
      brand: "",
      background: "",
      materials: "",
      theme: "",
      extra: "",
      level: "方向级",
    },
    scene: {
      elements: [],
      files: {},
      appState: {
        viewBackgroundColor: "#fafaf8",
        currentItemRoughness: 0,
        currentItemStrokeColor: "#243330",
        currentItemFontFamily: 2,
        currentItemRoundness: "sharp",
        currentItemArrowType: "sharp",
      },
    },
  };
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export function parseProject(value: unknown): Project {
  if (
    !object(value) ||
    value.format !== "zhongxing-canvas" ||
    value.version !== 1
  )
    throw new Error("不是支持的众行 V1 项目文件。");
  if (
    typeof value.name !== "string" ||
    value.name.length > 200 ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt))
  )
    throw new Error("项目名称或保存时间损坏。");
  for (const key of ["creativeBrief", "aiProposal", "aiImagePrompt"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 30000))
      throw new Error("AI 方案草稿数据损坏。");
  }
  if (value.rulePreset !== undefined && (typeof value.rulePreset !== "string" || value.rulePreset.length > 100))
    throw new Error("知识规则类型损坏。");
  if(value.commonRulesText !== undefined && (typeof value.commonRulesText!=='string'||value.commonRulesText.length>120000))throw new Error('通用底层规则损坏。');
  if (value.ruleLibraryId !== undefined && (typeof value.ruleLibraryId !== "string" || value.ruleLibraryId.length > 100))
    throw new Error("知识库选择记录损坏。");
  if (value.deletedRuleLibraryIds !== undefined && (!Array.isArray(value.deletedRuleLibraryIds) || value.deletedRuleLibraryIds.length > 5 || value.deletedRuleLibraryIds.some((id:unknown)=>typeof id!=='string'||!presetIds.includes(id)))) throw new Error('规则删除记录损坏。');
  if (value.customRuleLibraries !== undefined && (!Array.isArray(value.customRuleLibraries) || value.customRuleLibraries.length > 30 || value.customRuleLibraries.some((library: unknown) => !object(library) || typeof library.id !== "string" || (!presetIds.includes(library.id)&&!/^uploaded-[a-z0-9-]{1,80}$/.test(library.id)) || typeof library.name !== "string" || !library.name.trim() || library.name.length > 200 || typeof library.content !== "string" || !library.content.trim() || library.content.length > 120000 || typeof library.createdAt !== "string" || !Number.isFinite(Date.parse(library.createdAt)))))
    throw new Error("自定义审美规则库损坏。");
  if (value.customKnowledgeName !== undefined && (typeof value.customKnowledgeName !== "string" || value.customKnowledgeName.length > 200))
    throw new Error("自定义知识文件名损坏。");
  if (value.customKnowledge !== undefined && (typeof value.customKnowledge !== "string" || value.customKnowledge.length > 120000))
    throw new Error("自定义知识内容损坏。");
  if (value.aiSelectedOption !== undefined && (!Number.isInteger(value.aiSelectedOption) || value.aiSelectedOption < 0 || value.aiSelectedOption > 2))
    throw new Error("方案选择记录损坏。");
  if (value.aiOptions !== undefined && (!Array.isArray(value.aiOptions) || value.aiOptions.length > 3 || value.aiOptions.some((option: unknown) => !object(option) || typeof option.title !== "string" || !option.title.trim() || option.title.length > 120 || typeof option.proposal !== "string" || !option.proposal.trim() || option.proposal.length > 30000 || (option.sections !== undefined && (!Array.isArray(option.sections) || option.sections.length > 10 || option.sections.some((section: unknown) => !object(section) || typeof section.label !== "string" || !section.label.trim() || section.label.length > 40 || typeof section.content !== "string" || !section.content.trim() || section.content.length > 5000))) || typeof option.imagePrompt !== "string" || !option.imagePrompt.trim() || option.imagePrompt.length > 30000)))
    throw new Error("多方案数据损坏。");
  if (
    !object(value.brief) ||
    !levels.includes(value.brief.level) ||
    Object.keys(fields).some(
      (k) =>
        typeof value.brief[k] !== "string" || value.brief[k].length > 30000,
    )
  )
    throw new Error("提案草稿数据损坏。");
  const s = value.scene;
  if(value.imageJobReceipts !== undefined && (!Array.isArray(value.imageJobReceipts) || value.imageJobReceipts.some((id:unknown)=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))) throw new Error('生图任务回填记录损坏。');
  if (
    !object(s) ||
    !Array.isArray(s.elements) ||
    s.elements.length > 50000 ||
    !object(s.files) ||
    !object(s.appState)
  )
    throw new Error("画布数据损坏。");
  const ids = new Set();
  const types = [
    "rectangle",
    "diamond",
    "ellipse",
    "arrow",
    "line",
    "freedraw",
    "text",
    "image",
    "frame",
    "magicframe",
  ];
  for (const e of s.elements) {
    if (
      !object(e) ||
      !types.includes(e.type) ||
      typeof e.id !== "string" ||
      !e.id ||
      ids.has(e.id) ||
      !["x", "y", "width", "height", "angle", "version", "seed"].every((k) =>
        finite(e[k]),
      ) ||
      e.width < 0 ||
      e.height < 0 ||
      typeof e.isDeleted !== "boolean" ||
      !Array.isArray(e.groupIds) ||
      !e.groupIds.every((id: unknown) => typeof id === "string")
    )
      throw new Error("画布元素无效或重复。");
    ids.add(e.id);
    if (
      ["arrow", "line", "freedraw"].includes(e.type) &&
      (!Array.isArray(e.points) ||
        !e.points.every(
          (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(finite),
        ))
    )
      throw new Error("线条坐标损坏。");
    if (
      e.type === "text" &&
      (typeof e.text !== "string" || !finite(e.fontSize))
    )
      throw new Error("文字元素损坏。");
    if (
      e.type === "image" &&
      !e.isDeleted &&
      (typeof e.fileId !== "string" || !Object.hasOwn(s.files, e.fileId))
    )
      throw new Error("图片数据缺失，无法完整恢复。");
  }
  for (const [id, file] of Object.entries(s.files)) {
    if (
      !object(file) ||
      file.id !== id ||
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
        "image/avif",
        "image/bmp",
        "image/x-icon",
      ].includes(file.mimeType) ||
      typeof file.dataURL !== "string" ||
      !file.dataURL.startsWith(`data:${file.mimeType};base64,`) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.dataURL.split(",")[1]) ||
      !finite(file.created)
    )
      throw new Error("图片数据格式不正确。");
  }
  // Only persisted view/style fields are accepted, never transient UI state.
  const appState = cleanAppState(s.appState);
  const migratedPreset = migrateRulePreset(value.ruleLibraryId || value.rulePreset);
  const legacyLibrary = value.customKnowledge?.trim()
    ? [{ id: "uploaded-legacy", name: value.customKnowledgeName?.trim() || "已迁移知识库", content: value.customKnowledge.trim(), createdAt: value.savedAt }]
    : [];
  const customRuleLibraries = value.customRuleLibraries || legacyLibrary;
  const requestedLibraryId = value.ruleLibraryId || (legacyLibrary.length ? "uploaded-legacy" : migratedPreset);
  const ruleLibraryId = customRuleLibraries.some((library: CustomRuleLibrary) => library.id === requestedLibraryId)
    ? requestedLibraryId
    : migratedPreset;
  return {
    format: "zhongxing-canvas",
    version: 1,
    name: value.name,
    savedAt: value.savedAt,
    imageJobReceipts: value.imageJobReceipts || [],
    creativeBrief: value.creativeBrief || "",
    aiProposal: value.aiProposal || "",
    aiImagePrompt: value.aiImagePrompt || "",
    aiOptions: value.aiOptions || [],
    aiSelectedOption: value.aiSelectedOption || 0,
    rulePreset: migratedPreset,
    ruleLibraryId,
    customRuleLibraries,
    deletedRuleLibraryIds: value.deletedRuleLibraryIds || [],
    commonRulesText: value.commonRulesText,
    customKnowledgeName: "",
    customKnowledge: "",
    brief: {
      brand: value.brief.brand,
      background: value.brief.background,
      materials: value.brief.materials,
      theme: value.brief.theme,
      extra: value.brief.extra,
      level: value.brief.level,
    },
    scene: { elements: s.elements, files: s.files, appState },
  };
}
export function cleanAppState(s: Partial<AppState>): Partial<AppState> {
  const out: Record<string, unknown> = { currentItemArrowType: "sharp" };
  if (["sharp", "round", "elbow"].includes(s.currentItemArrowType || ""))
    out.currentItemArrowType = s.currentItemArrowType;
  for (const k of [
    "scrollX",
    "scrollY",
    "currentItemRoughness",
    "currentItemFontFamily",
    "currentItemStrokeWidth",
    "currentItemOpacity",
    "gridSize",
  ] as const)
    if (finite(s[k])) out[k] = s[k];
  for (const k of [
    "viewBackgroundColor",
    "currentItemStrokeColor",
    "currentItemBackgroundColor",
    "currentItemFillStyle",
    "currentItemStrokeStyle",
    "currentItemRoundness",
  ] as const)
    if (typeof s[k] === "string") out[k] = s[k];
  for (const k of ["gridModeEnabled", "objectsSnapModeEnabled"] as const)
    if (typeof s[k] === "boolean") out[k] = s[k];
  if (
    s.zoom &&
    finite(s.zoom.value) &&
    s.zoom.value >= 0.1 &&
    s.zoom.value <= 30
  )
    out.zoom = { value: s.zoom.value };
  return out;
}
