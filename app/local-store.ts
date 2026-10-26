"use client";
import { z } from "zod";
import type { Visit } from "./journal";
export const visitSchema = z.object({
  id: z.string().min(1).max(150),
  schoolId: z
    .string()
    .regex(/^\d{6}$/)
    .nullable()
    .optional(),
  name: z.string().trim().min(1).max(100),
  city: z.string().min(1).max(20),
  district: z.string().max(50),
  status: z.enum(["visited", "wish"]),
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  note: z.string().max(10000),
  tags: z.array(z.string().max(20)).max(6),
  photos: z.array(z.string().max(250)).max(4),
});
const backupSchema = z.object({
  format: z.literal("school-wander-backup"),
  version: z.literal(1),
  records: z.array(visitSchema).max(10000),
  photos: z
    .array(
      z.object({
        id: z.string().min(1).max(250),
        type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z.string().max(1600100),
      }),
    )
    .max(40000),
});
export type StoredPhoto = { id: string; blob: Blob };
export type SyncState = {
  revision: number;
  operation: string;
  dirty: boolean;
  activated: boolean;
};
export type Snapshot = {
  records: Visit[];
  photos: StoredPhoto[];
  state: SyncState;
};
const initialState = (): SyncState => ({
  revision: 0,
  operation: crypto.randomUUID(),
  dirty: false,
  activated: false,
});
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        Error(
          tx.error?.name === "QuotaExceededError"
            ? "儲存空間不足，請先匯出備份。"
            : "儲存未完成，請保留內容後重試。",
        ),
      );
    tx.onerror = () => {};
  });
}
const changed = (s: SyncState): SyncState => ({
  ...s,
  dirty: true,
  operation: crypto.randomUUID(),
});
const blobBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const f = new FileReader();
    f.onload = () => resolve(String(f.result).split(",")[1]);
    f.onerror = () => reject(Error("無法讀取照片。"));
    f.readAsDataURL(b);
  });
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function createVisitStore(databaseName = "school-wander-local-v1") {
  const photoCache = new Map<string, string>();
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const emit = () => {
    listeners.forEach((listener) => listener());
    channel?.postMessage("changed");
  };
  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(
          Error("此瀏覽器無法保存紀錄，請改用 Safari 或 Chrome 一般模式。"),
        );
        return;
      }
      const r = indexedDB.open(databaseName, 2);
      r.onupgradeneeded = () => {
        for (const name of ["records", "photos"])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: "id" });
        if (!r.result.objectStoreNames.contains("sync")) {
          r.result.createObjectStore("sync").put(initialState(), "state");
        }
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = () =>
        reject(Error("無法開啟本機儲存空間，請確認網站儲存權限。"));
      r.onblocked = () =>
        reject(Error("請先關閉其他校園漫遊分頁，再重新開啟。"));
    });
  }
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => Promise<T>,
  ) {
    const db = await openDb();
    const tx = db.transaction(["records", "photos", "sync"], mode);
    const completed = done(tx);
    try {
      const result = await run(tx);
      await completed;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await completed.catch(() => {});
      throw e;
    } finally {
      db.close();
    }
  }
  const stateOf = (tx: IDBTransaction) =>
    request<SyncState>(tx.objectStore("sync").get("state"));
  function guard(actual: SyncState, expected?: string) {
    if (expected && expected !== actual.operation)
      throw Error(
        "資料已由其他分頁或裝置更新。表單尚未儲存，請先保留內容，關閉後重新開啟再編輯。",
      );
  }
  async function snapshot(): Promise<Snapshot> {
    return transaction("readonly", async (tx) => {
      const [records, photos, state] = await Promise.all([
        request<Visit[]>(tx.objectStore("records").getAll()),
        request<StoredPhoto[]>(tx.objectStore("photos").getAll()),
        stateOf(tx),
      ]);
      return { records, photos, state };
    });
  }
  async function getState() {
    return transaction("readonly", stateOf);
  }
  function photoUrl(id: string) {
    return photoCache.get(id) || "";
  }
  async function listVisits() {
    const data = await snapshot();
    for (const p of data.photos)
      if (!photoCache.has(p.id))
        photoCache.set(p.id, URL.createObjectURL(p.blob));
    const alive = new Set(data.photos.map((p) => p.id));
    for (const [id, url] of photoCache)
      if (!alive.has(id)) {
        URL.revokeObjectURL(url);
        photoCache.delete(id);
      }
    return data.records.sort((a, b) => b.date.localeCompare(a.date));
  }
  async function saveVisit(
    input: Visit,
    files: File[],
    expected?: string,
  ): Promise<Visit> {
    const v = visitSchema.parse({
      ...input,
      id: input.id || crypto.randomUUID(),
    });
    if (v.status === "visited" && !v.date) throw Error("請填寫走訪日期。");
    if (v.photos.length + files.length > 4) throw Error("每筆最多 4 張照片。");
    if (
      files.some(
        (f) =>
          f.size > 1200000 ||
          !["image/jpeg", "image/png", "image/webp"].includes(f.type),
      )
    )
      throw Error("照片格式或容量不符合限制。");
    const added = files.map((f) => ({
      id: crypto.randomUUID(),
      blob: f as Blob,
    }));
    const result = await transaction("readwrite", async (tx) => {
      const [old, state] = await Promise.all([
        request<Visit | undefined>(tx.objectStore("records").get(v.id)),
        stateOf(tx),
      ]);
      guard(state, expected);
      if (v.photos.some((k) => !old?.photos.includes(k)))
        throw Error("找不到原本的照片，請重新開啟這筆紀錄。");
      const result: Visit = {
        ...v,
        photos: [...v.photos, ...added.map((p) => p.id)],
      };
      tx.objectStore("records").put(result);
      for (const p of added) tx.objectStore("photos").put(p);
      for (const k of old?.photos || [])
        if (!v.photos.includes(k)) tx.objectStore("photos").delete(k);
      tx.objectStore("sync").put(changed(state), "state");
      return result;
    });
    for (const p of added) photoCache.set(p.id, URL.createObjectURL(p.blob));
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    emit();
    return result;
  }
  async function deleteVisit(v: Visit, expected?: string) {
    await transaction("readwrite", async (tx) => {
      const state = await stateOf(tx);
      guard(state, expected);
      const current = await request<Visit | undefined>(
        tx.objectStore("records").get(v.id),
      );
      if (!current || JSON.stringify(current) !== JSON.stringify(v))
        throw Error("這筆紀錄已更新，請重新開啟後再刪除。");
      tx.objectStore("records").delete(v.id);
      for (const id of current.photos) tx.objectStore("photos").delete(id);
      tx.objectStore("sync").put(changed(state), "state");
    });
    for (const id of v.photos) {
      const url = photoCache.get(id);
      if (url) URL.revokeObjectURL(url);
      photoCache.delete(id);
    }
    emit();
  }
  async function exportBackup() {
    const data = await snapshot();
    const photos = [];
    for (const p of data.photos)
      photos.push({
        id: p.id,
        type: p.blob.type,
        data: await blobBase64(p.blob),
      });
    downloadJson(
      {
        format: "school-wander-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        records: data.records,
        photos,
      },
      "校園漫遊_完整備份_" + new Date().toISOString().slice(0, 10) + ".json",
    );
  }
  async function importBackup(file: File) {
    if (file.size > 100000000) throw Error("備份檔超過 100 MB。");
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw Error("這不是有效的 JSON 備份檔。");
    }
    const parsed = backupSchema.safeParse(raw);
    if (!parsed.success) throw Error("備份格式不符。");
    const backup = parsed.data;
    const initial = await snapshot();
    const ids = new Set(initial.records.map((v) => v.id));
    const byId = new Map(backup.photos.map((p) => [p.id, p]));
    const records: Visit[] = [],
      photos: StoredPhoto[] = [];
    let skipped = 0;
    for (const v of backup.records) {
      if (ids.has(v.id)) {
        skipped++;
        continue;
      }
      ids.add(v.id);
      const keys = [];
      for (const id of v.photos) {
        const p = byId.get(id);
        if (!p) throw Error("備份缺少照片，尚未匯入任何紀錄。");
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
        } catch {
          throw Error("備份照片資料損壞。");
        }
        if (bytes.byteLength > 1200000) throw Error("備份照片超過容量限制。");
        const key = crypto.randomUUID();
        keys.push(key);
        photos.push({
          id: key,
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: p.type }),
        });
      }
      records.push({ ...v, photos: keys });
    }
    await transaction("readwrite", async (tx) => {
      const state = await stateOf(tx);
      guard(state, initial.state.operation);
      for (const v of records) tx.objectStore("records").put(v);
      for (const p of photos) tx.objectStore("photos").put(p);
      if (records.length) tx.objectStore("sync").put(changed(state), "state");
    });
    emit();
    return { added: records.length, skipped };
  }
  async function activate(data: Pick<Snapshot, "records" | "photos">) {
    await transaction("readwrite", async (tx) => {
      const state = await stateOf(tx);
      if (state.activated) throw Error("已有帳簿，不能再次初始化。");
      for (const v of data.records)
        tx.objectStore("records").put(visitSchema.parse(v));
      for (const p of data.photos) tx.objectStore("photos").put(p);
      tx.objectStore("sync").put(
        { ...changed(state), activated: true },
        "state",
      );
    });
    emit();
  }
  async function acknowledge(operation: string, revision: number) {
    await transaction("readwrite", async (tx) => {
      const state = await stateOf(tx);
      if (revision < state.revision) return;
      tx.objectStore("sync").put(
        { ...state, revision, dirty: state.operation !== operation },
        "state",
      );
    });
  }
  async function acceptRemote(
    data: Pick<Snapshot, "records" | "photos">,
    revision: number,
    expected: string,
    discardPending = false,
  ) {
    await transaction("readwrite", async (tx) => {
      const state = await stateOf(tx);
      guard(state, expected);
      if (state.dirty && !discardPending)
        throw Error("本機有待同步資料，已保留，請重試。");
      tx.objectStore("records").clear();
      tx.objectStore("photos").clear();
      for (const v of data.records)
        tx.objectStore("records").put(visitSchema.parse(v));
      for (const p of data.photos) tx.objectStore("photos").put(p);
      tx.objectStore("sync").put(
        {
          revision,
          operation: crypto.randomUUID(),
          dirty: false,
          activated: true,
        },
        "state",
      );
    });
    emit();
  }
  function dispose() {
    channel?.close();
    channel = undefined;
    for (const url of photoCache.values()) URL.revokeObjectURL(url);
    photoCache.clear();
    listeners.clear();
  }
  return {
    databaseName,
    photoUrl,
    listVisits,
    saveVisit,
    deleteVisit,
    exportBackup,
    importBackup,
    snapshot,
    getState,
    activate,
    acknowledge,
    acceptRemote,
    dispose,
    subscribe(listener: () => void) {
      if (
        !channel &&
        typeof window !== "undefined" &&
        typeof BroadcastChannel !== "undefined"
      ) {
        channel = new BroadcastChannel("school-store:" + databaseName);
        channel.onmessage = () => listeners.forEach((listener) => listener());
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          channel?.close();
          channel = undefined;
        }
      };
    },
  };
}
export type VisitStore = ReturnType<typeof createVisitStore>;
export const localStore = createVisitStore();
export const {
  photoUrl,
  listVisits,
  saveVisit,
  deleteVisit,
  exportBackup,
  importBackup,
} = localStore;
