"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { copyText, type DockerLogs, type DockerService } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { Empty, ErrorState, errText, I, Skeleton, Switch } from "./ui";

const TAILS = [100, 300, 1000, 2000];
const SINCES: [string, string][] = [["", "از ابتدا"], ["10m", "۱۰ دقیقهٔ اخیر"], ["1h", "۱ ساعت اخیر"]];
const SERVICE_LABEL: Record<string, string> = {
  backend: "backend (Django)", frontend: "frontend (Next.js)", nginx: "nginx", db: "دیتابیس", scheduler: "زمان‌بند", agent: "agent", control: "control", "update-job": "کار به‌روزرسانی",
};
const ERROR_RE = /\b(error|exception|traceback|fatal|critical|panic|failed)\b|\s5\d\d\s/i;
const WARN_RE = /\b(warn|warning|deprecated|timeout|retry)\b|\s4\d\d\s/i;

/** «10:00:01» به وقت مرورگر از زمان UTC داکر */
function clock(ts: string): string {
  if (!ts) return "";
  const d = new Date(`${ts.slice(0, 23)}Z`);
  return Number.isNaN(d.getTime()) ? ts.slice(11, 19) : d.toTimeString().slice(0, 8);
}

const stateColor = (state: string) => (state === "running" ? "var(--ok)" : state === "restarting" ? "var(--warn)" : "var(--danger)");

/** تنظیمات ← لاگ داکر (فقط مالک): لاگ هر سرویس پنل، با جست‌وجو و نمایش زنده. */
export function DockerLogsTab() {
  const flash = useToast();
  const [service, setService] = useState("backend");
  const [tail, setTail] = useState(300);
  const [since, setSince] = useState("");
  const [live, setLive] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // کاربر پایین لاگ است؟ پس با خط تازه همراه شود

  const services = useSWR<{ services: DockerService[] }>("/api/settings/system/logs/services", fetcher, { refreshInterval: 15000 });
  const list = services.data?.services ?? [];
  const current = list.find((x) => x.service === service) ?? list[0];

  const url = current ? `/api/settings/system/logs?service=${current.service}&tail=${tail}${since ? `&since=${since}` : ""}` : null;
  const logs = useSWR<DockerLogs>(url, fetcher, { refreshInterval: live ? 3000 : 0, keepPreviousData: true });

  const lines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logs.data?.lines ?? []).filter((l) => (!q || l.text.toLowerCase().includes(q)) && (!onlyProblems || ERROR_RE.test(l.text) || WARN_RE.test(l.text)));
  }, [logs.data, query, onlyProblems]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (services.error && !services.data) {
    return <ErrorState onRetry={() => services.mutate()} />;
  }
  if (!services.data) return <Skeleton rows={3} />;
  if (list.length === 0) {
    return <Empty icon={I.terminal} title="سرویسی پیدا نشد" text="سرویس control کانتینرهای این پروژه را پیدا نکرد. مطمئن شوید پنل با docker compose بالا آمده است." />;
  }

  const plain = lines.map((l) => `${l.ts} ${l.text}`).join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([plain], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${current?.service ?? "log"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div className={s.people} role="tablist" aria-label="سرویس‌ها">
        {list.map((x) => (
          <button key={x.service} role="tab" className={s.person} aria-selected={current?.service === x.service} onClick={() => setService(x.service)} title={`${x.container} — ${x.status}`}>
            <span className="dot" style={{ background: stateColor(x.state) }} />
            <span>{SERVICE_LABEL[x.service] ?? x.service}</span>
          </button>
        ))}
      </div>

      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon d={I.search} size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو در لاگ…" aria-label="جست‌وجو در لاگ" dir="ltr" />
        </label>
        <select className={s.select} value={tail} onChange={(e) => setTail(Number(e.target.value))} aria-label="تعداد خط">
          {TAILS.map((n) => <option key={n} value={n}>{toFa(n)} خط آخر</option>)}
        </select>
        <select className={s.select} value={since} onChange={(e) => setSince(e.target.value)} aria-label="بازهٔ زمانی">
          {SINCES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button className={s.btnGhost} aria-pressed={onlyProblems} data-active={onlyProblems} onClick={() => setOnlyProblems(!onlyProblems)} title="فقط خطاها و هشدارها">
          <Icon d={I.alert} size={15} /> خطا و هشدار
        </button>
        <span className={s.liveSwitch}>
          <Switch on={live} onChange={setLive} label="نمایش زنده" />
          <span>زنده</span>
        </span>
        <span className={s.spacer} />
        <button className={s.iconBtn} onClick={() => logs.mutate()} title="تازه‌سازی" aria-label="تازه‌سازی"><Icon d={I.refresh} size={16} /></button>
        <button className={s.iconBtn} onClick={async () => flash((await copyText(plain)) ? "لاگ کپی شد" : "کپی نشد")} title="کپی" aria-label="کپی" disabled={!lines.length}><Icon d={I.copy} size={16} /></button>
        <button className={s.iconBtn} onClick={download} title="دانلود" aria-label="دانلود" disabled={!lines.length}><Icon d={I.download} size={16} /></button>
      </div>

      {logs.error && !logs.data ? (
        <div style={{ padding: 18 }}>
          <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} /><span><b>لاگ خوانده نشد</b>{errText(logs.error)}</span></div>
        </div>
      ) : (
        <div
          className={s.dlog}
          ref={box}
          dir="ltr"
          role="log"
          aria-label={`لاگ ${current?.service}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {lines.length === 0 && <div className={s.dlogEmpty}>{logs.isLoading ? "در حال خواندن…" : "خطی برای نمایش نیست."}</div>}
          {lines.map((l, i) => (
            <div key={i} className={s.dline} data-lvl={ERROR_RE.test(l.text) ? "err" : WARN_RE.test(l.text) ? "warn" : l.stream === "err" ? "stderr" : undefined}>
              <span>{clock(l.ts)}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className={s.dfoot}>
        <span>{toFa(lines.length)} خط{lines.length !== (logs.data?.lines.length ?? 0) && ` از ${toFa(logs.data?.lines.length ?? 0)}`}</span>
        <span dir="ltr" className="mono">{logs.data?.container}</span>
      </div>
    </div>
  );
}
