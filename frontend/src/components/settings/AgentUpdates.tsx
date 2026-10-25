"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { whenText } from "@/lib/people";
import { type AgentsInfo } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { errText, I } from "./ui";
import { JobStatusRow, UpdateProgressDialog } from "./UpdateProgress";

const Ver = ({ v }: { v: string | null }) => (v ? <span dir="ltr" className="mono">{v}</span> : <span>—</span>);

/**
 * ایجنت‌هایی که با docker compose روی سرور پنل نصب شده‌اند (برچسب asandesk.agent) از همین‌جا به‌روز می‌شوند:
 * control داخل پوشهٔ همان ایجنت `git pull` و `docker compose up -d --build` می‌زند. ایجنت روی سرورهای دیگر
 * (مثلاً سرور hbbs اگر جدا باشد) از اینجا قابل دسترسی نیست و باید روی خود آن سرور به‌روز شود.
 */
export function AgentUpdates() {
  const flash = useToast();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  // تابع ثابت: با تابع تازه در هر رندر SWR تایمرش را از نو می‌سازد
  const refreshInterval = useCallback((latest?: AgentsInfo) => (latest?.job?.state === "running" ? 2000 : 30000), []);
  const { data, mutate } = useSWR<AgentsInfo>("/api/settings/system/update/agents", fetcher, { refreshInterval, keepPreviousData: true });

  if (!data || !data.control.online) return null;
  const job = data.job && data.job.state !== "none" ? data.job : null;
  const running = job?.state === "running";

  const check = async () => {
    setChecking(true);
    try {
      await mutate(await api<AgentsInfo>("/api/settings/system/update/agents/check", { method: "POST" }), { revalidate: false });
    } catch (e) {
      flash(errText(e));
    } finally {
      setChecking(false);
    }
  };
  const start = async (project: string) => {
    setStarting(project);
    try {
      await mutate(await api<AgentsInfo>("/api/settings/system/update/agents/start", { method: "POST", body: { project } }), { revalidate: false });
      setProgressOpen(true);
    } catch (e) {
      flash(errText(e));
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className={`card ${s.cardPad}`}>
      <div className={s.cardHead}>
        <div>
          <b>ایجنت روی این سرور</b>
          <small>{data.agents.length ? `${toFa(data.agents.length)} ایجنت پیدا شد` : "ایجنتی پیدا نشد"}</small>
        </div>
        {data.agents.length > 0 && (
          <button className={s.btnGhost} onClick={check} disabled={checking || running}>
            <Icon d={I.refresh} size={15} /> {checking ? "در حال بررسی…" : "بررسی نسخهٔ جدید"}
          </button>
        )}
      </div>

      {data.agents.length === 0 && (
        <div className={s.note} data-tone="info">
          <Icon d={I.info} size={18} />
          <span>
            <b>ایجنتی که با docker compose نصب شده باشد روی این سرور پیدا نشد</b>
            فقط ایجنتِ نصب‌شده با دستور جدید (HA ← افزودن سرور) از اینجا به‌روز می‌شود. ایجنتی که قبلاً با docker run نصب شده یک‌بار باید با دستور جدید دوباره نصب شود. ایجنت روی سرورهای دیگر را باید روی خود آن سرور به‌روز کرد.
          </span>
        </div>
      )}

      {data.agents.map((a) => (
        <div key={a.project} className={s.kv}>
          <div>
            <span>
              <b dir="ltr" className="mono">{a.container}</b> · {a.state === "running" ? "در حال اجرا" : a.state}
            </span>
            <span>
              نسخهٔ روی سرور <Ver v={a.disk_version} />
              {a.remote_version && a.remote_version !== a.disk_version && <> ← <Ver v={a.remote_version} /></>}
              {a.checked_at && <> · بررسی: {whenText(a.checked_at)}</>}
            </span>
          </div>
          {a.error && <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} /><span><b>بررسی انجام نشد</b>{a.error}</span></div>}
          {!a.error && !a.checked_at && <div className={s.sub}>هنوز بررسی نشده؛ «بررسی نسخهٔ جدید» را بزنید.</div>}
          {!a.error && a.checked_at && !a.available && <div className={s.note} data-tone="ok"><Icon d={I.check} size={18} /><span><b>ایجنت به‌روز است</b>همان آخرین نسخهٔ شاخهٔ <span dir="ltr" className="mono">{a.branch}</span> است.</span></div>}
          {a.available && (
            <div className={s.row2}>
              <span className={s.sub}>
                {a.behind > 0 ? `${toFa(a.behind)} تغییر جدید در GitHub. ` : ""}ایجنت هنگام به‌روزرسانی چند ثانیه گزارش نمی‌فرستد.
                {a.dirty && " روی سرور فایل‌های تغییرکرده هست؛ اگر تداخل داشته باشند git pull خطا می‌دهد."}
              </span>
              <button className={s.btnPrimary} onClick={() => start(a.project)} disabled={running || starting !== null}>
                <Icon d={I.cloud} size={16} /> {starting === a.project ? "در حال شروع…" : "به‌روزرسانی ایجنت"}
              </button>
            </div>
          )}
        </div>
      ))}

      {job && <JobStatusRow kind="agent" job={job} onOpen={() => setProgressOpen(true)} />}

      {job && progressOpen && (
        <UpdateProgressDialog kind="agent" title="به‌روزرسانی ایجنت" job={job} onClose={() => setProgressOpen(false)}>
          {job.state === "failed" && (
            <div className={s.note} data-tone="danger">
              <Icon d={I.alert} size={18} />
              <span><b>مرحله‌ای خطا داد</b>لاگ زیر علتش را نشان می‌دهد؛ ایجنت فعلی معمولاً همان‌طور که بود کار می‌کند.</span>
            </div>
          )}
        </UpdateProgressDialog>
      )}
    </div>
  );
}
