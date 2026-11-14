import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Mail, MessageSquare, Send, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface WeeklyBriefConfig {
  enabled: boolean;
  dayOfWeek: number;
  hourIst: number;
  minuteIst: number;
  channels: { whatsapp: boolean; email: boolean };
  ownerName: string;
  ownerPhones: string;
  ownerEmails: string;
  whatsappTemplateName: string;
  whatsappTemplateLanguage: string;
  lastSentWeekKey?: string;
}

interface WeeklyBriefLogEntry {
  id: string;
  trigger: "auto" | "manual";
  weekKey: string;
  enquiries: number;
  qualified: number;
  booked: number;
  attended: number;
  closed: number;
  revenue: number;
  whatsappSent: boolean;
  emailSent: boolean;
  createdAt: string;
}

const CONFIG_KEY = ["/api/sales-team/weekly-owner-brief-config"];
const LOGS_KEY = ["/api/sales-team/weekly-owner-brief-logs"];

const DAYS = [
  { value: "1", label: "Monday (Start of Week)" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday (End of Week)" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hr12 = h % 12 === 0 ? 12 : h % 12;
  return { value: String(h), label: `${hr12}:00 ${period} IST` };
});

export function WeeklyOwnerBriefPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: savedConfig } = useQuery<WeeklyBriefConfig>({ queryKey: CONFIG_KEY });
  const { data: logs = [] } = useQuery<WeeklyBriefLogEntry[]>({ queryKey: LOGS_KEY, refetchInterval: 30000 });
  const [form, setForm] = useState<WeeklyBriefConfig | null>(null);

  useEffect(() => {
    if (savedConfig) setForm(savedConfig);
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (cfg: WeeklyBriefConfig) => {
      const res = await apiRequest("PUT", "/api/sales-team/weekly-owner-brief-config", cfg);
      return res.json();
    },
    onSuccess: (saved: WeeklyBriefConfig) => {
      queryClient.setQueryData(CONFIG_KEY, saved);
      toast({ title: "✅ Weekly Owner Brief Saved", description: "Your weekly report schedule is now updated." });
    },
    onError: (err: any) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  const sendNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/weekly-owner-brief/send-now", { test: true });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: LOGS_KEY });
      toast({
        title: r?.success ? "📊 Weekly Brief Sent!" : "Brief Could Not Be Delivered",
        description: r?.success
          ? `WhatsApp: ${r.whatsappSent ? "✅" : "❌"} • Email: ${r.emailSent ? "✅" : "❌"} (Enquiries: ${r.metrics?.enquiries ?? 0}, Booked: ${r.metrics?.booked ?? 0})`
          : r?.error || "Please verify Owner Phone / Email and save settings first.",
        variant: r?.success ? undefined : "destructive",
      });
    },
    onError: (err: any) => toast({ title: "Send Failed", description: err.message, variant: "destructive" }),
  });

  if (!form) {
    return (
      <Card>
        <CardContent className="py-6 text-xs text-muted-foreground">Loading Weekly Owner Brief settings...</CardContent>
      </Card>
    );
  }

  const update = (patch: Partial<WeeklyBriefConfig>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <Card className="border-blue-500/30">
      <CardHeader className="pb-3 border-b bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-transparent">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-blue-500" />
              Weekly Owner Brief (WhatsApp + Email)
              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 text-[10px]">
                Automated Weekly Digest
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Automatically send a 7-day executive summary (Enquiries, Qualified, Bookings, Attended, No-Shows, Sales, Revenue & Top Insight) every week.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <span>Auto-Send</span>
              <Switch checked={form.enabled} onCheckedChange={(v) => update({ enabled: v })} />
            </label>
            <Button
              size="sm"
              className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save Brief Settings"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-5 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Owner / Recipient Name</Label>
            <Input
              placeholder="e.g. Sunil"
              value={form.ownerName}
              onChange={(e) => update({ ownerName: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Owner WhatsApp Number(s)</Label>
            <Input
              placeholder="+9198XXXXXXXX"
              value={form.ownerPhones}
              onChange={(e) => update({ ownerPhones: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Owner Email(s)</Label>
            <Input
              placeholder="owner@company.com (blank = account email)"
              value={form.ownerEmails}
              onChange={(e) => update({ ownerEmails: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Send Day (IST)</Label>
            <Select value={String(form.dayOfWeek)} onValueChange={(v) => update({ dayOfWeek: Number(v) })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold">Send Time (IST)</Label>
            <Select value={String(form.hourIst)} onValueChange={(v) => update({ hourIst: Number(v) })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-4 pb-1.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch
                checked={form.channels.whatsapp}
                onCheckedChange={(v) => update({ channels: { ...form.channels, whatsapp: v } })}
              />
              <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch
                checked={form.channels.email}
                onCheckedChange={(v) => update({ channels: { ...form.channels, email: v } })}
              />
              <Mail className="w-3.5 h-3.5 text-blue-600" /> Email
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs border-blue-500/40 text-blue-600 dark:text-blue-400"
              disabled={sendNowMutation.isPending}
              onClick={() => sendNowMutation.mutate()}
            >
              <Send className="w-3.5 h-3.5" />
              {sendNowMutation.isPending ? "Sending..." : "Send Brief Now (Test)"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 space-y-1">
            <Label className="text-[11px]">Approved WhatsApp Template (optional, for outside 24h window)</Label>
            <Input
              placeholder="e.g. weekly_owner_brief ({{1}} = owner name, {{2}} = summary)"
              value={form.whatsappTemplateName}
              onChange={(e) => update({ whatsappTemplateName: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Template Language</Label>
            <Input
              value={form.whatsappTemplateLanguage}
              onChange={(e) => update({ whatsappTemplateLanguage: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>

        {/* Recent Briefs Log */}
        <div className="space-y-2 pt-2 border-t">
          <div className="font-semibold flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Recent Weekly Briefs Sent
          </div>
          {logs.length === 0 ? (
            <div className="text-muted-foreground">No weekly briefs sent yet. Save settings and click "Send Brief Now (Test)" to test.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {logs.slice(0, 6).map((l) => (
                <div key={l.id} className="p-2 rounded border flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      Enquiries: {l.enquiries} • Booked: {l.booked} • Closed: {l.closed}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(l.createdAt).toLocaleString("en-IN")} • {l.trigger === "manual" ? "Manual Test" : "Automatic"}
                    </div>
                  </div>
                  <div className="text-[10px] whitespace-nowrap">
                    WA {l.whatsappSent ? "✅" : "❌"} • Email {l.emailSent ? "✅" : "❌"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
