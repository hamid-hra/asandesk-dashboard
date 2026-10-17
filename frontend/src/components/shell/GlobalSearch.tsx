"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toFa } from "@/lib/fa";
import { canSee, ICONS, levelOf, TABS } from "@/lib/nav";
import type { SearchResult } from "@/lib/types";

import s from "./GlobalSearch.module.css";

const SEARCH_ICON = "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5";
const GROUP_ICON: Record<string, string> = {
  pages: "M4 5h16v14H4zM4 9h16",
  clients: ICONS.clients,
  tickets: ICONS.ticket,
  releases: ICONS.release,
  servers: ICONS.server,
  users: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 0112 0v1",
};

/** زیربخش‌های تنظیمات که در جستجو پیدا می‌شوند (section = بخش دسترسی لازم؛ null = همه) */
const SETTINGS: { id: string; label: string; section: string | null; words: string }[] = [
  { id: "users", label: "تنظیمات ← کاربران و دسترسی‌ها", section: "users", words: "کاربر نقش دسترسی رمز" },
  { id: "notices", label: "تنظیمات ← اعلان‌ها", section: "users", words: "اعلان پیام نوتیف اطلاعیه" },
  { id: "backup", label: "تنظیمات ← پشتیبان‌گیری", section: "backup", words: "بکاپ backup بازگردانی" },
  { id: "activity", label: "تنظیمات ← لاگ فعالیت‌ها", section: "activity", words: "لاگ فعالیت تاریخچه" },
  { id: "update", label: "تنظیمات ← به‌روزرسانی پنل", section: "system", words: "آپدیت update نسخه" },
  { id: "logs", label: "تنظیمات ← لاگ داکر", section: "system", words: "docker لاگ کانتینر" },
  { id: "account", label: "تنظیمات ← حساب من", section: null, words: "رمز کد بازیابی موبایل ایمیل پروفایل" },
];

/** یکسان‌سازی برای مقایسه: ی/ک عربی، نیم‌فاصله، ارقام فارسی، حروف کوچک */
function norm(text: string): string {
  return text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏]/g, "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .toLowerCase()
    .trim();
}

interface Row {
  key: string;
  group: string;
  groupLabel: string;
  title: string;
  sub?: string;
  href: string;
  online?: boolean;
}

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** دکمهٔ «جستجو» در نوار بالا و پنجرهٔ جستجوی کل پنل (Ctrl+K یا /) */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [mac] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K" || e.key === "ل") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button className={s.trigger} onClick={() => setOpen(true)} aria-label="جستجو در کل پنل" aria-haspopup="dialog">
        <Icon d={SEARCH_ICON} size={16} />
        <span className={s.triggerText}>جستجو در پنل…</span>
        <kbd className={s.kbd} dir="ltr">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      {open && createPortal(<Palette onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 200);
  const { data, isLoading } = useSWR<SearchResult>(dq.length >= 2 ? `/api/search?q=${encodeURIComponent(dq)}` : null, fetcher, { keepPreviousData: true });

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const pages = useMemo<Row[]>(() => {
    const tabs = TABS.filter((t) => !t.soon && canSee(t, user.perms)).map((t) => ({ title: t.label, href: t.href, words: "" }));
    const subs = SETTINGS.filter((x) => x.section === null || levelOf(user.perms, x.section) !== "none").map((x) => ({ title: x.label, href: `/settings?tab=${x.id}`, words: x.words }));
    const t = norm(q);
    return [...tabs, ...subs]
      .filter((p) => !t || norm(`${p.title} ${p.words}`).includes(t))
      .slice(0, t ? 6 : 12)
      .map((p) => ({ key: `page:${p.href}`, group: "pages", groupLabel: "صفحه‌ها", title: p.title, href: p.href }));
  }, [q, user.perms]);

  const rows = useMemo<Row[]>(() => {
    const remote = dq.length >= 2 && data && norm(data.q) === norm(dq)
      ? data.groups.flatMap((g) => g.items.map((it) => ({ key: `${g.id}:${it.id}`, group: g.id, groupLabel: g.label, title: it.title, sub: it.sub, href: it.href, online: it.online })))
      : [];
    return [...pages, ...remote];
  }, [pages, data, dq]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(rows[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const searching = dq !== q.trim() || (isLoading && q.trim().length >= 2);
  let lastGroup = "";
  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.palette} role="dialog" aria-modal="true" aria-label="جستجو در پنل" onKeyDown={onKey}>
        <div className={s.inputRow}>
          <Icon d={SEARCH_ICON} size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="شناسه یا نام دستگاه، بازخورد، نسخه، کاربر یا صفحه…"
            aria-label="عبارت جستجو"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={rows[active] ? `sr-${active}` : undefined}
            spellCheck={false}
          />
          {searching && <span className={s.spinner} aria-label="در حال جستجو" />}
          <kbd className={s.kbd}>Esc</kbd>
        </div>
        <div className={s.results} id="search-results" role="listbox" ref={list}>
          {rows.map((r, i) => {
            const head = r.group !== lastGroup ? r.groupLabel : null;
            lastGroup = r.group;
            return (
              <div key={r.key}>
                {head && <div className={s.groupHead}>{head}</div>}
                <button
                  id={`sr-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={s.row}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <span className={s.rowIcon}>
                    <Icon d={GROUP_ICON[r.group] ?? GROUP_ICON.pages} size={16} />
                    {r.online !== undefined && <i className={s.onlineDot} data-on={r.online} />}
                  </span>
                  <span className={s.rowText}>
                    <b>{r.title}</b>
                    {r.sub && <small dir="auto">{r.sub}</small>}
                  </span>
                  <span className={s.enter} aria-hidden="true">↵</span>
                </button>
              </div>
            );
          })}
          {rows.length === 0 && !searching && (
            <div className={s.empty}>{q.trim().length < 2 ? "حداقل دو حرف بنویسید." : `چیزی برای «${q.trim()}» پیدا نشد.`}</div>
          )}
        </div>
        <div className={s.foot}>
          <span><kbd className={s.kbd}>↑</kbd><kbd className={s.kbd}>↓</kbd> جابه‌جایی</span>
          <span><kbd className={s.kbd}>↵</kbd> باز کردن</span>
          {data && dq.length >= 2 && <span className={s.footCount}>{toFa(rows.length - pages.length)} نتیجه از داده‌ها</span>}
        </div>
      </div>
    </div>
  );
}
