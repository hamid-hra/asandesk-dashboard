"use client";

import { useState } from "react";
import useSWR from "swr";

import { Avatar } from "@/components/clients/Avatar";
import s from "@/components/clients/clients.module.css";
import { KpiStrip } from "@/components/clients/KpiStrip";
import { SearchBox, Seg } from "@/components/clients/SearchBox";
import { ApiError, api, fetcher } from "@/lib/api";
import { dfDay, fmt, toFa } from "@/lib/fa";
import { agoText, formatId } from "@/lib/people";
import { useToast } from "@/lib/toast";

import w from "./webusers.module.css";

interface WebUserRow {
  id: number;
  /** نام نمایشی، وگرنه ایمیل یا موبایل */
  name: string;
  display_name: string;
  email: string;
  phone: string;
  web_id: string;
  blocked: boolean;
  online: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  last_ip: string;
}

interface WebUserList {
  rows: WebUserRow[];
  total: number;
  page: number;
  pages: number;
  summary: { total: number; new_7d: number; online: number; blocked: number };
}

interface WebConnection {
  direction: "in" | "out";
  peer_id: string;
  peer_name: string;
  started_at: string;
  ended_at: string | null;
  ip: string;
}

interface WebUserDetail extends WebUserRow {
  signup_ip: string;
  sessions: number;
  devices: number;
  out_count: number;
  in_count: number;
  connections: WebConnection[];
}

type Filter = "all" | "online" | "blocked";
const FILTERS: [Filter, string][] = [
  ["all", "همه"],
  ["online", "آنلاین"],
  ["blocked", "مسدود"],
];

const day = (iso: string | null) => (iso ? dfDay.format(new Date(iso)) : "—");

export function WebUsers() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const query = new URLSearchParams({ filter, q, page: String(page) });
  const { data, mutate } = useSWR<WebUserList>(`/api/webusers?${query}`, fetcher, { refreshInterval: 30000, keepPreviousData: true });
  const sum = data?.summary;

  const kpis = [
    { label: "کاربران وب", value: sum ? fmt(sum.total) : "—", sub: sum ? `+${toFa(sum.new_7d)} در ۷ روز اخیر` : "" },
    { label: "آنلاین هم‌اکنون", value: sum ? fmt(sum.online) : "—", sub: "صفحهٔ آسان دسک وب باز است" },
    { label: "مسدود", value: sum ? fmt(sum.blocked) : "—", sub: "ورود و اشتراک صفحه بسته است" },
  ];

  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>کاربران وب</div>
        <div className={s.subtitle}>حساب‌هایی که در آسان دسک وب (web.asandesk.ir) ساخته شده‌اند؛ رمزها فقط به‌صورت هش ذخیره می‌شوند</div>
      </div>
      <KpiStrip items={kpis} />
      <div className={s.split}>
        <div className={`card ${s.listCard}`}>
          <div className={s.toolbar}>
            <SearchBox
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="نام نمایشی، ایمیل، موبایل یا کد…"
            />
            <Seg
              options={FILTERS}
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setPage(1);
              }}
            />
          </div>
          <div className={s.tableScroll}>
            <div className={w.table}>
              <div className={`${w.tr} ${s.th}`}>
                <span>کاربر</span>
                <span>وضعیت</span>
                <span>تماس</span>
                <span>کد اتصال</span>
                <span>ثبت‌نام</span>
              </div>
              {data?.rows.map((u) => (
                <button key={u.id} className={`${w.tr} ${s.row}`} aria-current={selected === u.id} onClick={() => setSelected(selected === u.id ? null : u.id)}>
                  <div className={s.who}>
                    <Avatar id={u.web_id} name={u.name} />
                    <div className={s.whoText}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span className={s.name}>{u.name}</span>
                        {u.blocked && (
                          <span className={s.tag} style={{ background: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                            مسدود
                          </span>
                        )}
                      </div>
                      <span dir="ltr" className={s.idText}>
                        {formatId(u.web_id)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                    <span className="dot" style={{ background: u.online ? "var(--ok)" : "var(--off)" }} />
                    <span style={{ color: u.online ? "var(--accent-strong)" : "var(--muted)" }}>{u.online ? "آنلاین" : agoText(u.last_seen_at)}</span>
                  </div>
                  <div className={s.stack}>
                    <span dir="ltr" style={{ textAlign: "right" }}>{u.phone}</span>
                    <span dir="ltr" style={{ textAlign: "right" }}>{u.email}</span>
                  </div>
                  <span dir="ltr" className="mono" style={{ textAlign: "right" }}>{formatId(u.web_id)}</span>
                  <span>{day(u.created_at)}</span>
                </button>
              ))}
              {data && data.rows.length === 0 && (
                <div className={s.footer} style={{ padding: 30, textAlign: "center" }}>
                  {sum?.total === 0 ? "هنوز کسی در آسان دسک وب ثبت‌نام نکرده است." : "کاربری با این فیلتر پیدا نشد"}
                </div>
              )}
            </div>
          </div>
          <div className={s.footer} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{data ? `${toFa(data.total)} کاربر` : "…"}</span>
            <span style={{ flex: 1 }} />
            {data && data.pages > 1 && (
              <>
                <button className={s.btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  قبلی
                </button>
                <span>
                  {toFa(page)} از {toFa(data.pages)}
                </span>
                <button className={s.btnGhost} disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
                  بعدی
                </button>
              </>
            )}
          </div>
        </div>
        {selected !== null && <WebUserPanel key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      </div>
    </div>
  );
}

function WebUserPanel({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const flash = useToast();
  const { data: u, mutate } = useSWR<WebUserDetail>(`/api/webusers/${id}`, fetcher);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "block" | "delete">(null);
  const [password, setPassword] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      flash(done);
      mutate();
      onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "انجام نشد");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!u) {
    return <div className={`card ${s.panel}`} style={{ padding: 24 }}>…</div>;
  }
  const info: [string, string, boolean?][] = [
    ["نام نمایشی", u.display_name || "—"],
    ["ایمیل", u.email || "—", true],
    ["موبایل", u.phone || "—", true],
    ["کد اتصال", formatId(u.web_id), true],
    ["ثبت‌نام", `${day(u.created_at)} · IP ${u.signup_ip || "—"}`],
    ["آخرین ورود", u.last_login_at ? agoText(u.last_login_at) : "هرگز"],
    ["آخرین IP", u.last_ip || "—", true],
    ["ورودهای باز", toFa(u.sessions)],
    ["دستگاه‌های ذخیره‌شده", toFa(u.devices)],
    ["کنترل دستگاه دیگر", `${toFa(u.out_count)} بار`],
    ["نمایش صفحهٔ خود", `${toFa(u.in_count)} بار`],
  ];
  return (
    <div className={`card ${s.panel}`}>
      <div className={s.panelHead}>
        <Avatar id={u.web_id} name={u.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{u.name}</div>
          <div dir="ltr" style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "right" }}>
            {formatId(u.web_id)}
          </div>
        </div>
        <button className={s.iconBtn} onClick={onClose} aria-label="بستن">
          ✕
        </button>
      </div>
      {u.blocked && (
        <div className={s.blockedNote}>
          <b>این حساب مسدود است</b>
          نمی‌تواند وارد شود و کدش در سرور شناسه ثبت نمی‌شود.
        </div>
      )}
      <div className={s.section}>
        {info.map(([k, v, ltr]) => (
          <div key={k} className={s.info}>
            <span>{k}</span>
            <span dir={ltr ? "ltr" : undefined}>{v}</span>
          </div>
        ))}
      </div>
      <div className={s.section}>
        <div className={s.sectionHead}>
          <span>اتصال‌های اخیر</span>
          <span>{toFa(u.connections.length)}</span>
        </div>
        {u.connections.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>هنوز اتصالی نداشته است.</div>}
        {u.connections.map((c, i) => (
          <div key={i} className={s.sess}>
            <span className={s.sessIcon}>{c.direction === "out" ? "↗" : "↙"}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {c.direction === "out" ? "کنترل " : "نمایش صفحه به "}
              <b>{c.peer_name || formatId(c.peer_id)}</b> <span dir="ltr">({formatId(c.peer_id)})</span>
            </span>
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{agoText(c.started_at)}</span>
          </div>
        ))}
      </div>
      {password && (
        <div className={s.blockedNote} style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
          <b>رمز تازه (فقط همین یک بار نمایش داده می‌شود)</b>
          <span dir="ltr" className="mono" style={{ fontSize: 16, userSelect: "all" }}>
            {password}
          </span>
          این رمز را به کاربر بگویید؛ ورودهای قبلی او بسته شد.
        </div>
      )}
      <div className={s.actions}>
        {confirm === null && (
          <>
            <button className={s.btnGhost} disabled={busy} onClick={() => setConfirm("block")}>
              {u.blocked ? "رفع مسدودیت" : "مسدودسازی"}
            </button>
            <button
              className={s.btnGhost}
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await api<{ password: string }>(`/api/webusers/${id}/password`, { method: "POST" });
                  setPassword(r.password);
                }, "رمز تازه ساخته شد")
              }
            >
              رمز تازه
            </button>
            <button className={`${s.btnGhost} ${s.btnDanger}`} disabled={busy} onClick={() => setConfirm("delete")}>
              حذف حساب
            </button>
          </>
        )}
        {confirm === "block" && (
          <div className={s.confirmBlock}>
            <span>{u.blocked ? "این حساب دوباره بتواند وارد شود؟" : "ورودهای باز بسته می‌شود و کاربر دیگر نمی‌تواند وارد شود یا صفحه‌اش را به کسی نشان دهد. ادامه؟"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={s.btnPrimary}
                disabled={busy}
                onClick={() => act(() => api(`/api/webusers/${id}/block`, { method: "POST", body: { blocked: !u.blocked } }), u.blocked ? "مسدودیت برداشته شد" : "حساب مسدود شد")}
              >
                بله
              </button>
              <button className={s.btnGhost} onClick={() => setConfirm(null)}>
                انصراف
              </button>
            </div>
          </div>
        )}
        {confirm === "delete" && (
          <div className={s.confirmBlock}>
            <span>حساب و همهٔ گزارش‌های آن برای همیشه پاک می‌شود. ادامه؟</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={`${s.btnPrimary}`}
                style={{ background: "var(--danger-strong)" }}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api(`/api/webusers/${id}`, { method: "DELETE" });
                    onClose();
                  }, "حساب حذف شد")
                }
              >
                حذف
              </button>
              <button className={s.btnGhost} onClick={() => setConfirm(null)}>
                انصراف
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
