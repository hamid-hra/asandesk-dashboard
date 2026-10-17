"use client";

import { useState } from "react";

import { InfoTip } from "@/components/Tip";
import { fmt, pctText } from "@/lib/fa";
import type { Overview, RangeId, RequestCounts } from "@/lib/types";

import s from "./server.module.css";
import { RANGES } from "./util";

type Period = "today" | "range";

interface Tile {
  key: string;
  label: string;
  value: number;
  tone: string;
  hint?: string;
}

const EMPTY: RequestCounts = { total: 0, ok: 0, pending: 0, failed: 0, cancelled: 0, unknown: 0, fail_rate: null };

/**
 * Connection requests that reached a controlled device: how many came, how many were accepted, failed or
 * cancelled. Failed and cancelled are told apart only when the app reports why a connection ended; until
 * then they are shown together («ناموفق یا لغو شده») instead of as two numbers that would both be wrong.
 */
export function RequestsCard({ requests, range }: { requests: Overview["requests"] | undefined; range: RangeId }) {
  const [period, setPeriod] = useState<Period>("today");
  const c = requests?.[period] ?? EMPTY;
  const split = (requests?.range.failed ?? 0) + (requests?.range.cancelled ?? 0) > 0;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "";

  const tiles: Tile[] = [
    { key: "total", label: "کل درخواست‌ها", value: c.total, tone: "var(--text)" },
    { key: "ok", label: "موفق", value: c.ok, tone: "var(--ok)", hint: "احراز هویت شد و اتصال برقرار شد" },
    ...(split
      ? [
          { key: "failed", label: "ناموفق", value: c.failed, tone: "var(--danger)", hint: "مثلاً رمز اشتباه یا خطا" },
          { key: "cancelled", label: "لغو شده", value: c.cancelled, tone: "var(--warn)", hint: "کنترل‌کننده یا کاربر آن را رها کرد" },
          ...(c.unknown ? [{ key: "unknown", label: "بدون علت ثبت‌شده", value: c.unknown, tone: "var(--off)" }] : []),
        ]
      : [{ key: "bad", label: "ناموفق یا لغو شده", value: c.unknown, tone: "var(--danger)", hint: "اتصال بدون ورود تمام شد" }]),
    ...(c.pending ? [{ key: "pending", label: "در انتظار", value: c.pending, tone: "var(--off)", hint: "تازه شروع شده و هنوز احراز نشده" }] : []),
  ];

  // نوار سهم هر دسته از کل
  const bar = [
    { v: c.ok, c: "var(--ok)" },
    { v: c.failed, c: "var(--danger)" },
    { v: c.cancelled, c: "var(--warn)" },
    { v: c.unknown, c: split ? "var(--off)" : "var(--danger)" },
    { v: c.pending, c: "var(--bar-off)" },
  ];

  return (
    <div className={`card ${s.reqCard}`}>
      <div className={s.reqHead}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div className={s.reqTitle}>
            درخواست‌های اتصال
            <InfoTip text="شمارش اتصال‌هایی که به یک دستگاه کنترل‌شونده رسیده‌اند؛ از گزارش خود کلاینت‌ها. درخواستی که پیش از رسیدن به دستگاه قطع شود (مثلاً به‌خاطر خطای شبکه یا سرور) اینجا دیده نمی‌شود." />
          </div>
          <div className={s.reqSub}>
            {period === "today" ? "از نیمه‌شب امروز تا الان" : `${rangeLabel} اخیر`}
            {c.fail_rate != null && ` · ${pctText(c.fail_rate, 1)} بدون نتیجه`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="بازهٔ شمارش">
          <button aria-pressed={period === "today"} onClick={() => setPeriod("today")}>
            امروز
          </button>
          <button aria-pressed={period === "range"} onClick={() => setPeriod("range")}>
            {rangeLabel}
          </button>
        </div>
      </div>

      <div className={s.reqTiles}>
        {tiles.map((t) => (
          <div key={t.key} className={s.reqTile} title={t.hint}>
            <span>{t.label}</span>
            <b style={{ color: t.tone }}>{requests ? fmt(t.value) : "—"}</b>
          </div>
        ))}
      </div>

      <div className={s.reqBar} role="img" aria-label="سهم هر دسته از کل درخواست‌ها">
        {c.total > 0 ? bar.filter((b) => b.v > 0).map((b, i) => <span key={i} style={{ flexGrow: b.v, background: b.c }} />) : <span style={{ flexGrow: 1, background: "var(--track)" }} />}
      </div>

      {!split && c.unknown > 0 && (
        <div className={s.reqNote}>
          اپ هنوز علت پایان اتصال‌های بی‌نتیجه را گزارش نمی‌کند، برای همین «ناموفق» و «لغو شده» از هم جدا نمی‌شوند. اپ در گزارش پایان اتصال
          <code dir="ltr">{'result: "failed" | "cancelled"'}</code>
          بفرستد تا همین‌جا جدا شوند.
        </div>
      )}
    </div>
  );
}
