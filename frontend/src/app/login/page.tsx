"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR, { mutate } from "swr";

import { AsanLoader } from "@/components/AsanLoader";
import { Brand, Label, Title } from "@/components/shell/AuthBits";
import { InfoTip } from "@/components/Tip";
import { api, ApiError, fetcher } from "@/lib/api";
import { INTRO_KEY, INTRO_MS } from "@/lib/auth";
import type { User } from "@/lib/types";

import s from "./login.module.css";

const tooMany = "تعداد تلاش‌ها زیاد است؛ یک دقیقه دیگر دوباره امتحان کنید.";

/** اولین ورود: ساخت حساب مالک با کد راه‌اندازی که در لاگ backend چاپ شده */
function SetupForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("کد راه‌اندازی را وارد کنید.");
    if (!username.trim()) return setError("نام کاربری را وارد کنید.");
    if (password.length < 8) return setError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
    if (password !== password2) return setError("تکرار رمز عبور با رمز عبور یکسان نیست.");
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/api/auth/setup", { method: "POST", body: { code, username, password } });
      // خطای ۴۰۳ قبلی /me در کش SWR نماند
      await mutate("/api/auth/me", user, { revalidate: false });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? tooMany
          : err instanceof Error
            ? err.message
            : "ساخت حساب ناموفق بود.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.card} onSubmit={submit}>
      <Brand />
      <Title tip="نام کاربری و رمز عبور حساب مالک را تعیین کنید. این صفحه فقط یک بار نمایش داده می‌شود.">راه‌اندازی اولیه</Title>
      <label className={s.field}>
        <Label tip={'کد در لاگ سرویس backend چاپ شده است؛ روی سرور: docker compose logs backend | grep "SETUP CODE"'}>کد راه‌اندازی</Label>
        <input dir="ltr" className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoFocus autoComplete="off" />
      </label>
      <label className={s.field}>
        <Label>نام کاربری مالک</Label>
        <input dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className={s.field}>
        <Label tip="حداقل ۸ نویسه">رمز عبور</Label>
        <input dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className={s.field}>
        <Label>تکرار رمز عبور</Label>
        <input dir="ltr" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </label>
      {error && <div className={s.error}>{error}</div>}
      <button className={s.submit} disabled={busy}>
        {busy ? "در حال ساخت حساب…" : "ساخت حساب مالک و ورود"}
      </button>
    </form>
  );
}

/**
 * رمز را فراموش کرده‌ام، دو مرحله (بدون ایمیل):
 * ۱) نام کاربری + یکی از کدهای بازیابی؛ سرور فقط درستی‌اش را می‌گوید و کد را مصرف نمی‌کند
 * ۲) فقط اگر درست بود: رمز تازه؛ همین‌جا کد مصرف می‌شود
 */
function ResetForm({ onBack, onDone }: { onBack: () => void; onDone: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError && err.status === 429 ? tooMany : err instanceof Error ? err.message : fallback);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setError("نام کاربری را وارد کنید.");
    if (!code.trim()) return setError("کد بازیابی را وارد کنید.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/recovery/verify", { method: "POST", body: { username: username.trim(), code } });
      setVerified(true);
    } catch (err) {
      fail(err, "بررسی کد ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
    if (password !== password2) return setError("تکرار رمز عبور با رمز عبور یکسان نیست.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/recovery/reset", { method: "POST", body: { username: username.trim(), code, password } });
      onDone(username.trim());
    } catch (err) {
      // کد در این فاصله مصرف یا باطل شده: از اول
      if (err instanceof ApiError && err.status === 400 && !(err.data as Record<string, unknown> | null)?.password) setVerified(false);
      fail(err, "تغییر رمز ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  if (!verified) {
    return (
      <form className={s.card} onSubmit={verify} method="post">
        <Brand />
        <Title tip="نام کاربری و یکی از کدهای بازیابی که قبلاً ذخیره کرده‌اید را وارد کنید. اگر درست باشد، رمز تازه را می‌گذارید.">بازیابی رمز عبور</Title>
        <div className={s.steps} aria-label="مرحلهٔ ۱ از ۲"><i data-on="true" /><i /></div>
        <label className={s.field}>
          <Label>نام کاربری</Label>
          <input name="username" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className={s.field}>
          <Label tip="هر کد فقط یک بار کار می‌کند. کدها را بعد از ورود در تنظیمات ← حساب من می‌سازید. کد ندارید؟ از مالک پنل بخواهید رمزتان را عوض کند.">کد بازیابی</Label>
          <input name="code" dir="ltr" className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
        </label>
        {error && <div className={s.error}>{error}</div>}
        <button className={s.submit} disabled={busy}>
          {busy ? "در حال بررسی…" : "ادامه"}
        </button>
        <button type="button" className={s.link} onClick={onBack}>
          بازگشت به ورود
        </button>
      </form>
    );
  }

  return (
    <form className={s.card} onSubmit={reset} method="post">
      <Brand />
      <Title tip="کد درست بود. رمز تازه را دو بار وارد کنید؛ با ذخیره، کد مصرف می‌شود و ورودهای قبلی این حساب بسته می‌شوند.">رمز عبور تازه</Title>
      <div className={s.steps} aria-label="مرحلهٔ ۲ از ۲"><i data-on="true" /><i data-on="true" /></div>
      <div className={s.who}>
        <span>نام کاربری</span>
        <b dir="ltr">{username.trim()}</b>
      </div>
      {/* برای اینکه مدیر رمز مرورگر رمز تازه را برای همین نام کاربری ذخیره کند */}
      <input type="text" name="username" autoComplete="username" value={username.trim()} readOnly hidden />
      <label className={s.field}>
        <Label tip="حداقل ۸ نویسه">رمز عبور تازه</Label>
        <input name="new-password" dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </label>
      <label className={s.field}>
        <Label>تکرار رمز عبور تازه</Label>
        <input name="new-password-confirm" dir="ltr" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </label>
      {error && <div className={s.error}>{error}</div>}
      <button className={s.submit} disabled={busy}>
        {busy ? "در حال تغییر…" : "تغییر رمز"}
      </button>
      <button type="button" className={s.link} onClick={onBack}>
        بازگشت به ورود
      </button>
    </form>
  );
}

function LoginForm({ onForgot, notice, initialUsername }: { onForgot: () => void; notice: string; initialUsername: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // بعد از ورود موفق تا باز شدن پنل، صفحهٔ لودینگ دیده می‌شود
  const [entering, setEntering] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError("نام کاربری و رمز عبور را وارد کنید.");
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/api/auth/login", { method: "POST", body: { username, password, remember } });
      await mutate("/api/auth/me", user, { revalidate: false });
      setEntering(true);
      // لوگو یک چرخهٔ کامل دیده می‌شود و بعد پنل باز می‌شود (مثل انتقال بین صفحات)
      sessionStorage.setItem(INTRO_KEY, "1");
      await new Promise((r) => setTimeout(r, INTRO_MS));
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/server");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? tooMany
          : err instanceof Error
            ? err.message
            : "ورود ناموفق بود.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.card} onSubmit={submit} method="post">
      {entering && <AsanLoader full label="در حال ورود" />}
      <Brand />
      <Title tip="برای مدیریت سرورها، نسخه‌ها و کلاینت‌ها وارد شوید.">ورود به پنل</Title>
      {/* name و id لازم است تا مرورگر و مدیر رمز، رمز را ذخیره و خودکار پر کنند */}
      <label className={s.field}>
        <Label>نام کاربری</Label>
        <input id="username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </label>
      <label className={s.field}>
        <Label>رمز عبور</Label>
        <input id="password" name="password" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className={s.remember}>
        <input type="checkbox" name="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>مرا به خاطر بسپار</span>
        <InfoTip text={remember ? "تا ۳۰ روز در همین مرورگر وارد می‌مانید" : "با بستن مرورگر خارج می‌شوید"} />
      </label>
      {notice && <div className={s.notice}>{notice}</div>}
      {error && <div className={s.error}>{error}</div>}
      <button className={s.submit} disabled={busy}>
        {busy ? "در حال ورود…" : "ورود"}
      </button>
      <button type="button" className={s.link} onClick={onForgot}>
        رمز عبور را فراموش کرده‌ام
      </button>
    </form>
  );
}

function Gate() {
  const router = useRouter();
  const { data } = useSWR<{ needed: boolean }>("/api/auth/setup", fetcher, { revalidateOnFocus: false });
  const [view, setView] = useState<"login" | "reset">("login");
  // بعد از بازیابی موفق: پیام و نام کاربری در فرم ورود
  const [done, setDone] = useState<{ username: string } | null>(null);
  if (!data) return null;
  if (data.needed) return <SetupForm onDone={() => router.replace("/server")} />;
  if (view === "reset") {
    return (
      <ResetForm
        onBack={() => setView("login")}
        onDone={(username) => {
          setDone({ username });
          setView("login");
        }}
      />
    );
  }
  return <LoginForm onForgot={() => setView("reset")} notice={done ? "رمز عبور عوض شد. با رمز تازه وارد شوید." : ""} initialUsername={done?.username ?? ""} />;
}

export default function LoginPage() {
  return (
    <div className={s.page}>
      <Suspense>
        <Gate />
      </Suspense>
    </div>
  );
}
