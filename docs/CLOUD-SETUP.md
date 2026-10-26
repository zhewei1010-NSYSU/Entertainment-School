# 校園漫遊：登入、私人資料庫與照片同步

沿用 Finance-Achievement 的 Supabase 專案與 Auth 帳號，但使用獨立的 `school_journals` 資料表和 **private** `school-photos` Storage bucket。不更動 `finance_books` 或理財網站設定。

## 你需要手動完成的兩個設定

### 1. 執行校園 SQL（只執行一次）

1. 到原本財務網站使用的 Supabase 專案。
2. 左側 **SQL Editor → New query**。
3. 複製 `supabase/migrations/202610270001_school_cloud.sql` 全部內容，貼上並按 **Run**。
4. 看到 Success 才繼續。如果顯示已存在，先不要刪表或重跑；保留錯誤內容交給開發者檢查。整份腳本放在 transaction 中，避免中途失敗留下部分設定。

SQL 建立個人紀錄表、RLS、版本保護寫入函式、Realtime publication、私人照片 bucket 與本人限定權限。照片僅允許 JPEG/PNG/WebP，單張最多 1,200,000 bytes，UI 會先縮圖。

**不可把 school-photos 改成 public，不需要提供 service_role、資料庫密碼或任何私人金鑰給前端。** 共享專案原有其他 bucket 的政策不受影響；校園 bucket 額外使用 restrictive policy 防止其他寬鬆政策意外放行。

### 2. 增加確認信返回網址

Supabase → **Authentication → URL Configuration → Redirect URLs → Add URL**，加入：

```
https://zhewei1010-nsysu.github.io/Entertainment-School/
```

保留原 Finance-Achievement 的網址及 Site URL，不要刪除或替換。原 Email provider、Confirm email 與 SMTP 設定沿用。已有財務帳號可直接用相同信箱密碼登入校園網站，毋須再註冊。

前端已設定原專案的公開 Project URL／publishable key；不必再新增 GitHub 變數。若日後搬到其他專案，可用 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY` 同時覆寫。`VITE_*` 會公開出現在瀏覽器，不可填 service_role 或 secret key。

## 第一次從手機匯入

1. 在原本保存照片與心得的手機／瀏覽器，開啟校園漫遊並更新新版。先按「匯出備份」，檢查檔案已保存。
2. 點頁首「登入」，使用財務網站同一帳號。
3. 若此帳號雲端尚無校園紀錄，會顯示首次設定。按「下載原手機完整備份」，確認備份後勾選同意，再按「確認匯入手機紀錄」。只在一台原始手機做第一次匯入。
4. 等待「已確認與雲端同步（含照片）」；照片較多時保持 App 開啟與連網。上傳未完成前，不要清除瀏覽器資料。
5. 另一支手機或電腦登入同帳號，就會下載雲端紀錄與私人照片。已有雲端內容時直接載入，不用此裝置舊內容自動覆蓋。

原 `school-wander-local-v1` IndexedDB 與照片仍保留。未登入的本機帳簿和每個帳號各自使用不同資料庫；匯入是複製，不是搬走或刪除。首次資料庫升級只新增同步 metadata object store，原 records/photos 不清空。

如果 Safari 與主畫面 App 看不到同一份原資料，請先在原本有資料的入口完成匯入。兩份既有本機資料要合併時，先分別匯出備份，再登入後用「匯入備份」；相同紀錄 ID 會保留既有版本並跳過，不會自動合併同筆內容。

## 同步的實際行為

- 個人手機保存 session，Supabase SDK 自動續期。校園使用獨立 session storage key；相同帳密可共用，但兩個網站不強制一起登出。Safari、其他瀏覽器與主畫面 App 可能需要各登入一次。
- 新增、編輯、刪除與備份匯入先以一個 IndexedDB transaction 原子保存紀錄、照片及待同步狀態；失敗不顯示假成功。
- 上傳照片到 `school-photos/<登入者 UUID>/<照片 UUID>`，用 SHA-256 確認重試或下載的內容相同，才提交紀錄版本。不使用公開照片網址；畫面以已下載的本機 Blob URL 顯示。
- 雲端紀錄使用 JSONB 快照，保留原紀錄 ID、schoolId、想去狀態、日期、心得、標籤及照片關聯。每人最多 10,000 筆，JSON 文字／metadata 約 5 MB 上限，照片容量另外受 Supabase 專案 Storage 方案限制。
- 每次寫入檢查伺服器版本及 mutation UUID。回應中斷時可安全重試；上傳期間再次修改會保留新的待同步版本，收到舊版本確認不會誤標成全部已同步。
- Realtime 通知觸發重抓；另有 20 秒輪詢、回前景及恢復連線補查。照片下載完整並驗證成功後才原子替換本機副本，避免照片缺一半就覆蓋現有資料。
- 離線可讀取快取介面與已下載照片、編輯紀錄，明確顯示尚未同步。沒有 iOS 背景同步保證：保持 App 開啟並恢復連線，必要時「帳號 → 重試同步」。未曾下載的裝置不能憑空取得離線照片。
- 同步衝突會保留本機資料並暫停修改。在「帳號」下載備份、確認檔案可讀取，再選「改用雲端版本」；未上傳內容依備份逐筆補登。沒有自動最後寫入覆蓋，也沒有自動合併雙方同筆修改。
- 編輯中的表單會檢查開啟時的本機版本；若其他分頁／裝置已更新，不會直接覆寫，而是保留表單並要求重新開啟。

## 照片刪除與容量

刪除紀錄會從雲端快照解除照片關聯，也從該裝置副本移除；雲端原照片檔案暫時保留在私人 bucket，避免未完成上傳、跨裝置競爭或衝突時誤刪別的版本。**刪除紀錄不等於立即釋放 Storage 容量或永久抹除照片**。

Storage 不提供瀏覽器 UPDATE/DELETE 權限，保留不可變照片以安全重試。管理員可在確認目前快照及待同步備份的引用後，人工清理不再使用的檔案。若需要自動清理／完整帳號刪除功能，應另加有保留期限與引用檢查的後端工作，不能直接讓前端清空 bucket。

## 真實專案驗收（設定後必須做）

- 同帳號 A：手機新增紀錄及照片，電腦應出現；電腦修改／刪除，手機應更新。
- 手機離線新增：狀態顯示未同步；恢復連線後出現一次，照片可在另一裝置打開。
- A、B 帳號：B 看不到 A 紀錄；B 的 JWT 查 A 的 user_id 應回空；B 下載 A 的 Storage 路徑應遭拒。匿名不能讀取表格或下載照片。不可用會繞過 RLS 的管理員 SQL Editor／service_role 當作隔離驗證。
- 同一版本在兩台裝置修改：第一台成功，另一台顯示衝突，原待同步資料仍能下載備份。
- 登出／切換帳號／重新開啟：不顯示其他帳號副本；原未登入手機紀錄仍保留。
- Realtime 應在兩台裝置保持開啟時觸發；再測試阻斷 WebSocket 後靠輪詢／回前景恢復。

本機自動測試使用模擬 Supabase，涵蓋上述主要資料流及照片下載失敗保護，但不代表遠端 SQL、真實 RLS、Realtime 或 iPhone 實機已驗收。SQL 未執行或 Storage 未建立時，同步會明確失敗，原本機功能仍可使用；需要登出回到原本機帳簿。

## 開發檢查

```bash
npm ci
npm run check
npm test
npm run publish:root
npm run preview -- --host 127.0.0.1 --port 4185 --strictPort --base=/Entertainment-School/
# 另一個終端機（使用獨立測試資料）：
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:cloud-browser
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:map-selection
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:pwa
```

SQL 另外可用暫存 PostgreSQL 引擎檢查（不連真實資料庫）：

```bash
npm install --prefix /tmp/school-sql-check @electric-sql/pglite
PGLITE_MODULE=/tmp/school-sql-check/node_modules/@electric-sql/pglite/dist/index.js node tests/sql-policies.mjs
```

此 harness 模擬 Supabase Auth／Storage schema，驗證 migration 語法、A/B 帳號 RLS、版本衝突與重試、匿名拒絕，以及即使共享專案有另一條 permissive Storage policy 仍不能讀取別人校園照片。Realtime publication 屬於 Supabase 平台，本機 harness 不執行該行，仍須在真實專案驗收。
