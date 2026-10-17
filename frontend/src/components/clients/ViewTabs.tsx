"use client";

import { toFa } from "@/lib/fa";

import s from "./clients.module.css";

export interface ViewTab<T extends string> {
  id: T;
  label: string;
  /** SVG path (24×24) */
  icon: string;
  count?: number | null;
}

/**
 * Page tabs («فهرست کلاینت‌ها» / «نمودارها»), at the top right under the title. The open tab has an
 * accent underline, an accent icon and bold text, so it is always clear which view you are in.
 */
export function ViewTabs<T extends string>({ tabs, value, onChange }: { tabs: ViewTab<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={s.viewTabs} role="tablist" aria-label="نمای صفحه">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          <span>{t.label}</span>
          {t.count != null && <em>{toFa(t.count)}</em>}
        </button>
      ))}
    </div>
  );
}
