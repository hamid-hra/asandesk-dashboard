"use client";

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { I } from "@/components/settings/ui";
import st from "@/components/settings/settings.module.css";
import { copyText, downloadTextFile } from "@/lib/settings";

import s from "./Recovery.module.css";

/** The ten one-time codes with copy and download; used by the profile dialog and by the first-login screen. */
export function RecoveryCodes({ codes, username }: { codes: string[]; username: string }) {
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    if (await copyText(codes.join("\n"))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const download = () =>
    downloadTextFile(
      "asandesk-recovery-codes.txt",
      [
        "AsanDesk panel recovery codes",
        `user: ${username}`,
        `date: ${new Date().toISOString().slice(0, 10)}`,
        "",
        ...codes,
        "",
        "Each code works once. Keep this file somewhere safe.",
      ].join("\n"),
    );

  return (
    <>
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
        <button type="button" className={st.btnGhost} onClick={copyAll}>
          <Icon d={copied ? I.check : I.copy} size={16} /> {copied ? "کپی شد" : "کپی همه"}
        </button>
        <button type="button" className={st.btnGhost} onClick={download}>
          <Icon d={I.download} size={16} /> دانلود فایل متنی
        </button>
      </div>
    </>
  );
}
