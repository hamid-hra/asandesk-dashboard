"use client";

import { useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { I, Modal } from "@/components/settings/ui";
import { fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import type { ChangelogItem, VersionInfo } from "@/lib/types";

import s from "./Shell.module.css";

const dfDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "long", day: "numeric" });

const KIND: Record<ChangelogItem["type"], string> = { new: "جدید", change: "تغییر", fix: "رفع اشکال" };

/** Panel version at the bottom of the sidebar; click opens the changelog. */
export function VersionBadge() {
  const { data } = useSWR<VersionInfo>("/api/version", fetcher);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <>
      <button className={s.versionBtn} onClick={() => setOpen(true)} title="تاریخچهٔ تغییرات پنل">
        <Icon d={I.info} size={14} />
        <span>نسخهٔ پنل</span>
        <span className={s.versionNum} dir="ltr">
          {data.version}
        </span>
      </button>
      {open && (
        <Modal title="تاریخچهٔ تغییرات پنل" onClose={() => setOpen(false)} width={620}>
          <div className={s.changelog}>
            {data.changelog.map((e, i) => (
              <section key={e.version} className={s.release}>
                <header className={s.releaseHead}>
                  <span className={s.releaseVer} dir="ltr">
                    {e.version}
                  </span>
                  {i === 0 && <span className={s.currentTag}>نسخهٔ فعلی</span>}
                  <span className={s.releaseDate}>{dfDate.format(new Date(`${e.date}T12:00:00`))}</span>
                </header>
                <div className={s.releaseTitle}>{e.title}</div>
                <ul className={s.releaseItems}>
                  {e.items.map((it, k) => (
                    <li key={k}>
                      <span className={s.kind} data-kind={it.type}>
                        {KIND[it.type]}
                      </span>
                      <span>{it.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className={s.releaseNote}>{toFa(data.changelog.length)} نسخه ثبت شده است.</div>
          </div>
        </Modal>
      )}
    </>
  );
}
