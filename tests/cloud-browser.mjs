import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base =
  process.env.PWA_TEST_URL || "http://127.0.0.1:4185/Entertainment-School/";
const owner = "6dcd01b4-50e8-4654-b95d-9e975ed11447",
  bob = "9dcd01b4-50e8-4654-b95d-9e975ed11447";
const rows = new Map(),
  objects = new Map(),
  offline = new WeakSet();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
});
function session(id) {
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: id === owner ? "alice@example.com" : "bob@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: id, exp, role: "authenticated" },
    ]
      .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
      .join(".") + ".mock";
  return {
    access_token: token,
    refresh_token: "mock-refresh-" + id,
    expires_in: 3600,
    expires_at: exp,
    token_type: "bearer",
    user,
  };
}
async function mocks(context) {
  await context.route(
    "https://bxywdeuffodtfrgpidwk.supabase.co/**",
    async (route) => {
      if (offline.has(context)) return route.abort("internetdisconnected");
      const r = route.request(),
        url = new URL(r.url());
      if (url.pathname.endsWith("/token")) {
        const input = r.postDataJSON();
        return route.fulfill({
          json: session(
            input.email === "bob@example.com" ||
              input.refresh_token?.endsWith(bob)
              ? bob
              : owner,
          ),
        });
      }
      if (url.pathname.endsWith("/logout"))
        return route.fulfill({ status: 204 });
      let actor;
      try {
        actor = JSON.parse(
          Buffer.from(r.headers().authorization.split(".")[1], "base64url"),
        ).sub;
      } catch {}
      if (!actor)
        return route.fulfill({
          status: 401,
          json: { message: "auth required" },
        });
      if (url.pathname.endsWith("/user"))
        return route.fulfill({ json: session(actor).user });
      if (url.pathname === "/rest/v1/school_journals")
        return route.fulfill({ json: rows.get(actor) || null });
      if (url.pathname === "/rest/v1/rpc/save_school_journal") {
        const p = r.postDataJSON(),
          old = rows.get(actor);
        if (p.p_owner !== actor)
          return route.fulfill({
            status: 403,
            json: { message: "owner mismatch" },
          });
        if (old?.mutation_id === p.p_mutation_id)
          return route.fulfill({ json: old });
        if ((old?.revision || 0) !== p.p_expected_revision)
          return route.fulfill({
            status: 409,
            json: { code: "40001", message: "conflict" },
          });
        const row = {
          document: p.p_document,
          revision: p.p_expected_revision + 1,
          mutation_id: p.p_mutation_id,
        };
        rows.set(actor, row);
        return route.fulfill({ json: row });
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        const path = decodeURIComponent(
          url.pathname
            .replace("/storage/v1/object/", "")
            .replace(/^authenticated\//, ""),
        );
        if (!path.startsWith("school-photos/" + actor + "/"))
          return route.fulfill({
            status: 403,
            json: { message: "private photo" },
          });
        if (r.method() === "POST") {
          if (objects.has(path))
            return route.fulfill({
              status: 409,
              json: {
                statusCode: "409",
                error: "Duplicate",
                message: "already exists",
              },
            });
          let data = r.postDataBuffer(),
            type = r.headers()["content-type"] || "";
          if (type.includes("multipart/form-data")) {
            const boundary = type.match(/boundary=(.*)$/)[1];
            const marker = Buffer.from("filename=");
            const fileAt = data.indexOf(marker);
            assert.ok(fileAt >= 0, "photo upload has a file");
            const start = data.indexOf(Buffer.from("\r\n\r\n"), fileAt) + 4;
            const end = data.indexOf(Buffer.from("\r\n--" + boundary), start);
            type =
              data
                .subarray(
                  data.lastIndexOf(Buffer.from("Content-Type:"), start),
                  start,
                )
                .toString()
                .match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "image/jpeg";
            data = data.subarray(start, end);
          }
          objects.set(path, { data, type });
          return route.fulfill({ json: { Key: path } });
        }
        const object = objects.get(path);
        if (!object)
          return route.fulfill({
            status: 404,
            json: { message: "missing photo" },
          });
        return route.fulfill({ body: object.data, contentType: object.type });
      }
      return route.fulfill({
        status: 404,
        json: { message: "unhandled mock " + url.pathname },
      });
    },
  );
  await context.routeWebSocket(/supabase\.co/, (ws) => ws.close());
}
async function login(page, email = "alice@example.com") {
  await page.getByRole("button", { name: "登入", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("電子郵件", { exact: true }).fill(email);
  await dialog.getByLabel("密碼", { exact: true }).fill("test-password-123");
  await dialog
    .getByRole("button", { name: "登入並連接雲端", exact: true })
    .click();
}
async function school(page) {
  await page.getByLabel("搜尋國小、地區或地址").fill("隆田國小");
  await page.locator(".school-row").first().click();
}
try {
  const a = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await mocks(a);
  const p = await a.newPage();
  await p.goto(base);
  await school(p);
  await p.getByRole("button", { name: "加入校園照片", exact: true }).click();
  await p.getByLabel("沿途的感受").fill("原手機照片與紀錄");
  await p
    .locator("dialog input[type=file]")
    .setInputFiles(new URL("../public/pwa-192.png", import.meta.url).pathname);
  await p.getByRole("button", { name: "儲存這一站" }).click();
  await expect(p.getByText("已儲存在這台裝置", { exact: true })).toBeVisible();
  await login(p);
  await expect(
    p.getByRole("heading", { name: "第一次使用，先備份再確認匯入" }),
  ).toBeVisible();
  await expect(
    p.getByRole("button", { name: "確認匯入手機紀錄" }),
  ).toBeDisabled();
  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "下載原手機完整備份" }).click();
  await download;
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "確認匯入手機紀錄" }).click();
  await expect(
    p.getByText("已確認與雲端同步（含照片）。", { exact: true }),
  ).toBeVisible();
  assert.equal(rows.get(owner).document.records.length, 1);
  assert.equal(objects.size, 1);
  await p.reload();
  await expect(
    p.getByRole("button", { name: "帳號", exact: true }),
  ).toBeVisible();
  // A separate device loads the same private photo bytes from Storage.
  const b = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await mocks(b);
  const q = await b.newPage();
  await q.goto(base);
  await login(q);
  await expect(
    q.getByText("已確認與雲端同步（含照片）。", { exact: true }),
  ).toBeVisible();
  await school(q);
  await expect(q.locator(".map-school-photo")).toBeVisible();
  assert.ok(
    await q
      .locator(".map-school-photo")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  // Offline edits remain local, then upload once connection recovers.
  offline.add(a);
  await a.setOffline(true);
  await school(p);
  await p.getByRole("button", { name: "寫一筆", exact: true }).click();
  await p.getByLabel("沿途的感受").fill("離線補記");
  await p.getByRole("button", { name: "儲存這一站" }).click();
  await expect(
    p.getByText("已儲存在這台裝置，尚未確認雲端同步", { exact: true }),
  ).toBeVisible();
  assert.equal(rows.get(owner).document.records.length, 1);
  offline.delete(a);
  await a.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => rows.get(owner).document.records.length).toBe(2);
  await q.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(q.locator(".school-note")).toHaveCount(2);
  // A fresh login under B must not see A's cached journal or photos.
  await q.getByRole("button", { name: "帳號", exact: true }).click();
  await q.getByRole("button", { name: "登出", exact: true }).click();
  const auth = q.getByRole("dialog");
  await auth.getByLabel("電子郵件", { exact: true }).fill("bob@example.com");
  await auth.getByLabel("密碼", { exact: true }).fill("test-password-123");
  await auth.getByRole("button", { name: "登入並連接雲端" }).click();
  await expect(
    q.getByRole("heading", { name: "第一次使用，先備份再確認匯入" }),
  ).toBeVisible();
  assert.equal(rows.has(bob), false);
  // Original unauthenticated phone data is unchanged by migration and cloud edits.
  const original = await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("school-wander-local-v1");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("records");
          const get = tx.objectStore("records").getAll();
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
        };
      }),
  );
  assert.equal(original.length, 1);
  assert.equal(original[0].note, "原手機照片與紀錄");
  console.log(
    "PASS: mobile login, explicit migration with photo, persistent session, separate device private-photo restore, offline pending upload, foreground synchronization, account isolation and legacy preservation (mock Supabase).",
  );
} finally {
  await browser.close();
}
