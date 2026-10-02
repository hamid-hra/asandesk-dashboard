"use client";

import { useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { agoText, copyText, jStamp, RO_TIP, type HAEventRow, type HAOverview, type HAServerRow } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { Empty, ErrorState, errText, fieldErrors, I, Menu, Modal, Skeleton, Stepper, Switch } from "./ui";

const STATUS: Record<string, [string, string]> = {
  ok: ["سالم", "var(--ok)"],
  slow: ["کند / ناقص", "var(--warn)"],
  down: ["قطع", "var(--danger)"],
  unknown: ["در انتظار بررسی", "var(--off)"],
  maintenance: ["خارج از چرخه (تعمیرات)", "var(--info)"],
};
const EV_COLOR: Record<string, string> = { ok: "var(--ok)", add: "var(--ok)", warn: "var(--warn)", err: "var(--danger)", edit: "var(--info)" };
const ROLE_LABEL = { primary: "اصلی", backup: "پشتیبان" } as const;

export function HATab({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useSWR<HAOverview>("/api/settings/ha/", fetcher, { refreshInterval: 5000 });
  const flash = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HAServerRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "promote" | "delete"; server: HAServerRow } | null>(null);

  if (error) return <ErrorState onRetry={() => mutate()} />;
  if (!data) return <Skeleton />;

  const failover = !!data.serving && data.servers.some((x) => x.role === "primary" && !x.serving && x.status === "down");
  const none = data.total > 0 && !data.serving;
  const tone = none ? "danger" : failover ? "warn" : undefined;
  const title = none ? "هیچ سرور سالمی وجود ندارد" : failover ? "در حالت failover" : data.total === 0 ? "سروری ثبت نشده" : "فعال";
  const sub = data.total === 0 ? "یک سرور اضافه کنید" : `${toFa(data.healthy)} از ${toFa(data.total)} سرور سالم${data.serving ? ` · سرور فعال: ${data.serving}` : ""}`;
  const dot = none ? "var(--danger)" : failover ? "var(--warn)" : data.total ? "var(--ok)" : "var(--off)";

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      flash(msg);
      mutate();
    } catch (e) {
      flash(errText(e));
    }
  };

  return (
    <>
      <div className={`card ${s.haBar}`} data-tone={tone}>
        <div className={s.haState}>
          <span className="dot" style={{ background: dot, width: 12, height: 12, animation: tone ? undefined : "pulse 2s infinite" }} />
          <div><b>{title}</b><small>{sub}</small></div>
        </div>
        <div className={s.haCell}>
          <span>آدرس عمومی</span>
          <div dir="ltr" className="mono"><span>{data.config.domain}</span><span>→</span><span>{data.ip || "—"}</span></div>
        </div>
        <div className={s.haCell}>
          <span>آخرین failover</span>
          <div>{data.last_failover ? agoText(data.last_failover.ts) : "ثبت نشده"}</div>
        </div>
        <span className={s.spacer} />
        <button className={s.btnPrimary} onClick={() => setAdding(true)} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>
          <Icon d={I.plus} size={16} /> افزودن سرور
        </button>
      </div>

      <div className={s.srvGrid}>
        {data.servers.map((sv) => (
          <ServerCard
            key={sv.id}
            sv={sv}
            canEdit={canEdit}
            onEdit={() => setEditing(sv)}
            onPromote={() => setConfirm({ kind: "promote", server: sv })}
            onMaintenance={() => act(() => api(`/api/settings/ha/servers/${sv.id}`, { method: "PATCH", body: { maintenance: !sv.maintenance } }), sv.maintenance ? `${sv.name} دوباره وارد چرخه شد` : `${sv.name} از چرخه خارج شد`)}
            onDelete={() => setConfirm({ kind: "delete", server: sv })}
          />
        ))}
      </div>
      {data.total === 0 && (
        <div className="card">
          <Empty
            icon={I.ha}
            title="هنوز سرور پشتیبانی ندارید"
            text="با یک سرور، قطع شدن آن یعنی قطع همهٔ کلاینت‌ها. یک سرور پشتیبان اضافه کنید تا جابه‌جایی خودکار فعال شود."
            action={<button className={s.btnPrimary} onClick={() => setAdding(true)} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>+ افزودن سرور</button>}
          />
        </div>
      )}

      <div className={s.haCols}>
        <FailoverCard key={JSON.stringify(data.config)} cfg={data.config} canEdit={canEdit} onSaved={() => mutate()} />
        <div className={`card ${s.cardPad}`}>
          <b style={{ fontSize: 15 }}>رویدادها</b>
          <div className={s.timeline}>
            {data.events.map((e) => <EventLine key={e.id} e={e} />)}
            {data.events.length === 0 && <div className={s.muted}>هنوز رویدادی ثبت نشده.</div>}
          </div>
        </div>
      </div>

      {(adding || editing) && (
        <ServerDialog
          server={editing}
          existing={data.servers.length}
          onClose={() => { setAdding(false); setEditing(null); }}
          onDone={(msg) => { setAdding(false); setEditing(null); flash(msg); mutate(); }}
        />
      )}
      {confirm && (
        <Modal
          title={confirm.kind === "promote" ? "سوییچ دستی سرور اصلی" : "حذف سرور"}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className={s.btnGhost} onClick={() => setConfirm(null)}>انصراف</button>
              <button
                className={confirm.kind === "delete" ? s.btnDanger : s.btnPrimary}
                onClick={async () => {
                  const sv = confirm.server;
                  setConfirm(null);
                  if (confirm.kind === "promote") await act(() => api(`/api/settings/ha/servers/${sv.id}/promote`, { method: "POST" }), `${sv.name} اصلی شد`);
                  else await act(() => api(`/api/settings/ha/servers/${sv.id}`, { method: "DELETE" }), `سرور ${sv.name} حذف شد`);
                }}
              >
                {confirm.kind === "promote" ? "اصلی شود" : "حذف سرور"}
              </button>
            </>
          }
        >
          {confirm.kind === "promote" ? (
            <div className={s.note} data-tone="warn"><Icon d={I.alert} size={18} /><span><b>{confirm.server.name} سرور اصلی می‌شود.</b>سرور اصلی فعلی پشتیبان می‌شود. اگر ترافیک روی DNS/IP شناور جابه‌جا شود، اتصال‌های فعلی کاربران ممکن است چند ثانیه قطع شوند.</span></div>
          ) : (
            <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} /><span><b>سرور {confirm.server.name} از چرخه حذف می‌شود.</b>خود سرور و سرویس‌های روی آن تغییری نمی‌کنند، فقط پنل دیگر آن را بررسی نمی‌کند.</span></div>
          )}
        </Modal>
      )}
    </>
  );
}

function Spark({ data }: { data: (number | null)[] }) {
  const pts = data.map((v, i) => (v == null ? null : [i, v] as const)).filter(Boolean) as (readonly [number, number])[];
  if (pts.length < 2) return <span className={s.muted}>داده‌ای نیست</span>;
  const max = Math.max(...pts.map((p) => p[1])), min = Math.min(...pts.map((p) => p[1]));
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${((i / 23) * 120).toFixed(1)} ${(26 - ((v - min) / (max - min || 1)) * 22).toFixed(1)}`).join(" ");
  return (
    <svg width="120" height="30" viewBox="0 0 120 30" aria-hidden="true" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ServerCard({ sv, canEdit, onEdit, onPromote, onMaintenance, onDelete }: { sv: HAServerRow; canEdit: boolean; onEdit: () => void; onPromote: () => void; onMaintenance: () => void; onDelete: () => void }) {
  const [label, color] = STATUS[sv.status];
  const items = [
    { label: "ویرایش", icon: I.edit, onClick: onEdit },
    { label: "سوییچ به این سرور (اصلی شود)", icon: I.swap, onClick: onPromote, disabled: sv.role === "primary", tip: sv.role === "primary" ? "این سرور همین حالا اصلی است" : undefined },
    { label: sv.maintenance ? "برگرداندن به چرخه" : "خارج کردن از چرخه (تعمیرات)", icon: I.wrench, onClick: onMaintenance },
    { label: "حذف", icon: I.trash, onClick: onDelete, danger: true },
  ];
  return (
    <div className={`card ${s.srv}`} data-status={sv.status}>
      <div className={s.srvTop}>
        <span className={s.prio} title="اولویت">{toFa(sv.priority)}</span>
        <span className={`${s.srvName} mono`} dir="ltr">{sv.name}</span>
        <span className={s.badge} style={{ background: sv.role === "primary" ? "var(--accent-strong)" : "var(--subtle)", color: sv.role === "primary" ? "#fff" : "var(--text-2)" }}>{ROLE_LABEL[sv.role]}</span>
        {sv.serving && <span className={s.live}><i />ترافیک فعال</span>}
        <span className={s.spacer} />
        <Menu items={items} disabled={!canEdit} tip={RO_TIP} />
      </div>
      <div className={s.srvStatus}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color }}><span className="dot" style={{ background: color }} />{label}</span>
        <span style={{ color: "var(--faint)" }}>|</span>
        <span dir="ltr" className="mono">{sv.address}</span>
      </div>
      <div className={s.ports} dir="ltr">
        {sv.ports.map((p) => <span key={p.label} className={s.port} data-ok={String(p.ok)} title={p.tip}>{p.label}</span>)}
      </div>
      <div className={s.lat}>
        <span>تأخیر <b dir="ltr" className="mono">{sv.latency_ms != null ? `${sv.latency_ms} ms` : "—"}</b></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Spark data={sv.history} /><small>۲۴ ساعت گذشته</small></span>
      </div>
      {sv.key_state === "ok" && <div className={s.keyOk}><Icon d={I.key} size={15} />کلید عمومی: یکسان ✓</div>}
      {sv.key_state === "unknown" && <div className={s.keyUnknown}><Icon d={I.key} size={15} />کلید عمومی: نامشخص (agent کلید را گزارش نمی‌کند)</div>}
      {sv.key_state === "bad" && (
        <div className={s.note} data-tone="danger">
          <Icon d={I.alert} size={18} />
          <span><b>کلید عمومی با سرور اصلی یکی نیست</b>کلاینت‌ها نمی‌توانند به این سرور وصل شوند. فایل id_ed25519 سرور اصلی را روی این سرور کپی کنید.</span>
        </div>
      )}
      <div className={s.checkTime}>آخرین بررسی سلامت: {sv.last_check ? agoText(sv.last_check) : "هنوز انجام نشده"}</div>
    </div>
  );
}

function FailoverCard({ cfg, canEdit, onSaved }: { cfg: HAOverview["config"]; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(cfg);
  const flash = useToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg);
  const methods: { id: "dns" | "vip"; label: string; desc: string }[] = [
    { id: "dns", label: "تغییر رکورد DNS", desc: "مناسب سرورهای جدا از هم؛ جابه‌جایی چند ثانیه تا چند دقیقه (به TTL بستگی دارد)." },
    { id: "vip", label: "IP شناور (keepalived)", desc: "مناسب سرورهای هم‌شبکه؛ جابه‌جایی در حد چند ثانیه." },
  ];
  return (
    <div className={`card ${s.cardPad}`}>
      <div className={s.cardHead}>
        <div>
          <b>تنظیمات failover</b>
          <small>بررسی هر {toFa(cfg.interval)} ثانیه · بعد از {toFa(cfg.fails)} خطای پشت‌سرهم، سرور بعدی فعال می‌شود</small>
        </div>
      </div>
      <div className={s.field}>
        <span>روش جابه‌جایی</span>
        <div className={s.methodCards}>
          {methods.map((m) => (
            <button key={m.id} type="button" className={s.roleCard} aria-pressed={draft.method === m.id} disabled={!canEdit} onClick={() => setDraft({ ...draft, method: m.id })} title={canEdit ? undefined : RO_TIP}>
              <span className="radio" />
              <span><b>{m.label}</b><small>{m.desc}</small></span>
            </button>
          ))}
        </div>
      </div>
      <div className={s.row2}><span>فاصلهٔ بررسی سلامت</span><Stepper value={draft.interval} min={1} max={60} unit="ثانیه" disabled={!canEdit} onChange={(v) => setDraft({ ...draft, interval: v })} /></div>
      <div className={s.row2}><span>تعداد خطای پشت‌سرهم قبل از جابه‌جایی</span><Stepper value={draft.fails} min={1} max={10} unit="بار" disabled={!canEdit} onChange={(v) => setDraft({ ...draft, fails: v })} /></div>
      <div className={s.toggleRow}>
        <span><b>برگشت خودکار به سرور اصلی بعد از سالم شدن</b><small>وقتی سرور اصلی دوباره سالم شد، ترافیک به آن برمی‌گردد.</small></span>
        <Switch on={draft.failback} onChange={(v) => setDraft({ ...draft, failback: v })} disabled={!canEdit} label="برگشت خودکار" />
      </div>
      <div className={s.note} data-tone="info">
        <Icon d={I.info} size={18} />
        <span>پنل سلامت سرورها را می‌سنجد و «سرور فعال» را تعیین و ثبت می‌کند. جابه‌جایی واقعی ترافیک (تغییر DNS یا IP شناور) روی خود سرورها یا سرویس DNS انجام می‌شود.</span>
      </div>
      {dirty && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className={s.btnGhost} onClick={() => setDraft(cfg)}>انصراف</button>
          <button className={s.btnPrimary} onClick={async () => {
            try {
              await api("/api/settings/ha/config", { method: "PATCH", body: draft });
              flash("تنظیمات failover ذخیره شد");
              onSaved();
            } catch (e) {
              flash(errText(e));
            }
          }}>ذخیرهٔ تغییرات</button>
        </div>
      )}
    </div>
  );
}

function EventLine({ e }: { e: HAEventRow }) {
  return (
    <div className={s.ev}>
      <span className={s.evDot} style={{ background: EV_COLOR[e.kind] }} />
      <div>
        <b>{e.title}</b>
        <small>{jStamp(e.ts)} · <span dir="ltr">{e.by}</span></small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- دیالوگ افزودن/ویرایش سرور

interface CheckItem { id: string; label: string; critical: boolean; ok: boolean | null; detail: string; help: string }

function ServerDialog({ server, existing, onClose, onDone }: { server: HAServerRow | null; existing: number; onClose: () => void; onDone: (msg: string) => void }) {
  const editing = !!server;
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState({ name: server?.name ?? "", address: server?.address ?? "", id_port: String(server?.id_port ?? 21116), relay_port: String(server?.relay_port ?? 21117), priority: String(server?.priority ?? existing + 1) });
  const [role, setRole] = useState<"primary" | "backup">(existing === 0 ? "primary" : "backup");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: number; token: string; command: string } | null>(null);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [target, setTarget] = useState("");
  const flash = useToast();

  const close = async () => {
    // پیش‌نویس نیمه‌کاره پاک می‌شود
    if (draft) await api(`/api/settings/ha/servers/${draft.id}`, { method: "DELETE" }).catch(() => {});
    onClose();
  };

  const runChecks = async (id: number) => {
    setChecks(null);
    try {
      const r = await api<{ target: string; checks: CheckItem[] }>(`/api/settings/ha/servers/${id}/check`, { method: "POST" });
      setTarget(r.target);
      setChecks(r.checks);
    } catch (e) {
      flash(errText(e));
      setChecks([]);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErrs({});
    try {
      if (editing) {
        await api(`/api/settings/ha/servers/${server!.id}`, { method: "PATCH", body: f });
        onDone("تغییرات ذخیره شد");
        return;
      }
      const r = await api<{ server: { id: number }; token: string; command: string }>("/api/settings/ha/servers", { method: "POST", body: { ...f, role } });
      setDraft({ id: r.server.id, token: r.token, command: r.command });
      setStep(2);
      runChecks(r.server.id);
    } catch (e) {
      setErrs(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) flash(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const criticalOk = !!checks && checks.every((c) => !c.critical || c.ok === true || (c.id === "key" && c.ok === null));
  const fields: [keyof typeof f, string, string][] = [
    ["name", "نام سرور", "tehran-2"],
    ["address", "آدرس IP یا دامنه", "185.143.232.24"],
    ["id_port", "پورت ID", "21116"],
    ["relay_port", "پورت رله", "21117"],
    ["priority", "اولویت", "2"],
  ];
  return (
    <Modal
      title={editing ? `ویرایش سرور — ${server!.name}` : "افزودن سرور HA"}
      onClose={close}
      busy={busy}
      width={640}
      footer={
        step === 1 ? (
          <>
            <button className={s.btnGhost} onClick={close} disabled={busy}>انصراف</button>
            <button className={`${s.btnPrimary} primary`} onClick={submit} disabled={busy}>{editing ? "ذخیره" : busy ? "در حال ایجاد…" : "بعدی: تست اتصال"}</button>
          </>
        ) : (
          <>
            <button className={s.btnGhost} onClick={async () => { if (draft) await api(`/api/settings/ha/servers/${draft.id}`, { method: "DELETE" }).catch(() => {}); setDraft(null); setChecks(null); setStep(1); }}>بازگشت</button>
            <span className={s.spacer} />
            <button className={s.btnPrimary} disabled={!criticalOk || busy} onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/settings/ha/servers/${draft!.id}/confirm`, { method: "POST" });
                onDone(`سرور ${f.name} اضافه شد`);
              } catch (e) {
                flash(errText(e));
                setBusy(false);
              }
            }}>افزودن</button>
          </>
        )
      }
    >
      {!editing && (
        <div className={s.steps} style={{ margin: "-20px -20px 0", }}>
          <div className={s.step} data-on={step === 1}><i>۱</i>مشخصات</div>
          <div className={s.step} data-on={step === 2}><i>۲</i>تست اتصال</div>
        </div>
      )}
      {step === 1 && (
        <>
          <div className={s.grid2}>
            {fields.map(([k, label, ph]) => (
              <label key={k} className={s.field}>
                <span>{label}</span>
                <input className={s.input} dir="ltr" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} />
                {errs[k] && <span className={s.err}>{errs[k]}</span>}
              </label>
            ))}
            {!editing && (
              <div className={s.field}>
                <span>نقش</span>
                <div className="seg">
                  {(["backup", "primary"] as const).map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>)}
                </div>
                {errs.role && <span className={s.err}>{errs.role}</span>}
              </div>
            )}
          </div>
          {!editing && <div className={s.note} data-tone="info"><Icon d={I.info} size={18} />با «بعدی» یک توکن agent ساخته می‌شود تا بتوانید منابع و کلید این سرور را هم از پنل ببینید.</div>}
        </>
      )}
      {step === 2 && draft && (
        <>
          <div className={s.field}>
            <span>نصب agent روی سرور جدید <small>(اختیاری، برای آمار منابع و سنجش کلید)</small></span>
            <div className={s.cmd}>
              <code>{draft.command}</code>
              <button className={s.btnGhost} onClick={async () => (await copyText(draft.command)) && flash("دستور کپی شد")}>کپی</button>
            </div>
            <small className={s.muted}>مسیر <span dir="ltr" className="mono">/path/to/hbbs-data</span> را با پوشهٔ دادهٔ hbbs روی آن سرور عوض کنید.</small>
          </div>
          <div className={s.muted}>بررسی اتصال به <span dir="ltr" className="mono">{target}</span></div>
          {!checks && <div className={s.chk} data-st="run"><div><span className={s.mark}><span className={s.spin} /></span>در حال بررسی…</div></div>}
          {checks?.map((c) => {
            const st = c.ok === true ? "ok" : c.ok === false ? (c.critical ? "fail" : "warn") : "warn";
            return (
              <div key={c.id} className={s.chk} data-st={st}>
                <div>
                  <span className={s.mark}>{st === "ok" ? "✓" : st === "fail" ? "✗" : "!"}</span>
                  <span>{c.label}{!c.critical && <small style={{ color: "var(--faint)" }}> · اختیاری</small>}</span>
                  <span className={s.detail}>{c.detail}</span>
                </div>
                {c.help && st !== "ok" && (
                  <div className={s.help}><span>{c.help}</span>{c.id !== "key" && <button className={s.btnGhost} style={{ height: 30 }} onClick={() => runChecks(draft.id)}>بررسی دوباره</button>}</div>
                )}
              </div>
            );
          })}
          {checks && !criticalOk && <div className={s.note} data-tone="danger"><Icon d={I.alert} size={18} />تا وقتی بررسی‌های حیاتی (شبکه، پورت‌ها و کلید) موفق نشوند نمی‌توان سرور را اضافه کرد.</div>}
          {checks && criticalOk && <div className={s.note} data-tone="ok"><Icon d={I.check} size={18} />همهٔ بررسی‌های حیاتی موفق بود؛ می‌توانید سرور را اضافه کنید.</div>}
        </>
      )}
    </Modal>
  );
}
