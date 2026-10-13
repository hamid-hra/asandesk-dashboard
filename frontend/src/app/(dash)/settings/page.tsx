"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ActivityTab } from "@/components/settings/ActivityTab";
import { BackupTab } from "@/components/settings/BackupTab";
import { DockerLogsTab } from "@/components/settings/DockerLogsTab";
import { HATab } from "@/components/settings/HATab";
import s from "@/components/settings/settings.module.css";
import { I } from "@/components/settings/ui";
import { UpdateTab } from "@/components/settings/UpdateTab";
import { UsersTab } from "@/components/settings/UsersTab";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth";
import { levelOf } from "@/lib/nav";
import { RO_TIP } from "@/lib/settings";

// section = بخش دسترسی لازم برای دیدن تب؛ readOnlyTab = تبی که چیزی برای ویرایش ندارد (نوار «فقط مشاهده» نمی‌آید)
const SUB = [
  { id: "users", section: "users", label: "کاربران و دسترسی‌ها", icon: I.users },
  { id: "backup", section: "backup", label: "پشتیبان‌گیری", icon: I.db },
  { id: "ha", section: "ha", label: "سرورهای HA", icon: I.ha },
  { id: "activity", section: "activity", label: "لاگ فعالیت‌ها", icon: I.activity, readOnlyTab: true },
  { id: "update", section: "system", label: "به‌روزرسانی پنل", icon: I.cloud, readOnlyTab: true },
  { id: "logs", section: "system", label: "لاگ داکر", icon: I.terminal, readOnlyTab: true },
] as const;

function SettingsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const param = useSearchParams().get("tab");
  const tabs = SUB.filter((t) => levelOf(user.perms, t.section) !== "none");
  const active = tabs.find((t) => t.id === param) ?? tabs[0];
  const current = active?.id;
  const canEdit = active ? levelOf(user.perms, active.section) === "edit" : false;
  const readOnlyTab = !!active && "readOnlyTab" in active;
  void RO_TIP;

  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>تنظیمات</div>
        <div className={s.subtitle}>کاربران پنل، پشتیبان‌گیری، افزونگی سرور، لاگ فعالیت‌ها و به‌روزرسانی پنل</div>
      </div>
      <div className={s.subtabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id} onClick={() => router.replace(`/settings?tab=${t.id}`, { scroll: false })}>
            <Icon d={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>
      {current && !canEdit && !readOnlyTab && (
        <div className={s.roBanner}>
          <Icon d={I.lock} size={16} />
          <span><b>فقط مشاهده</b> — نقش شما اجازهٔ ویرایش این بخش را ندارد. دکمه‌های ویرایش غیرفعال‌اند.</span>
        </div>
      )}
      {current === "users" && <UsersTab canEdit={canEdit} />}
      {current === "backup" && <BackupTab canEdit={canEdit} />}
      {current === "ha" && <HATab canEdit={canEdit} />}
      {current === "activity" && <ActivityTab />}
      {current === "update" && <UpdateTab />}
      {current === "logs" && <DockerLogsTab />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
