"use client";

import { HATab } from "@/components/settings/HATab";
import s from "@/components/settings/settings.module.css";
import { I } from "@/components/settings/ui";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth";
import { levelOf } from "@/lib/nav";

export default function HAPage() {
  const { user } = useAuth();
  const canEdit = levelOf(user.perms, "ha") === "edit";
  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>سرورهای HA</div>
        <div className={s.subtitle}>سلامت سرورهای شناسه و رله و جابه‌جایی خودکار بین آن‌ها (failover)</div>
      </div>
      {!canEdit && (
        <div className={s.roBanner}>
          <Icon d={I.lock} size={16} />
          <span><b>فقط مشاهده</b> — نقش شما اجازهٔ ویرایش این بخش را ندارد. دکمه‌های ویرایش غیرفعال‌اند.</span>
        </div>
      )}
      <HATab canEdit={canEdit} />
    </div>
  );
}
