import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, AlertTriangle, CheckCircle2, MessageSquare, Mail, Send, Clock, ShieldAlert, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface ReviewComplaintConfig {
  reviewRequestEnabled: boolean;
  reviewDelayMinutes: number;
  reviewTriggerStatuses: string[];
  googleReviewLink: string;
  reviewChannels: { whatsapp: boolean; email: boolean };
  reviewWhatsappMessage: string;
  reviewEmailSubject: string;
  reviewEmailMessage: string;
  reviewWhatsappTemplateName: string;
  reviewWhatsappTemplateLanguage: string;
  complaintAlertEnabled: boolean;
  complaintDetectNegativeSentiment: boolean;
  complaintDetectKeywords: boolean;
  complaintKeywords: string;
  complaintChannels: { whatsapp: boolean; email: boolean };
  managerName: string;
  managerPhones: string;
  managerEmails: string;
  complaintMinCallSeconds: number;
}

interface LogsResponse {
  complaints: Array<{
    id: string;
    customerName: string;
    customerPhone: string;
    reason: string;
    whatsappSent: boolean;
    emailSent: boolean;
    engine: string;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    customerName: string;
    customerPhone: string;
    whatsappSent: boolean;
    emailSent: boolean;
    trigger: string;
    createdAt: string;
  }>;
}

const CONFIG_KEY = ["/api/sales-team/review-complaint-config"];
const LOGS_KEY = ["/api/sales-team/review-complaint-logs"];

const DELAY_PRESETS = [
  { value: "0", label: "Immediately (turant)" },
  { value: "30", label: "30 minutes baad" },
  { value: "60", label: "1 hour baad" },
  { value: "120", label: "2 hours baad (Recommended)" },
  { value: "240", label: "4 hours baad" },
  { value: "1440", label: "Next day (24 hours)" },
  { value: "custom", label: "Custom time..." },
];

const TRIGGER_STATUS_OPTIONS = [
  { value: "completed_visited", label: "Attended & Completed" },
  { value: "deal_won", label: "Deal Won / Converted" },
  { value: "interested_followup", label: "Interested - Follow-up" },
];

function formatDelay(mins: number) {
  if (!mins) return "immediately";
  if (mins % 1440 === 0) return `${mins / 1440} day(s)`;
  if (mins % 60 === 0) return `${mins / 60} hour(s)`;
  return `${mins} min`;
}

export function ReviewComplaintAutomationPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: savedConfig } = useQuery<ReviewComplaintConfig>({ queryKey: CONFIG_KEY });
  const { data: logs } = useQuery<LogsResponse>({ queryKey: LOGS_KEY, refetchInterval: 30000 });

  const [form, setForm] = useState<ReviewComplaintConfig | null>(null);
  const [customDelayValue, setCustomDelayValue] = useState<number>(2);
  const [customDelayUnit, setCustomDelayUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [delayPreset, setDelayPreset] = useState<string>("120");

  useEffect(() => {
    if (!savedConfig) return;
    setForm(savedConfig);
    const d = Number(savedConfig.reviewDelayMinutes) || 0;
    const preset = DELAY_PRESETS.find((p) => p.value === String(d));
    setDelayPreset(preset ? preset.value : "custom");
    if (d > 0 && d % 1440 === 0) {
      setCustomDelayUnit("days");
      setCustomDelayValue(d / 1440);
    } else if (d > 0 && d % 60 === 0) {
      setCustomDelayUnit("hours");
      setCustomDelayValue(d / 60);
    } else {
      setCustomDelayUnit("minutes");
      setCustomDelayValue(d);
    }
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (config: ReviewComplaintConfig) => {
      const res = await apiRequest("PUT", "/api/sales-team/review-complaint-config", config);
      return res.json();
    },
    onSuccess: (saved: ReviewComplaintConfig) => {
      queryClient.setQueryData(CONFIG_KEY, saved);
      toast({ title: "✅ Review & Complaint Automation Saved", description: "Rules are now live and running automatically." });
    },
    onError: (err: any) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  const testAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/review-complaint/test-alert", {});
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: LOGS_KEY });
      toast({
        title: r?.alerted ? "🚨 Test Alert Sent" : "Test alert not sent",
        description: r?.alerted
          ? `WhatsApp: ${r.whatsappSent ? "✅" : "❌"} • Email: ${r.emailSent ? "✅" : "❌"}`
          : "Please save Manager phone/email first and enable at least one detection rule.",
        variant: r?.alerted ? undefined : "destructive",
      });
    },
    onError: (err: any) => toast({ title: "Test Failed", description: err.message, variant: "destructive" }),
  });

  if (!form) {
    return (
      <Card>
        <CardContent className="py-6 text-xs text-muted-foreground">Loading Review & Complaint automation...</CardContent>
      </Card>
    );
  }

  const update = (patch: Partial<ReviewComplaintConfig>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const applyCustomDelay = (value: number, unit: "minutes" | "hours" | "days") => {
    const mult = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
    update({ reviewDelayMinutes: Math.max(0, Math.round((Number(value) || 0) * mult)) });
  };

  const toggleTriggerStatus = (status: string, checked: boolean) => {
    const set = new Set(form.reviewTriggerStatuses);
    if (checked) set.add(status);
    else set.delete(status);
    update({ reviewTriggerStatuses: Array.from(set) });
  };

  const handleSave = () => {
    if (form.reviewRequestEnabled && !form.googleReviewLink.trim()) {
      toast({ title: "Google Review Link required", description: "Please paste your Google Review link before enabling.", variant: "destructive" });
      return;
    }
    if (form.reviewRequestEnabled && form.reviewTriggerStatuses.length === 0) {
      toast({ title: "Select at least one trigger status", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="p-4 rounded-xl border border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 via-red-500/5 to-transparent flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Star className="w-5 h-5 text-yellow-500" />
            <h3 className="text-base font-bold text-foreground">Automated Google Review Request & Complaint Alert</h3>
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px]">
              Admin Controlled • Automatic
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Appointment card par <strong>Mark Attended</strong> karte hi customer ko aapke set kiye gaye time par Thank-You + Google Review link
            (WhatsApp + Email) chala jayega. Aur agar kisi AI call par customer naraz ho, toh Manager/Owner ko turant Urgent Complaint Alert milega.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold gap-1.5 shadow-sm shrink-0"
        >
          <CheckCircle2 className="w-4 h-4" />
          {saveMutation.isPending ? "Saving..." : "Save Review & Alert Rules"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 1. GOOGLE REVIEW REQUEST ── */}
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-3 border-b bg-yellow-500/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />
                  3. Automatic Google Review Request
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Sent {formatDelay(form.reviewDelayMinutes)} after the appointment is marked attended.
                </CardDescription>
              </div>
              <Switch checked={form.reviewRequestEnabled} onCheckedChange={(v) => update({ reviewRequestEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Google Review Link *</Label>
              <Input
                placeholder="https://g.page/r/XXXXXXXX/review"
                value={form.googleReviewLink}
                onChange={(e) => update({ googleReviewLink: e.target.value })}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Google Business Profile → "Ask for reviews" → copy link.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Kitni der baad bhejna hai?
              </Label>
              <Select
                value={delayPreset}
                onValueChange={(v) => {
                  setDelayPreset(v);
                  if (v === "custom") applyCustomDelay(customDelayValue, customDelayUnit);
                  else update({ reviewDelayMinutes: Number(v) });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {delayPreset === "custom" && (
                <div className="flex gap-2 pt-1">
                  <Input
                    type="number"
                    min={0}
                    value={customDelayValue}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCustomDelayValue(v);
                      applyCustomDelay(v, customDelayUnit);
                    }}
                    className="h-8 text-xs w-24"
                  />
                  <Select
                    value={customDelayUnit}
                    onValueChange={(u: any) => {
                      setCustomDelayUnit(u);
                      applyCustomDelay(customDelayValue, u);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Kis outcome par bhejna hai?</Label>
              <div className="flex flex-wrap gap-3">
                {TRIGGER_STATUS_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 cursor-pointer">
                    <Switch
                      checked={form.reviewTriggerStatuses.includes(o.value)}
                      onCheckedChange={(v) => toggleTriggerStatus(o.value, v)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={form.reviewChannels.whatsapp}
                  onCheckedChange={(v) => update({ reviewChannels: { ...form.reviewChannels, whatsapp: v } })}
                />
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={form.reviewChannels.email}
                  onCheckedChange={(v) => update({ reviewChannels: { ...form.reviewChannels, email: v } })}
                />
                <Mail className="w-3.5 h-3.5 text-blue-600" /> Email
              </label>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">WhatsApp Thank-You + Review Message</Label>
              <Textarea
                rows={6}
                value={form.reviewWhatsappMessage}
                onChange={(e) => update({ reviewWhatsappMessage: e.target.value })}
                className="text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Variables: {"{customer_name} {business_name} {service_name} {review_link} {staff_name} {date} {time}"}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label className="text-[11px]">Approved WhatsApp Template (optional)</Label>
                <Input
                  placeholder="e.g. google_review_request"
                  value={form.reviewWhatsappTemplateName}
                  onChange={(e) => update({ reviewWhatsappTemplateName: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Language</Label>
                <Input
                  value={form.reviewWhatsappTemplateLanguage}
                  onChange={(e) => update({ reviewWhatsappTemplateLanguage: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-2">
              Meta rule: 24 hours ke baad plain text sirf approved template se jaata hai. Template me {"{{1}}"} = customer name, {"{{2}}"} = review link. Template fail ho to upar wala text message bheja jayega.
            </p>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-blue-600 dark:text-blue-400">Email Subject</Label>
              <Input
                value={form.reviewEmailSubject}
                onChange={(e) => update({ reviewEmailSubject: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-blue-600 dark:text-blue-400">Email Message (Review button auto-added)</Label>
              <Textarea
                rows={4}
                value={form.reviewEmailMessage}
                onChange={(e) => update({ reviewEmailMessage: e.target.value })}
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── 2. COMPLAINT ALERT ── */}
        <Card className="border-red-500/30">
          <CardHeader className="pb-3 border-b bg-red-500/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-500" />
                  4. Negative Call / Complaint Alert
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Instant alert to Owner / Manager when a customer is angry on an AI call.
                </CardDescription>
              </div>
              <Switch checked={form.complaintAlertEnabled} onCheckedChange={(v) => update({ complaintAlertEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Manager / Owner Name</Label>
              <Input
                placeholder="e.g. Sunil"
                value={form.managerName}
                onChange={(e) => update({ managerName: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Manager WhatsApp Number(s)</Label>
              <Input
                placeholder="+9198XXXXXXXX, +9197XXXXXXXX"
                value={form.managerPhones}
                onChange={(e) => update({ managerPhones: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Manager Email(s)</Label>
              <Input
                placeholder="owner@company.com, manager@company.com"
                value={form.managerEmails}
                onChange={(e) => update({ managerEmails: e.target.value })}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Khali chhodne par aapke account email par alert jayega.</p>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={form.complaintChannels.whatsapp}
                  onCheckedChange={(v) => update({ complaintChannels: { ...form.complaintChannels, whatsapp: v } })}
                />
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp Alert
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={form.complaintChannels.email}
                  onCheckedChange={(v) => update({ complaintChannels: { ...form.complaintChannels, email: v } })}
                />
                <Mail className="w-3.5 h-3.5 text-blue-600" /> Email Alert
              </label>
            </div>

            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs font-semibold">Detection Rules</Label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={form.complaintDetectNegativeSentiment}
                  onCheckedChange={(v) => update({ complaintDetectNegativeSentiment: v })}
                />
                AI ne call sentiment "Negative" bataya
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={form.complaintDetectKeywords} onCheckedChange={(v) => update({ complaintDetectKeywords: v })} />
                Customer ne complaint keywords bole
              </label>
              {form.complaintDetectKeywords && (
                <Textarea
                  rows={3}
                  value={form.complaintKeywords}
                  onChange={(e) => update({ complaintKeywords: e.target.value })}
                  className="text-[11px] font-mono"
                />
              )}
              <div className="flex items-center gap-2">
                <span>Ignore calls shorter than</span>
                <Input
                  type="number"
                  min={0}
                  value={form.complaintMinCallSeconds}
                  onChange={(e) => update({ complaintMinCallSeconds: Number(e.target.value) || 0 })}
                  className="h-7 text-xs w-20"
                />
                <span>seconds</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-red-500/40 text-red-600"
                disabled={testAlertMutation.isPending}
                onClick={() => testAlertMutation.mutate()}
              >
                <Send className="w-3.5 h-3.5" />
                {testAlertMutation.isPending ? "Sending..." : "Send Test Alert"}
              </Button>
              <span className="text-[10px] text-muted-foreground self-center">Pehle Save karein, phir test karein.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Activity Log ── */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <History className="w-4 h-4" /> Recent Review Requests & Complaint Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-yellow-500" /> Review Requests
            </div>
            {(logs?.reviews || []).length === 0 && <div className="text-muted-foreground">Abhi koi review request nahi gayi.</div>}
            {(logs?.reviews || []).slice(0, 10).map((r) => (
              <div key={r.id} className="p-2 rounded border flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{r.customerName} <span className="text-muted-foreground">({r.customerPhone})</span></div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-IN")} • {r.trigger === "manual" ? "Manual" : "Automatic"}
                  </div>
                </div>
                <div className="text-[10px] whitespace-nowrap">
                  WA {r.whatsappSent ? "✅" : "❌"} • Email {r.emailSent ? "✅" : "❌"}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Complaint Alerts
            </div>
            {(logs?.complaints || []).length === 0 && <div className="text-muted-foreground">Abhi koi complaint alert nahi aaya.</div>}
            {(logs?.complaints || []).slice(0, 10).map((c) => (
              <div key={c.id} className="p-2 rounded border border-red-500/20 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {c.customerName} <span className="text-muted-foreground">({c.customerPhone})</span>
                    {c.engine === "test" && <Badge variant="outline" className="ml-1 text-[9px]">TEST</Badge>}
                  </div>
                  <div className="text-[10px] whitespace-nowrap">
                    WA {c.whatsappSent ? "✅" : "❌"} • Email {c.emailSent ? "✅" : "❌"}
                  </div>
                </div>
                <div className="text-[10px] text-red-600 dark:text-red-400">{c.reason}</div>
                <div className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-IN")}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

