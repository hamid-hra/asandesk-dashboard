import s from "./AsanLoader.module.css";

type Theme = "light" | "dark" | "green";

/**
 * لودینگ آسان‌دسک: نشان دوپاره که از هم باز می‌شود و می‌چرخد.
 * - `full`: تمام‌صفحه (برای اتصال/ورود)
 * - بدون `full`: داخل محتوای صفحه (قد کارت‌ها)
 * رنگ‌ها از تم پنل (cookie → data-theme روی html) گرفته می‌شود مگر `theme` داده شود.
 */
export function AsanLoader({ label = "در حال اتصال", theme, full, small }: { label?: string; theme?: Theme; full?: boolean; small?: boolean }) {
  return (
    <div className={`${s.loader} ${full ? s.full : s.fill} ${small ? s.small : ""}`} data-theme={theme ?? "auto"} role="status" aria-live="polite" aria-label={label}>
      <div className={s.mark}>
        <div className={s.ring} />
        <svg className={s.svg} viewBox="0 0 1000 1000" aria-hidden="true">
          <g className={s.spin}>
            <polygon className={s.top} points="472,133 705,366 629,501 458,331 229,560 137,467" />
            <polygon className={s.bot} points="776,443 868,535 533,870 300,636 376,502 546,672" />
          </g>
        </svg>
      </div>
      <div className={s.meta}>
        <div className={s.label}>
          {label}
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
        <div className={s.track}>
          <div className={s.bar} />
        </div>
      </div>
    </div>
  );
}
