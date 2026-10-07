"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="صفحه پیدا نشد"
      message="آدرسی که باز کردید وجود ندارد یا جابه‌جا شده است."
      hint="آدرس را بررسی کنید یا به صفحهٔ اصلی برگردید."
      primary={{ label: "بازگشت به خانه", href: "/" }}
      secondary={{ label: "صفحهٔ قبل", onClick: () => history.back() }}
    />
  );
}
