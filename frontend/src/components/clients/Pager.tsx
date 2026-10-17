"use client";

import { toFa } from "@/lib/fa";

import s from "./clients.module.css";

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/** Page numbers to show: all of them when few, else first, last and the neighbours of the current one («…» between). */
export function pageItems(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - last > 1) out.push("gap");
    out.push(p);
    last = p;
  }
  return out;
}

/** Footer of the clients table: which rows are shown, the page size and the page buttons. */
export function Pager({
  page,
  pages,
  pageSize,
  count,
  shown,
  note,
  loading,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  pageSize: number;
  count: number;
  shown: number;
  note?: string;
  loading?: boolean;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const from = count ? (page - 1) * pageSize + 1 : 0;
  const to = (page - 1) * pageSize + shown;
  return (
    <div className={s.footer}>
      <span className={s.footerText}>
        {loading ? "…" : count ? `نمایش ${toFa(from)} تا ${toFa(to)} از ${toFa(count)} کلاینت` : "کلاینتی نیست"}
        {note ? ` · ${note}` : ""}
      </span>
      <label className={s.pageSize}>
        <span>تعداد در صفحه</span>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="تعداد کلاینت در هر صفحه">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {toFa(n)}
            </option>
          ))}
        </select>
      </label>
      {pages > 1 && (
        <nav className={s.pager} aria-label="صفحه‌بندی">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="صفحهٔ قبل">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {pageItems(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`g${i}`} className={s.pagerGap} aria-hidden="true">
                …
              </span>
            ) : (
              <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined} aria-label={`صفحهٔ ${toFa(p)}`}>
                {toFa(p)}
              </button>
            ),
          )}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="صفحهٔ بعد">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </nav>
      )}
    </div>
  );
}
