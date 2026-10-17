"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";

import { Icon } from "@/components/Icon";
import { INBOX_KEY, NoticeBody } from "@/components/shell/Notices";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { agoText, jStamp, RO_TIP, type UserRow } from "@/lib/settings";
import { useToast } from "@/lib/toast";
import type { NoticeKind, SentNotice } from "@/lib/types";

import s from "./settings.module.css";
import { Empty, ErrorState, errText, fieldErrors, I, Menu, Modal, Skeleton, Switch } from "./ui";

const KINDS: [NoticeKind, string][] = [
  ["info", "اطلاعیه"],
  ["warning", "هشدار"],
  ["update", "به‌روزرسانی"],
];
const KIND_LABEL: Record<NoticeKind, string> = { info: "اطلاعیه", warning: "هشدار", update: "به‌روزرسانی پنل" };
const KIND_TONE: Record<NoticeKind, [string, string]> = {
  info: ["var(--info-soft)", "var(--info)"],
  warning: ["var(--warn-soft)", "var(--warn-text)"],
  update: ["var(--accent-soft)", "var(--accent)"],
};
const EXPIRY: [string, string][] = [
  ["", "بدون پایان"],
  ["1", "۱ روز"],
  ["7", "۷ روز"],
  ["30", "۳۰ روز"],
];
const BELL = "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0";

/** تنظیمات ← اعلان‌ها: فرستادن پیام به کاربران پنل و دیدن اینکه چند نفر خوانده‌اند. */
export function NoticesTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useSWR<SentNotice[]>("/api/settings/notices", fetcher, { refreshInterval: 30000 });
  const flash = useToast();
  const [composing, setComposing] = useState(false);
  const [del, setDel] = useState<SentNotice | null>(null);
  const [view, setView] = useState<SentNotice | null>(null);

  if (error) return <ErrorState onRetry={() => mutate()} />;
  if (!data) return <Skeleton rows={3} />;

  return (
    <>
      <div className="card" style={{ overflow: "visible" }}>
        <div className={s.toolbar}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b style={{ fontSize: 15 }}>اعلان‌های فرستاده‌شده</b>
            <small className={s.sub}>پیام به همهٔ کاربران پنل یا چند نفر خاص؛ اعلان «پنل به‌روز شد» بعد از هر به‌روزرسانی خودکار ساخته می‌شود.</small>
          </div>
          <span className={s.spacer} />
          <button className={s.btnPrimary} onClick={() => setComposing(true)} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>
            <Icon d={I.plus} size={16} /> اعلان تازه
          </button>
        </div>
        {data.length === 0 && (
          <Empty
            icon={BELL}
            title="هنوز اعلانی فرستاده نشده"
            text="برای خبر دادن تغییرات، زمان تعمیرات یا هر پیامی به همکاران، اعلان بفرستید. در ورود بعدی‌شان به‌صورت پنجره دیده می‌شود."
          />
        )}
        {data.map((n) => (
          <div key={n.id} className={s.noticeRow} data-off={n.expired}>
            <span className={s.noticeIcon} style={{ background: KIND_TONE[n.kind][0], color: KIND_TONE[n.kind][1] }}>
              <Icon d={n.kind === "warning" ? I.alert : n.kind === "update" ? I.box : I.info} size={17} />
            </span>
            <button className={s.noticeMain} onClick={() => setView(n)}>
              <span className={s.name}>
                <span>{n.title}</span>
                {n.version && <span className={s.badge} style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>خودکار</span>}
                {n.popup && <span className={s.badge} style={{ background: "var(--subtle)", color: "var(--muted)" }}>پنجره در ورود</span>}
                {n.expired && <span className={s.badge} style={{ background: "var(--subtle)", color: "var(--faint)" }}>پایان‌یافته</span>}
              </span>
              <span className={s.sub}>
                {KIND_LABEL[n.kind]} · {n.by || "سیستم"} · {agoText(n.created_at)} · {n.recipient_names.length ? `برای ${n.recipient_names.join("، ")}` : "برای همه"}
              </span>
            </button>
            <div className={s.readMeter} title={`${toFa(n.reads)} نفر از ${toFa(n.audience)} نفر دیده‌اند`}>
              <span>{toFa(Math.min(n.reads, n.audience))} / {toFa(n.audience)}</span>
              <i>
                <b style={{ width: `${n.audience ? Math.min(100, (n.reads / n.audience) * 100) : 0}%` }} />
              </i>
            </div>
            <Menu items={[{ label: "مشاهده", icon: I.eye, onClick: () => setView(n) }, { label: "حذف", icon: I.trash, onClick: () => setDel(n), danger: true }]} disabled={!canEdit} tip={RO_TIP} />
          </div>
        ))}
      </div>

      {composing && (
        <Compose
          onClose={() => setComposing(false)}
          onSent={(title) => {
            setComposing(false);
            flash(`اعلان «${title}» فرستاده شد`);
            void mutate();
            void globalMutate(INBOX_KEY);
          }}
        />
      )}

      {view && (
        <Modal title={view.title} onClose={() => setView(null)} width={560}>
          <div className={s.sub}>
            {KIND_LABEL[view.kind]} · {view.by || "سیستم"} · {agoText(view.created_at)}
          </div>
          <NoticeBody n={{ ...view, read: true }} />
          <div className={s.kv}>
            <div><span>گیرندگان</span><span>{view.recipient_names.length ? view.recipient_names.join("، ") : "همهٔ کاربران پنل"}</span></div>
            <div><span>دیده‌اند</span><span>{toFa(Math.min(view.reads, view.audience))} از {toFa(view.audience)} نفر</span></div>
            <div><span>پایان نمایش</span><span>{view.expires_at ? jStamp(view.expires_at) : "ندارد"}</span></div>
          </div>
        </Modal>
      )}

      {del && (
        <Modal
          title="حذف اعلان"
          onClose={() => setDel(null)}
          footer={
            <>
              <button className={s.btnGhost} onClick={() => setDel(null)}>انصراف</button>
              <button
                className={s.btnDanger}
                onClick={async () => {
                  try {
                    await api(`/api/settings/notices/${del.id}`, { method: "DELETE" });
                    flash("اعلان حذف شد");
                    setDel(null);
                    void mutate();
                    void globalMutate(INBOX_KEY);
                  } catch (e) {
                    flash(errText(e));
                  }
                }}
              >
                حذف اعلان
              </button>
            </>
          }
        >
          <div className={s.note} data-tone="danger">
            <Icon d={I.alert} size={18} />
            <span>
              <b>«{del.title}» از منوی اعلان همهٔ کاربران برداشته می‌شود.</b>
              {del.version ? "این اعلان خودکار نسخهٔ پنل است و دوباره ساخته نمی‌شود." : "این کار قابل بازگشت نیست."}
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (title: string) => void }) {
  const { data: users } = useSWR<UserRow[]>("/api/settings/users", fetcher);
  const flash = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<NoticeKind>("info");
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [popup, setPopup] = useState(true);
  const [expires, setExpires] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const others = (users ?? []).filter((u) => u.active && !u.me);

  const send = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "عنوان را وارد کنید.";
    if (!everyone && picked.length === 0) e.recipients = "حداقل یک گیرنده انتخاب کنید.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api("/api/settings/notices", { method: "POST", body: { title: title.trim(), body: body.trim(), kind, popup, expires_days: expires, recipients: everyone ? [] : picked } });
      onSent(title.trim());
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length && !fe.detail) setErrs(fe);
      else flash(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="اعلان تازه"
      onClose={onClose}
      busy={busy}
      width={600}
      footer={
        <>
          <button className={s.btnGhost} onClick={onClose} disabled={busy}>انصراف</button>
          <button className={`${s.btnPrimary} primary`} onClick={send} disabled={busy}>
            <Icon d={BELL} size={16} /> {busy ? "در حال فرستادن…" : "فرستادن"}
          </button>
        </>
      }
    >
      <label className={s.field}>
        <span>عنوان</span>
        <input className={s.input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="مثلاً: سرور امشب ساعت ۲۳ برای تعمیرات قطع است" />
        {errs.title && <span className={s.err}>{errs.title}</span>}
      </label>
      <label className={s.field}>
        <span>متن <small>(اختیاری)</small></span>
        <textarea className={`${s.input} ${s.textarea}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={4} />
        {errs.body && <span className={s.err}>{errs.body}</span>}
      </label>
      <div className={s.grid2}>
        <div className={s.field}>
          <span>نوع</span>
          <div className="seg">
            {KINDS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
            ))}
          </div>
        </div>
        <label className={s.field}>
          <span>مدت نمایش</span>
          <select className={s.select} value={expires} onChange={(e) => setExpires(e.target.value)}>
            {EXPIRY.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className={s.toggleRow}>
        <span>
          <b>نمایش به‌صورت پنجره</b>
          <small>در ورود بعدی هر گیرنده، اعلان وسط صفحه باز می‌شود تا «متوجه شدم» را بزند. خاموش: فقط در منوی زنگوله.</small>
        </span>
        <Switch on={popup} onChange={setPopup} label="نمایش به‌صورت پنجره" />
      </div>
      <div className={s.field}>
        <span>گیرندگان</span>
        <div className="seg">
          <button type="button" aria-pressed={everyone} onClick={() => setEveryone(true)}>همهٔ کاربران پنل</button>
          <button type="button" aria-pressed={!everyone} onClick={() => setEveryone(false)}>انتخاب کاربران</button>
        </div>
        {!everyone && (
          <div className={s.pickList}>
            {!users && <span className={s.sub}>در حال خواندن…</span>}
            {users && others.length === 0 && <span className={s.sub}>کاربر فعال دیگری نیست.</span>}
            {others.map((u) => (
              <label key={u.id} className={s.pick}>
                <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />
                <span>{u.display_name}</span>
                <small dir="ltr">{u.username}</small>
              </label>
            ))}
          </div>
        )}
        {errs.recipients && <span className={s.err}>{errs.recipients}</span>}
      </div>
    </Modal>
  );
}
