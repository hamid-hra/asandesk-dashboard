import s from "@/app/login/login.module.css";
import { Logo } from "@/components/Logo";
import { InfoTip } from "@/components/Tip";

// تکه‌های مشترک صفحه‌های ورود، بازیابی رمز، اولین ورود و اطلاعات تماس

export function Brand() {
  return (
    <div className={s.brand}>
      <Logo size={40} />
      <div className={s.brandName}>آسان‌دسک</div>
    </div>
  );
}

/** عنوان فرم؛ توضیح فقط با بردن نشانگر روی «ⓘ» دیده می‌شود */
export function Title({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <div className={s.titleRow}>
      <div className={s.title}>{children}</div>
      {tip && <InfoTip text={tip} side="bottom" />}
    </div>
  );
}

/** برچسب فیلد با راهنمای اختیاری */
export function Label({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <span className={s.labelRow}>
      {children}
      {tip && <InfoTip text={tip} />}
    </span>
  );
}
