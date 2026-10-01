import type { RangeId } from "@/lib/types";

import s from "./server.module.css";
import { RANGES } from "./util";

export function RangeHeader({ range, onChange }: { range: RangeId; onChange: (r: RangeId) => void }) {
  return (
    <div className={s.head}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.h1}>سرور و منابع</div>
        <div className={s.h1sub}>وضعیت زیرساخت، مصرف منابع و کانکشن‌ها</div>
      </div>
      <div style={{ flex: 1 }} />
      <div className={s.ranges} role="group" aria-label="بازه زمانی">
        {RANGES.map((r) => (
          <button key={r.id} aria-pressed={range === r.id} onClick={() => onChange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
