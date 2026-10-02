"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { BackupTab } from "@/components/settings/BackupTab";
import { HATab } from "@/components/settings/HATab";
import s from "@/components/settings/settings.module.css";
import { I } from "@/components/settings/ui";
import { UsersTab } from "@/components/settings/UsersTab";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth";
import { levelOf } from "@/lib/nav";
import { RO_TIP } from "@/lib/settings";

const SUB = [
  { id: "users", label: "کاربران و دسترسی‌ها", icon: I.users },
  { id: "backup", label: "پشتیبان‌گیری", icon: I.db },
  { id: "ha", label: "سرورهای HA", icon: I.ha },
] as const;

function SettingsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const param = useSearchParams().get("tab");
  const tabs = SUB.filter((t) => levelOf(user.perms, t.id) !== "none");
  const current = tabs.find((t) => t.id === param)?.id ?? tabs[0]?.id;
  const canEdit = current ? levelOf(user.perms, current) === "edit" : false;
  void RO_TIP;

  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>تنظیمات</div>
        <div className={s.subtitle}>کاربران پنل، پشتیبان‌گیری و افزونگی سرور شناسه/رله</div>
      </div>
      <div className={s.subtabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id} onClick={() => router.replace(`/settings?tab=${t.id}`, { scroll: false })}>
            <Icon d={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>
      {current && !canEdit && (
        <div className={s.roBanner}>
          <Icon d={I.lock} size={16} />
          <span><b>فقط مشاهده</b> — نقش شما اجازهٔ ویرایش این بخش را ندارد. دکمه‌های ویرایش غیرفعال‌اند.</span>
        </div>
      )}
      {current === "users" && <UsersTab canEdit={canEdit} />}
      {current === "backup" && <BackupTab canEdit={canEdit} />}
      {current === "ha" && <HATab canEdit={canEdit} />}
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
