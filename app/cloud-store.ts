import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { visitSchema } from "./local-store";
import type { Snapshot, StoredPhoto } from "./local-store";
const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://bxywdeuffodtfrgpidwk.supabase.co";
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_T-6-UJlS5DwXbY-Qhla-lQ_xEZxnfbC";
export const supabase = createClient(url, key, {
  auth: {
    storageKey: "school-wander-auth-v1",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
const photoSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const documentSchema = z
  .object({
    records: z.array(visitSchema).max(10000),
    photos: z.array(photoSchema).max(40000),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = new Set(d.photos.map((p) => p.id));
    if (
      ids.size !== d.photos.length ||
      new Set(d.records.map((v) => v.id)).size !== d.records.length ||
      d.records.some((v) => v.photos.some((id) => !ids.has(id)))
    )
      ctx.addIssue({
        code: "custom",
        message: "雲端紀錄或照片關聯不完整，已停止覆蓋本機資料。",
      });
  });
export type CloudDocument = z.infer<typeof documentSchema>;
export type CloudRow = {
  document: CloudDocument;
  revision: number;
  mutation_id: string;
};
export interface CloudAPI {
  pull(): Promise<CloudRow | null>;
  push(snapshot: Snapshot): Promise<CloudRow>;
  photos(
    document: CloudDocument,
    cached: StoredPhoto[],
  ): Promise<StoredPhoto[]>;
}
export async function checksum(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function cloudAPI(owner: string): CloudAPI {
  const uploaded = new Set<string>();
  async function checkOwner() {
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== owner)
      throw Error("登入已失效或帳號已切換，請重新登入。");
  }
  const bucket = supabase.storage.from("school-photos");
  async function download(photo: CloudDocument["photos"][number]) {
    await checkOwner();
    const { data, error } = await bucket.download(`${owner}/${photo.id}`);
    if (error) throw error;
    if (data.size > 1200000 || (await checksum(data)) !== photo.sha256)
      throw Error("照片驗證失敗，本機原資料仍保留。");
    return { id: photo.id, blob: new Blob([data], { type: photo.type }) };
  }
  return {
    async pull() {
      await checkOwner();
      const { data, error } = await supabase
        .from("school_journals")
        .select("document,revision,mutation_id")
        .eq("user_id", owner)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { ...data, document: documentSchema.parse(data.document) }
        : null;
    },
    async push(snapshot) {
      await checkOwner();
      const referenced = new Set(snapshot.records.flatMap((v) => v.photos));
      const photos: CloudDocument["photos"] = [];
      for (const id of referenced) {
        const stored = snapshot.photos.find((p) => p.id === id);
        if (!stored) throw Error("本機缺少照片，請保留資料並檢查備份。");
        photos.push(
          photoSchema.parse({
            id,
            type: stored.blob.type,
            sha256: await checksum(stored.blob),
          }),
        );
      }
      const document = documentSchema.parse({
        records: snapshot.records,
        photos,
      });
      if (new Blob([JSON.stringify(document)]).size > 5000000)
        throw Error("紀錄文字超過 5 MB 同步上限，請先下載備份。");
      for (const photo of photos) {
        const identity = `${photo.id}:${photo.sha256}`;
        if (uploaded.has(identity)) continue;
        await checkOwner();
        const blob = snapshot.photos.find((p) => p.id === photo.id)!.blob;
        const { error } = await bucket.upload(`${owner}/${photo.id}`, blob, {
          upsert: false,
          contentType: photo.type,
        });
        if (error) {
          if (String(error.statusCode) !== "409") throw error;
          await download(photo); // Idempotent retry: an existing object must have the same bytes.
        }
        uploaded.add(identity);
      }
      await checkOwner();
      const { data, error } = await supabase.rpc("save_school_journal", {
        p_owner: owner,
        p_document: document,
        p_expected_revision: snapshot.state.revision,
        p_mutation_id: snapshot.state.operation,
      });
      if (error) throw error;
      return { ...data, document: documentSchema.parse(data.document) };
    },
    async photos(document, cached) {
      const result: StoredPhoto[] = [];
      for (const photo of document.photos) {
        const local = cached.find((p) => p.id === photo.id);
        if (local && (await checksum(local.blob)) === photo.sha256)
          result.push(local);
        else result.push(await download(photo));
      }
      return result;
    },
  };
}
export { CloudJournal } from "./cloud-journal";
