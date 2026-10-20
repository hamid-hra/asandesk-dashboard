"use client";

import { useState } from "react";
import useSWR from "swr";

import { AlertsCard } from "@/components/server/AlertsCard";
import { BreakdownCard } from "@/components/server/BreakdownCard";
import { ConnChart } from "@/components/server/ConnChart";
import { Kpis } from "@/components/server/Kpis";
import { LiveCard } from "@/components/server/LiveCard";
import { RangeHeader } from "@/components/server/RangeHeader";
import { RequestsCard } from "@/components/server/RequestsCard";
import { ResourceChart } from "@/components/server/ResourceChart";
import { ServersTable } from "@/components/server/ServersTable";
import s from "@/components/server/server.module.css";
import { fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import type { Live, Overview, RangeId } from "@/lib/types";

export default function ServerPage() {
  const [range, setRange] = useState<RangeId>("7d");
  const [auto, setAuto] = useState(true);
  // null = همهٔ سرورهای پایش‌شده؛ وگرنه شناسهٔ یکی از آن‌ها
  const [serverId, setServerId] = useState<number | null>(null);
  const q = serverId ? `&server=${serverId}` : "";
  const { data: overview } = useSWR<Overview>(`/api/monitoring/overview?range=${range}${q}`, fetcher, {
    refreshInterval: auto ? 60000 : 0,
    keepPreviousData: true,
  });
  const { data: live } = useSWR<Live>(`/api/monitoring/live${serverId ? `?server=${serverId}` : ""}`, fetcher, { refreshInterval: auto ? 5000 : 0 });
  const servers = overview?.servers ?? [];
  // سروری که حذف یا بی‌agent شد، انتخابش به «همه» برمی‌گردد
  const activeServer = servers.find((x) => x.id === serverId);
  const scope = activeServer ? activeServer.name : servers.length > 1 ? `همهٔ سرورها (${toFa(servers.length)})` : (servers[0]?.name ?? "");

  const points = overview?.points ?? [];
  const cpuVals = points.map((p) => p.cpu).filter((v): v is number => v != null);
  const cpuAvg = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
  const connNow = live?.aggregate?.tcp_established ?? null;

  return (
    <div className={s.page}>
      <RangeHeader range={range} onChange={setRange} servers={servers} serverId={activeServer ? serverId : null} onServer={setServerId} />
      <Kpis data={overview} connNow={connNow} />
      <RequestsCard requests={overview?.requests} range={overview?.range ?? range} />
      <div className={s.row}>
        <ConnChart points={points} range={overview?.range ?? range} connNow={connNow} />
        <LiveCard live={live} cpuAvg={cpuAvg} auto={auto} onToggleAuto={() => setAuto((v) => !v)} scope={scope} single={!!activeServer} />
      </div>
      <ResourceChart points={points} range={overview?.range ?? range} scope={scope} />
      <div className={s.row}>
        <AlertsCard refresh={auto ? 15000 : 0} />
        <BreakdownCard breakdown={overview?.breakdown} />
      </div>
      <ServersTable servers={overview?.servers ?? []} />
    </div>
  );
}
