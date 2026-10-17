"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { contactErrors, normalizePhone, phoneText } from "@/lib/contact";
import { avatarOf, initialOf } from "@/lib/people";
import { agoText, downloadTextFile, jDate, LEVELS, loginFileText, PRESET, randomPassword, RO_TIP, ROLE_CARDS, ROLE_TONE, SECTION_HINT, SECTION_LEVELS, SECTIONS, copyText, type UserRow } from "@/lib/settings";
import { useToast } from "@/lib/toast";
import type { Level, Perms } from "@/lib/types";

import { StrengthMeter } from "./PasswordTools";
import s from "./settings.module.css";
import { Empty, ErrorState, errText, fieldErrors, I, Menu, Modal, Skeleton, Switch } from "./ui";

type Role = "admin" | "viewer" | "custom";
const FILTERS: [string, string][] = [["all", "همه"], ["owner", "مالک"], ["admin", "مدیر"], ["viewer", "ناظر"], ["custom", "سفارشی"], ["nocontact", "بدون اطلاعات تماس"]];

export function UsersTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useSWR<UserRow[]>("/api/settings/users", fetcher, { refreshInterval: 30000 });
  const flash = useToast();
  // از جستجوی کلی با ?q=نام‌کاربری می‌آید
  const urlQ = useSearchParams().get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }
  const [filter, setFilter] = useState("all");
  const [dlg, setDlg] = useState<{ mode: "create" | "edit" | "password"; user?: UserRow } | null>(null);
  const [del, setDel] = useState<UserRow | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hay = (u: UserRow) => `${u.display_name} ${u.username} ${u.email} ${u.phone}`.toLowerCase();
    return (data ?? []).filter((u) => (filter === "all" || (filter === "nocontact" ? u.needs_contact : u.role === filter)) && (!t || hay(u).includes(t)));
  }, [data, q, filter]);

  if (error) return <ErrorState onRetry={() => mutate()} />;
  if (!data) return <Skeleton />;
  const onlyOwner = data.length <= 1;

  const toggleActive = async (u: UserRow) => {
    try {
      await api(`/api/settings/users/${u.id}`, { method: "PATCH", body: { active: !u.active } });
      flash(u.active ? `حساب ${u.display_name} غیرفعال شد` : `حساب ${u.display_name} فعال شد`);
      mutate();
    } catch (e) {
      flash(errText(e));
    }
  };

  return (
    <>
      <div className="card" style={{ overflow: "visible" }}>
        <div className={s.toolbar}>
          <label className={s.search}>
            <Icon d={I.search} size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، نام کاربری، ایمیل یا موبایل…" aria-label="جست‌وجوی کاربر" />
          </label>
          <div className="seg">
            {FILTERS.map(([id, label]) => (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className={s.spacer} />
          <button className={s.btnPrimary} onClick={() => setDlg({ mode: "create" })} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>
            <Icon d={I.plus} size={16} /> افزودن کاربر
          </button>
        </div>
        <div className={s.th}>
          <span>کاربر</span>
          <span>نقش</span>
          <span>وضعیت</span>
          <span>آخرین ورود</span>
          <span>تاریخ ایجاد</span>
          <span />
        </div>
        {rows.map((u) => (
          <UserLine key={u.id} u={u} canEdit={canEdit} onEdit={() => setDlg({ mode: "edit", user: u })} onPassword={() => setDlg({ mode: "password", user: u })} onToggle={() => toggleActive(u)} onDelete={() => setDel(u)} />
        ))}
        {data.length > 0 && rows.length === 0 && <div className="empty">کاربری با این مشخصات پیدا نشد.</div>}
        {onlyOwner && (
          <Empty
            icon={I.users}
            title="هنوز عضو دیگری به تیم مدیریت اضافه نشده"
            text="برای همکاران حساب جداگانه بسازید و با نقش‌ها مشخص کنید هر کس به کدام بخش پنل دسترسی دارد."
            action={
              <button className={s.btnPrimary} onClick={() => setDlg({ mode: "create" })} disabled={!canEdit} title={canEdit ? undefined : RO_TIP}>
                + افزودن اولین کاربر
              </button>
            }
          />
        )}
      </div>

      {dlg && <UserDialog mode={dlg.mode} user={dlg.user} onClose={() => setDlg(null)} onSaved={(msg) => { setDlg(null); flash(msg); mutate(); }} />}
      {del && (
        <Modal
          title="حذف کاربر"
          onClose={() => setDel(null)}
          footer={
            <>
              <button className={s.btnGhost} onClick={() => setDel(null)}>انصراف</button>
              <button
                className={s.btnDanger}
                onClick={async () => {
                  try {
                    await api(`/api/settings/users/${del.id}`, { method: "DELETE" });
                    flash(`کاربر ${del.display_name} حذف شد`);
                    setDel(null);
                    mutate();
                  } catch (e) {
                    flash(errText(e));
                  }
                }}
              >
                حذف کاربر
              </button>
            </>
          }
        >
          <div className={s.note} data-tone="danger">
            <Icon d={I.alert} size={18} />
            <span>
              <b>حساب «{del.display_name}» برای همیشه حذف می‌شود.</b>
              این کار قابل بازگشت نیست. اگر فقط می‌خواهید دسترسی را ببندید، به‌جای حذف حساب را غیرفعال کنید.
            </span>
          </div>
          <div className={s.kv}>
            <div><span>نام کاربری</span><span dir="ltr" className="mono">{del.username}</span></div>
            <div><span>نقش</span><span>{del.role_label}</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function UserLine({ u, canEdit, onEdit, onPassword, onToggle, onDelete }: { u: UserRow; canEdit: boolean; onEdit: () => void; onPassword: () => void; onToggle: () => void; onDelete: () => void }) {
  const [bg, color] = avatarOf(String(u.id));
  const tone = ROLE_TONE[u.role];
  const items = [
    { label: "ویرایش", icon: I.edit, onClick: onEdit },
    { label: "تغییر رمز", icon: I.key, onClick: onPassword },
    ...(u.locked ? [] : [
      { label: u.active ? "غیرفعال‌کردن" : "فعال‌کردن", icon: I.power, onClick: onToggle, disabled: u.me, tip: u.me ? "حساب خودتان را نمی‌توانید غیرفعال کنید" : undefined },
      { label: "حذف", icon: I.trash, onClick: onDelete, danger: true, disabled: u.me, tip: u.me ? "حساب خودتان را نمی‌توانید حذف کنید" : undefined },
    ]),
  ];
  return (
    <div className={s.row} data-off={!u.active}>
      <div className={s.who}>
        <div className={s.avatar} style={{ background: bg, color }}>{initialOf(u.display_name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className={s.name}>
            <span>{u.display_name}</span>
            {u.locked && <span title="حساب مالک قفل است: حذف و تغییر نقش ندارد" style={{ color: "var(--faint)", display: "inline-flex" }}><Icon d={I.lock} size={14} /></span>}
            {u.me && <span className={`${s.badge} ${s.me}`}>شما</span>}
            {u.must_change_password && <span className={s.badge} style={{ background: "var(--warn-soft)", color: "var(--warn-text)" }} title="هنوز رمز خودش را نگذاشته؛ در اولین ورود باید بگذارد">رمز موقت</span>}
            {u.needs_contact && <span className={s.badge} style={{ background: "var(--info-soft)", color: "var(--info-text)" }} title="موبایل یا ایمیل ندارد؛ در ورود بعدی باید وارد کند">بدون اطلاعات تماس</span>}
          </div>
          <span className={s.sub} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span dir="ltr" className="mono">{u.username}</span>
            {u.phone && <> · <span dir="ltr">{phoneText(u.phone)}</span></>}
            {u.email && <> · <span dir="ltr">{u.email}</span></>}
          </span>
        </div>
      </div>
      <div><span className={s.badge} style={{ background: tone.bg, color: tone.color }}>{u.role_label}</span></div>
      <div className={s.status}>
        <span className="dot" style={{ background: u.active ? "var(--ok)" : "var(--off)" }} />
        {u.active ? "فعال" : "غیرفعال"}
      </div>
      <div className={s.muted}><span className={s.cellLabel}>آخرین ورود: </span>{u.last_login ? agoText(u.last_login) : "هنوز وارد نشده"}</div>
      <div className={s.muted}><span className={s.cellLabel}>ایجاد: </span>{jDate(u.created)}</div>
      <div style={{ textAlign: "end" }}>
        <Menu items={items} disabled={!canEdit} tip={RO_TIP} />
      </div>
    </div>
  );
}

function UserDialog({ mode, user, onClose, onSaved }: { mode: "create" | "edit" | "password"; user?: UserRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const { user: me } = useAuth();
  const creating = mode === "create";
  const owner = user?.role === "owner";
  const [name, setName] = useState(user?.display_name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [active, setActive] = useState(user?.active ?? true);
  const [role, setRole] = useState<Role>(owner ? "admin" : ((user?.role as Role) ?? "viewer"));
  const [perms, setPerms] = useState<Perms>(user?.role === "custom" && user.perms ? user.perms : { ...PRESET.viewer });
  // مدیر/ناظر: دیدن لاگ فعالیت‌ها را مالک جداگانه می‌دهد (روی نقش «سفارشی» از ماتریس تنظیم می‌شود)
  const [seeLog, setSeeLog] = useState(user?.role !== "custom" && user?.perms?.activity === "view");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const flash = useToast();
  const showPw = creating || mode === "password";
  // فایل «اطلاعات ورود»: برای حساب تازه یا وقتی مالک برای کس دیگری رمز می‌گذارد (نه رمز خودش)
  const loginFile = showPw && !user?.me;
  const { data: access } = useSWR<{ entry_key: string }>(loginFile ? "/api/settings/users/access" : null, fetcher);
  const [urlEdit, setUrlEdit] = useState<string | null>(null);
  const loginUrl = urlEdit ?? (access ? `${window.location.origin}${access.entry_key ? `/${access.entry_key}` : ""}` : "");
  const showIdentity = mode !== "password";
  const showRoles = mode !== "password" && !owner;
  const showMatrix = showRoles;
  const effective: Perms = role === "custom" ? perms : { ...PRESET[role], activity: seeLog ? "view" : "none" };
  const extraPerms = role === "custom" ? perms : { activity: seeLog ? "view" : "none" };
  // مدیر غیرمالک نمی‌تواند بیش از دسترسی خودش بدهد
  const myRank = (sec: string) => (me.role === "owner" ? 2 : LEVELS.findIndex(([l]) => l === (me.perms[sec] ?? "none")));

  const submit = async (withFile = false) => {
    const e: Record<string, string> = {};
    if (showIdentity && !name.trim()) e.display_name = "نام نمایشی را وارد کنید.";
    if (creating && !/^[\w.@+-]+$/.test(username)) e.username = "نام کاربری فقط شامل حروف انگلیسی، عدد و @/./+/-/_ باشد.";
    if (showIdentity) Object.assign(e, contactErrors(email, phone, false));
    if (showPw) {
      if (!pw) e.password = "رمز عبور را وارد کنید.";
      else if (pw.length < 8) e.password = "رمز عبور باید حداقل ۸ نویسه باشد.";
      if (pw !== pw2) e.password2 = "تکرار رمز با رمز بالا یکسان نیست.";
    }
    setErrs(e);
    if (withFile && !loginUrl.trim()) e.url = "آدرس پنل را وارد کنید.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const who = creating ? { username, name: name.trim() } : { username: user?.username ?? "", name: user?.display_name ?? "" };
    const saveFile = () =>
      withFile &&
      downloadTextFile(
        `asandesk-login-${who.username}.txt`,
        loginFileText({ url: loginUrl.trim(), username: who.username, password: pw, name: who.name, hasKey: !!access?.entry_key && loginUrl.includes(access.entry_key) }),
      );
    try {
      if (creating) {
        await api("/api/settings/users", { method: "POST", body: { display_name: name.trim(), username, password: pw, role, perms: extraPerms, active, email: email.trim(), phone: normalizePhone(phone) } });
        saveFile();
        onSaved(`کاربر ${name.trim()} اضافه شد${withFile ? "؛ فایل ورود دانلود شد" : ""}`);
      } else if (mode === "password") {
        await api(`/api/settings/users/${user!.id}`, { method: "PATCH", body: { password: pw } });
        saveFile();
        onSaved(`رمز عبور تغییر کرد${withFile ? "؛ فایل ورود دانلود شد" : ""}`);
      } else {
        const body: Record<string, unknown> = { display_name: name.trim(), email: email.trim(), phone: normalizePhone(phone) };
        if (!owner) Object.assign(body, { role, active, perms: extraPerms });
        await api(`/api/settings/users/${user!.id}`, { method: "PATCH", body });
        onSaved("تغییرات ذخیره شد");
      }
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length && !fe.detail) setErrs({ display_name: fe.display_name, username: fe.username, password: fe.password, role: fe.role, email: fe.email, phone: fe.phone });
      else flash(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const title = creating ? "افزودن کاربر" : mode === "password" ? `تغییر رمز — ${user!.display_name}` : `ویرایش — ${user!.display_name}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      width={620}
      footer={
        <>
          <button className={s.btnGhost} onClick={onClose} disabled={busy}>انصراف</button>
          {loginFile && (
            <button className={s.btnGhost} onClick={() => submit(true)} disabled={busy || !access} title="کاربر را می‌سازد و یک فایل متنی با آدرس پنل، نام کاربری و رمز موقت می‌دهد تا برایش بفرستید">
              <Icon d={I.download} size={16} /> ذخیره و دانلود فایل ورود
            </button>
          )}
          <button className={`${s.btnPrimary} primary`} onClick={() => submit(false)} disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</button>
        </>
      }
    >
      {showIdentity && (
        <div className={s.grid2}>
          <label className={s.field}>
            <span>نام نمایشی</span>
            <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً سارا احمدی" />
            {errs.display_name && <span className={s.err}>{errs.display_name}</span>}
          </label>
          <label className={s.field}>
            <span>نام کاربری <small>(لاتین)</small></span>
            <input className={s.input} dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!creating} placeholder="sara.ahmadi" autoComplete="off" />
            {errs.username && <span className={s.err}>{errs.username}</span>}
          </label>
          <label className={s.field}>
            <span>موبایل <small>(اختیاری)</small></span>
            <input className={s.input} dir="ltr" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone.trim() && setPhone(normalizePhone(phone))} placeholder="0912 345 6789" autoComplete="off" />
            {errs.phone && <span className={s.err}>{errs.phone}</span>}
          </label>
          <label className={s.field}>
            <span>ایمیل <small>(اختیاری)</small></span>
            <input className={s.input} dir="ltr" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sara@example.com" autoComplete="off" />
            {errs.email && <span className={s.err}>{errs.email}</span>}
          </label>
          {(!phone.trim() || !email.trim()) && (
            <small className={s.gridNote}>اگر موبایل یا ایمیل خالی بماند، کاربر در ورود بعدی‌اش باید وارد کند.</small>
          )}
        </div>
      )}
      {showPw && (
        <>
          <div className={s.field}>
            <span>{creating ? "رمز عبور" : "رمز عبور جدید"}</span>
            <div className={s.pwRow}>
              <input className={s.input} dir="ltr" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              <button type="button" className={s.btnGhost} style={{ padding: "0 10px" }} onClick={() => setShow(!show)} title="نمایش رمز" aria-label="نمایش رمز"><Icon d={I.eye} size={16} /></button>
              <button type="button" className={s.btnGhost} style={{ padding: "0 10px" }} onClick={async () => flash((await copyText(pw)) ? "رمز کپی شد" : "کپی نشد؛ رمز را با دست انتخاب و کپی کنید")} title="کپی رمز" aria-label="کپی رمز" disabled={!pw}><Icon d={I.copy} size={16} /></button>
            </div>
            <StrengthMeter pw={pw} />
            <button type="button" className={s.linkBtn} onClick={() => { const p = randomPassword(); setPw(p); setPw2(p); setShow(true); }}>
              <Icon d={I.refresh} size={14} /> ساخت رمز تصادفی
            </button>
            {errs.password && <span className={s.err}>{errs.password}</span>}
          </div>
          <label className={s.field}>
            <span>تکرار رمز عبور</span>
            <input className={s.input} dir="ltr" type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            {errs.password2 && <span className={s.err}>{errs.password2}</span>}
            {!errs.password2 && pw2 && pw === pw2 && <span className={s.ok}>✓ رمزها یکسان‌اند</span>}
          </label>
          {loginFile && (
            <>
              <div className={s.note} data-tone="info">
                <Icon d={I.info} size={18} />
                <span>
                  <b>این رمز موقت است</b>
                  کاربر در اولین ورود باید رمز خودش را بگذارد و بعد کدهای بازیابی‌اش را می‌بیند و می‌تواند دانلود کند. با «ذخیره و دانلود فایل ورود» یک فایل متنی با آدرس پنل، نام کاربری و همین رمز می‌گیرید تا برایش بفرستید.
                </span>
              </div>
              <label className={s.field}>
                <span>آدرس پنل در فایل <small>(آدرسی که کاربر باید باز کند)</small></span>
                <input className={s.input} dir="ltr" value={loginUrl} onChange={(e) => setUrlEdit(e.target.value)} placeholder={access ? "https://panel.example.com" : "در حال خواندن…"} />
                {errs.url && <span className={s.err}>{errs.url}</span>}
              </label>
            </>
          )}
        </>
      )}
      {mode !== "password" && !owner && (
        <div className={s.toggleRow}>
          <span><b>حساب فعال باشد</b><small>کاربر غیرفعال نمی‌تواند وارد پنل شود.</small></span>
          <Switch on={active} onChange={setActive} label="فعال بودن حساب" disabled={user?.me} title={user?.me ? "حساب خودتان را نمی‌توانید غیرفعال کنید" : undefined} />
        </div>
      )}
      {showRoles && (
        <div className={s.field}>
          <span>نقش</span>
          <div className={s.roleCards}>
            {ROLE_CARDS.map((r) => (
              <button key={r.id} type="button" className={s.roleCard} aria-pressed={role === r.id} onClick={() => setRole(r.id)} disabled={user?.me}>
                <span className="radio" />
                <span><b>{r.label}</b><small>{r.desc}</small></span>
              </button>
            ))}
          </div>
          {errs.role && <span className={s.err}>{errs.role}</span>}
        </div>
      )}
      {showRoles && role !== "custom" && (
        <div className={s.toggleRow}>
          <span>
            <b>دیدن لاگ فعالیت‌ها</b>
            <small>با روشن بودن، این کاربر در تنظیمات ← لاگ فعالیت‌ها می‌بیند هر کس در پنل چه کاری کرده و می‌تواند روی یک نفر فیلتر کند.</small>
          </span>
          <Switch on={seeLog} onChange={setSeeLog} label="دیدن لاگ فعالیت‌ها" disabled={myRank("activity") < 1} title={myRank("activity") < 1 ? "شما خودتان به لاگ فعالیت‌ها دسترسی ندارید" : undefined} />
        </div>
      )}
      {owner && mode === "edit" && (
        <div className={s.note} data-tone="info"><Icon d={I.lock} size={18} />نقش «مالک» قفل است و همهٔ دسترسی‌ها را دارد.</div>
      )}
      {showMatrix && (
        <div className={s.matrix}>
          <div className={s.matrixHead}>
            <span>ماتریس دسترسی</span>
            {role !== "custom" && <small><Icon d={I.lock} size={13} />با نقش «{role === "admin" ? "مدیر" : "ناظر"}» ثابت است؛ برای تغییر «سفارشی» را انتخاب کنید</small>}
          </div>
          {SECTIONS.map(([key, label]) => (
            <div key={key} className={s.mRow}>
              <span className={s.mLabel}>
                {label}
                {SECTION_HINT[key] && <small>{SECTION_HINT[key]}</small>}
              </span>
              <div className={s.tri} data-locked={role !== "custom"}>
                {LEVELS.map(([lv, lvLabel], i) => (SECTION_LEVELS[key] && !SECTION_LEVELS[key].includes(lv) ? null : (
                  <button
                    key={lv}
                    type="button"
                    data-lv={lv}
                    aria-pressed={effective[key] === lv}
                    disabled={role !== "custom" || i > myRank(key)}
                    title={i > myRank(key) ? "بیشتر از دسترسی خودتان نمی‌توانید بدهید" : undefined}
                    onClick={() => setPerms({ ...perms, [key]: lv as Level })}
                  >
                    {lvLabel}
                  </button>
                )))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
