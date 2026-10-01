import { notFound } from "next/navigation";

import { ComingSoon } from "@/components/ComingSoon";
import { TABS } from "@/lib/nav";

export function generateStaticParams() {
  return TABS.filter((t) => t.soon).map((t) => ({ soon: t.href.slice(1) }));
}

export const dynamicParams = false;

export default async function SoonPage({ params }: { params: Promise<{ soon: string }> }) {
  const { soon } = await params;
  const tab = TABS.find((t) => t.soon && t.href === `/${soon}`);
  if (!tab) notFound();
  return <ComingSoon tab={tab} />;
}
