"use client";

import { toFa } from "@/lib/fa";
import type { ClientList } from "@/lib/types";

import s from "./clients.module.css";

export interface ClientFilters {
  /** «p:Windows» = همهٔ ویندوزها، «o:Windows 11 Pro» = دقیقاً همین سیستم‌عامل */
  os: string;
  version: string;
  seen: string;
  old: boolean;
  newOnly: boolean;
}

export const NO_FILTERS: ClientFilters = { os: "", version: "", seen: "", old: false, newOnly: false };

const SEEN: [string, string][] = [
  ["", "هر زمان"],
  ["24h", "۲۴ ساعت اخیر"],
  ["7d", "۷ روز اخیر"],
  ["30d", "۳۰ روز اخیر"],
  ["inactive", "غیرفعال بیش از ۳۰ روز"],
];

/** پارامترهای API از روی فیلترها */
export function filterParams(f: ClientFilters, p: URLSearchParams) {
  if (f.os.startsWith("p:")) p.set("platform", f.os.slice(2));
  else if (f.os.startsWith("o:")) p.set("os", f.os.slice(2));
  if (f.version) p.set("version", f.version);
  if (f.seen) p.set("seen", f.seen);
  if (f.old) p.set("old", "1");
  if (f.newOnly) p.set("new", "1");
}

export const activeCount = (f: ClientFilters) => [f.os, f.version, f.seen].filter(Boolean).length + Number(f.old) + Number(f.newOnly);

/** گزینه‌ای که انتخاب شده ولی دیگر در شمارش‌ها نیست (۰ نتیجه) هم در فهرست بماند */
function withSelected(list: [string, number][], selected: string): [string, number][] {
  return !selected || list.some(([v]) => v === selected) ? list : [[selected, 0], ...list];
}

export function FilterBar({ value, onChange, facets }: { value: ClientFilters; onChange: (f: ClientFilters) => void; facets: ClientList["facets"] }) {
  const set = (patch: Partial<ClientFilters>) => onChange({ ...value, ...patch });
  const platforms = withSelected(facets?.platforms ?? [], value.os.startsWith("p:") ? value.os.slice(2) : "");
  const oses = withSelected(facets?.os ?? [], value.os.startsWith("o:") ? value.os.slice(2) : "");
  const versions = withSelected(facets?.versions ?? [], value.version);
  const n = activeCount(value);

  return (
    <div className={s.filterBar} role="group" aria-label="فیلترهای کلاینت">
      <label className={s.filterSelect} data-active={!!value.os}>
        <span>سیستم‌عامل</span>
        <select value={value.os} onChange={(e) => set({ os: e.target.value })}>
          <option value="">همه</option>
          {platforms.length > 0 && (
            <optgroup label="پلتفرم">
              {platforms.map(([p, c]) => (
                <option key={`p:${p}`} value={`p:${p}`}>
                  {p} ({toFa(c)})
                </option>
              ))}
            </optgroup>
          )}
          {oses.length > 0 && (
            <optgroup label="نسخهٔ سیستم‌عامل">
              {oses.map(([o, c]) => (
                <option key={`o:${o}`} value={`o:${o}`}>
                  {o} ({toFa(c)})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className={s.filterSelect} data-active={!!value.version}>
        <span>نسخهٔ برنامه</span>
        <select value={value.version} onChange={(e) => set({ version: e.target.value })} dir="auto">
          <option value="">همه</option>
          {versions.map(([v, c]) => (
            <option key={v} value={v}>
              {v} ({toFa(c)})
            </option>
          ))}
        </select>
      </label>
      <label className={s.filterSelect} data-active={!!value.seen}>
        <span>آخرین فعالیت</span>
        <select value={value.seen} onChange={(e) => set({ seen: e.target.value })}>
          {SEEN.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={s.filterChip} aria-pressed={value.old} onClick={() => set({ old: !value.old })} title="کلاینت‌هایی که نسخه‌شان از آخرین نسخهٔ پایدار قدیمی‌تر است">
        نسخهٔ قدیمی
      </button>
      <button type="button" className={s.filterChip} aria-pressed={value.newOnly} onClick={() => set({ newOnly: !value.newOnly })} title="اولین گزارش در ۷ روز اخیر">
        نصب تازه · ۷ روز
      </button>
      {n > 0 && (
        <button type="button" className={s.filterClear} onClick={() => onChange(NO_FILTERS)}>
          پاک کردن {toFa(n)} فیلتر
        </button>
      )}
    </div>
  );
}
