import "@fontsource/vazirmatn/300.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/vazirmatn/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "آسان‌دسک — پنل مالک",
  description: "داشبورد مدیریتی آسان‌دسک",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // تم از cookie خوانده می‌شود تا صفحه بدون پرش رنگ رندر شود
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="fa" dir="rtl" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
