"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher, upload } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { bytesFa, copyText, jDate, jStamp, jTime, KIND_LABEL, mmss, RO_TIP, type BackupOverview, type BackupRow, type Operation } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { Empty, ErrorState, errText, I, Modal, Skeleton, Stepper, Switch } from "./ui";

export function BackupTab({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  // هنگام اجرای عملیات هر ثانیه، وگرنه هر ۱۵ ثانیه تازه‌سازی می‌شود
  const { data, error, mutate } = useSWR<BackupOverview>("/api/settings/backups/", fetcher, {
    refreshInterval: (latest) => (latest?.op && (latest.op.status === "queued" || latest.op.status === "running") ? 1000 : 15000),
  });
  const flash = useToast();
  const [restore, setRestore] = useState<BackupRow | null>(null);
  const [del, setDel] = useState<BackupRow | null>(null);
  const [drop, setDrop] = useState(false);
  const active = !!data?.op && (data.op.status === "queued" || data.op.status === "running");

  // پایان یک عملیات: اگر بازگردانی بود، نشست‌ها بسته شده و باید دوباره وارد شد
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const op = data?.op;
    if (!op) return;
    const key = `${op.id}:${op.status}`;
    if (lastStatus.current && lastStatus.current !== key && op.kind === "restore" && op.status === "ok") {
      router.replace("/login");
    }
    lastStatus.current = key;
  }, [data?.op, router]);

  if (error) return <ErrorState onRetry={() => mutate()} />;
  if (!data) return <Skeleton />;
  const cfg = data.settings;

  const patch = async (body: Partial<BackupOverview["settings"]>) => {
    mutate((cur) => (cur ? { ...cur, settings: { ...cur.settings, ...body } } : cur), { revalidate: false });
    try {
      await api("/api/settings/backups/settings", { method: "PATCH", body });
      mutate();
    } catch (e) {
      flash(errText(e));
      mutate();
    }
  };

  const run = async () => {
    try {
      await api("/api/settings/backups/run", { method: "POST", body: { include_files: cfg.include_files } });
      mutate();
    } catch (e) {
      flash(errText(e));
    }
  };

  const lastAuto = data.backups.find((b) => b.kind === "auto");
  const autoText = !cfg.enabled
    ? "پشتیبان‌گیری خودکار خاموش است"
    : `${lastAuto ? `آخرین پشتیبان خودکار: ${lastAuto.ok ? "موفق" : "ناموفق"}، ${jStamp(lastAuto.created_at)}${lastAuto.ok ? `، ${bytesFa(lastAuto.size)}` : ""}` : "هنوز پشتیبان خودکاری ساخته نشده"}${data.next_run ? ` · بعدی: ${new Date(data.next_run).toDateString() === new Date().toDateString() ? "امروز" : "فردا"} ${jTime(data.next_run)}` : ""}`;

  return (
    <>
      <div className={s.bkTop}>
        <OperationCard data={data} canEdit={canEdit} onRun={run} onChange={() => mutate()} />
        <div className={`card ${s.cardPad}`}>
          <div className={s.cardHead}>
            <div><b>پشتیبان‌گیری خودکار</b><small>هر روز یک نسخه از دیتابیس پنل</small></div>
            <Switch on={cfg.enabled} onChange={(v) => patch({ enabled: v })} disabled={!canEdit} title={canEdit ? undefined : RO_TIP} label="پشتیبان‌گیری خودکار" />
          </div>
          <div className={s.row2}>
            <span>ساعت اجرای روزانه</span>
            <input className={s.timeInput} type="time" dir="ltr" value={cfg.run_time} disabled={!canEdit || !cfg.enabled} onChange={(e) => e.target.value && patch({ run_time: e.target.value })} />
          </div>
          <div>
            <div className={s.row2}>
              <span>نگه‌داری تا</span>
              <Stepper value={cfg.keep_days} min={1} max={90} unit="روز" disabled={!canEdit || !cfg.enabled} onChange={(v) => patch({ keep_days: v })} />
            </div>
            <div className={s.sub} style={{ marginTop: 6 }}>پشتیبان‌های خودکار قدیمی‌تر از {toFa(cfg.keep_days)} روز حذف می‌شوند. پشتیبان‌های دستی و ایمنی حذف نمی‌شوند.</div>
          </div>
          <button className={s.fileCheck} onClick={() => patch({ include_files: !cfg.include_files })} disabled={!canEdit || !cfg.enabled}>
            <span className={s.box} data-on={cfg.include_files}>{cfg.include_files && <Icon d={I.check} size={13} stroke={3} />}</span>
            <span><b>شامل فایل‌های نصب نسخه‌ها هم باشد</b><small>حجم تخمینی فایل‌ها: {bytesFa(data.files_size)}</small></span>
          </button>
          <div className={s.autoLine}>
            <span className="dot" style={{ background: cfg.enabled ? "var(--ok)" : "var(--off)" }} />
            <span>{autoText}</span>
          </div>
          {cfg.enabled && !data.scheduler_alive && (
            <div className={s.note} data-tone="warn"><Icon d={I.alert} size={18} /><span><b>سرویس زمان‌بند فعال نیست</b>پشتیبان‌گیری خودکار و صف عملیات اجرا نمی‌شود. سرویس scheduler در docker compose را بررسی کنید.</span></div>
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: "visible" }}>
        <div className={s.toolbar}>
          <div>
            <b style={{ fontSize: 15, display: "block" }}>پشتیبان‌ها</b>
            <small className={s.muted}>
              {data.backups.length ? `${toFa(data.backups.length)} پشتیبان · مجموع ${bytesFa(data.backups.reduce((n, b) => n + b.size, 0))}` : "هنوز پشتیبانی وجود ندارد"}
            </small>
          </div>
          <span className={s.spacer} />
          <button className={s.btnGhost} onClick={() => setDrop(!drop)} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>
            <Icon d={I.upload} size={15} /> بارگذاری فایل پشتیبان
          </button>
        </div>
        {drop && <DropZone onDone={() => { setDrop(false); mutate(); flash("فایل پشتیبان بارگذاری شد"); }} />}
        {data.backups.length > 0 && (
          <div className={s.bkTh}><span>تاریخ و ساعت</span><span>نوع</span><span>حجم</span><span>محتوا</span><span>وضعیت</span><span /></div>
        )}
        {data.backups.map((b) => (
          <div key={b.id} className={s.bkRow}>
            <div>
              <span>{jDate(b.created_at)} — {jTime(b.created_at)}</span>
              {b.expiring && <span className={s.expiring}>فردا حذف می‌شود</span>}
            </div>
            <div><span className={s.badge} style={{ background: b.kind === "auto" ? "var(--accent-soft)" : "var(--subtle)", color: b.kind === "auto" ? "var(--accent)" : "var(--text-2)" }}>{KIND_LABEL[b.kind]}</span></div>
            <div className={s.muted}>{b.ok ? bytesFa(b.size) : "—"}</div>
            <div className={s.muted}>{b.ok ? (b.include_files ? "دیتابیس + فایل‌ها" : "دیتابیس") : "—"}</div>
            <div className={s.status} title={b.error}><span className="dot" style={{ background: b.ok ? "var(--ok)" : "var(--danger)" }} />{b.ok ? "موفق" : "ناموفق"}</div>
            <div className={s.acts}>
              <a className={s.iconBtn} href={b.ok ? `/api/settings/backups/${b.id}/download` : undefined} aria-disabled={!b.ok} title="دانلود" aria-label="دانلود" style={b.ok ? undefined : { opacity: 0.4, pointerEvents: "none" }}><Icon d={I.download} size={16} /></a>
              <button className={s.iconBtn} onClick={() => setRestore(b)} disabled={!canEdit || !b.ok || active} title={canEdit ? "بازگردانی" : RO_TIP} aria-label="بازگردانی"><Icon d={I.restore} size={16} /></button>
              <button className={s.iconBtn} data-danger="true" onClick={() => setDel(b)} disabled={!canEdit} title={canEdit ? "حذف" : RO_TIP} aria-label="حذف"><Icon d={I.trash} size={16} /></button>
            </div>
          </div>
        ))}
        {data.backups.length === 0 && (
          <Empty
            icon={I.db}
            title="هنوز پشتیبانی ساخته نشده"
            text={`اولین پشتیبان خودکار ${cfg.enabled ? `امشب ساعت ${toFa(cfg.run_time)}` : "بعد از روشن‌کردن پشتیبان‌گیری خودکار"} ساخته می‌شود. می‌توانید همین حالا هم یک نسخه بگیرید یا فایلی را برای بازگردانی بارگذاری کنید.`}
            action={<button className={s.btnPrimary} onClick={run} disabled={!canEdit || active} title={canEdit ? undefined : RO_TIP}>پشتیبان‌گیری همین حالا</button>}
          />
        )}
      </div>

      {restore && <RestoreDialog backup={restore} word={data.confirm_word} onClose={() => setRestore(null)} onStarted={() => { setRestore(null); mutate(); }} />}
      {del && (
        <Modal
          title="حذف پشتیبان"
          onClose={() => setDel(null)}
          footer={
            <>
              <button className={s.btnGhost} onClick={() => setDel(null)}>انصراف</button>
              <button className={s.btnDanger} onClick={async () => {
                try {
                  await api(`/api/settings/backups/${del.id}`, { method: "DELETE" });
                  setDel(null);
                  flash("پشتیبان حذف شد");
                  mutate();
                } catch (e) {
                  flash(errText(e));
                }
              }}>حذف پشتیبان</button>
            </>
          }
        >
          <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} /><span><b>این پشتیبان برای همیشه حذف می‌شود.</b>فایل آن از سرور پاک می‌شود و قابل بازگشت نیست.</span></div>
          <div className={s.kv}>
            <div><span>تاریخ</span><span>{jStamp(del.created_at)}</span></div>
            <div><span>نوع</span><span>{KIND_LABEL[del.kind]}</span></div>
            <div><span>حجم</span><span>{del.ok ? bytesFa(del.size) : "—"}</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function OperationCard({ data, canEdit, onRun, onChange }: { data: BackupOverview; canEdit: boolean; onRun: () => void; onChange: () => void }) {
  const op = data.op;
  const flash = useToast();
  const logRef = useRef<HTMLDivElement>(null);
  const running = op && (op.status === "queued" || op.status === "running");
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [op?.logs.length]);

  const act = async (path: string) => {
    try {
      await api(path, { method: "POST" });
    } catch (e) {
      flash(errText(e));
    }
    onChange();
  };
  const label = op ? `${op.kind === "backup" ? "پشتیبان‌گیری" : "بازگردانی"} ${op.trigger === "auto" ? "خودکار" : "دستی"}` : "";
  return (
    <div className={`card ${s.cardPad}`}>
      <div className={s.cardHead}>
        <div>
          <b>عملیات جاری</b>
          <small>{op ? (running ? (op.status === "queued" ? "در صف اجرا" : "در حال اجرا…") : op.status === "ok" ? "عملیات با موفقیت تمام شد" : op.status === "cancelled" ? "عملیات لغو شد" : "عملیات با خطا تمام شد") : "هیچ عملیاتی در جریان نیست"}</small>
        </div>
        {!op && <button className={s.btnPrimary} onClick={onRun} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}><Icon d={I.db} size={15} /> پشتیبان‌گیری همین حالا</button>}
        {running && <button className={s.btnGhost} onClick={() => act(`/api/settings/backups/operation/${op.id}/cancel`)} disabled={!canEdit || !op.cancellable} title={op.cancellable ? undefined : "در این مرحله لغو ممکن نیست"}>لغو</button>}
        {op && !running && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className={s.btnGhost} onClick={() => act(`/api/settings/backups/operation/${op.id}/dismiss`)}>بستن</button>
            {op.status !== "ok" && op.kind === "backup" && <button className={s.btnPrimary} onClick={async () => { await act(`/api/settings/backups/operation/${op.id}/dismiss`); onRun(); }} disabled={!canEdit}><Icon d={I.refresh} size={15} /> تلاش دوباره</button>}
          </div>
        )}
      </div>
      {!op && (
        <div className={s.idle}>
          <div className={s.emptyIcon}><Icon d={I.clock} size={20} /></div>
          <div><b>عملیاتی در جریان نیست</b><small>{data.settings.enabled && data.next_run ? `پشتیبان خودکار بعدی ساعت ${jTime(data.next_run)}` : "پشتیبان‌گیری خودکار خاموش است"}</small></div>
        </div>
      )}
      {op && <OperationBody op={op} label={label} logRef={logRef} />}
      {op?.status === "queued" && !data.scheduler_alive && (
        <div className={s.note} data-tone="warn"><Icon d={I.alert} size={18} /><span><b>سرویس زمان‌بند فعال نیست</b>عملیات تا بالا آمدن سرویس scheduler در صف می‌ماند.</span></div>
      )}
    </div>
  );
}

function OperationBody({ op, label, logRef }: { op: Operation; label: string; logRef: React.RefObject<HTMLDivElement | null> }) {
  const flash = useToast();
  const running = op.status === "running" || op.status === "queued";
  const failed = op.status === "failed";
  return (
    <>
      <div className={s.opTop}>
        <div>
          <div className={s.opKind}><b style={{ color: "var(--text)" }}>{label}</b><span>زمان سپری‌شده {mmss(op.elapsed)}</span></div>
          <div className={s.opStage}>{running && <span className={s.spin} />}{op.stage || "…"}</div>
        </div>
        <span className={s.pct} dir="ltr">{toFa(op.pct)}٪</span>
      </div>
      <div className={s.progress} data-state={running ? "running" : op.status} dir="rtl" role="progressbar" aria-valuenow={op.pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${op.pct}%` }} />
      </div>
      {op.status === "ok" && <div className={s.note} data-tone="ok"><Icon d={I.check} size={18} />{op.message}</div>}
      {failed && <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} /><span><b>{op.kind === "backup" ? "پشتیبان‌گیری ناموفق بود." : "بازگردانی ناموفق بود."}</b>{op.message}</span></div>}
      <div className={s.logBox}>
        <div className={s.logHead}>
          <span className="dot" style={{ background: running ? "var(--ok)" : "#5d7a73", width: 7, height: 7 }} />
          <span>لاگ زنده</span>
          <button onClick={async () => (await copyText(op.logs.map((l) => `${l.t} ${l.txt}`).join("\n"))) && flash("لاگ کپی شد")}><Icon d={I.copy} size={13} /> کپی لاگ</button>
        </div>
        <div className={s.logBody} ref={logRef}>
          {op.logs.map((l, i) => (
            <div key={i} data-lvl={l.lvl}><span>{l.t}</span><span dir="auto">{l.txt}</span></div>
          ))}
        </div>
      </div>
    </>
  );
}

function RestoreDialog({ backup, word, onClose, onStarted }: { backup: BackupRow; word: string; onClose: () => void; onStarted: () => void }) {
  const [safety, setSafety] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const flash = useToast();
  return (
    <Modal
      title="بازگردانی پشتیبان"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className={s.btnGhost} onClick={onClose} disabled={busy}>انصراف</button>
          <button
            className={s.btnDanger}
            disabled={busy || text.trim() !== word}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/settings/backups/${backup.id}/restore`, { method: "POST", body: { confirm: text.trim(), safety } });
                onStarted();
              } catch (e) {
                flash(errText(e));
                setBusy(false);
              }
            }}
          >
            بازگردانی
          </button>
        </>
      }
    >
      <div className={s.note} data-tone="danger">
        <Icon d={I.alert} size={18} />
        <span><b>همهٔ اطلاعات فعلی پنل با این نسخه جایگزین می‌شود</b>کاربران، کلاینت‌ها، بازخوردها و تنظیمات به وضعیت تاریخ این پشتیبان برمی‌گردند و نشست همهٔ مدیران بسته می‌شود.</span>
      </div>
      <div className={s.kv}>
        <div><span>تاریخ پشتیبان</span><span>{jStamp(backup.created_at)}</span></div>
        <div><span>نوع</span><span>{KIND_LABEL[backup.kind]}</span></div>
        <div><span>حجم</span><span>{bytesFa(backup.size)}</span></div>
        <div><span>محتوا</span><span>{backup.include_files ? "دیتابیس + فایل‌ها" : "دیتابیس"}</span></div>
      </div>
      <button className={s.fileCheck} onClick={() => setSafety(!safety)}>
        <span className={s.box} data-on={safety}>{safety && <Icon d={I.check} size={13} stroke={3} />}</span>
        <span><b>قبل از بازگردانی، از وضعیت فعلی یک پشتیبان ایمنی گرفته شود</b><small>اگر بازگردانی به مشکل بخورد، با این نسخه برمی‌گردید.</small></span>
      </button>
      <label className={s.field}>
        <span>برای تأیید، کلمهٔ <b>«{word}»</b> را تایپ کنید</span>
        <input className={s.input} value={text} onChange={(e) => setText(e.target.value)} placeholder={word} />
      </label>
    </Modal>
  );
}

function DropZone({ onDone }: { onDone: () => void }) {
  const [over, setOver] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const flash = useToast();
  const send = async (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".adbk")) return flash("فقط فایل با پسوند .adbk پذیرفته می‌شود");
    const form = new FormData();
    form.append("file", f);
    setPct(0);
    try {
      await upload("/api/settings/backups/upload", form, setPct);
      onDone();
    } catch (e) {
      flash(errText(e, "بارگذاری ناموفق بود"));
      setPct(null);
    }
  };
  return (
    <label className={s.drop} data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]); }}>
      <Icon d={I.upload} size={26} />
      {pct === null ? (
        <>
          <b>فایل پشتیبان را اینجا رها کنید</b>
          <span>یا برای انتخاب از کامپیوتر کلیک کنید · <span dir="ltr">.adbk</span> تا ۴ گیگابایت</span>
        </>
      ) : (
        <>
          <b>در حال بارگذاری… {toFa(pct)}٪</b>
          <div className={s.progress} style={{ width: 260 }}><div style={{ width: `${pct}%` }} /></div>
        </>
      )}
      <input type="file" accept=".adbk" onChange={(e) => send(e.target.files?.[0])} />
    </label>
  );
}
