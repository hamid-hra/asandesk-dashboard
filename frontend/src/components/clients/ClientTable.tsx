import { toFa } from "@/lib/fa";
import { agoText, formatId, minutesText } from "@/lib/people";
import type { ClientList, ClientRow } from "@/lib/types";

import { Avatar } from "./Avatar";
import s from "./clients.module.css";
import { ColumnHead, Choice, MenuSection } from "./ColumnHead";
import { type ClientFilters, type SortKey, type SortState, SEEN, SORT_LABEL, withSelected } from "./query";

function Row({ c, selected, onSelect }: { c: ClientRow; selected: boolean; onSelect: () => void }) {
  const tLabel = c.tickets_open ? `${toFa(c.tickets_open)} باز` : c.tickets_total ? `${toFa(c.tickets_total)} بسته` : "ندارد";
  return (
    <button className={`${s.tr} ${s.row}`} aria-current={selected} onClick={onSelect}>
      <div className={s.who}>
        <Avatar id={c.id} name={c.display} />
        <div className={s.whoText}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span className={s.name}>{c.display}</span>
            {c.legacy && (
              <span className={s.tag} title="فقط از سرور شناسه (hbbs) شناخته شده و به API گزارش نمی‌دهد" style={{ background: "var(--seg-track)", color: "var(--muted)" }}>
                قدیمی
              </span>
            )}
            {c.blocked && (
              <span className={s.tag} style={{ background: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                مسدود
              </span>
            )}
          </div>
          <span dir="ltr" className={s.idText}>
            {formatId(c.id)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        <span className="dot" style={{ background: c.online ? "var(--ok)" : "var(--off)" }} />
        <span style={{ color: c.online ? "var(--accent-strong)" : "var(--muted)" }} title={c.legacy ? "وضعیت آنلاین دستگاه‌های قدیمی از سرور قابل خواندن نیست" : undefined}>
          {c.legacy ? "نامشخص" : c.online ? "آنلاین" : agoText(c.last_seen)}
        </span>
      </div>
      <span
        className={s.pill}
        style={c.legacy ? { background: "var(--seg-track)", color: "var(--muted)" } : c.logged ? { background: "var(--accent-soft)", color: "var(--accent-strong)" } : { background: "var(--warn-soft)", color: "var(--warn-text)" }}
      >
        {c.legacy ? "—" : c.logged ? "وارد شده" : "مهمان"}
      </span>
      <div className={s.stack}>
        <span>{c.mins_30d ? minutesText(c.mins_30d) : "—"}</span>
        <span>{c.legacy ? "—" : `${toFa(c.sessions_30d)} نشست`}</span>
      </div>
      <div className={s.stack}>
        <span>{c.platform || "—"}</span>
        <span dir="ltr" style={{ textAlign: "right" }} title={c.os}>
          {c.os || c.ip}
        </span>
      </div>
      <span
        className={s.pill}
        style={c.tickets_open ? { background: "var(--danger-soft)", color: "var(--danger-strong)" } : { background: "var(--seg-track)", color: "var(--muted)" }}
      >
        {tLabel}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
        <span dir="ltr" className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {c.version || "—"}
        </span>
        {c.version_old && (
          <span className={s.tag} style={{ fontWeight: 600, background: "var(--warn-soft)", color: "var(--warn-text)" }}>
            قدیمی
          </span>
        )}
      </div>
    </button>
  );
}

interface HeaderProps {
  sort: SortState;
  onSort: (s: SortState) => void;
  filters: ClientFilters;
  onFilters: (f: ClientFilters) => void;
  facets: ClientList["facets"];
}

/** گزینه‌های مرتب‌سازی یک ستون، در منوی همان ستون */
function SortChoices({ keys, sort, onSort }: { keys: SortKey[]; sort: SortState; onSort: (s: SortState) => void }) {
  return (
    <MenuSection title="مرتب‌سازی">
      {keys.flatMap((key) =>
        // اول جهت پیش‌فرضِ هر کلید (بیشترین/جدیدترین یا الفبایی)، بعد برعکسش
        (key === "name" ? (["asc", "desc"] as const) : (["desc", "asc"] as const)).map((dir) => (
          <Choice key={`${key}-${dir}`} on={sort.key === key && sort.dir === dir} onClick={() => onSort({ key, dir })}>
            {SORT_LABEL[key][dir === "asc" ? 0 : 1]}
          </Choice>
        )),
      )}
    </MenuSection>
  );
}

function Header({ sort, onSort, filters: f, onFilters, facets }: HeaderProps) {
  const set = (patch: Partial<ClientFilters>) => onFilters({ ...f, ...patch });
  const dirOf = (...keys: SortKey[]) => (keys.includes(sort.key) ? sort.dir : null);
  const platforms = withSelected(facets?.platforms ?? [], f.os.startsWith("p:") ? f.os.slice(2) : "");
  const oses = withSelected(facets?.os ?? [], f.os.startsWith("o:") ? f.os.slice(2) : "");
  const versions = withSelected(facets?.versions ?? [], f.version);

  return (
    <div className={`${s.tr} ${s.th}`}>
      <ColumnHead label="کلاینت" sort={dirOf("name")} filtered={f.blocked || f.newOnly || !!f.legacy}>
        <SortChoices keys={["name"]} sort={sort} onSort={onSort} />
        <MenuSection title="نوع دستگاه">
          <Choice on={!f.legacy} onClick={() => set({ legacy: "" })}>
            همه
          </Choice>
          <Choice on={f.legacy === "only"} onClick={() => set({ legacy: "only" })}>
            قدیمی (بدون API)
          </Choice>
          <Choice on={f.legacy === "exclude"} onClick={() => set({ legacy: "exclude" })}>
            فقط دارای API
          </Choice>
        </MenuSection>
        <MenuSection title="نمایش">
          <Choice kind="check" on={f.blocked} onClick={() => set({ blocked: !f.blocked })}>
            فقط مسدودها
          </Choice>
          <Choice kind="check" on={f.newOnly} onClick={() => set({ newOnly: !f.newOnly })}>
            نصب تازه · ۷ روز
          </Choice>
        </MenuSection>
      </ColumnHead>

      <ColumnHead label="وضعیت" sort={dirOf("recent")} filtered={!!f.status || !!f.seen}>
        <SortChoices keys={["recent"]} sort={sort} onSort={onSort} />
        <MenuSection title="وضعیت">
          <Choice on={!f.status} onClick={() => set({ status: "" })}>
            همه
          </Choice>
          <Choice on={f.status === "online"} onClick={() => set({ status: "online" })}>
            آنلاین
          </Choice>
          <Choice on={f.status === "offline"} onClick={() => set({ status: "offline" })}>
            آفلاین
          </Choice>
        </MenuSection>
        <MenuSection title="آخرین فعالیت">
          {SEEN.map(([v, label]) => (
            <Choice key={v} on={f.seen === v} onClick={() => set({ seen: v })}>
              {label}
            </Choice>
          ))}
        </MenuSection>
      </ColumnHead>

      <ColumnHead label="حساب" filtered={!!f.account}>
        <MenuSection title="حساب">
          <Choice on={!f.account} onClick={() => set({ account: "" })}>
            همه
          </Choice>
          <Choice on={f.account === "logged"} onClick={() => set({ account: "logged" })}>
            وارد شده
          </Choice>
          <Choice on={f.account === "guest"} onClick={() => set({ account: "guest" })}>
            مهمان (بدون ورود)
          </Choice>
        </MenuSection>
      </ColumnHead>

      <ColumnHead label="مدت اتصال · ۳۰ روز" sort={dirOf("mins", "sessions")}>
        <SortChoices keys={["mins", "sessions"]} sort={sort} onSort={onSort} />
      </ColumnHead>

      <ColumnHead label="سیستم‌عامل" filtered={!!f.os}>
        <MenuSection title="سیستم‌عامل" scroll>
          <Choice on={!f.os} onClick={() => set({ os: "" })}>
            همه
          </Choice>
        </MenuSection>
        {platforms.length > 0 && (
          <MenuSection title="پلتفرم" scroll>
            {platforms.map(([p, c]) => (
              <Choice key={p} on={f.os === `p:${p}`} count={c} onClick={() => set({ os: `p:${p}` })}>
                {p}
              </Choice>
            ))}
          </MenuSection>
        )}
        {oses.length > 0 && (
          <MenuSection title="نسخهٔ سیستم‌عامل" scroll>
            {oses.map(([o, c]) => (
              <Choice key={o} on={f.os === `o:${o}`} count={c} onClick={() => set({ os: `o:${o}` })}>
                <bdi dir="auto">{o}</bdi>
              </Choice>
            ))}
          </MenuSection>
        )}
      </ColumnHead>

      <ColumnHead label="بازخورد" sort={dirOf("tickets")} filtered={f.tickets}>
        <SortChoices keys={["tickets"]} sort={sort} onSort={onSort} />
        <MenuSection title="نمایش">
          <Choice on={!f.tickets} onClick={() => set({ tickets: false })}>
            همه
          </Choice>
          <Choice on={f.tickets} onClick={() => set({ tickets: true })}>
            دارای بازخورد جدید
          </Choice>
        </MenuSection>
      </ColumnHead>

      <ColumnHead label="نسخه" sort={dirOf("version")} filtered={!!f.version || f.old}>
        <SortChoices keys={["version"]} sort={sort} onSort={onSort} />
        <MenuSection title="نمایش">
          <Choice kind="check" on={f.old} onClick={() => set({ old: !f.old })}>
            فقط نسخهٔ قدیمی
          </Choice>
        </MenuSection>
        <MenuSection title="نسخهٔ برنامه" scroll>
          <Choice on={!f.version} onClick={() => set({ version: "" })}>
            همه
          </Choice>
          {versions.map(([v, c]) => (
            <Choice key={v} on={f.version === v} count={c} onClick={() => set({ version: v })}>
              <bdi dir="ltr">{v}</bdi>
            </Choice>
          ))}
        </MenuSection>
      </ColumnHead>
    </div>
  );
}

export function ClientTable({ rows, selected, onSelect, empty, ...header }: { rows: ClientRow[] | undefined; selected: string | null; onSelect: (id: string) => void; empty: string } & HeaderProps) {
  return (
    <div className={s.tableScroll}>
      <div className={s.table}>
        <Header {...header} />
        {rows?.map((c) => <Row key={c.id} c={c} selected={c.id === selected} onSelect={() => onSelect(c.id)} />)}
        {rows && !rows.length && <div className="empty">{empty}</div>}
        {!rows && <div className="empty">در حال بارگذاری…</div>}
      </div>
    </div>
  );
}
