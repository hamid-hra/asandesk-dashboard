"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";

import { Icon } from "@/components/Icon";
import { RECOVERY_KEY, RecoveryDialog } from "@/components/shell/RecoveryDialog";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { contactErrors, normalizePhone } from "@/lib/contact";
import { toFa } from "@/lib/fa";
import type { RecoveryStatus, User } from "@/lib/types";
import { useToast } from "@/lib/toast";

import { PasswordPair } from "./PasswordTools";
import s from "./settings.module.css";
import { errText, fieldErrors, I } from "./ui";

/** موبایل و ایمیل خود کاربر (هر دو لازم‌اند؛ سرور قالب و تکراری‌نبودن را بررسی می‌کند) */
function ContactCard() {
  const { user } = useAuth();
  const flash = useToast();
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [errs, setErrs] = useState<{ email?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);
  const dirty = email.trim() !== (user.email ?? "") || normalizePhone(phone) !== (user.phone ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = contactErrors(email, phone, true);
    setErrs(next);
    if (next.email || next.phone) return;
    setBusy(true);
    try {
      const me = await api<User>("/api/auth/profile", { method: "PATCH", body: { email: email.trim(), phone: normalizePhone(phone) } });
      await globalMutate("/api/auth/me", me, { revalidate: false });
      setPhone(me.phone);
      setEmail(me.email);
      flash("اطلاعات تماس ذخیره شد");
    } catch (err) {
      const fe = fieldErrors(err);
      if (fe.email || fe.phone) setErrs({ email: fe.email, phone: fe.phone });
      else flash(errText(err, "ذخیره نشد."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`card ${s.cardPad}`} onSubmit={save} method="post" noValidate>
      <div className={s.cardHead}>
        <div>
          <b>اطلاعات تماس</b>
          <small>شمارهٔ موبایل و ایمیل شما برای پیگیری و اطلاع‌رسانی؛ هر دو لازم‌اند.</small>
        </div>
      </div>
      <div className={s.grid2}>
        <label className={s.field}>
          <span>شمارهٔ موبایل</span>
          <input className={s.input} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone.trim() && setPhone(normalizePhone(phone))} placeholder="0912 345 6789" />
          {errs.phone && <span className={s.err}>{errs.phone}</span>}
        </label>
        <label className={s.field}>
          <span>ایمیل</span>
          <input className={s.input} dir="ltr" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          {errs.email && <span className={s.err}>{errs.email}</span>}
        </label>
      </div>
      <div>
        <button className={`${s.btnPrimary} primary`} disabled={busy || !dirty}>
          {busy ? "در حال ذخیره…" : "ذخیرهٔ اطلاعات تماس"}
        </button>
      </div>
    </form>
  );
}

/** Settings → «حساب من»: every signed-in user changes their own password and manages recovery codes here. */
export function AccountTab() {
  const flash = useToast();
  const { data: recovery, mutate } = useSWR<RecoveryStatus>(RECOVERY_KEY, fetcher);
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [errs, setErrs] = useState<{ current?: string; pw?: string; pw2?: string }>({});
  const [busy, setBusy] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    if (!current) next.current = "رمز عبور فعلی را وارد کنید.";
    if (pw.length < 8) next.pw = "رمز تازه باید حداقل ۸ نویسه باشد.";
    else if (pw === current) next.pw = "رمز تازه باید با رمز فعلی فرق داشته باشد.";
    if (pw !== pw2) next.pw2 = "تکرار رمز با رمز تازه یکسان نیست.";
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { current_password: current, new_password: pw } });
      setCurrent("");
      setPw("");
      setPw2("");
      flash("رمز عبور عوض شد");
    } catch (err) {
      const fe = fieldErrors(err);
      if (fe.current_password || fe.new_password) setErrs({ current: fe.current_password, pw: fe.new_password });
      else flash(errText(err, "رمز عوض نشد."));
    } finally {
      setBusy(false);
    }
  };

  const left = recovery?.remaining ?? 0;
  return (
    <>
      <ContactCard />
      <form className={`card ${s.cardPad}`} onSubmit={save} method="post">
        <div className={s.cardHead}>
          <div>
            <b>رمز عبور</b>
            <small>با عوض‌کردن رمز، ورودهای دیگر همین حساب (مرورگرها و دستگاه‌های دیگر) بسته می‌شوند.</small>
          </div>
        </div>
        <label className={s.field}>
          <span>رمز عبور فعلی</span>
          <input className={s.input} name="current-password" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          {errs.current && <span className={s.err}>{errs.current}</span>}
        </label>
        <PasswordPair pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} errs={{ pw: errs.pw, pw2: errs.pw2 }} />
        <div>
          <button className={`${s.btnPrimary} primary`} disabled={busy}>
            {busy ? "در حال ذخیره…" : "ذخیرهٔ رمز تازه"}
          </button>
        </div>
      </form>

      <div className={`card ${s.cardPad}`}>
        <div className={s.cardHead}>
          <div>
            <b>کدهای بازیابی رمز</b>
            <small>اگر رمز را فراموش کردید، از صفحهٔ ورود با نام کاربری و یکی از این کدها رمز تازه می‌گذارید. نیازی به ایمیل نیست.</small>
          </div>
          <button className={s.btnGhost} onClick={() => setCodesOpen(true)} disabled={!recovery}>
            <Icon d={I.key} size={16} /> ساخت کدهای تازه
          </button>
        </div>
        {recovery && (
          <div className={s.note} data-tone={left === 0 ? "warn" : "info"}>
            <Icon d={left === 0 ? I.alert : I.info} size={18} />
            <span>{left === 0 ? "کد بازیابی ندارید یا همهٔ کدها مصرف شده‌اند. همین حالا کدهای تازه بسازید و جای امن نگه دارید." : `${toFa(left)} کد از ${toFa(recovery.total)} کد باقی مانده است.`}</span>
          </div>
        )}
      </div>

      {codesOpen && (
        <RecoveryDialog
          onClose={() => {
            setCodesOpen(false);
            void mutate();
          }}
        />
      )}
    </>
  );
}
