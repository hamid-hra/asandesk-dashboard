"use client";

import useSWR from "swr";

import { ReleaseForm } from "@/components/releases/ReleaseForm";
import { ReleaseHistory } from "@/components/releases/ReleaseHistory";
import s from "@/components/releases/releases.module.css";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmt, pctText, toFa } from "@/lib/fa";
import { useToast } from "@/lib/toast";
import type { Release, ReleaseStats } from "@/lib/types";

const DIST_COLORS = ["var(--ok)", "var(--dist-2)", "var(--dist-3)", "var(--older)"];

export default function ReleasesPage() {
  const { user } = useAuth();
  const flash = useToast();
  const { data: releases, mutate } = useSWR<Release[]>("/api/releases", fetcher);
  const { data: stats, mutate: mutateStats } = useSWR<ReleaseStats>("/api/releases/stats", fetcher);

  const statItems = [
    { label: "آخرین نسخه پایدار", value: stats?.latest_stable ?? "—", mono: true },
    { label: "آخرین نسخه بتا", value: stats?.latest_beta ?? "—", mono: true },
    { label: "دانلود ۳۰ روز اخیر", value: stats ? fmt(stats.downloads_30d) : "—", mono: false },
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
            <span>{k.label}</span>
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
          <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{dist ? "" : "بدون داده"}</span>
        </div>
        <div dir="ltr" className={s.distBar}>
          {dist?.map((d, i) => (
            <span key={d.version} style={{ width: `${d.share}%`, background: DIST_COLORS[Math.min(i, 3)] }} />
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {dist
            ? dist.map((d) => `${d.version} ${toFa(Math.round(d.share))}٪`).join(" · ")
            : "پس از اتصال کلاینت‌ها به API آسان‌دسک، سهم هر نسخه از دستگاه‌های فعال اینجا نمایش داده می‌شود."}
        </div>
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
        <ReleaseHistory releases={releases} current={stats?.latest_stable ?? null} />
      </div>
    </div>
  );
}
