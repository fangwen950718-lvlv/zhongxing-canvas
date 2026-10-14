import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  emptyProject,
  parseProject,
  makePrompt,
  levels,
  missingFields,
  cleanAppState,
} from "../src/project";
import { loadProject, saveProject } from "../src/storage";
test("three levels include brief, context and distinct requirements", () => {
  const p = emptyProject();
  assert.equal(missingFields(p.brief).length, 4);
  assert.throws(() => makePrompt(p.brief));
  Object.assign(p.brief, {
    brand: "测试品牌",
    background: "夏季新品上市",
    materials: "海报",
    theme: "向光而行",
    extra: "避免堆砌",
  });
  for (const level of levels) {
    const prompt = makePrompt({ ...p.brief, level });
    assert.ok(prompt.includes(`只输出本次所选的「${level}」`));
    for (const v of [
      "测试品牌",
      "夏季新品上市",
      "海报",
      "向光而行",
      "避免堆砌",
      "单母体收敛",
    ])
      assert.ok(prompt.includes(v));
  }
});
test("reject corrupted or unsupported files", () => {
  for (const value of [
    null,
    {},
    { ...emptyProject(), version: 2 },
    { ...emptyProject(), brief: {} },
    { ...emptyProject(), scene: { elements: [{}], files: {}, appState: {} } },
  ])
    assert.throws(() => parseProject(value));
});
test("image and brief JSON plus IndexedDB round trip", async () => {
  const p = emptyProject();
  p.brief.theme = "恢复测试";
  p.rulePreset = "3d-poster";
  delete p.ruleLibraryId;
  delete p.customRuleLibraries;
  p.customKnowledgeName = "品牌规则.md";
  p.customKnowledge = "避免冷色";
  p.aiOptions = [1, 2, 3].map((number) => ({ title: `方向 ${number}`, proposal: `方案 ${number}`, imagePrompt: `提示词 ${number}` }));
  p.aiSelectedOption = 2;
  const file = {
    id: "image-1",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,aGVsbG8=",
    created: 1,
  };
  p.scene.files = { "image-1": file } as any;
  p.scene.elements = [
    {
      id: "e1",
      type: "image",
      fileId: "image-1",
      x: 10,
      y: 20,
      width: 200,
      height: 150,
      angle: 0,
      version: 1,
      seed: 1,
      isDeleted: false,
      groupIds: [],
    },
  ] as any;
  const parsed = parseProject(JSON.parse(JSON.stringify(p)));
  assert.equal(parsed.aiOptions?.length, 3);
  assert.equal(parsed.rulePreset, "3d-ip-poster");
  assert.equal(parsed.ruleLibraryId, "uploaded-legacy");
  assert.equal(parsed.customRuleLibraries?.[0].name, "品牌规则.md");
  await saveProject(parsed);
  assert.deepEqual(await loadProject(), parsed);
  const broken = structuredClone(p);
  broken.scene.files = {};
  assert.throws(() => parseProject(broken));
  assert.deepEqual(await loadProject(), parsed);
});
test("new uploaded rule libraries remain selectable after project import", () => {
  const p = emptyProject();
  p.customRuleLibraries = [{ id: "uploaded-test-library", name: "我的品牌规则", content: "以暖色与大留白为主。", createdAt: new Date().toISOString() }];
  p.ruleLibraryId = "uploaded-test-library";
  const parsed = parseProject(JSON.parse(JSON.stringify(p)));
  assert.equal(parsed.ruleLibraryId, "uploaded-test-library");
  assert.equal(parsed.customRuleLibraries?.[0].content, "以暖色与大留白为主。");
});
test("unsafe/transient app state is stripped", () => {
  assert.deepEqual(
    cleanAppState({
      collaborators: new Map(),
      scrollX: NaN,
      zoom: { value: -1 },
      viewBackgroundColor: "#fff",
    } as any),
    { currentItemArrowType: "sharp", viewBackgroundColor: "#fff" },
  );
});
test("storage denial rejects without altering in-memory project", async () => {
  const p = emptyProject();
  const original = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        throw new Error("denied");
      },
    },
  });
  await assert.rejects(saveProject(p));
  assert.equal(p.name, "未命名视觉项目");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: original,
  });
});
