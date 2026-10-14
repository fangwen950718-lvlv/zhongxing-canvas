import type { Project } from "./project";
import { callTool } from './codexBridge';
export const saveLocation = () => typeof window !== 'undefined' && window.parent !== window ? '本机用户目录' : '本机浏览器';
const openDB = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("zhongxing-independent-canvas", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("projects");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("数据库被其他页面占用"));
  });
export async function loadProject(): Promise<unknown> {
  if (typeof window !== 'undefined' && window.parent !== window) {
    const result = await callTool('load_zhongxing_project', {}) as { structuredContent?: { projectJSON?: string | null } } | null;
    if (!result) throw new Error('画布与 Codex 保存工具未连接，请重新打开画布');
    const text = result.structuredContent?.projectJSON;
    return text ? JSON.parse(text) : null;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readonly");
    const req = tx.objectStore("projects").get("current");
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function saveProject(project: Project): Promise<void> {
  if (typeof window !== 'undefined' && window.parent !== window) {
    const result = await callTool('save_zhongxing_project', { projectJSON: JSON.stringify(project) }) as { structuredContent?: { saved?: boolean } } | null;
    if (!result?.structuredContent?.saved) throw new Error('本机保存未确认，请导出备份');
    return;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(project, "current");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
