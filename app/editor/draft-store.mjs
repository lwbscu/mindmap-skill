const DB_NAME = "mindmap-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const ACTIVE_DRAFT_ID = "active";

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("无法打开本地草稿数据库"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(mode, run) {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let request;
      try { request = run(store); } catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("本地草稿操作失败"));
    });
  } finally {
    database.close();
  }
}

export async function saveDraft(diagram, filePath = "") {
  if (!diagram || typeof diagram !== "object") throw new TypeError("diagram must be an object");
  return withStore("readwrite", (store) => store.put({
    id: ACTIVE_DRAFT_ID,
    diagram,
    filePath: String(filePath || ""),
    updatedAt: Date.now(),
  }));
}

export async function loadDraft() {
  return withStore("readonly", (store) => store.get(ACTIVE_DRAFT_ID));
}

export async function migrateLegacyDraft(diagramKey, fileKey, storage = globalThis.localStorage) {
  const existing = await loadDraft().catch(() => null);
  if (existing?.diagram) return existing;
  if (!storage) return null;
  const serialized = storage.getItem(diagramKey);
  if (!serialized) return null;
  const diagram = JSON.parse(serialized);
  const filePath = storage.getItem(fileKey) || "";
  await saveDraft(diagram, filePath);
  return { id: ACTIVE_DRAFT_ID, diagram, filePath, migrated: true };
}
