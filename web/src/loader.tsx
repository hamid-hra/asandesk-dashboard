// لودینگ آسان دسک: همان نشان دوپاره‌ای که در برنامهٔ دسکتاپ (AsanLoader / AsanSpinner) و پنل هست.
// در هیچ جای این برنامه چرخندهٔ معمولی به کار نمی‌رود.
const TOP = '472,133 705,366 629,501 458,331 229,560 137,467';
const BOT = '776,443 868,535 533,870 300,636 376,502 546,672';

function Mark() {
  return (
    <svg className="al-svg" viewBox="0 0 1000 1000" aria-hidden="true">
      <g className="al-spin">
        <polygon className="al-top" points={TOP} />
        <polygon className="al-bot" points={BOT} />
      </g>
    </svg>
  );
}

/** لودینگ بزرگ (صفحه یا داخل کارت) */
export function AsanLoader({ label, full, small }: { label: string; full?: boolean; small?: boolean }) {
  return (
    <div className={`al${full ? ' al-full' : ''}${small ? ' al-small' : ''}`} role="status" aria-live="polite" aria-label={label}>
      <div className="al-mark">
        <div className="al-ring" />
        <Mark />
      </div>
      <div className="al-meta">
        <div className="al-label">
          {label}
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
        <div className="al-track">
          <div className="al-bar" />
        </div>
      </div>
    </div>
  );
}

/** نشان کوچک چرخان برای دکمه‌ها و جاهای تنگ */
export function AsanSpinner({ size = 18 }: { size?: number }) {
  return (
    <span className="al-spinner" style={{ width: size, height: size }} role="status" aria-label="loading">
      <Mark />
    </span>
  );
}

/** نوار نامعین باریک */
export function AsanBar() {
  return (
    <div className="al-track al-track-wide">
      <div className="al-bar" />
    </div>
  );
}

/** نشان آسان دسک (مربع سبز با دو شورون سفید) */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <rect width="1000" height="1000" rx="220" fill="#26a379" />
      <polygon points="137,467 471,133 705,366 628,501 458,331 229,560" fill="#fff" />
      <polygon points="300,636 376,502 546,671 776,443 868,535 533,869" fill="#fff" />
    </svg>
  );
}
