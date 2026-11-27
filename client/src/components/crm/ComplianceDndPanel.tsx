import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Plus,
  Trash2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  PhoneCall,
  Clock,
  Sparkles,
  Bot,
  UserCheck,
  Check,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ComplianceSettingsData {
  id?: string;
  dndScrubEnabled: boolean;
  dndAutoBlacklistOnOptOut: boolean;
  aiDisclosureEnabled: boolean;
  aiDisclosureText: string;
  dpdpDataRetentionDays: number;
  consentCheckboxEnabled: boolean;
}

interface DndRecordItem {
  id: string;
  phoneNumber: string;
  category: string;
  reason: string;
  callId?: string;
  leadId?: string;
  isActive: boolean;
  createdAt: string;
  purgedAt?: string;
}

const SETTINGS_KEY = ["/api/compliance/settings"];
const METRICS_KEY = ["/api/compliance/metrics"];
const DND_RECORDS_KEY = ["/api/compliance/dnd-records"];

export function ComplianceDndPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Queries ──
  const { data: metrics, isLoading: isMetricsLoading } = useQuery<{
    settings: ComplianceSettingsData;
    totalDndNumbers: number;
    optOutRequests: number;
    nationalDndCount: number;
    callsProtectedEstimate: number;
    dndScrubActive: boolean;
    aiDisclosureActive: boolean;
  }>({
    queryKey: METRICS_KEY,
  });

  const { data: settingsData } = useQuery<ComplianceSettingsData>({
    queryKey: SETTINGS_KEY,
  });

  const [formSettings, setFormSettings] = useState<ComplianceSettingsData | null>(null);
  if (settingsData && !formSettings) {
    setFormSettings(settingsData);
  }

  // ── DND Records List State ──
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: dndData, isLoading: isRecordsLoading } = useQuery<{
    records: DndRecordItem[];
    total: number;
  }>({
    queryKey: [...DND_RECORDS_KEY, searchTerm, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.append("search", searchTerm);
      if (categoryFilter !== "all") params.append("category", categoryFilter);
      const res = await apiRequest("GET", `/api/compliance/dnd-records?${params.toString()}`);
      return res.json();
    },
  });

  // ── Real-Time DND Lookup State ──
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupResult, setLookupResult] = useState<{
    tested: boolean;
    isDnd: boolean;
    category?: string;
    reason?: string;
  } | null>(null);

  const checkDndMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("POST", "/api/compliance/check-dnd", { phoneNumber });
      return res.json();
    },
    onSuccess: (data) => {
      setLookupResult({ tested: true, ...data });
    },
    onError: (err: any) => {
      toast({ title: "Verification Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Mutations ──
  const saveSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ComplianceSettingsData>) => {
      const { id, createdAt, updatedAt, ...cleanData } = (data || {}) as any;
      const res = await apiRequest("PUT", "/api/compliance/settings", cleanData);
      return res.json();
    },
    onSuccess: (updated: ComplianceSettingsData) => {
      setFormSettings(updated);
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      toast({
        title: "Compliance Settings Saved",
        description: "DND scrubbing and AI disclosure policies have been updated successfully.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Add Number Modal ──
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newCategory, setNewCategory] = useState("manual_blacklist");
  const [newReason, setNewReason] = useState("");

  const addDndMutation = useMutation({
    mutationFn: async (payload: { phoneNumber: string; category: string; reason: string }) => {
      const res = await apiRequest("POST", "/api/compliance/dnd-records", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DND_RECORDS_KEY });
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      setIsAddModalOpen(false);
      setNewPhone("");
      setNewReason("");
      toast({
        title: "Number Added to DND Registry",
        description: "Outbound automated calls to this phone number will be suppressed.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeDndMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/compliance/dnd-records/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DND_RECORDS_KEY });
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      toast({
        title: "Record Removed from DND Registry",
        description: "The phone number has been removed from the suppression list.",
      });
    },
  });

  // ── Bulk Import Modal ──
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const bulkImportMutation = useMutation({
    mutationFn: async (phoneNumbers: string[]) => {
      const res = await apiRequest("POST", "/api/compliance/bulk-import", {
        phoneNumbers,
        reason: "Bulk DND Import",
      });
      return res.json();
    },
    onSuccess: (data: { added: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: DND_RECORDS_KEY });
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      setIsBulkModalOpen(false);
      setBulkText("");
      toast({
        title: `${data.added} Numbers Added to DND Registry`,
        description: data.skipped ? `${data.skipped} duplicate or invalid numbers skipped.` : undefined,
      });
    },
    onError: (err: any) => {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    },
  });

  // ── DPDP Purge Modal ──
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [purgePhone, setPurgePhone] = useState("");
  const [purgeResult, setPurgeResult] = useState<any>(null);

  const dpdpPurgeMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("POST", "/api/compliance/dpdp-purge", { phoneNumber });
      return res.json();
    },
    onSuccess: (data) => {
      setPurgeResult(data);
      queryClient.invalidateQueries({ queryKey: DND_RECORDS_KEY });
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      toast({
        title: "DPDP Act Data Purge Executed",
        description: "Customer records, transcripts, and call audio have been permanently redacted.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Purge Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & OVERVIEW STATS
      ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-teal-500" />
            <span>DND Scrubbing & Regulatory Compliance Engine</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            National Do-Not-Call (DND) scrubbing, AI caller disclosure, and DPDP Act 2023 Right-to-be-Forgotten data privacy controls.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsBulkModalOpen(true)}
            className="text-xs border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Bulk Upload DND (CSV)</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="text-xs bg-teal-600 hover:bg-teal-700 text-white gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add DND Number</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-teal-500/30 bg-gradient-to-br from-card via-card to-teal-500/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Regulatory Protection Status</span>
              <ShieldCheck className="w-4 h-4 text-teal-500" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-teal-600 dark:text-teal-400">
              100% Compliant Calling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Est. ~{metrics?.callsProtectedEstimate || 180} calls protected against regulatory non-compliance penalties.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Total Suppressed Numbers</span>
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {metrics?.totalDndNumbers || 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Numbers automatically bypassed during contact imports and active calling campaigns.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>DPDP Erasure Requests</span>
              <UserCheck className="w-4 h-4 text-blue-500" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {metrics?.optOutRequests || 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Customer consent withdrawal and Right-to-be-Forgotten requests fulfilled.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>AI Caller Identity Disclosure</span>
              <Bot className="w-4 h-4 text-purple-400" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {formSettings?.aiDisclosureEnabled ? "Active (Transparent)" : "Disabled (Natural)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              {formSettings?.aiDisclosureEnabled
                ? "Agent introduces itself as an automated AI assistant on call start."
                : "Agent speaks naturally as a professional human consultant."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. REAL-TIME DND LOOKUP TOOL
      ───────────────────────────────────────────────────────────── */}
      <Card className="border-teal-500/40 bg-gradient-to-br from-card via-card to-teal-500/5 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4 text-teal-500" />
            <span>Real-Time Phone Number DND Verification</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Verify any phone number prior to dialing to ensure it is clear of Do-Not-Call and customer opt-out registries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <PhoneCall className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={lookupPhone}
                onChange={(e) => {
                  setLookupPhone(e.target.value);
                  setLookupResult(null);
                }}
                placeholder="Enter 10-digit number e.g. 9876543210 or +91 9876543210"
                className="text-xs pl-8 font-mono"
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                if (lookupPhone) checkDndMutation.mutate(lookupPhone);
              }}
              disabled={!lookupPhone || checkDndMutation.isPending}
              className="h-9 text-xs bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
            >
              {checkDndMutation.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Verify DND Status</span>
            </Button>
          </div>

          {lookupResult && lookupResult.tested && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center justify-between flex-wrap gap-2 ${
                lookupResult.isDnd
                  ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              <div className="flex items-center gap-2">
                {lookupResult.isDnd ? (
                  <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                )}
                <div>
                  <div className="font-bold">
                    {lookupResult.isDnd ? "DO NOT CALL (DND PROTECTED)" : "SAFE TO CALL (NOT ON DND)"}
                  </div>
                  <div className="text-[11px] opacity-90">
                    {lookupResult.isDnd
                      ? `Reason: ${lookupResult.reason || "Registered on National DND / Opt-Out List"}`
                      : "This phone number is not listed on any Do-Not-Call registry. Safe for outbound calling campaigns."}
                  </div>
                </div>
              </div>

              {lookupResult.isDnd && (
                <Badge variant="outline" className="border-red-500/40 text-red-500 text-[10px] uppercase">
                  {lookupResult.category || "DND Registered"}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          3. COMPLIANCE & SCRUBBING RULES SETTINGS
      ───────────────────────────────────────────────────────────── */}
      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-500" />
            <span>Compliance Rules & Voice Configuration</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Configure calling compliance policies and caller disclosure behaviors enforced during campaign execution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. DND Auto-Scrub Toggle */}
            <div className="p-3.5 rounded-xl border bg-muted/20 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="dnd-scrub-toggle" className="text-xs font-bold cursor-pointer">
                  National DND Auto-Scrubbing
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Automatically suppress blacklisted numbers during contact imports and active outbound campaigns.
                </p>
              </div>
              <Switch
                id="dnd-scrub-toggle"
                checked={!!formSettings?.dndScrubEnabled}
                onCheckedChange={(checked) => {
                  setFormSettings((prev) => prev ? { ...prev, dndScrubEnabled: checked } : prev);
                }}
              />
            </div>

            {/* 2. Auto-Blacklist on Opt-Out */}
            <div className="p-3.5 rounded-xl border bg-muted/20 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="opt-out-toggle" className="text-xs font-bold cursor-pointer">
                  Auto-Blacklist on Customer Opt-Out
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Automatically add phone numbers to the DND list whenever a customer requests not to be contacted again.
                </p>
              </div>
              <Switch
                id="opt-out-toggle"
                checked={!!formSettings?.dndAutoBlacklistOnOptOut}
                onCheckedChange={(checked) => {
                  setFormSettings((prev) => prev ? { ...prev, dndAutoBlacklistOnOptOut: checked } : prev);
                }}
              />
            </div>

            {/* 3. AI Disclosure Toggle */}
            <div className="p-3.5 rounded-xl border bg-muted/20 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-disclosure-toggle" className="text-xs font-bold cursor-pointer">
                  Transparent AI Greeting Disclosure
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Disclose automated AI caller identity immediately upon call connection for full transparency.
                </p>
              </div>
              <Switch
                id="ai-disclosure-toggle"
                checked={!!formSettings?.aiDisclosureEnabled}
                onCheckedChange={(checked) => {
                  setFormSettings((prev) => prev ? { ...prev, aiDisclosureEnabled: checked } : prev);
                }}
              />
            </div>

            {/* 4. DPDP Data Retention Days */}
            <div className="p-3.5 rounded-xl border bg-muted/20 space-y-1.5">
              <Label className="text-xs font-bold">Audio & Transcript Data Retention Period</Label>
              <Select
                value={String(formSettings?.dpdpDataRetentionDays || 90)}
                onValueChange={(val) => {
                  setFormSettings((prev) => prev ? { ...prev, dpdpDataRetentionDays: parseInt(val, 10) } : prev);
                }}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 Days (Strict Privacy)</SelectItem>
                  <SelectItem value="90">90 Days (Enterprise Standard)</SelectItem>
                  <SelectItem value="180">180 Days (Extended Retention)</SelectItem>
                  <SelectItem value="365">365 Days (1 Year Legal Archive)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Call audio and transcripts are automatically purged after this period in accordance with privacy laws.
              </p>
            </div>
          </div>

          {/* AI Disclosure Custom Message */}
          {formSettings?.aiDisclosureEnabled && (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-semibold">AI Disclosure Greeting Message</Label>
              <Input
                value={formSettings?.aiDisclosureText || ""}
                onChange={(e) => setFormSettings((prev) => prev ? { ...prev, aiDisclosureText: e.target.value } : prev)}
                className="text-xs"
                placeholder="e.g. Hello, this is an automated AI assistant calling on behalf of our team."
              />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={() => formSettings && saveSettingsMutation.mutate(formSettings)}
              disabled={saveSettingsMutation.isPending}
              className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Compliance Rules</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          4. DND BLACKLIST & OPT-OUT DATABASE
      ───────────────────────────────────────────────────────────── */}
      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                <span>DND Blacklist & Suppression Registry ({dndData?.total || 0} numbers)</span>
              </CardTitle>
              <CardDescription className="text-xs">
                These phone numbers are strictly suppressed from all outbound automated calling campaigns.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-48">
                <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search phone or reason..."
                  className="h-7 text-xs pl-7"
                />
              </div>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-7 text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="dnd_national">National DND Registry</SelectItem>
                  <SelectItem value="customer_opt_out">Customer Opt-Out</SelectItem>
                  <SelectItem value="manual_blacklist">Manual Blacklist</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIsPurgeModalOpen(true)}
                className="h-7 text-xs border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 gap-1"
                title="DPDP Act 2023 Right to be Forgotten Purge"
              >
                <Trash2 className="w-3 h-3" />
                <span>DPDP Data Purge</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isRecordsLoading ? (
            <div className="text-center py-8 text-xs text-muted-foreground flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading suppression records...</span>
            </div>
          ) : (dndData?.records || []).length === 0 ? (
            <div className="text-center py-10 text-xs text-muted-foreground border rounded-lg bg-muted/10 space-y-2">
              <ShieldCheck className="w-8 h-8 text-teal-500/40 mx-auto" />
              <div className="font-medium text-foreground">No DND records found.</div>
              <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                Add phone numbers manually using the "+ Add DND Number" button or upload a CSV suppression list.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground font-semibold border-b text-[11px]">
                  <tr>
                    <th className="p-2.5">Phone Number</th>
                    <th className="p-2.5">Category</th>
                    <th className="p-2.5">Reason / Source</th>
                    <th className="p-2.5">Date Added</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(dndData?.records || []).map((rec) => (
                    <tr key={rec.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 font-mono font-semibold text-foreground">
                        {rec.phoneNumber}
                      </td>
                      <td className="p-2.5">
                        <Badge
                          variant="outline"
                          className={
                            rec.category === "customer_opt_out"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 text-[10px]"
                              : rec.category === "dnd_national"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]"
                              : "bg-muted text-muted-foreground text-[10px]"
                          }
                        >
                          {rec.category === "customer_opt_out"
                            ? "Customer Opt-Out"
                            : rec.category === "dnd_national"
                            ? "National DND"
                            : "Manual Blacklist"}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-muted-foreground line-clamp-1 max-w-[280px]">
                        {rec.reason || "Suppression Registered"}
                      </td>
                      <td className="p-2.5 text-muted-foreground text-[11px]">
                        {new Date(rec.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDndMutation.mutate(rec.id)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                          title="Remove from DND list"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 1: ADD SINGLE DND NUMBER
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-500" />
              <span>Add Phone Number to DND Registry</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              This phone number will be excluded from all automated voice campaigns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Phone Number</Label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="e.g. +91 9876543210 or 9876543210"
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_blacklist">Manual Blacklist (Do Not Call)</SelectItem>
                  <SelectItem value="customer_opt_out">Customer Opt-Out (Requested on Call)</SelectItem>
                  <SelectItem value="dnd_national">National DND Registry</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Reason (Optional)</Label>
              <Input
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="e.g. Customer requested call suppression"
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAddModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (newPhone) {
                  addDndMutation.mutate({
                    phoneNumber: newPhone,
                    category: newCategory,
                    reason: newReason || "Added to DND suppression list",
                  });
                }
              }}
              disabled={!newPhone || addDndMutation.isPending}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white gap-1"
            >
              {addDndMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>Add to DND Registry</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 2: BULK UPLOAD DND CSV / LIST
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={isBulkModalOpen} onOpenChange={setIsBulkModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Upload className="w-4 h-4 text-teal-500" />
              <span>Bulk Import DND Numbers</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Paste multiple phone numbers (one per line) or copy-paste directly from a spreadsheet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Phone Numbers (One per line)</Label>
              <Textarea
                rows={8}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"9876543210\n9812345678\n+919988776655"}
                className="text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Total numbers entered: {bulkText.split("\n").filter((x) => x.trim()).length}
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsBulkModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const numbers = bulkText
                  .split(/[\n,]/)
                  .map((x) => x.trim())
                  .filter((x) => x.length >= 8);
                if (numbers.length > 0) {
                  bulkImportMutation.mutate(numbers);
                }
              }}
              disabled={!bulkText.trim() || bulkImportMutation.isPending}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white gap-1"
            >
              {bulkImportMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              <span>Import Numbers</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 3: DPDP 2023 RIGHT-TO-BE-FORGOTTEN PURGE
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={isPurgeModalOpen} onOpenChange={setIsPurgeModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-4 h-4" />
              <span>DPDP Act 2023: Right-to-be-Forgotten Data Purge</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Customer consent withdrawal: Permanently redacts contact details, call transcripts, and recordings, and locks the number into the permanent opt-out registry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Irreversible Compliance Action</span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">
                Under Section 12 of the Digital Personal Data Protection Act, individuals have the right to personal data erasure. Once executed, associated call audio, transcripts, and contact records cannot be recovered.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Customer Phone Number to Purge</Label>
              <Input
                value={purgePhone}
                onChange={(e) => {
                  setPurgePhone(e.target.value);
                  setPurgeResult(null);
                }}
                placeholder="e.g. 9876543210 or +91 9876543210"
                className="text-xs font-mono"
              />
            </div>

            {purgeResult && (
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>DPDP Purge Executed Successfully:</span>
                </div>
                <div className="text-[11px] space-y-0.5">
                  <div>• Contacts Anonymized: {purgeResult.contactsAnonymized}</div>
                  <div>• CRM Leads Anonymized: {purgeResult.leadsAnonymized}</div>
                  <div>• Call Transcripts & Recordings Redacted: {purgeResult.callsRedacted}</div>
                  <div>• Phone number permanently locked in the DND Opt-Out registry.</div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsPurgeModalOpen(false)}
              className="text-xs"
            >
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (purgePhone) dpdpPurgeMutation.mutate(purgePhone);
              }}
              disabled={!purgePhone || dpdpPurgeMutation.isPending}
              className="text-xs bg-red-600 hover:bg-red-700 text-white gap-1"
            >
              {dpdpPurgeMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              <span>Execute Data Purge</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
