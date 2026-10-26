import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createVisitStore } from "../app/local-store.ts";
import { CloudJournal } from "../app/cloud-journal.ts";
Object.defineProperty(globalThis, "navigator", {
  value: { storage: { persist: async () => true } },
  configurable: true,
});
const visit = (note = "原紀錄") => ({
  id: "",
  schoolId: "114721",
  name: "隆田國小",
  city: "臺南市",
  district: "官田區",
  status: "visited",
  date: "2026-10-27",
  note,
  tags: [],
  photos: [],
});
let counter = 0;
const store = () => createVisitStore("test-cloud-" + counter++);
function server() {
  let row = null;
  let uploads = 0;
  return {
    get row() {
      return row;
    },
    get uploads() {
      return uploads;
    },
    api: {
      async pull() {
        return row;
      },
      async push(s) {
        if (row?.mutation_id === s.state.operation) return row;
        if ((row?.revision || 0) !== s.state.revision) throw { code: "40001" };
        uploads++;
        row = {
          document: { records: s.records, photos: [] },
          revision: s.state.revision + 1,
          mutation_id: s.state.operation,
        };
        return row;
      },
      async photos(_document, cached) {
        return cached;
      },
    },
  };
}
// Upgrade a real v1-shaped store without losing records/photos.
const oldName = "test-old-" + counter++;
await new Promise((resolve, reject) => {
  const r = indexedDB.open(oldName, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("records", { keyPath: "id" });
    r.result.createObjectStore("photos", { keyPath: "id" });
  };
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const db = r.result,
      tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put({ ...visit(), id: "legacy" });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  };
});
assert.equal((await createVisitStore(oldName).listVisits())[0].id, "legacy");
const legacy = store();
const original = await legacy.saveVisit(visit(), []);
const backend = server();
const a = new CloudJournal("alice", backend.api, store());
await a.sync();
assert.equal((await a.store.snapshot()).state.activated, false);
await a.store.activate(await legacy.snapshot());
await a.sync();
assert.equal(backend.row.document.records.length, 1);
assert.equal((await legacy.listVisits())[0].id, original.id); // migration keeps the source unchanged
const b = new CloudJournal("alice", backend.api, store());
await b.sync();
assert.equal((await b.store.listVisits())[0].id, original.id);
const token = (await a.store.getState()).operation;
await a.store.saveVisit({ ...original, note: "電腦更新" }, [], token);
await a.sync();
await b.store.saveVisit({ ...original, note: "手機離線更新" }, []);
await b.sync();
assert.equal(b.conflict, true);
assert.equal((await b.store.listVisits())[0].note, "手機離線更新");
assert.equal(backend.row.document.records[0].note, "電腦更新");
assert.throws(() => b.assertEditable());
await b.useCloud();
assert.equal((await b.store.listVisits())[0].note, "電腦更新");
await assert.rejects(
  () => a.store.saveVisit({ ...original, note: "過期表單" }, [], token),
  /資料已/,
);
// Lost response is replayed with the same operation ID, including after restart.
const lost = server();
const push = lost.api.push;
let drop = true;
lost.api.push = async (s) => {
  const row = await push(s);
  if (drop) {
    drop = false;
    throw Error("offline");
  }
  return row;
};
const pendingStore = store();
await pendingStore.activate(await legacy.snapshot());
const c = new CloudJournal("alice", lost.api, pendingStore);
await c.sync();
assert.equal((await pendingStore.getState()).dirty, true);
const restored = new CloudJournal(
  "alice",
  lost.api,
  createVisitStore(pendingStore.databaseName),
);
await restored.sync();
assert.equal(lost.uploads, 1);
assert.equal((await restored.store.getState()).dirty, false);
// Edits during upload remain dirty and are sent against the acknowledged revision.
const flight = server();
const underlying = flight.api.push;
let release, entered;
const start = new Promise((r) => (entered = r));
const gate = new Promise((r) => (release = r));
let first = true;
flight.api.push = async (s) => {
  if (first) {
    first = false;
    entered();
    await gate;
  }
  return underlying(s);
};
const d = new CloudJournal("alice", flight.api, store());
await d.store.activate(await legacy.snapshot());
const running = d.sync();
await start;
await d.store.saveVisit({ ...original, note: "上傳期間再編輯" }, []);
release();
await running;
assert.equal(flight.row.document.records[0].note, "上傳期間再編輯");
assert.equal((await d.store.getState()).dirty, false);
assert.equal(flight.uploads, 2);
// A failed photo download cannot partially replace a valid local snapshot.
const failure = server();
const seed = await pendingStore.snapshot();
await failure.api.push({ ...seed, state: { ...seed.state, revision: 0 } });
const e = new CloudJournal("alice", failure.api, store());
await e.sync();
const before = await e.store.snapshot();
failure.api.pull = async () => ({
  ...failure.row,
  revision: 100,
  document: { records: [], photos: [{ id: "missing" }] },
});
failure.api.photos = async () => {
  throw Error("photo unavailable");
};
await e.sync();
assert.deepEqual(await e.store.snapshot(), before);
assert.match(e.status, /同步未完成/);
// A delayed response from an older server version cannot roll back a newer local snapshot.
const stable = await restored.store.snapshot();
lost.api.pull = async () => ({
  ...lost.row,
  revision: 0,
  document: { records: [], photos: [] },
});
await restored.sync();
assert.deepEqual(await restored.store.snapshot(), stable);
// Separate users' databases and photo URL caches never share private records.
const bob = new CloudJournal("bob", server().api, store());
assert.deepEqual(await bob.store.listVisits(), []);
assert.equal(bob.store.photoUrl("anything"), "");
console.log(
  "Cloud tests passed: v1 upgrade, explicit migration, isolation, conflict preservation, stale-form protection, idempotent lost-response retry, in-flight edits, atomic photo failure.",
);
