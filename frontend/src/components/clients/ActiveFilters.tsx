"use client";

import { toFa } from "@/lib/fa";

import s from "./clients.module.css";
import { type Chip, type ClientFilters, DEFAULT_SORT, isDefaultSort, type SortState, sortText } from "./query";

/** Active filters and sort as removable chips, so the table never hides why it shows what it shows. */
export function ActiveFilters({ chips, sort, onSort, onFilters, filters }: { chips: Chip[]; sort: SortState; onSort: (s: SortState) => void; filters: ClientFilters; onFilters: (f: ClientFilters) => void }) {
  const sorted = !isDefaultSort(sort);
  if (!chips.length && !sorted) return null;
  return (
    <div className={s.chips} role="group" aria-label="فیلترها و ترتیب فعال">
      {chips.map((c) => (
        <button key={c.key} type="button" className={s.chip} onClick={() => onFilters({ ...filters, ...c.clear })} title="برداشتن این فیلتر">
          {c.label}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      {sorted && (
        <button type="button" className={s.chip} data-kind="sort" onClick={() => onSort(DEFAULT_SORT)} title="برگشت به ترتیب پیش‌فرض">
          ترتیب: {sortText(sort)}
          <span aria-hidden="true">×</span>
        </button>
      )}
      {chips.length > 1 && (
        <button type="button" className={s.chipsClear} onClick={() => onFilters({ ...filters, ...Object.assign({}, ...chips.map((c) => c.clear)) })}>
          پاک کردن {toFa(chips.length)} فیلتر
        </button>
      )}
    </div>
  );
}
