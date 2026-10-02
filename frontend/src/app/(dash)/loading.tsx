import { AsanLoader } from "@/components/AsanLoader";

/** هنگام رفتن به یک تب (بارگذاری مسیر) داخل قاب پنل نمایش داده می‌شود */
export default function Loading() {
  return <AsanLoader label="در حال بارگذاری" />;
}
