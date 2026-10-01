"use client";

import { useState } from "react";
import useSWR from "swr";

import { AlertsCard } from "@/components/server/AlertsCard";
import { BreakdownCard } from "@/components/server/BreakdownCard";
import { ConnChart } from "@/components/server/ConnChart";
import { Kpis } from "@/components/server/Kpis";
import { LiveCard } from "@/components/server/LiveCard";
import { RangeHeader } from "@/components/server/RangeHeader";
import { ResourceChart } from "@/components/server/ResourceChart";
import { ServersTable } from "@/components/server/ServersTable";
import s from "@/components/server/server.module.css";
import { fetcher } from "@/lib/api";
import type { Live, Overview, RangeId } from "@/lib/types";

export default function ServerPage() {
  const [range, setRange] = useState<RangeId>("7d");
  const [auto, setAuto] = useState(true);
  const { data: overview } = useSWR<Overview>(`/api/monitoring/overview?range=${range}`, fetcher, {
    refreshInterval: auto ? 60000 : 0,
    keepPreviousData: true,
  });
  const { data: live } = useSWR<Live>("/api/monitoring/live", fetcher, { refreshInterval: auto ? 5000 : 0 });

  const points = overview?.points ?? [];
  const cpuVals = points.map((p) => p.cpu).filter((v): v is number => v != null);
  const cpuAvg = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
  const connNow = live?.aggregate?.tcp_established ?? null;

  return (
    <div className={s.page}>
      <RangeHeader range={range} onChange={setRange} />
      <Kpis data={overview} connNow={connNow} />
      <div className={s.row}>
        <ConnChart points={points} range={overview?.range ?? range} connNow={connNow} />
        <LiveCard live={live} cpuAvg={cpuAvg} auto={auto} onToggleAuto={() => setAuto((v) => !v)} />
      </div>
      <ResourceChart points={points} range={overview?.range ?? range} />
      <div className={s.row}>
        <AlertsCard refresh={auto ? 15000 : 0} />
        <BreakdownCard breakdown={overview?.breakdown} total={connNow ?? 0} />
      </div>
      <ServersTable servers={overview?.servers ?? []} />
    </div>
  );
}
