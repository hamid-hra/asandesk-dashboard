"use client";

import useSWR from "swr";

import { InfoTip } from "@/components/Tip";
import { ReleaseForm } from "@/components/releases/ReleaseForm";
import { ReleaseHistory } from "@/components/releases/ReleaseHistory";
import s from "@/components/releases/releases.module.css";
import { UpdateJsonCard } from "@/components/releases/UpdateJsonCard";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmt, pctText, toFa } from "@/lib/fa";
import { useToast } from "@/lib/toast";
import type { Release, ReleaseStats } from "@/lib/types";

const DIST_COLORS = ["var(--ok)", "var(--dist-2)", "var(--dist-3)", "var(--older)"];

/** سهم‌های زیر ۱۰٪ با یک رقم اعشار، تا نسخهٔ ۲٪ «۰٪» یا هم‌اندازهٔ ۳٪ دیده نشود */
const pctShare = (v: number) => pctText(v, v < 10 ? 1 : 0);

export default function ReleasesPage() {
  const { user } = useAuth();
  const flash = useToast();
  const { data: releases, mutate } = useSWR<Release[]>("/api/releases", fetcher);
  const { data: stats, mutate: mutateStats } = useSWR<ReleaseStats>("/api/releases/stats", fetcher);

  const statItems: { label: string; value: string; mono: boolean; tip?: string }[] = [
    { label: "آخرین نسخه پایدار", value: stats?.latest_stable ?? "—", mono: true },
    { label: "آخرین نسخه بتا", value: stats?.latest_beta ?? "—", mono: true },
    {
      label: "نصب تازه · ۳۰ روز اخیر",
      value: stats ? fmt(stats.installs_30d) : "—",
      mono: false,
      tip: "هر دستگاهی که تازه نصب کرده و اولین درخواستش در ۳۰ روز اخیر به API رسیده. از خود دانلود نمی‌شمارد، پس با فایل روی CDN هم درست است.",
    },
    { label: "کاربران روی نسخه فعلی", value: stats?.users_on_current == null ? "—" : pctText(stats.users_on_current), mono: false },
  ];
  const dist = stats?.distribution;

  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>نسخه‌ها</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>انتشار نسخه جدید و تاریخچه انتشارها</div>
      </div>

      <div className={s.stats}>
        {statItems.map((k) => (
          <div key={k.label} className={s.stat}>
            <span>
              {k.label}
              {k.tip && <InfoTip text={k.tip} />}
            </span>
            <span dir="ltr" className={k.mono && k.value !== "—" ? "mono" : undefined}>
              {k.value}
            </span>
          </div>
        ))}
      </div>

      <div className={`card ${s.dist}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="card-title">توزیع نسخه‌ها بین کاربران</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {dist ? `از ${fmt(stats?.active_devices ?? 0)} دستگاه فعال در ۳۰ روز اخیر` : "بدون داده"}
          </span>
        </div>
        {/* بدون dir=ltr: اولین نسخه سمت راست است، همان جایی که اولین ردیف راهنما */}
        <div className={s.distBar}>
          {dist?.map((d, i) => (
            <span key={d.version} title={`${d.version}: ${fmt(d.count)} دستگاه (${pctShare(d.share)})`} style={{ width: `${d.share}%`, background: DIST_COLORS[Math.min(i, 3)] }} />
          ))}
        </div>
        {dist ? (
          <div className={s.distLegend}>
            {dist.map((d, i) => (
              <div key={d.version} className={s.distItem}>
                <span className={s.distSwatch} style={{ background: DIST_COLORS[Math.min(i, 3)] }} />
                <span className={s.distName}>
                  {d.versions ? (
                    `${d.version} (${toFa(d.versions)} نسخه)`
                  ) : (
                    <bdi dir="ltr" className="mono">
                      {d.version}
                    </bdi>
                  )}
                  {d.version === stats?.latest_stable && <em>نسخهٔ فعلی</em>}
                </span>
                <b>{pctShare(d.share)}</b>
                <small>{fmt(d.count)} دستگاه</small>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>پس از اتصال کلاینت‌ها به API آسان‌دسک، سهم هر نسخه از دستگاه‌های فعال اینجا نمایش داده می‌شود.</div>
        )}
      </div>

      <div className={s.cols}>
        {user.can_manage ? (
          <ReleaseForm
            existing={(releases ?? []).map((r) => r.version)}
            onPublished={(r) => {
              mutate((cur) => [r, ...(cur ?? [])], { revalidate: true });
              mutateStats();
              flash(`نسخه ${r.version} منتشر شد`);
            }}
          />
        ) : (
          <div className="card empty">برای انتشار نسخه جدید به نقش «مدیر» یا «مالک» نیاز دارید.</div>
        )}
        <ReleaseHistory
          releases={releases}
          current={stats?.latest_stable ?? null}
          canDelete={user.perms.release === "edit"}
          onDeleted={(version) => {
            mutate((cur) => (cur ?? []).filter((r) => r.version !== version), { revalidate: true });
            mutateStats();
            flash(`نسخه ${version} حذف شد`);
          }}
        />
      </div>

      <UpdateJsonCard releases={releases} onSaved={() => mutate()} />
    </div>
  );
}
