"use client";

import { useEffect } from "react";

import { ErrorScreen } from "@/components/ErrorScreen";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      title="مشکلی در پنل پیش آمد"
      message="این خطا از سمت ماست، نه شما."
      hint="چند لحظه بعد دوباره امتحان کنید."
      primary={{ label: "تلاش دوباره", onClick: () => retry() }}
      secondary={{ label: "بازگشت به خانه", href: "/" }}
    />
  );
}
