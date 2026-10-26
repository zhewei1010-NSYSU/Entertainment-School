import { createVisitStore } from "./local-store.ts";
import type { VisitStore } from "./local-store.ts";
import type { CloudAPI } from "./cloud-store.ts";
export class CloudJournal {
  readonly store: VisitStore;
  status = "正在確認雲端版本…";
  conflict = false;
  canInitialize = false;
  stopped = false;
  busy = false;
  onChange = () => {};
  private running: Promise<void> | null = null;
  readonly owner: string;
  private api: CloudAPI;
  constructor(owner: string, api: CloudAPI, store?: VisitStore) {
    this.owner = owner;
    this.api = api;
    this.store = store || createVisitStore("school-wander-cloud-v1:" + owner);
  }
  assertEditable() {
    if (this.stopped || this.conflict)
      throw Error("同步衝突或帳號已切換，請先處理。");
  }
  stop() {
    this.stopped = true;
  }
  sync(): Promise<void> {
    if (this.stopped || this.conflict) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async run() {
    this.busy = true;
    try {
      this.status = "確認同步中，完成前請勿清除網站資料。";
      this.onChange();
      let local = await this.store.snapshot();
      while (local.state.activated && local.state.dirty && !this.stopped) {
        const row = await this.api.push(local);
        if (this.stopped) return;
        await this.store.acknowledge(local.state.operation, row.revision);
        local = await this.store.snapshot();
      }
      if (this.stopped) return;
      const row = await this.api.pull();
      if (this.stopped) return;
      local = await this.store.snapshot();
      if (local.state.dirty && local.state.activated) {
        this.status = "已保存於此裝置，尚未同步。";
        return;
      }
      if (row && row.revision < local.state.revision)
        throw Error("收到較舊的雲端版本，已保留此裝置資料，請重試。");
      if (
        row &&
        (!local.state.activated || row.revision !== local.state.revision)
      ) {
        const photos = await this.api.photos(row.document, local.photos);
        if (this.stopped) return;
        await this.store.acceptRemote(
          { records: row.document.records, photos },
          row.revision,
          local.state.operation,
        );
      } else if (!row && local.state.activated)
        throw Error("雲端帳簿不存在，本機副本已保留。");
      this.canInitialize = !row && !local.state.activated;
      this.status = row
        ? "已確認與雲端同步（含照片）。"
        : "雲端尚無紀錄，請先確認匯入方式。";
    } catch (error) {
      const e = error as { code?: string; message?: string };
      this.canInitialize = false;
      this.conflict = e.code === "40001";
      this.status = ["PGRST205", "PGRST202", "42P01", "42883"].includes(
        e.code || "",
      )
        ? "校園雲端尚未設定；原手機資料仍保留。請先依教學執行 Supabase 校園 SQL。"
        : this.conflict
          ? "另一裝置已修改紀錄。本機變更保留，尚未同步；請備份後處理衝突。"
          : `同步未完成，本機資料保留。${e.message || "請確認網路後重試。"}`;
    } finally {
      this.busy = false;
      if (!this.stopped) this.onChange();
    }
  }
  async useCloud() {
    const initial = await this.store.snapshot();
    const row = await this.api.pull();
    if (!row) throw Error("雲端尚無紀錄。");
    if (row.revision < initial.state.revision)
      throw Error("收到較舊的雲端版本，請稍後重試。");
    const photos = await this.api.photos(row.document, initial.photos);
    if (this.stopped) return;
    await this.store.acceptRemote(
      { records: row.document.records, photos },
      row.revision,
      initial.state.operation,
      true,
    );
    this.conflict = false;
    this.status = "已改用雲端版本，請依備份核對待同步的紀錄。";
    this.onChange();
  }
  editableStore(): VisitStore {
    const store = this.store;
    return {
      ...store,
      saveVisit: (...args) => {
        this.assertEditable();
        return store.saveVisit(...args);
      },
      deleteVisit: (...args) => {
        this.assertEditable();
        return store.deleteVisit(...args);
      },
      importBackup: (...args) => {
        this.assertEditable();
        return store.importBackup(...args);
      },
    };
  }
}
