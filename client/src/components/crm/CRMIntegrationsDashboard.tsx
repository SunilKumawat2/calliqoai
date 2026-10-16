import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  FileSpreadsheet, Calendar, RefreshCw, CheckCircle2, AlertCircle, 
  ExternalLink, Plus, Trash2, ArrowRight, ShieldCheck, Clock, 
  Layers, Database, Zap, Sparkles
} from "lucide-react";

interface SheetSyncConfig {
  id: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetTabName: string;
  campaignId: string | null;
  direction: string;
  columnMapping: Record<string, string>;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt: string | null;
  totalImported: number;
  totalUpdated: number;
  status: string;
  lastErrorMessage: string | null;
}

interface SyncLog {
  id: string;
  source: string;
  action: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  status: string;
  summary: string | null;
  createdAt: string;
}

export function CRMIntegrationsDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [selectedTab, setSelectedTab] = useState("Sheet1");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("none");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Column mapping form state
  const [mapping, setMapping] = useState({
    phone: "A",
    firstName: "B",
    lastName: "",
    email: "C",
    company: "",
    notes: "D",
    callStatus: "E",
    duration: "F",
    aiSummary: "G",
    leadScore: "H",
    appointmentDate: "I",
  });

  // Check connection status
  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    googleSheets: { connected: boolean; email?: string };
    googleCalendar: { connected: boolean; email?: string };
  }>({
    queryKey: ["/api/crm-sync/status"],
  });

  // Sync configs
  const { data: configs = [], isLoading: configsLoading, refetch: refetchConfigs } = useQuery<SheetSyncConfig[]>({
    queryKey: ["/api/crm-sync/configs"],
  });

  // Sync logs
  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<SyncLog[]>({
    queryKey: ["/api/crm-sync/logs"],
  });

  // User spreadsheets
  const { data: sheetsList = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/google-sheets/sheets"],
    enabled: statusData?.googleSheets?.connected === true && createDialogOpen,
  });

  // Tabs for selected sheet
  const { data: tabsList = [] } = useQuery<Array<{ sheetId: number; title: string }>>({
    queryKey: [`/api/google-sheets/sheets/${selectedSheetId}/tabs`],
    enabled: !!selectedSheetId && createDialogOpen,
  });

  // Campaigns list
  const { data: campaignsList = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/campaigns"],
  });

  // Connect Google Sheets OAuth
  const handleConnectGoogleSheets = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/google/auth");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to start Google Sheets auth", variant: "destructive" });
    }
  };

  // Connect Google Calendar OAuth
  const handleConnectGoogleCalendar = async () => {
    try {
      const res = await apiRequest("GET", "/api/google-calendar/auth");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to start Google Calendar auth", variant: "destructive" });
    }
  };

  // Disconnect Google Sheets
  const handleDisconnectSheets = async () => {
    try {
      await apiRequest("DELETE", "/api/integrations/google/disconnect");
      toast({ title: "Disconnected", description: "Google Sheets disconnected successfully" });
      refetchStatus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Disconnect Google Calendar
  const handleDisconnectCalendar = async () => {
    try {
      await apiRequest("DELETE", "/api/google-calendar/disconnect");
      toast({ title: "Disconnected", description: "Google Calendar disconnected successfully" });
      refetchStatus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Manual Trigger Sync Mutation
  const syncMutation = useMutation({
    mutationFn: async (configId: string) => {
      setSyncingId(configId);
      const res = await apiRequest("POST", `/api/crm-sync/configs/${configId}/sync`);
      return res.json();
    },
    onSuccess: (data) => {
      setSyncingId(null);
      toast({
        title: "Sync Completed",
        description: `Created: ${data.created || 0}, Updated: ${data.updated || 0}, Skipped: ${data.skipped || 0}`,
      });
      refetchConfigs();
      refetchLogs();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
    },
    onError: (err: any) => {
      setSyncingId(null);
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    },
  });

  // Save new sync config
  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const selectedSheet = sheetsList.find(s => s.id === selectedSheetId);
      const payload = {
        spreadsheetId: selectedSheetId,
        spreadsheetName: selectedSheet?.name || "Google Sheet",
        sheetTabName: selectedTab || "Sheet1",
        campaignId: selectedCampaignId !== "none" ? selectedCampaignId : null,
        direction: "both",
        columnMapping: mapping,
        autoSyncEnabled: true,
      };
      const res = await apiRequest("POST", "/api/crm-sync/configs", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Google Sheet sync configuration saved!" });
      setCreateDialogOpen(false);
      refetchConfigs();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Delete sync config
  const deleteConfigMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/crm-sync/configs/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Sync configuration removed" });
      refetchConfigs();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Overview Banner */}
      <div className="bg-gradient-to-r from-emerald-600/10 via-blue-600/10 to-purple-600/10 border border-emerald-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Calliqo CRM Ecosystem
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Central CRM & External Tools Synchronization
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Automatically import leads from Google Sheets, dial them via AI campaigns, check live calendar availability, book site visits, and write back call summaries and outcomes in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => { refetchConfigs(); refetchLogs(); refetchStatus(); }}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh All
          </Button>
        </div>
      </div>

      {/* 2 Main Integration Cards: Google Sheets & Google Calendar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Google Sheets Card */}
        <Card className="border border-border/60 hover:shadow-md transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Google Sheets 2-Way Sync</CardTitle>
                  <CardDescription className="text-xs">Import leads & write back AI call results</CardDescription>
                </div>
              </div>
              {statusData?.googleSheets?.connected ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/30 gap-1.5 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your Google account to automatically pull phone numbers and prospect details into Calliqo AI, and automatically write call duration, transcripts, AI scores, and summaries back into your spreadsheet.
            </p>

            <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account:</span>
                <span className="font-medium text-foreground">{statusData?.googleSheets?.email || "Not linked"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Sync Sheets:</span>
                <span className="font-medium text-foreground">{configs.length} configured</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {statusData?.googleSheets?.connected ? (
                <>
                  <Button 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                    onClick={() => setCreateDialogOpen(true)}
                  >
                    <Plus className="w-4 h-4" /> Link New Sheet
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-muted-foreground hover:text-destructive"
                    onClick={handleDisconnectSheets}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button 
                  size="sm" 
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 w-full"
                  onClick={handleConnectGoogleSheets}
                >
                  <ExternalLink className="w-4 h-4" /> Connect with Google Sheets
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Google Calendar Card */}
        <Card className="border border-border/60 hover:shadow-md transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Google Calendar Real-Time Booking</CardTitle>
                  <CardDescription className="text-xs">Live slot verification & site visits booking</CardDescription>
                </div>
              </div>
              {statusData?.googleCalendar?.connected ? (
                <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 border-blue-500/30 gap-1.5 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Allows your AI voice agents to query your Google Calendar in real time during a call to find free slots and book site visits or meetings directly onto your calendar with automatic attendee invites.
            </p>

            <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connected Calendar:</span>
                <span className="font-medium text-foreground">{statusData?.googleCalendar?.email || "Not linked"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Booking Mode:</span>
                <span className="font-medium text-foreground">Real-Time FreeBusy Verification</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {statusData?.googleCalendar?.connected ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-muted-foreground hover:text-destructive"
                  onClick={handleDisconnectCalendar}
                >
                  Disconnect Calendar
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2 w-full"
                  onClick={handleConnectGoogleCalendar}
                >
                  <ExternalLink className="w-4 h-4" /> Connect with Google Calendar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configured Sheets Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Active Google Sheet Sync Mappings</CardTitle>
            <CardDescription className="text-xs">Spreadsheets actively monitored and synchronized with Calliqo CRM</CardDescription>
          </div>
          {statusData?.googleSheets?.connected && (
            <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Sheet Sync
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground space-y-2 border border-dashed rounded-xl">
              <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground/60" />
              <p className="text-sm font-medium">No Google Sheets connected for sync yet.</p>
              <p className="text-xs text-muted-foreground/80 max-w-md mx-auto">
                Connect your Google account and link a spreadsheet to start automatically importing leads into Calliqo AI.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {configs.map((cfg) => (
                <div key={cfg.id} className="py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{cfg.spreadsheetName}</span>
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0">
                        {cfg.sheetTabName}
                      </Badge>
                      <Badge className={cfg.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-0' : 'bg-amber-500/10 text-amber-600 border-0'}>
                        {cfg.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Imported: <strong className="text-foreground">{cfg.totalImported}</strong></span>
                      <span>•</span>
                      <span>Updated: <strong className="text-foreground">{cfg.totalUpdated}</strong></span>
                      <span>•</span>
                      <span>Last Synced: <strong className="text-foreground">{cfg.lastSyncedAt ? new Date(cfg.lastSyncedAt).toLocaleString() : "Never"}</strong></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={syncingId === cfg.id}
                      onClick={() => syncMutation.mutate(cfg.id)}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingId === cfg.id ? "animate-spin" : ""}`} />
                      {syncingId === cfg.id ? "Syncing..." : "Sync Now"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                      onClick={() => deleteConfigMutation.mutate(cfg.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Logs & Audit Trail (Client requirement #6) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Sync History & Audit Logs</CardTitle>
              <CardDescription className="text-xs">Real-time log of lead imports, outcome writebacks, and deduplication events</CardDescription>
            </div>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Duplicate Safe
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No sync events recorded yet. Logs will appear automatically when sheets or campaigns are synchronized.
            </div>
          ) : (
            <ScrollArea className="h-64 rounded-lg border">
              <div className="divide-y divide-border/60 text-xs">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 flex items-center justify-between hover:bg-muted/30">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                          {log.source.replace('_', ' ')}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {log.action}
                        </Badge>
                        <Badge className={log.status === 'success' ? 'bg-emerald-500/10 text-emerald-600 text-[10px] border-0' : 'bg-amber-500/10 text-amber-600 text-[10px] border-0'}>
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{log.summary || `Processed ${log.recordsProcessed} rows`}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Modal: Configure Google Sheet Sync */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure Google Sheet 2-Way Sync</DialogTitle>
            <DialogDescription>
              Select your spreadsheet and map the columns so Calliqo AI knows where to read leads and write call results.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Select Google Spreadsheet</Label>
                <Select value={selectedSheetId} onValueChange={setSelectedSheetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a spreadsheet..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sheetsList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Sheet Tab Name</Label>
                <Select value={selectedTab} onValueChange={setSelectedTab}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select tab..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tabsList.length > 0 ? (
                      tabsList.map((t) => (
                        <SelectItem key={t.title} value={t.title}>{t.title}</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="Sheet1">Sheet1</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Auto-Add Imported Leads to AI Campaign (Optional)</Label>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger>
                  <SelectValue placeholder="Do not assign to campaign immediately" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Campaign (Import to CRM Only)</SelectItem>
                  {campaignsList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-emerald-600" />
                Inbound Lead Column Mapping (Letters: A, B, C...)
              </h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <Label className="text-[11px]">Phone (Required)*</Label>
                  <Input 
                    value={mapping.phone} 
                    onChange={(e) => setMapping({ ...mapping, phone: e.target.value.toUpperCase() })} 
                    placeholder="A" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">First Name</Label>
                  <Input 
                    value={mapping.firstName} 
                    onChange={(e) => setMapping({ ...mapping, firstName: e.target.value.toUpperCase() })} 
                    placeholder="B" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Last Name</Label>
                  <Input 
                    value={mapping.lastName} 
                    onChange={(e) => setMapping({ ...mapping, lastName: e.target.value.toUpperCase() })} 
                    placeholder="C" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Email</Label>
                  <Input 
                    value={mapping.email} 
                    onChange={(e) => setMapping({ ...mapping, email: e.target.value.toUpperCase() })} 
                    placeholder="D" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Company</Label>
                  <Input 
                    value={mapping.company} 
                    onChange={(e) => setMapping({ ...mapping, company: e.target.value.toUpperCase() })} 
                    placeholder="E" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Notes / Requirements</Label>
                  <Input 
                    value={mapping.notes} 
                    onChange={(e) => setMapping({ ...mapping, notes: e.target.value.toUpperCase() })} 
                    placeholder="F" 
                    className="h-8 uppercase"
                  />
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-blue-600">
                <ArrowRight className="w-4 h-4" />
                Post-Call Outcome Writeback Columns
              </h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <Label className="text-[11px]">Call Status</Label>
                  <Input 
                    value={mapping.callStatus} 
                    onChange={(e) => setMapping({ ...mapping, callStatus: e.target.value.toUpperCase() })} 
                    placeholder="G" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Duration</Label>
                  <Input 
                    value={mapping.duration} 
                    onChange={(e) => setMapping({ ...mapping, duration: e.target.value.toUpperCase() })} 
                    placeholder="H" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">AI Call Summary</Label>
                  <Input 
                    value={mapping.aiSummary} 
                    onChange={(e) => setMapping({ ...mapping, aiSummary: e.target.value.toUpperCase() })} 
                    placeholder="I" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Lead Score (1-100)</Label>
                  <Input 
                    value={mapping.leadScore} 
                    onChange={(e) => setMapping({ ...mapping, leadScore: e.target.value.toUpperCase() })} 
                    placeholder="J" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Appointment Date/Time</Label>
                  <Input 
                    value={mapping.appointmentDate} 
                    onChange={(e) => setMapping({ ...mapping, appointmentDate: e.target.value.toUpperCase() })} 
                    placeholder="K" 
                    className="h-8 uppercase"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button 
              className="bg-emerald-600 hover:bg-emerald-700 text-white" 
              onClick={() => saveConfigMutation.mutate()}
              disabled={!selectedSheetId || !mapping.phone}
            >
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
