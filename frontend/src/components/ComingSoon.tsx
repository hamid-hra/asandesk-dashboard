import type { Tab } from "@/lib/nav";

import { Icon } from "./Icon";
import s from "./ComingSoon.module.css";

export function ComingSoon({ tab }: { tab: Tab }) {
  return (
    <div className={s.wrap}>
      <div className={s.inner}>
        <div className={s.icon}>
          <Icon d={tab.icon} size={34} stroke={1.6} />
        </div>
        <span className={s.phase}>فاز ۳</span>
        <div className={s.title}>به‌زودی</div>
        <div className={s.label}>{tab.label}</div>
        <div className={s.desc}>{tab.soon}</div>
        <div className={s.en}>COMING SOON</div>
      </div>
    </div>
  );
}
