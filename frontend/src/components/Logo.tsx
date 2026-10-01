/** نشان آسان‌دسک (مربع سبز برند با دو شورون سفید) */
export const LOGO_MARK = ["137,467 471,133 705,366 628,501 458,331 229,560", "300,636 376,502 546,671 776,443 868,535 533,869"];

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" role="img" aria-label="آسان‌دسک" style={{ flex: "none", display: "block" }}>
      <rect width="1000" height="1000" rx="220" fill="#26a379" />
      {LOGO_MARK.map((p) => (
        <polygon key={p} points={p} fill="#fff" />
      ))}
    </svg>
  );
}
