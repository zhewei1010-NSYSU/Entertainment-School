import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { Eye, EyeOff, UserRound, X } from "lucide-react";
import Journal from "./journal";
import { CloudJournal, cloudAPI, supabase } from "./cloud-store";
import { localStore } from "./local-store";
import type { SyncState } from "./local-store";

function AccountDialog({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="school-account-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          aria-label="關閉帳號視窗"
          className="icon-button"
          disabled={busy}
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SignedWorkspace({ user }: { user: User }) {
  const [cloud] = useState(() => new CloudJournal(user.id, cloudAPI(user.id)));
  const storage = useMemo(() => cloud.editableStore(), [cloud]);
  const [state, setState] = useState<SyncState | null>(null);
  const [, render] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState("");
  const actionBusy = useRef(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) {
        render((v) => v + 1);
        void cloud.store
          .getState()
          .then((value) => {
            if (active) setState(value);
          })
          .catch(() => {
            if (active)
              setMessage("無法讀取此帳號的本機副本，請勿清除網站資料。");
          });
      }
    };
    cloud.onChange = refresh;
    const sync = () => {
      void cloud.sync();
    };
    const unsubscribe = cloud.store.subscribe(() => {
      refresh();
      sync();
    });
    refresh();
    void cloud.sync().then(() => {
      if (active) setInitialized(true);
    });
    const channel = supabase
      .channel("school:" + user.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_journals",
          filter: "user_id=eq." + user.id,
        },
        sync,
      )
      .subscribe();
    const timer = setInterval(sync, 20000);
    const visible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      cloud.stop();
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
      cloud.store.dispose();
    };
  }, [cloud, user.id]);
  async function action(run: () => Promise<unknown>) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setMessage("");
    try {
      await run();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "操作未完成，請檢查網路後重試。",
      );
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }
  const controls = (
    <>
      <p className="account-email">{user.email}</p>
      <p role="status">{cloud.status}</p>
      <p className="account-hint">
        只有「已確認與雲端同步（含照片）」代表上傳完成。離線資料先存於手機；請定期下載備份。
      </p>
      <div className="account-actions">
        <button
          type="button"
          disabled={busy || cloud.busy}
          onClick={() => void action(() => cloud.sync())}
        >
          重試同步
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await cloud.store.exportBackup();
              setBackedUp(true);
            })
          }
        >
          下載此裝置完整備份
        </button>
        <button
          type="button"
          disabled={busy || cloud.busy}
          onClick={() =>
            void action(async () => {
              if (
                state?.dirty &&
                !window.confirm(
                  "尚有未同步資料。登出後副本仍在此裝置，下次登入同帳號才能重試。確定登出？",
                )
              )
                return;
              const { error } = await supabase.auth.signOut({ scope: "local" });
              if (error) throw error;
            })
          }
        >
          登出
        </button>
      </div>
      {cloud.conflict && (
        <div className="account-warning">
          <p>
            本機與另一裝置都有變更，不會自動合併。先下載備份並確認檔案可讀取，再選擇雲端版本；未上傳的紀錄可依備份逐筆補登。
          </p>
          <button
            disabled={busy || !backedUp}
            onClick={() => {
              if (
                window.confirm(
                  "已確認備份可讀取？將捨棄此裝置的待同步版本，不會自動合併。",
                )
              )
                void action(() => cloud.useCloud());
            }}
          >
            已備份，改用雲端版本
          </button>
        </div>
      )}
      {message && (
        <p role="alert" className="account-warning">
          {message}
        </p>
      )}
      <p className="account-hint">
        此裝置會保持登入。登出不會刪除本機副本，請使用自己的手機。
      </p>
    </>
  );
  const accountButton = (
    <button className="school-account-button" onClick={() => setOpen(true)}>
      <UserRound size={18} />
      帳號
    </button>
  );
  return (
    <>
      {state?.activated ? (
        <Journal
          store={storage}
          accountAction={accountButton}
          syncMessage={cloud.status}
        />
      ) : (
        <section className="cloud-setup">
          <h1>連接校園雲端紀錄</h1>
          {controls}
          {initialized && state && !state.activated && cloud.canInitialize && (
            <div className="account-migration">
              <h2>第一次使用，先備份再確認匯入</h2>
              <p>
                原手機照片與心得不會刪除。確認後才會複製到目前登入帳號；如果雲端已有資料，會載入雲端，不覆蓋它。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await localStore.exportBackup();
                    setBackedUp(true);
                  })
                }
              >
                下載原手機完整備份
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                我已保存備份，同意把此手機的紀錄與照片匯入這個帳號
              </label>
              <button
                disabled={busy || !backedUp || !agreed}
                onClick={() =>
                  void action(async () => {
                    await cloud.store.activate(await localStore.snapshot());
                    await cloud.sync();
                  })
                }
              >
                確認匯入手機紀錄
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm("建立全新空白雲端紀錄？原手機紀錄仍保留。")
                  )
                    void action(async () => {
                      await cloud.store.activate({ records: [], photos: [] });
                      await cloud.sync();
                    });
                }}
              >
                改用全新空白紀錄
              </button>
            </div>
          )}
        </section>
      )}
      {state?.activated && cloud.conflict && (
        <div className="cloud-conflict-alert" role="alert">
          同步衝突：本機資料已保留。
          <button onClick={() => setOpen(true)}>開啟帳號處理</button>
        </div>
      )}
      {open && (
        <AccountDialog
          title="帳號與同步"
          close={() => setOpen(false)}
          busy={busy}
        >
          {controls}
        </AccountDialog>
      )}
    </>
  );
}
export default function CloudWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const close = useCallback(() => {
    setOpen(false);
    setPassword("");
    setShowPassword(false);
  }, []);
  useEffect(() => {
    let active = true;
    let authEvent = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEvent = true;
      if (active) {
        setUser(session?.user || null);
        setLoading(false);
      }
    });
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active && !authEvent) {
          setUser(data.session?.user || null);
          setLoading(false);
          if (error) setMessage("請重新登入。");
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setMessage("無法確認登入狀態，請檢查網路後重試。");
        }
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = signup
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: new URL("./", location.href).href },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
      if (result.error) throw result.error;
      setPassword("");
      setMessage(signup ? "請到信箱點確認信，再回來登入。" : "登入成功。");
      if (signup) setSignup(false);
    } catch {
      setMessage(
        "登入／註冊未完成，請確認信箱、密碼、確認信及網路。可使用財務網站同一組帳號。",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <p className="cloud-setup" role="status">
        正在恢復登入狀態…
      </p>
    );
  if (user) return <SignedWorkspace key={user.id} user={user} />;
  return (
    <>
      <Journal
        accountAction={
          <button
            className="school-account-button"
            onClick={() => {
              setMessage("");
              setOpen(true);
            }}
          >
            <UserRound size={18} />
            登入
          </button>
        }
      />
      {open && (
        <AccountDialog
          title={signup ? "建立校園帳號" : "登入校園漫遊"}
          close={close}
          busy={busy}
        >
          <p>可使用財務網站同一組信箱與密碼，校園與理財資料分開保存。</p>
          <div className="account-tabs">
            <button
              disabled={busy}
              aria-pressed={!signup}
              onClick={() => setSignup(false)}
            >
              登入
            </button>
            <button
              disabled={busy}
              aria-pressed={signup}
              onClick={() => setSignup(true)}
            >
              註冊
            </button>
          </div>
          <form onSubmit={login} aria-busy={busy}>
            <label>
              電子郵件
              <input
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              密碼
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 8 : undefined}
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="account-reveal"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}{" "}
              {showPassword ? "隱藏密碼" : "顯示密碼"}
            </button>
            {message && (
              <p className="account-warning" role="status">
                {message}
              </p>
            )}
            <button className="account-submit" type="submit" disabled={busy}>
              {busy ? "處理中…" : signup ? "建立帳號" : "登入並連接雲端"}
            </button>
          </form>
          <p className="account-hint">
            個人手機會保持登入並自動續期。首次登入需確認是否匯入舊資料，原手機紀錄不會自動刪除。
          </p>
        </AccountDialog>
      )}
    </>
  );
}
