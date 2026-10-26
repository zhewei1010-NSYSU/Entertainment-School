# 校園漫遊｜台灣國小探索地圖

免登入、手機可用的國小走訪網站。點台灣地圖 → 縣市 → 行政區 → 國小，加入自己的照片與心得，查看同鄉鎮景點。

## 第一次開啟網站（不需要寫程式）

網站已建置好，`index.html`、`assets/`、`data/` 都在儲存庫根目錄。

1. 在儲存庫上方點 **Settings**，左側點 **Pages**。
2. 在 **Build and deployment → Source** 選 **Deploy from a branch**。
3. Branch 選 **main**，資料夾選 **/(root)**，按 **Save**。
4. 等 GitHub 完成發布，重新整理 Pages 頁面，點它顯示的 **Visit site** 網址。該網址就是可以傳到手機使用的網站網址。

GitHub 專案頁面與實際網站是兩個不同的網址。網站發布成功前，請以 Pages 顯示的狀態為準。

## 使用方式

- 地圖支援單指拖曳、雙指縮放與＋／－按鈕。
- 點縣市後顯示行政區；高雄另有「市區放大」。
- 點行政區可看該區國小，點學校可加入最多四張照片與心得。
- 景點依同鄉鎮篩選，沒有計算實際距離。
- 紀錄保存在該瀏覽器的 IndexedDB，**不會上傳到 GitHub、也不會與其他訪客共用**。
- 清除網站資料、換手機或換網站網址前，請先按「匯出備份」；新裝置再按「匯入備份」。備份包含照片與心得。
- 從原本的 Sites 網址搬來時，也需要用匯出／匯入備份移轉。

## 原始碼與日後修改

`app/` 為介面與資料保存程式；`pages-app/` 為入口；`data/` 為公開資料；`tests/` 為資料與縮放計算測試。這裡不包含私人雲端資料庫、使用者照片、帳號密碼或金鑰。

使用 Node.js 24：

```
npm ci
npm run check
npm test
npm run publish:root
```

`publish:root` 會重新建置網站並更新根目錄的 `index.html` 與 `assets/`。把這些檔案與程式碼一起提交後，GitHub Pages 會重新發布。

## 資料來源

教育部統計處 115 學年度國民小學名錄、交通部觀光署觀光開放資料、內政部縣市與鄉鎮界線（taiwan-atlas）。資料下載快照日期：2026-10-19。完整來源與授權見 [data/README.md](data/README.md)。

## 手機 App（PWA）

網站已加入 PWA，可在手機以獨立視窗開啟，不需要下載 APK，也不需要 App Store 帳號。

- **iPhone**：用 Safari 開啟正式網址，點「分享」→「加入主畫面」→「加入」。再從主畫面上的綠色校舍圖示開啟。
- **Android**：用 Chrome 開啟正式網址，從選單選「安裝應用程式」或「新增至主畫面」（名稱依版本而異）。
- 第一次必須連網完整開啟，準備約 6.5 MB 的公開地圖／學校／景點快取。安裝完成後可離線開啟，使用公開資料及本機照片、心得；外部 Google 地圖、學校網站仍需網路。
- 照片與心得仍只保存在此裝置的 IndexedDB，不會自動上傳或跨裝置同步。離線提示會明確說明這點；請定期使用「匯出備份」。
- Safari 與主畫面 App 不保證共用既有儲存狀態。如果開啟後沒看到原紀錄，先回原瀏覽器匯出，再到 App 匯入；**不要清除網站資料**。
- 有新版本時會顯示更新提示；先儲存表單，再按更新。更新只更換程式與公開資料快取，不刪除照片與心得。瀏覽器仍可能因儲存空間不足而清理本機資料，安裝 App 不等於雲端備份。
- 沒有額外的 iPhone 安裝提示按鈕，原地圖與記錄操作保留。

### PWA 建置與測試

`public/` 保存 192、512 像素 App 圖示及 180 像素 Apple Touch Icon。`npm run icons` 可由原校舍圖示重新產生。`vite-plugin-pwa` 在正式建置時產生 manifest、service worker 與公開資料快取。使用相對 base、start_url、scope，支援 `/Entertainment-School/` GitHub Pages 專案路徑。

`npm run publish:root` 會一起更新根目錄的 manifest、service worker、圖示與建置資源。保留舊版雜湊資源，避免尚未更新的分頁失去檔案；不要只提交 HTML 而漏掉 PWA 檔案。

瀏覽器離線測試（另開一個終端機啟動預覽）：

```bash
npm ci
npm run check
npm test
npm run publish:root
npm run preview -- --host 127.0.0.1 --port 4185 --strictPort --base=/Entertainment-School/
# 另一個終端機：
npx playwright install chromium
npm run test:pwa
# Linux 已有 Chromium 可改用：
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:pwa
```

測試使用獨立瀏覽器資料，不操作日常紀錄；驗證正式子路徑、standalone manifest、離線重新載入、公開資料快取、320～768px 版面、離線新增心得與重開保存。既有 core 測試另外驗證照片保存、備份還原、重複匯入與損毀備份保護。iPhone 實機仍需依上方步驟確認主畫面圖示、橫直向、Safe Area 與照片選取。
