import s from "./clients.module.css";

export interface StripItem {
  label: string;
  value: string;
  sub: string;
}

export function KpiStrip({ items }: { items: StripItem[] }) {
  return (
    <div className={s.kpis}>
      {items.map((k) => (
        <div key={k.label} className={s.kpi}>
          <span>{k.label}</span>
          <span>{k.value}</span>
          <span title={k.sub}>{k.sub}</span>
        </div>
      ))}
    </div>
  );
}
