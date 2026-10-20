import { toFa } from "@/lib/fa";
import type { RangeId, ServerRow } from "@/lib/types";

import s from "./server.module.css";
import { RANGES } from "./util";

export function RangeHeader({
  range,
  onChange,
  servers,
  serverId,
  onServer,
}: {
  range: RangeId;
  onChange: (r: RangeId) => void;
  servers: ServerRow[];
  serverId: number | null;
  onServer: (id: number | null) => void;
}) {
  return (
    <div className={s.head}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.h1}>سرور و منابع</div>
        <div className={s.h1sub}>وضعیت زیرساخت، مصرف منابع و کانکشن‌ها</div>
      </div>
      <div style={{ flex: 1 }} />
      {servers.length > 0 && (
        // سرورها همان‌هایی‌اند که در بخش «سرورهای HA» ثبت شده و agent دارند؛ با یک سرور فقط نامش نشان داده می‌شود
        <div className={s.ranges} role="group" aria-label="سرور">
          {servers.length > 1 && (
            <button aria-pressed={serverId == null} onClick={() => onServer(null)}>
              همه ({toFa(servers.length)})
            </button>
          )}
          {servers.map((sv) => (
            <button key={sv.id} aria-pressed={servers.length === 1 || serverId === sv.id} onClick={() => onServer(servers.length === 1 ? null : sv.id)}>
              {sv.name}
            </button>
          ))}
        </div>
      )}
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
