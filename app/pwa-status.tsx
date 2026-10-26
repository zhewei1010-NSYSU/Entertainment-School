import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
let update: ((reload?: boolean) => Promise<void>) | undefined;
let waiting = false;
let ready = false;
let failed = false;
function start() {
  if (update) return;
  update = registerSW({
    onNeedRefresh() { waiting = true; window.dispatchEvent(new Event('school-pwa')); },
    onOfflineReady() { ready = true; window.dispatchEvent(new Event('school-pwa')); },
    onRegisterError() { failed = true; window.dispatchEvent(new Event('school-pwa')); },
  });
}
export default function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [, render] = useState(0);
  useEffect(() => {
    const changed = () => { setOnline(navigator.onLine); render(v => v + 1); };
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    window.addEventListener('school-pwa', changed);
    start();
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
      window.removeEventListener('school-pwa', changed);
    };
  }, []);
  if (online && !waiting && !failed) return null;
  return <aside className="pwa-status" aria-label="App 連線與更新狀態">
    {!online && <p role="status">目前離線{ready ? '，離線介面已準備好' : ''}。照片與心得只保存在此裝置，不會上傳或跨裝置同步；外部地圖與學校網站需要網路。</p>}
    {failed && <p role="status">離線介面尚未準備好，請連線後重新開啟；已保存的紀錄不受影響。</p>}
    {waiting && <p role="status">有新版本可用。<button onClick={() => {
      if (window.confirm('請先儲存正在填寫的心得。更新會重新載入頁面，尚未儲存的表單會遺失；已保存的照片與紀錄會保留。確定更新？')) void update?.(true);
    }}>儲存完成，更新 App</button></p>}
  </aside>;
}
