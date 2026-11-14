import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, Users, UserCheck, CalendarCheck, CheckCircle2, Trophy, IndianRupee,
  AlertTriangle, Info, Sparkles, RefreshCw, Settings2, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface FunnelStage {
  key: "enquiries" | "qualified" | "booked" | "attended" | "closed";
  label: string;
  count: number;
  pctOfTotal: number;
  pctOfPrev: number;
}

interface FunnelResponse {
  period: { label: string; startDate: string; endDate: string };
  config: { avgDealValue: number; monthlySpend: number; currency: string; closedStageKeywords: string };
  stages: FunnelStage[];
  extra: { noShow: number; cancelled: number; upcoming: number; awaitingOutcome: number; lost: number; hot: number; warm: number };
  money: {
    currency: string;
    avgDealValue: number;
    periodSpend: number;
    revenue: number;
    roiPercent: number | null;
    costPerEnquiry: number | null;
    costPerBooking: number | null;
    costPerSale: number | null;
  };
  sources: Array<{
    source: string;
    enquiries: number;
    qualified: number;
    booked: number;
    attended: number;
    closed: number;
    revenue: number;
    conversionPct: number;
  }>;
  insights: Array<{ level: "warning" | "info" | "success"; text: string }>;
}

const STAGE_STYLE: Record<FunnelStage["key"], { color: string; icon: any }> = {
  enquiries: { color: "bg-blue-500", icon: Users },
  qualified: { color: "bg-indigo-500", icon: UserCheck },
  booked: { color: "bg-amber-500", icon: CalendarCheck },
  attended: { color: "bg-purple-500", icon: CheckCircle2 },
  closed: { color: "bg-emerald-500", icon: Trophy },
};

function money(currency: string, v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${currency}${Math.round(v).toLocaleString("en-IN")}`;
}

export function SourceToSaleFunnel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [range, setRange] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ avgDealValue: 0, monthlySpend: 0, currency: "₹", closedStageKeywords: "" });

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams({ range });
    if (range === "custom") {
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    }
    return `/api/sales-team/roi-funnel?${p.toString()}`;
  }, [range, from, to]);

  const { data, isLoading, isFetching, refetch, error } = useQuery<FunnelResponse>({
    queryKey: ["/api/sales-team/roi-funnel", range, from, to],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      return res.json();
    },
    enabled: range !== "custom" || !!from,
  });

  useEffect(() => {
    if (data?.config) {
      setSettingsForm({
        avgDealValue: data.config.avgDealValue || 0,
        monthlySpend: data.config.monthlySpend || 0,
        currency: data.config.currency || "₹",
        closedStageKeywords: data.config.closedStageKeywords || "",
      });
    }
  }, [data?.config]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/sales-team/roi-funnel-config", settingsForm);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/roi-funnel"] });
      setShowSettings(false);
      toast({ title: "✅ ROI Settings Saved", description: "Revenue & ROI will now be calculated using your updated values." });
    },
    onError: (err: any) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  const maxCount = Math.max(1, ...(data?.stages || []).map((s) => s.count));
  const cur = data?.money.currency || "₹";

  return (
    <Card className="border-emerald-500/30">
      <CardHeader className="pb-3 border-b bg-gradient-to-r from-emerald-500/10 via-blue-500/5 to-transparent">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              Source-to-Sale ROI Funnel
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px]">Live</Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Enquiries ➔ Qualified ➔ Booked ➔ Attended ➔ Closed Sales — {data?.period.label || "..."}
              {data?.period ? ` (${data.period.startDate} → ${data.period.endDate})` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
            {range === "custom" && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs w-36" />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs w-36" />
              </>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="w-3.5 h-3.5" /> ROI Settings
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-5">
        {/* ROI Settings */}
        {showSettings && (
          <div className="p-3 rounded-lg border bg-muted/30 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Average Deal Value ({settingsForm.currency})</Label>
              <Input
                type="number"
                min={0}
                value={settingsForm.avgDealValue}
                onChange={(e) => setSettingsForm((p) => ({ ...p, avgDealValue: Number(e.target.value) || 0 }))}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Average revenue earned from 1 closed sale.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Monthly Spend ({settingsForm.currency})</Label>
              <Input
                type="number"
                min={0}
                value={settingsForm.monthlySpend}
                onChange={(e) => setSettingsForm((p) => ({ ...p, monthlySpend: Number(e.target.value) || 0 }))}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Total monthly spend on AI calling, ads, and team (used for ROI).</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">"Closed" Lead Stage Keywords</Label>
              <Input
                value={settingsForm.closedStageKeywords}
                onChange={(e) => setSettingsForm((p) => ({ ...p, closedStageKeywords: e.target.value }))}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Kanban stage names matching these keywords will be counted as Closed Sales.</p>
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending}
              >
                {saveSettings.isPending ? "Saving..." : "Save Settings"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowSettings(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-xs text-red-500">Failed to load funnel: {(error as any)?.message}</div>
        ) : !data ? (
          <div className="text-xs text-muted-foreground">Please select a start date for the custom range.</div>
        ) : (
          <>
            {/* Funnel bars */}
            <div className="space-y-2">
              {data.stages.map((s, i) => {
                const style = STAGE_STYLE[s.key];
                const Icon = style.icon;
                const width = Math.max(6, (s.count / maxCount) * 100);
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="w-44 shrink-0 flex items-center gap-2 text-xs font-semibold">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {s.label}
                    </div>
                    <div className="flex-1 relative h-9 bg-muted/40 rounded-md overflow-hidden">
                      <div
                        className={`${style.color} h-full rounded-md flex items-center px-3 text-white text-sm font-bold transition-all`}
                        style={{ width: `${width}%` }}
                      >
                        {s.count}
                      </div>
                    </div>
                    <div className="w-36 shrink-0 text-right text-[11px] leading-tight">
                      <div className="font-semibold">{s.pctOfTotal}% of enquiries</div>
                      {i > 0 && <div className="text-muted-foreground">{s.pctOfPrev}% from previous</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Extra counters */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              {[
                { label: "🔥 Hot Leads", v: data.extra.hot },
                { label: "🌤️ Warm Leads", v: data.extra.warm },
                { label: "📅 Upcoming", v: data.extra.upcoming },
                { label: "⏳ Outcome Pending", v: data.extra.awaitingOutcome },
                { label: "🚫 No-Show", v: data.extra.noShow },
                { label: "❌ Cancelled", v: data.extra.cancelled },
              ].map((x) => (
                <div key={x.label} className="p-2 rounded-lg border bg-background/60">
                  <div className="text-muted-foreground text-[11px]">{x.label}</div>
                  <div className="text-lg font-bold">{x.v}</div>
                </div>
              ))}
            </div>

            {/* Money */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <div className="text-muted-foreground text-[11px] flex items-center gap-1">
                  <IndianRupee className="w-3 h-3" /> Estimated Revenue
                </div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{money(cur, data.money.revenue)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {data.stages.find((s) => s.key === "closed")?.count || 0} sales × {money(cur, data.money.avgDealValue)}
                </div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-muted-foreground text-[11px]">Spend (this period)</div>
                <div className="text-xl font-bold">{money(cur, data.money.periodSpend)}</div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-muted-foreground text-[11px]">ROI</div>
                <div
                  className={`text-xl font-bold ${
                    data.money.roiPercent === null ? "" : data.money.roiPercent >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {data.money.roiPercent === null ? "—" : `${data.money.roiPercent}%`}
                </div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-muted-foreground text-[11px]">Cost / Booking</div>
                <div className="text-xl font-bold">{money(cur, data.money.costPerBooking)}</div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-muted-foreground text-[11px]">Cost / Sale</div>
                <div className="text-xl font-bold">{money(cur, data.money.costPerSale)}</div>
              </div>
            </div>
            {data.money.avgDealValue <= 0 && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                To view Revenue & ROI, enter your Average Deal Value and Monthly Spend in <strong>ROI Settings</strong> above.
              </p>
            )}

            {/* Insights */}
            {data.insights.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Lead Drop-Off & Leakage Insights
                </div>
                {data.insights.map((ins, idx) => (
                  <div
                    key={idx}
                    className={`text-xs p-2 rounded-md border flex items-start gap-2 ${
                      ins.level === "warning"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : ins.level === "success"
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-blue-500/20 bg-blue-500/5"
                    }`}
                  >
                    {ins.level === "warning" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    ) : ins.level === "success" ? (
                      <Trophy className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    ) : (
                      <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                    )}
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Source breakdown */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">Source-wise Breakdown</div>
              {data.sources.length === 0 ? (
                <div className="text-xs text-muted-foreground">No enquiries found in this period.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2 font-semibold">Source</th>
                        <th className="p-2 font-semibold text-right">Enquiries</th>
                        <th className="p-2 font-semibold text-right">Qualified</th>
                        <th className="p-2 font-semibold text-right">Booked</th>
                        <th className="p-2 font-semibold text-right">Attended</th>
                        <th className="p-2 font-semibold text-right">Closed</th>
                        <th className="p-2 font-semibold text-right">Conv. %</th>
                        <th className="p-2 font-semibold text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.source} className="border-t">
                          <td className="p-2 font-medium">{s.source}</td>
                          <td className="p-2 text-right">{s.enquiries}</td>
                          <td className="p-2 text-right">{s.qualified}</td>
                          <td className="p-2 text-right">{s.booked}</td>
                          <td className="p-2 text-right">{s.attended}</td>
                          <td className="p-2 text-right font-semibold text-emerald-600">{s.closed}</td>
                          <td className="p-2 text-right">{s.conversionPct}%</td>
                          <td className="p-2 text-right">{money(cur, s.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
