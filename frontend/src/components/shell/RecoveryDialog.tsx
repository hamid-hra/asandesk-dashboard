"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";

import { Icon } from "@/components/Icon";
import { errText, I, Modal } from "@/components/settings/ui";
import st from "@/components/settings/settings.module.css";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toFa } from "@/lib/fa";
import { copyText } from "@/lib/settings";
import type { RecoveryStatus } from "@/lib/types";

import s from "./Recovery.module.css";

export const RECOVERY_KEY = "/api/auth/recovery";

/** One-time recovery codes: lets the user set a new password from the login page without email. */
export function RecoveryDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { data } = useSWR<RecoveryStatus>(RECOVERY_KEY, fetcher);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!password) return setError("رمز عبور فعلی را وارد کنید.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ codes: string[] }>("/api/auth/recovery/generate", { method: "POST", body: { password } });
      setCodes(res.codes);
      setPassword("");
      await mutate(RECOVERY_KEY);
    } catch (e) {
      setError(errText(e, "ساخت کدها انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    if (codes && (await copyText(codes.join("\n")))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const download = () => {
    if (!codes) return;
    const text = [
      "AsanDesk panel recovery codes",
      `user: ${user.username}`,
      `date: ${new Date().toISOString().slice(0, 10)}`,
      "",
      ...codes,
      "",
      "Each code works once. Keep this file somewhere safe.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "asandesk-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (codes) {
    return (
      <Modal
        title="کدهای بازیابی رمز"
        onClose={onClose}
        width={520}
        footer={
          <button className={`${st.btnPrimary} primary`} onClick={onClose}>
            ذخیره کردم
          </button>
        }
      >
        <div className={st.note} data-tone="warn">
          <span>
            <b>این کدها فقط همین یک بار نشان داده می‌شوند.</b>
            آن‌ها را جای امن نگه دارید، مثلاً در مدیر رمز یا روی کاغذ. هر کد فقط یک بار کار می‌کند.
          </span>
        </div>
        <div className={s.codes}>
          {codes.map((c) => (
            <div key={c} className={s.code}>
              {c}
            </div>
          ))}
        </div>
        <div className={s.tools}>
          <button className={st.btnGhost} onClick={copyAll}>
            <Icon d={copied ? I.check : I.copy} size={16} /> {copied ? "کپی شد" : "کپی همه"}
          </button>
          <button className={st.btnGhost} onClick={download}>
            <Icon d={I.download} size={16} /> دانلود فایل متنی
          </button>
        </div>
      </Modal>
    );
  }

  const left = data?.remaining ?? 0;
  return (
    <Modal
      title="کدهای بازیابی رمز"
      onClose={onClose}
      busy={busy}
      width={520}
      footer={
        <>
          <button className={st.btnGhost} onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button className={`${st.btnPrimary} primary`} onClick={generate} disabled={busy || !data}>
            {busy ? "در حال ساخت…" : "ساخت کدهای تازه"}
          </button>
        </>
      }
    >
      <div className={st.note} data-tone="info">
        <span>
          اگر رمز عبورتان را فراموش کردید، از صفحهٔ ورود با نام کاربری و یکی از این کدها رمز تازه می‌گذارید. نیازی به ایمیل نیست.
        </span>
      </div>
      {data && (
        <div className={s.status} data-empty={left === 0}>
          {left === 0 ? "کد بازیابی ندارید یا همهٔ کدها مصرف شده‌اند." : `${toFa(left)} کد از ${toFa(data.total)} کد باقی مانده است.`}
        </div>
      )}
      <label className={st.field}>
        <span>رمز عبور فعلی</span>
        <input
          className={st.input}
          dir="ltr"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
        />
        <small>با ساخت کدهای تازه، کدهای قبلی از کار می‌افتند.</small>
        {error && <span className={st.err}>{error}</span>}
      </label>
    </Modal>
  );
}
