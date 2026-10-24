import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  FileSpreadsheet, Calendar, RefreshCw, CheckCircle2, AlertCircle, 
  ExternalLink, Plus, Trash2, ArrowRight, ShieldCheck, Clock, 
  Layers, Database, Zap, Sparkles, Building2, Globe, Megaphone,
  Copy, Check, Send, Code2, PhoneCall, PhoneForwarded, Play,
  Sliders, Settings2, Mail
} from "lucide-react";
import { CompanyEmailSettingsDialog } from "./CompanyEmailSettingsDialog";

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

export interface LeadSourceIntegration {
  id: string;
  userId: string;
  name: string;
  sourceType: 'website_form' | 'meta_ads' | 'google_ads' | '99acres' | 'magicbricks' | 'housing' | 'custom_webhook' | 'zoho_crm';
  campaignId: string | null;
  agentId: string | null;
  spreadsheetId: string | null;
  webhookKey: string;
  apiKey: string | null;
  autoCall: boolean;
  autoCallDelaySeconds: number;
  customGreeting: string | null;
  portalConfig: Record<string, any> | null;
  totalLeads: number;
  totalCalls: number;
  lastLeadAt: string | null;
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
}

export function CRMIntegrationsDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Google Sheet Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [selectedTab, setSelectedTab] = useState("Sheet1");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("none");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState(false);

  // Lead Source Dialog state
  const [leadSourceDialogOpen, setLeadSourceDialogOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Edit Lead Source Dialog State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<{
    id: string;
    name: string;
    sourceType: string;
    campaignId: string;
    agentId: string;
    spreadsheetId: string;
    autoCall: boolean;
    autoCallDelaySeconds: number;
    customGreeting: string;
    propertyName: string;
    city: string;
  } | null>(null);

  // Inbound Form Simulator Dialog state
  const [simulatorDialogOpen, setSimulatorDialogOpen] = useState(false);
  const [simulatorSource, setSimulatorSource] = useState<LeadSourceIntegration | null>(null);
  const [simulatorForm, setSimulatorForm] = useState({
    name: "Sunil Kumawat",
    phone: "",
    email: "sunil@gmail.com",
    project: "DLF Cyber Heights Luxury Residences",
    budget: "2.0 - 3.5 Cr",
    city: "Gurugram",
    query: "Interested in 3BHK high-rise apartment. Please arrange a callback.",
    agentName: "Master Receptionist IVR 11labs",
  });
  const [isSubmittingSim, setIsSubmittingSim] = useState(false);

  // New Lead Source Form State
  const [newLeadSource, setNewLeadSource] = useState({
    name: "",
    sourceType: "website_form",
    campaignId: "none",
    agentId: "none",
    spreadsheetId: "none",
    autoCall: true,
    autoCallDelaySeconds: 15,
    customGreeting: "",
    propertyName: "",
    city: "",
  });

  // Column mapping form state for Google Sheets
  const [mapping, setMapping] = useState({
    phone: "A",
    firstName: "B",
    lastName: "",
    email: "C",
    company: "",
    notes: "D",
    callStatus: "G",
    duration: "H",
    aiSummary: "I",
    leadScore: "J",
    recordingUrl: "K",
    appointmentDate: "L",
  });

  // Base URL for webhooks
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://calliqoai.com";

  // Check connection status (Google Sheets & Calendar)
  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    googleSheets: { connected: boolean; email?: string };
    googleCalendar: { connected: boolean; email?: string };
  }>({
    queryKey: ["/api/crm-sync/status"],
  });

  // Sync configs (Google Sheets)
  const { data: configs = [], isLoading: configsLoading, refetch: refetchConfigs } = useQuery<SheetSyncConfig[]>({
    queryKey: ["/api/crm-sync/configs"],
  });

  // Sync logs
  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<SyncLog[]>({
    queryKey: ["/api/crm-sync/logs"],
  });

  // Lead Source Integrations
  const { data: leadSources = [], isLoading: leadSourcesLoading, refetch: refetchLeadSources } = useQuery<LeadSourceIntegration[]>({
    queryKey: ["/api/lead-sources"],
  });

  // Company Custom SMTP Settings
  const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
  const { data: smtpData, refetch: refetchSmtp } = useQuery<{
    configured: boolean;
    settings: {
      fromEmail: string;
      fromName: string;
      provider: string;
    } | null;
  }>({
    queryKey: ["/api/crm/smtp-settings"],
  });

  // Agents list for dynamic voice routing
  const { data: agentsList = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/agents"],
  });

  // User spreadsheets from Google Drive
  const { data: sheetsList = [], isLoading: sheetsLoading } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/integrations/google/sheets"],
    enabled: statusData?.googleSheets?.connected === true,
  });

  // Combined available spreadsheets (configs + Drive sheets)
  const availableSpreadsheets = React.useMemo(() => {
    const map = new Map<string, string>();
    configs.forEach(c => {
      if (c.spreadsheetId) map.set(c.spreadsheetId, c.spreadsheetName || c.spreadsheetId);
    });
    sheetsList.forEach(s => {
      if (s.id) map.set(s.id, s.name || s.id);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [configs, sheetsList]);

  // Tabs for selected sheet
  const { data: tabsList = [] } = useQuery<Array<{ sheetId: number; title: string }>>({
    queryKey: [`/api/integrations/google/sheets/${selectedSheetId}/tabs`],
    enabled: !!selectedSheetId && createDialogOpen,
  });

  // Campaigns list
  const { data: campaignsList = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/campaigns"],
  });

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    toast({ title: "Copied!", description: "Webhook URL copied to clipboard" });
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Open Simulator modal
  const handleOpenSimulator = (source: LeadSourceIntegration) => {
    setSimulatorSource(source);
    let initialAgentName = "Master Receptionist IVR 11labs";
    if (source.agentId) {
      const match = agentsList.find(a => a.id === source.agentId);
      if (match) initialAgentName = match.name;
    }
    setSimulatorForm(prev => ({
      ...prev,
      agentName: initialAgentName,
      project: source.portalConfig?.propertyName || prev.project,
      city: source.portalConfig?.city || prev.city,
    }));
    setSimulatorDialogOpen(true);
  };

  // Open Edit modal
  const handleOpenEdit = (source: LeadSourceIntegration) => {
    setEditingSource({
      id: source.id,
      name: source.name,
      sourceType: source.sourceType,
      campaignId: source.campaignId || "none",
      agentId: source.agentId || "none",
      spreadsheetId: source.spreadsheetId || "none",
      autoCall: source.autoCall ?? true,
      autoCallDelaySeconds: source.autoCallDelaySeconds || 15,
      customGreeting: source.customGreeting || "",
      propertyName: source.portalConfig?.propertyName || "",
      city: source.portalConfig?.city || "",
    });
    setEditDialogOpen(true);
  };

  // Submit Simulator Form
  const handleSimulateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatorSource) return;
    if (!simulatorForm.phone.trim()) {
      toast({ title: "Phone Required", description: "Please enter your mobile number", variant: "destructive" });
      return;
    }

    setIsSubmittingSim(true);
    try {
      const webhookUrl = getWebhookUrl(simulatorSource);
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: simulatorForm.name,
          mobile: simulatorForm.phone,
          phone: simulatorForm.phone,
          email: simulatorForm.email,
          project_name: simulatorForm.project,
          project: simulatorForm.project,
          budget: simulatorForm.budget,
          city: simulatorForm.city,
          query: simulatorForm.query,
          notes: simulatorForm.query,
          agent_name: simulatorForm.agentName,
          auto_call: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit form");
      }

      toast({
        title: "Lead Submitted Successfully! 🚀",
        description: `Lead for "${simulatorForm.name}" created in CRM. ${data.autoCallInitiated ? "⚡ Speed-to-Lead AI call triggered!" : "Queued in pipeline."}`,
      });
      setSimulatorDialogOpen(false);
      refetchLeadSources();
      refetchLogs();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
    } catch (err: any) {
      toast({ title: "Submission Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmittingSim(false);
    }
  };

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

  // Manual Trigger Sync Mutation (Google Sheets)
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

  // Save new sync config (Google Sheets)
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

  // Delete sync config (Google Sheets)
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

  // Create Lead Source Mutation
  const createLeadSourceMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: newLeadSource.name,
        sourceType: newLeadSource.sourceType,
        campaignId: newLeadSource.campaignId !== "none" ? newLeadSource.campaignId : null,
        agentId: newLeadSource.agentId !== "none" ? newLeadSource.agentId : null,
        spreadsheetId: newLeadSource.spreadsheetId !== "none" ? newLeadSource.spreadsheetId : null,
        autoCall: newLeadSource.autoCall,
        autoCallDelaySeconds: Number(newLeadSource.autoCallDelaySeconds) || 15,
        customGreeting: newLeadSource.customGreeting || null,
        portalConfig: {
          propertyName: newLeadSource.propertyName || undefined,
          city: newLeadSource.city || undefined,
        },
      };
      const res = await apiRequest("POST", "/api/lead-sources", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Integration Created!",
        description: `Source "${data.name}" is now ready. Webhook endpoint generated.`,
      });
      setLeadSourceDialogOpen(false);
      setNewLeadSource({
        name: "",
        sourceType: "website_form",
        campaignId: "none",
        agentId: "none",
        spreadsheetId: "none",
        autoCall: true,
        autoCallDelaySeconds: 15,
        customGreeting: "",
        propertyName: "",
        city: "",
      });
      refetchLeadSources();
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
    },
    onError: (err: any) => {
      toast({ title: "Creation Failed", description: err.message, variant: "destructive" });
    },
  });

  // Update Existing Lead Source Mutation
  const updateLeadSourceMutation = useMutation({
    mutationFn: async () => {
      if (!editingSource) return;
      const payload = {
        name: editingSource.name,
        sourceType: editingSource.sourceType,
        campaignId: editingSource.campaignId !== "none" ? editingSource.campaignId : null,
        agentId: editingSource.agentId !== "none" ? editingSource.agentId : null,
        spreadsheetId: editingSource.spreadsheetId !== "none" ? editingSource.spreadsheetId : null,
        autoCall: editingSource.autoCall,
        autoCallDelaySeconds: Number(editingSource.autoCallDelaySeconds) || 15,
        customGreeting: editingSource.customGreeting || null,
        portalConfig: {
          propertyName: editingSource.propertyName || undefined,
          city: editingSource.city || undefined,
        },
      };
      const res = await apiRequest("PATCH", `/api/lead-sources/${editingSource.id}`, payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Integration Updated! ⚡",
        description: `Settings for "${data.name}" saved. Dynamic agent & sheet routing updated.`,
      });
      setEditDialogOpen(false);
      setEditingSource(null);
      refetchLeadSources();
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  // Delete Lead Source Mutation
  const deleteLeadSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lead-sources/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Integration Deleted", description: "Lead source integration removed." });
      refetchLeadSources();
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
    },
    onError: (err: any) => {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  // Test Lead Source Simulation Mutation
  const testLeadSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingId(id);
      const res = await apiRequest("POST", `/api/lead-sources/${id}/test`);
      return res.json();
    },
    onSuccess: (data) => {
      setTestingId(null);
      toast({
        title: "Test Lead Ingested Successfully! 🚀",
        description: `Lead created for ${data.lead?.firstName || "Prospect"}. Auto-call status: ${data.autoCallInitiated ? "Triggered" : "Ready / Campaign mapped"}.`,
      });
      refetchLeadSources();
      refetchLogs();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
    },
    onError: (err: any) => {
      setTestingId(null);
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    },
  });

  // Filter lead sources by category
  const realEstateSources = leadSources.filter(s => ['99acres', 'magicbricks', 'housing'].includes(s.sourceType));
  const adSources = leadSources.filter(s => ['meta_ads', 'google_ads'].includes(s.sourceType));
  const webSources = leadSources.filter(s => ['website_form', 'custom_webhook'].includes(s.sourceType));
  const zohoSources = leadSources.filter(s => s.sourceType === 'zoho_crm');

  // Compute aggregate stats
  const totalLeadsCaptured = leadSources.reduce((acc, curr) => acc + (curr.totalLeads || 0), 0) + 
    configs.reduce((acc, curr) => acc + (curr.totalImported || 0), 0);
  const totalInstantCalls = leadSources.reduce((acc, curr) => acc + (curr.totalCalls || 0), 0);

  // Helper to get platform webhook endpoint
  const getWebhookUrl = (source: LeadSourceIntegration) => {
    switch (source.sourceType) {
      case 'zoho_crm':
        return `${baseUrl}/api/v1/integrations/zoho/${source.webhookKey}`;
      case '99acres':
        return `${baseUrl}/api/v1/integrations/99acres/${source.webhookKey}`;
      case 'magicbricks':
        return `${baseUrl}/api/v1/integrations/magicbricks/${source.webhookKey}`;
      case 'housing':
        return `${baseUrl}/api/v1/integrations/housing/${source.webhookKey}`;
      case 'meta_ads':
        return `${baseUrl}/api/v1/integrations/meta/${source.webhookKey}`;
      default:
        return `${baseUrl}/api/v1/integrations/lead-source/${source.webhookKey}`;
    }
  };

  // Helper to render a rich lead source integration card with Dynamic Agent & Google Sheet routing
  const renderLeadSourceCard = (src: LeadSourceIntegration) => {
    const webhookUrl = getWebhookUrl(src);
    const campaign = campaignsList.find(c => c.id === src.campaignId);
    const assignedAgent = agentsList.find(a => a.id === src.agentId);
    const assignedSheet = availableSpreadsheets.find(s => s.id === src.spreadsheetId);

    return (
      <div key={src.id} className="py-4 space-y-3">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{src.name}</span>
            <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 uppercase">
              {src.sourceType.replace('_', ' ')}
            </Badge>
            {src.autoCall ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-[10px] gap-1 font-medium">
                <Zap className="w-3 h-3 text-emerald-500" /> Speed-to-Lead ({src.autoCallDelaySeconds}s delay)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Auto-Call Paused
              </Badge>
            )}
            
            {/* Dynamic AI Agent Badge */}
            <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-[10px] gap-1 font-semibold">
              <PhoneCall className="w-3 h-3 text-purple-600" />
              Agent: {assignedAgent ? assignedAgent.name : "Master Receptionist (Default)"}
            </Badge>

            {/* Dynamic Destination Google Sheet Badge */}
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] gap-1 font-semibold">
              <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
              Sheet: {assignedSheet ? assignedSheet.name : "All Connected Sheets (Default)"}
            </Badge>

            <Badge className={src.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-0 text-[10px]' : 'bg-amber-500/10 text-amber-600 border-0 text-[10px]'}>
              {src.status}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 font-medium"
              onClick={() => handleOpenEdit(src)}
            >
              <Sliders className="w-3.5 h-3.5" />
              Configure
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm font-semibold"
              onClick={() => handleOpenSimulator(src)}
            >
              <Send className="w-3.5 h-3.5" />
              Fill Test Form
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-xs gap-1.5"
              disabled={testingId === src.id}
              onClick={() => testLeadSourceMutation.mutate(src.id)}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingId === src.id ? "animate-spin" : ""}`} />
              {testingId === src.id ? "Testing..." : "Quick Test"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive h-8 w-8"
              onClick={() => deleteLeadSourceMutation.mutate(src.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0 font-medium">Webhook Endpoint URL:</span>
            <code className="bg-background px-2 py-1 rounded border text-[11px] font-mono text-foreground break-all flex-1 select-all">
              {webhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => copyToClipboard(webhookUrl, src.id)}
            >
              {copiedKey === src.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              Copy
            </Button>
          </div>
          {src.sourceType === 'meta_ads' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground shrink-0 font-medium">Verify Token:</span>
              <code className="bg-background px-2 py-1 rounded border text-[11px] font-mono text-foreground">
                {src.webhookKey}
              </code>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={() => copyToClipboard(src.webhookKey, `${src.id}-key`)}
              >
                {copiedKey === `${src.id}-key` ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                Copy Key
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-[11px] pt-1 border-t border-border/40">
            <span>Campaign: <strong className="text-foreground">{campaign ? campaign.name : "CRM Only"}</strong></span>
            <span>Total Leads Captured: <strong className="text-foreground">{src.totalLeads}</strong></span>
            <span>Speed-to-Lead Calls: <strong className="text-foreground">{src.totalCalls}</strong></span>
            <span>Last Lead: <strong className="text-foreground">{src.lastLeadAt ? new Date(src.lastLeadAt).toLocaleString() : "Never"}</strong></span>
          </div>
        </div>
      </div>
    );
  };

  // Reusable Google Workspace (Sheets & Calendar) Cards and Active Mappings Section
  const renderGoogleWorkspaceSection = () => (
    <div className="space-y-6">
      {/* 3 Main Integration Cards: Google Sheets, Google Calendar & Company Email Gateway */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
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

        {/* 3. Company Email & SMTP Gateway Card */}
        <Card className="border border-border/60 hover:shadow-md transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Company Email & SMTP</CardTitle>
                  <CardDescription className="text-xs">Custom domain email & Gmail integration</CardDescription>
                </div>
              </div>
              {smtpData?.configured ? (
                <Badge className="bg-purple-500/15 text-purple-600 hover:bg-purple-500/20 border-purple-500/30 gap-1.5 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1">
                  <AlertCircle className="w-3.5 h-3.5" /> System Default
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your company's own email server (Gmail, Mailbux, Zoho, Outlook, SendGrid) so property site visit confirmations and staff briefings are sent from your brand.
            </p>

            <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sender Email:</span>
                <span className="font-medium text-foreground truncate max-w-[170px]" title={smtpData?.settings?.fromEmail || "Platform Default"}>
                  {smtpData?.settings?.fromEmail || "Platform Default"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sender Name:</span>
                <span className="font-medium text-foreground truncate max-w-[170px]" title={smtpData?.settings?.fromName || "Calliqo AI"}>
                  {smtpData?.settings?.fromName || "Calliqo AI"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button 
                size="sm" 
                className="bg-purple-600 hover:bg-purple-700 text-white gap-2 w-full font-medium"
                onClick={() => setEmailSettingsOpen(true)}
              >
                <Sliders className="w-3.5 h-3.5" />
                {smtpData?.configured ? "Configure / Test Gateway" : "Connect Company Email"}
              </Button>
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
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Overview Banner */}
      <div className="bg-gradient-to-r from-emerald-600/10 via-blue-600/10 to-purple-600/10 border border-emerald-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Calliqo Omnichannel CRM & External Synchronization Hub
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Central CRM Lead Sources, Google Sheets & Calendar Synchronization
          </h2>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Two-way synchronization with <strong>Google Sheets</strong> & <strong>Google Calendar</strong>, plus automated lead ingestion from <strong>99acres</strong>, <strong>Magicbricks</strong>, <strong>Meta Ads</strong>, and <strong>Website Forms</strong> with instant Speed-to-Lead AI voice calling.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => window.open('/test-lead-form.html', '_blank')}
            variant="outline"
            size="sm"
            className="gap-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 font-semibold"
          >
            <ExternalLink className="w-4 h-4" /> Open Live Form Simulator
          </Button>
          <Button
            onClick={() => { refetchConfigs(); refetchLogs(); refetchStatus(); refetchLeadSources(); }}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh All
          </Button>
          <Button
            onClick={() => setLeadSourceDialogOpen(true)}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Connect Lead Source
          </Button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Google Sheets Sync</p>
              <h3 className="text-sm font-bold text-foreground">
                {statusData?.googleSheets?.connected ? "Connected & Active" : "Not Linked"}
              </h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Google Calendar Booking</p>
              <h3 className="text-sm font-bold text-foreground">
                {statusData?.googleCalendar?.connected ? "Connected & Active" : "Not Linked"}
              </h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Ingested Leads</p>
              <h3 className="text-xl font-bold text-foreground">{totalLeadsCaptured}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Speed-to-Lead AI Calls</p>
              <h3 className="text-xl font-bold text-foreground">{totalInstantCalls}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 h-auto p-1 bg-muted/60 border border-border/50 rounded-xl">
          <TabsTrigger value="overview" className="gap-2 py-2.5 text-xs font-semibold">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            Overview & Hub
          </TabsTrigger>
          <TabsTrigger value="sheets-calendar" className="gap-2 py-2.5 text-xs font-semibold">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            Google Sheets & Calendar ({configs.length})
          </TabsTrigger>
          <TabsTrigger value="zoho-crm" className="gap-2 py-2.5 text-xs font-semibold">
            <Database className="w-4 h-4 text-red-500" />
            Zoho CRM ({zohoSources.length})
          </TabsTrigger>
          <TabsTrigger value="real-estate" className="gap-2 py-2.5 text-xs font-semibold">
            <Building2 className="w-4 h-4 text-blue-500" />
            Real Estate Portals ({realEstateSources.length})
          </TabsTrigger>
          <TabsTrigger value="ads" className="gap-2 py-2.5 text-xs font-semibold">
            <Megaphone className="w-4 h-4 text-purple-500" />
            Meta & Google Ads ({adSources.length})
          </TabsTrigger>
          <TabsTrigger value="website-forms" className="gap-2 py-2.5 text-xs font-semibold">
            <Globe className="w-4 h-4 text-orange-500" />
            Website Forms ({webSources.length})
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* TAB 1: OVERVIEW & HUB (Includes Google Sheets, Calendar, Portals & Webhooks) */}
        {/* ============================================================ */}
        <TabsContent value="overview" className="space-y-8 m-0">
          
          {/* SECTION 1: Google Sheets & Google Calendar Sync (Front and Center!) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  Google Sheets 2-Way Sync & Google Calendar Booking
                </h3>
                <p className="text-xs text-muted-foreground">
                  Connect your Google account to auto-import prospects from spreadsheets, book calendar site visits, and write back AI call results.
                </p>
              </div>
            </div>
            {renderGoogleWorkspaceSection()}
          </div>

          {/* SECTION 2: Omnichannel Lead Source Integrations */}
          <div className="space-y-4 pt-6 border-t border-border/60">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  Omnichannel Inbound Lead Integrations (99acres, Magicbricks, Meta, Web Forms)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Connect property portals and advertising channels to automatically ingest leads into CRM and trigger Speed-to-Lead AI voice calls.
                </p>
              </div>
              <Button size="sm" onClick={() => setLeadSourceDialogOpen(true)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add Lead Source
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Real Estate Quick Card */}
              <Card className="border border-border/60 hover:border-blue-500/40 transition-all flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold mb-2">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-base font-semibold">99acres & Magicbricks</CardTitle>
                  <CardDescription className="text-xs">
                    Connect property inquiries from 99acres, Magicbricks, and Housing.com directly into Calliqo CRM.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="text-xs text-muted-foreground flex justify-between border-t pt-3">
                    <span>Active Sources:</span>
                    <strong className="text-foreground">{realEstateSources.length} configured</strong>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs gap-1.5"
                    onClick={() => setActiveTab("real-estate")}
                  >
                    Manage Real Estate Portals <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>

              {/* Ads Quick Card */}
              <Card className="border border-border/60 hover:border-purple-500/40 transition-all flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold mb-2">
                    <Megaphone className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-base font-semibold">Meta & Google Ads</CardTitle>
                  <CardDescription className="text-xs">
                    Sync leads instantly from Facebook & Instagram Instant Forms and Google Lead Form extensions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="text-xs text-muted-foreground flex justify-between border-t pt-3">
                    <span>Active Ad Streams:</span>
                    <strong className="text-foreground">{adSources.length} configured</strong>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs gap-1.5"
                    onClick={() => setActiveTab("ads")}
                  >
                    Manage Ad Integrations <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>

              {/* Website Forms Quick Card */}
              <Card className="border border-border/60 hover:border-orange-500/40 transition-all flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center font-bold mb-2">
                    <Globe className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-base font-semibold">Website Enquiry Forms</CardTitle>
                  <CardDescription className="text-xs">
                    Embed ready-to-use webhooks on WordPress, Elementor, Contact Form 7, Webflow, or custom landing pages.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="text-xs text-muted-foreground flex justify-between border-t pt-3">
                    <span>Active Forms:</span>
                    <strong className="text-foreground">{webSources.length} configured</strong>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs gap-1.5"
                    onClick={() => setActiveTab("website-forms")}
                  >
                    Manage Website Forms <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Quick Active Sources List */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">All Active Inbound Lead Integrations</CardTitle>
                  <CardDescription className="text-xs">
                    Configured webhooks pulling leads into CRM and triggering Speed-to-Lead voice calls
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setLeadSourceDialogOpen(true)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Plus className="w-3.5 h-3.5" /> Add Lead Source
                </Button>
              </CardHeader>
              <CardContent>
                {leadSources.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground space-y-2 border border-dashed rounded-xl">
                    <Sparkles className="w-8 h-8 mx-auto text-muted-foreground/60" />
                    <p className="text-sm font-medium">No lead source integrations created yet.</p>
                    <p className="text-xs text-muted-foreground/80 max-w-md mx-auto">
                      Click "Connect Lead Source" to create your first webhook for 99acres, Magicbricks, Facebook Ads, or your website.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {leadSources.map(renderLeadSourceCard)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: GOOGLE SHEETS & CALENDAR SYNC */}
        {/* ============================================================ */}
        <TabsContent value="sheets-calendar" className="space-y-6 m-0">
          {renderGoogleWorkspaceSection()}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB: ZOHO CRM INTEGRATION (Automated Inbound & Outbound Calling) */}
        {/* ============================================================ */}
        <TabsContent value="zoho-crm" className="space-y-6 m-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Zoho CRM Overview Card */}
            <Card className="border border-border/60 hover:shadow-md transition-all md:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-red-600/10 text-red-600 flex items-center justify-center font-bold">
                    <Database className="w-5 h-5" />
                  </div>
                  <Badge className="bg-red-500/10 text-red-600 border-0 text-[10px] font-semibold">
                    Two-Way CTI & Lead Sync
                  </Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2 flex items-center gap-2">
                  Zoho CRM Automated Lead-to-Call Pipeline
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Connect your company's Zoho CRM with Calliqo AI. When a new lead is created in Zoho CRM, it is instantly captured into Calliqo CRM and dialed by your assigned AI Voice Agent with speed-to-lead automation!
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                    <span className="text-xs text-muted-foreground block">Capture Speed</span>
                    <span className="text-sm font-bold text-emerald-500">Instant (Real-time)</span>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                    <span className="text-xs text-muted-foreground block">Auto AI Dialing</span>
                    <span className="text-sm font-bold text-amber-500">Within 15 Seconds</span>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                    <span className="text-xs text-muted-foreground block">Data Ingested</span>
                    <span className="text-sm font-bold text-blue-500">Leads, Company, Notes</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button 
                    size="sm" 
                    className="bg-red-600 hover:bg-red-700 text-white gap-2 font-medium"
                    onClick={() => {
                      setNewLeadSource(prev => ({ ...prev, name: "Zoho CRM Lead Stream", sourceType: "zoho_crm" }));
                      setLeadSourceDialogOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4" /> Connect Zoho CRM Stream
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Step-by-Step Zoho Setup Guide */}
            <Card className="border border-border/60 bg-muted/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> 60-Second Zoho Setup Guide
                </CardTitle>
                <CardDescription className="text-[11px]">
                  How to trigger webhooks in Zoho CRM:
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">1. In Zoho CRM:</p>
                  <p className="text-[11px]">Go to <strong>Setup &gt; Automation &gt; Actions &gt; Webhooks</strong>.</p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">2. Click "Configure Webhook":</p>
                  <p className="text-[11px]">Name: <code className="bg-background px-1 py-0.5 rounded">Calliqo AI Auto-Caller</code></p>
                  <p className="text-[11px]">URL: Paste the webhook URL generated below.</p>
                  <p className="text-[11px]">Method: <code className="bg-background px-1 py-0.5 rounded">POST</code></p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">3. Attach to Workflow Rule:</p>
                  <p className="text-[11px]">Create a rule on <strong>Leads module &gt; On Lead Creation</strong> &gt; Action: select this Webhook.</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Active Zoho CRM Endpoints */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Active Zoho CRM Webhook Endpoints</CardTitle>
              <CardDescription className="text-xs">
                Copy this webhook URL into your Zoho CRM Webhook Action
              </CardDescription>
            </CardHeader>
            <CardContent>
              {zohoSources.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
                  No Zoho CRM streams configured yet. Click "Connect Zoho CRM Stream" above to generate your webhook URL.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {zohoSources.map(renderLeadSourceCard)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 3: REAL ESTATE PORTALS (99acres, Magicbricks, Housing) */}
        {/* ============================================================ */}
        <TabsContent value="real-estate" className="space-y-6 m-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 99acres Card */}
            <Card className="border border-border/60 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Real Estate Direct</Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2">99acres Integration</CardTitle>
                <CardDescription className="text-xs">
                  Direct webhook for 99acres lead push notifications and developer portal webhooks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When a buyer inquires on 99acres, their contact information, project preference, and inquiry text are automatically pushed into Calliqo CRM and queued for AI dialing.
                </p>
                <Button 
                  size="sm" 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  onClick={() => {
                    setNewLeadSource(prev => ({ ...prev, name: "99acres Lead Stream", sourceType: "99acres" }));
                    setLeadSourceDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Add 99acres Webhook
                </Button>
              </CardContent>
            </Card>

            {/* Magicbricks Card */}
            <Card className="border border-border/60 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-red-600/10 text-red-600 flex items-center justify-center font-bold">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <Badge className="bg-red-500/10 text-red-600 border-0 text-[10px]">Portal Push</Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2">Magicbricks Integration</CardTitle>
                <CardDescription className="text-xs">
                  Real-time webhook ingestion for Magicbricks property leads and buyer enquiries.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Support for Magicbricks XML/JSON lead push. Automatically extracts buyer name, mobile number, budget, and property ID.
                </p>
                <Button 
                  size="sm" 
                  className="w-full bg-red-600 hover:bg-red-700 text-white gap-2"
                  onClick={() => {
                    setNewLeadSource(prev => ({ ...prev, name: "Magicbricks Lead Stream", sourceType: "magicbricks" }));
                    setLeadSourceDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Add Magicbricks Webhook
                </Button>
              </CardContent>
            </Card>

            {/* Housing.com Card */}
            <Card className="border border-border/60 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-[10px]">API Supported</Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2">Housing.com Integration</CardTitle>
                <CardDescription className="text-xs">
                  Webhook listener for Housing.com and Proptiger leads.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Instantly receives buyer leads from Housing.com campaigns and schedules an outbound AI verification call with automatic calendar booking.
                </p>
                <Button 
                  size="sm" 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  onClick={() => {
                    setNewLeadSource(prev => ({ ...prev, name: "Housing.com Lead Stream", sourceType: "housing" }));
                    setLeadSourceDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Add Housing.com Webhook
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Real Estate Configured Endpoints */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Configured Real Estate Webhook Endpoints</CardTitle>
              <CardDescription className="text-xs">
                Copy and paste these endpoints into your 99acres or Magicbricks lead settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              {realEstateSources.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
                  No real estate portal webhooks configured yet. Click above to add one.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {realEstateSources.map(renderLeadSourceCard)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 4: ADVERTISING CAMPAIGNS (Meta Ads & Google Ads) */}
        {/* ============================================================ */}
        <TabsContent value="ads" className="space-y-6 m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Meta / Facebook Lead Ads */}
            <Card className="border border-border/60 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
                    <Megaphone className="w-5 h-5" />
                  </div>
                  <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Facebook & Instagram</Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2">Meta Lead Ads Webhook</CardTitle>
                <CardDescription className="text-xs">
                  Real-time webhook for Facebook & Instagram Instant Lead Forms.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Supports Meta App Webhooks verification challenge (`hub.challenge`) and automatic lead payload parsing. When a user fills your Instagram/Facebook lead ad form, Calliqo instantly calls them.
                </p>
                <Button 
                  size="sm" 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  onClick={() => {
                    setNewLeadSource(prev => ({ ...prev, name: "Meta Lead Ads Campaign", sourceType: "meta_ads" }));
                    setLeadSourceDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Create Meta Lead Webhook
                </Button>
              </CardContent>
            </Card>

            {/* Google Ads Lead Form */}
            <Card className="border border-border/60 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/10 text-purple-600 flex items-center justify-center font-bold">
                    <Megaphone className="w-5 h-5" />
                  </div>
                  <Badge className="bg-purple-500/10 text-purple-600 border-0 text-[10px]">Google Ads Extension</Badge>
                </div>
                <CardTitle className="text-base font-semibold mt-2">Google Ads Lead Form Webhook</CardTitle>
                <CardDescription className="text-xs">
                  Webhook URL and key for Google Ads Lead Form asset delivery.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paste the generated Webhook URL and Webhook Key into your Google Ads Lead Form Extension under "Lead delivery options". Google sends lead submissions in real time.
                </p>
                <Button 
                  size="sm" 
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white gap-2"
                  onClick={() => {
                    setNewLeadSource(prev => ({ ...prev, name: "Google Ads Lead Form", sourceType: "google_ads" }));
                    setLeadSourceDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Create Google Ads Webhook
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Configured Ad Endpoints */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Active Ad Campaign Integrations</CardTitle>
              <CardDescription className="text-xs">
                Copy these endpoints into your Meta Business Suite or Google Ads Lead Form settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              {adSources.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
                  No advertising webhooks configured yet. Click above to create one.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {adSources.map(renderLeadSourceCard)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 5: WEBSITE ENQUIRY FORMS (WordPress, Elementor, CF7, HTML) */}
        {/* ============================================================ */}
        <TabsContent value="website-forms" className="space-y-6 m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Website Forms Info */}
            <Card className="border border-border/60">
              <CardHeader className="pb-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center font-bold mb-2">
                  <Globe className="w-5 h-5" />
                </div>
                <CardTitle className="text-base font-semibold">Website Lead Capture Webhooks</CardTitle>
                <CardDescription className="text-xs">
                  Works seamlessly with WordPress, Elementor Forms, Contact Form 7, WPForms, Webflow, and custom HTML.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Simply point your website contact form's Webhook Action to Calliqo AI. When a visitor submits their name and phone number on your website, our AI agent calls them within 15 seconds to answer questions, qualify their interest, and book a site visit!
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button 
                    size="sm" 
                    className="bg-orange-600 hover:bg-orange-700 text-white gap-2"
                    onClick={() => {
                      setNewLeadSource(prev => ({ ...prev, name: "Website Contact Form", sourceType: "website_form" }));
                      setLeadSourceDialogOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4" /> Create Form Webhook
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Quick Embed Snippet */}
            <Card className="border border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-orange-500" />
                  <CardTitle className="text-base font-semibold">Ready-to-Use HTML Form Snippet</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Drop this snippet into any landing page or website
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ScrollArea className="h-32 rounded-lg border bg-muted/40 p-3">
                  <pre className="text-[11px] font-mono text-muted-foreground">
{`<form action="${baseUrl}/api/v1/integrations/lead-source/YOUR_WEBHOOK_KEY" method="POST">
  <input type="text" name="name" placeholder="Your Full Name" required />
  <input type="tel" name="phone" placeholder="Phone Number" required />
  <input type="email" name="email" placeholder="Email Address" />
  <button type="submit">Request Instant AI Callback</button>
</form>`}
                  </pre>
                </ScrollArea>
                <p className="text-[11px] text-muted-foreground">
                  Replace <code className="bg-muted px-1 rounded">YOUR_WEBHOOK_KEY</code> with your unique integration key below.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Configured Website Forms */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Configured Website Form Webhooks</CardTitle>
              <CardDescription className="text-xs">
                Active webhooks currently receiving website leads
              </CardDescription>
            </CardHeader>
            <CardContent>
              {webSources.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
                  No website form webhooks configured yet. Click above to create one.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {webSources.map(renderLeadSourceCard)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sync Logs & Audit Trail (Preserved & Visible for All Sources) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Sync History & Real-Time Ingestion Logs</CardTitle>
              <CardDescription className="text-xs">Real-time log of incoming leads from 99acres, Magicbricks, Meta Ads, Forms, and Google Sheets</CardDescription>
            </div>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Duplicate Safe Ingestion
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No sync events recorded yet. Logs will appear automatically when leads are ingested from any source.
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

      {/* ============================================================ */}
      {/* MODAL 1: Connect New Lead Source Integration */}
      {/* ============================================================ */}
      <Dialog open={leadSourceDialogOpen} onOpenChange={setLeadSourceDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <div className="p-6 pb-4 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle>Connect Inbound Lead Source</DialogTitle>
              <DialogDescription>
                Create a dedicated webhook endpoint to ingest leads automatically into your CRM and trigger Speed-to-Lead AI voice calls.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 p-6 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Integration Name *</Label>
                <Input 
                  placeholder="e.g. 99acres Luxury Villas"
                  value={newLeadSource.name}
                  onChange={(e) => setNewLeadSource({ ...newLeadSource, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Source Platform *</Label>
                <Select 
                  value={newLeadSource.sourceType} 
                  onValueChange={(val) => setNewLeadSource({ ...newLeadSource, sourceType: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zoho_crm">Zoho CRM (Webhook & Workflow Automation)</SelectItem>
                    <SelectItem value="99acres">99acres.com</SelectItem>
                    <SelectItem value="magicbricks">Magicbricks.com</SelectItem>
                    <SelectItem value="housing">Housing.com</SelectItem>
                    <SelectItem value="meta_ads">Meta / Facebook & Instagram Ads</SelectItem>
                    <SelectItem value="google_ads">Google Ads Lead Form</SelectItem>
                    <SelectItem value="website_form">Website Contact Form / Elementor</SelectItem>
                    <SelectItem value="custom_webhook">Custom Webhook / Zapier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assign to AI Calling Campaign</Label>
              <Select 
                value={newLeadSource.campaignId} 
                onValueChange={(val) => setNewLeadSource({ ...newLeadSource, campaignId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose campaign for automated dialing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Campaign (Import to CRM Only)</SelectItem>
                  {campaignsList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                When selected, incoming leads will automatically be enqueued to this campaign.
              </p>
            </div>

            {/* Dynamic Calling AI Agent */}
            <div className="space-y-1.5 p-3 rounded-xl bg-purple-500/5 border border-purple-500/20">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                <PhoneCall className="w-3.5 h-3.5 text-purple-600" />
                Assigned AI Calling Agent (Dynamic Voice Routing)
              </Label>
              <Select 
                value={newLeadSource.agentId} 
                onValueChange={(val) => setNewLeadSource({ ...newLeadSource, agentId: val })}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose AI Agent to call this form's leads" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Master Receptionist IVR (Default)</SelectItem>
                  {agentsList.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Whenever a lead submits this specific form, this AI Agent will place the outbound call.
              </p>
            </div>

            {/* Dynamic Destination Google Spreadsheet */}
            <div className="space-y-1.5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                Destination Google Spreadsheet (Dynamic Sync)
              </Label>
              <Select 
                value={newLeadSource.spreadsheetId} 
                onValueChange={(val) => setNewLeadSource({ ...newLeadSource, spreadsheetId: val })}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose destination spreadsheet for leads" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All Connected Spreadsheets (Default)</SelectItem>
                  {availableSpreadsheets.map((sheet) => (
                    <SelectItem key={sheet.id} value={sheet.id}>{sheet.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Incoming leads will automatically be appended as new rows into this Google Sheet.
              </p>
            </div>

            <Separator />

            {/* Speed-to-Lead Settings */}
            <div className="space-y-3 p-3 bg-muted/40 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                    <Zap className="w-4 h-4 text-emerald-500" />
                    Instant Speed-to-Lead AI Calling
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically dial prospect within seconds after they submit their inquiry.
                  </p>
                </div>
                <Switch 
                  checked={newLeadSource.autoCall}
                  onCheckedChange={(checked) => setNewLeadSource({ ...newLeadSource, autoCall: checked })}
                />
              </div>

              {newLeadSource.autoCall && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Dial Delay (Seconds)</Label>
                    <Input 
                      type="number"
                      min="5"
                      max="300"
                      value={newLeadSource.autoCallDelaySeconds}
                      onChange={(e) => setNewLeadSource({ ...newLeadSource, autoCallDelaySeconds: Number(e.target.value) })}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Project / Property Name (Optional)</Label>
                    <Input 
                      placeholder="e.g. DLF Cyber Park"
                      value={newLeadSource.propertyName}
                      onChange={(e) => setNewLeadSource({ ...newLeadSource, propertyName: e.target.value })}
                      className="h-8"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Custom AI Prompt Context / Greeting Note (Optional)</Label>
              <Textarea 
                placeholder="e.g. Mention that this inquiry is regarding the 3BHK Penthouse in Gurgaon seen on 99acres."
                value={newLeadSource.customGreeting}
                onChange={(e) => setNewLeadSource({ ...newLeadSource, customGreeting: e.target.value })}
                rows={2}
                className="text-xs"
              />
            </div>
          </div>

          <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
            <DialogFooter>
              <Button variant="outline" onClick={() => setLeadSourceDialogOpen(false)}>Cancel</Button>
              <Button 
                className="bg-emerald-600 hover:bg-emerald-700 text-white" 
                onClick={() => createLeadSourceMutation.mutate()}
                disabled={!newLeadSource.name || createLeadSourceMutation.isPending}
              >
                {createLeadSourceMutation.isPending ? "Generating..." : "Create Webhook"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* MODAL 2: Configure Google Sheet Sync (100% Preserved) */}
      {/* ============================================================ */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <div className="p-6 pb-4 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle>Configure Google Sheet 2-Way Sync</DialogTitle>
              <DialogDescription>
                Select your spreadsheet and map the columns so Calliqo AI knows where to read leads and write call results.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 p-6 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Google Spreadsheet</Label>
                  <button 
                    type="button" 
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                    onClick={() => setManualInput(!manualInput)}
                  >
                    {manualInput ? "← Select from Drive" : "Paste Link or ID →"}
                  </button>
                </div>
                {manualInput ? (
                  <Input 
                    placeholder="Paste Spreadsheet ID or Google Sheet Link"
                    value={selectedSheetId}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                      setSelectedSheetId(match ? match[1] : val);
                    }}
                  />
                ) : (
                  <Select value={selectedSheetId} onValueChange={setSelectedSheetId}>
                    <SelectTrigger>
                      <SelectValue placeholder={sheetsLoading ? "Loading spreadsheets..." : sheetsList.length === 0 ? "No spreadsheets found (click Paste Link)" : "Choose a spreadsheet..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {sheetsList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Sheet Tab Name</Label>
                {tabsList.length > 0 ? (
                  <Select value={selectedTab} onValueChange={setSelectedTab}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tab..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tabsList.map((t) => (
                        <SelectItem key={t.title} value={t.title}>{t.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input 
                    value={selectedTab}
                    onChange={(e) => setSelectedTab(e.target.value)}
                    placeholder="e.g. Sheet1"
                  />
                )}
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
                  <Label className="text-[11px]">Call Recording URL</Label>
                  <Input 
                    value={mapping.recordingUrl || ''} 
                    onChange={(e) => setMapping({ ...mapping, recordingUrl: e.target.value.toUpperCase() })} 
                    placeholder="K" 
                    className="h-8 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Appointment Date/Time</Label>
                  <Input 
                    value={mapping.appointmentDate} 
                    onChange={(e) => setMapping({ ...mapping, appointmentDate: e.target.value.toUpperCase() })} 
                    placeholder="L" 
                    className="h-8 uppercase"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
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
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* MODAL 3: Inbound Lead Form Simulator (Interactive Test Form) */}
      {/* ============================================================ */}
      <Dialog open={simulatorDialogOpen} onOpenChange={setSimulatorDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <form onSubmit={handleSimulateSubmit} className="flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 pb-4 border-b border-border/50 shrink-0">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <DialogTitle>Live Lead Form Submission Simulator</DialogTitle>
                </div>
                <DialogDescription>
                  Fill out this enquiry form as a buyer on <strong>{simulatorSource?.name}</strong> ({simulatorSource?.sourceType.toUpperCase()}). Clicking Submit will push the lead to the webhook in real time!
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="space-y-4 p-6 overflow-y-auto flex-1 text-xs">
            <div className="p-2.5 bg-muted/40 rounded-lg text-muted-foreground flex justify-between items-center text-[11px]">
              <span>Testing Webhook:</span>
              <code className="font-mono text-foreground font-semibold">
                /{simulatorSource?.sourceType}/{simulatorSource?.webhookKey.slice(0, 10)}...
              </code>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Full Name *</Label>
                <Input
                  required
                  placeholder="e.g. Sunil Kumawat"
                  value={simulatorForm.name}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, name: e.target.value })}
                  className="h-9"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Mobile Number *</Label>
                <Input
                  required
                  type="tel"
                  placeholder="+91 98XXXXXXXX"
                  value={simulatorForm.phone}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, phone: e.target.value })}
                  className="h-9 font-mono"
                />
                <span className="text-[10px] text-muted-foreground">Put your number to receive AI call</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Email Address</Label>
                <Input
                  type="email"
                  placeholder="name@example.com"
                  value={simulatorForm.email}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, email: e.target.value })}
                  className="h-9"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">City</Label>
                <Input
                  placeholder="e.g. Gurugram / Delhi"
                  value={simulatorForm.city}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, city: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Interested Project / Property</Label>
                <Input
                  placeholder="e.g. DLF Cyber Park Luxury 3BHK"
                  value={simulatorForm.project}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, project: e.target.value })}
                  className="h-9"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Budget</Label>
                <Input
                  placeholder="e.g. 2 - 3 Cr"
                  value={simulatorForm.budget}
                  onChange={(e) => setSimulatorForm({ ...simulatorForm, budget: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">Inquiry Message / Requirement</Label>
              <Textarea
                placeholder="e.g. Looking for ready-to-move apartment with park view. Please share brochure."
                value={simulatorForm.query}
                onChange={(e) => setSimulatorForm({ ...simulatorForm, query: e.target.value })}
                rows={2}
                className="text-xs"
              />
            </div>

            {/* Dynamic Calling Agent in Simulator */}
            <div className="space-y-1.5 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5" />
                  Testing AI Calling Agent
                </Label>
                {simulatorSource?.agentId && (
                  <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-500/30">
                    Form Assigned Default
                  </Badge>
                )}
              </div>
              <Select
                value={simulatorForm.agentName}
                onValueChange={(val) => setSimulatorForm({ ...simulatorForm, agentName: val })}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Choose Calling Agent" />
                </SelectTrigger>
                <SelectContent>
                  {agentsList.length > 0 ? (
                    agentsList.map((a) => (
                      <SelectItem key={a.id} value={a.name}>
                        {a.name}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="Master Receptionist IVR 11labs">Master Receptionist IVR 11labs</SelectItem>
                      <SelectItem value="TRI-CITY HOMES ( Outgoing Agent )">TRI-CITY HOMES ( Outgoing Agent )</SelectItem>
                      <SelectItem value="ABC Real State">ABC Real State</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span>Destination Sheet: <strong>{availableSpreadsheets.find(s => s.id === simulatorSource?.spreadsheetId)?.name || "All Connected Sheets (Default)"}</strong></span>
              </div>
            </div>

            </div>

            <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSimulatorDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  disabled={isSubmittingSim || !simulatorForm.phone}
                >
                  {isSubmittingSim ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isSubmittingSim ? "Submitting to Webhook..." : "Submit Form as Buyer 🚀"}
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* MODAL 4: Configure / Edit Existing Lead Source Integration */}
      {/* ============================================================ */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <div className="p-6 pb-4 border-b border-border/50 shrink-0">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Sliders className="w-4 h-4" />
                </span>
                <DialogTitle>Configure Lead Source Integration</DialogTitle>
              </div>
              <DialogDescription>
                Dynamically assign which AI Agent calls incoming leads and which Google Spreadsheet receives the data.
              </DialogDescription>
            </DialogHeader>
          </div>

          {editingSource && (
            <div className="space-y-4 p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Integration Name *</Label>
                  <Input 
                    value={editingSource.name}
                    onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Source Platform</Label>
                  <Input 
                    disabled 
                    value={editingSource.sourceType.toUpperCase()}
                    className="bg-muted text-muted-foreground uppercase text-xs font-mono"
                  />
                </div>
              </div>

              {/* Dynamic Agent Assignment */}
              <div className="space-y-1.5 p-3 rounded-xl bg-purple-500/5 border border-purple-500/20">
                <Label className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                  <PhoneCall className="w-3.5 h-3.5 text-purple-600" />
                  Assigned AI Calling Agent (Dynamic Voice Routing)
                </Label>
                <Select 
                  value={editingSource.agentId} 
                  onValueChange={(val) => setEditingSource({ ...editingSource, agentId: val })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select Calling AI Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Master Receptionist IVR (Default)</SelectItem>
                    {agentsList.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Whenever a prospect submits this form, this AI Agent will place the instant phone call.
                </p>
              </div>

              {/* Dynamic Google Sheet Destination */}
              <div className="space-y-1.5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <Label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Destination Google Spreadsheet (Dynamic Sync)
                </Label>
                <Select 
                  value={editingSource.spreadsheetId} 
                  onValueChange={(val) => setEditingSource({ ...editingSource, spreadsheetId: val })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select Destination Spreadsheet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">All Connected Spreadsheets (Default)</SelectItem>
                    {availableSpreadsheets.map((sheet) => (
                      <SelectItem key={sheet.id} value={sheet.id}>{sheet.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Leads captured from this specific form will automatically be saved into this Google Spreadsheet.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Assign to AI Campaign (Optional)</Label>
                <Select 
                  value={editingSource.campaignId} 
                  onValueChange={(val) => setEditingSource({ ...editingSource, campaignId: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Campaign (CRM Lead Only)</SelectItem>
                    {campaignsList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Speed-to-Lead Settings */}
              <div className="space-y-3 p-3 bg-muted/40 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                      <Zap className="w-4 h-4 text-emerald-500" />
                      Instant Speed-to-Lead AI Calling
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Automatically dial the prospect after form submission.
                    </p>
                  </div>
                  <Switch 
                    checked={editingSource.autoCall}
                    onCheckedChange={(checked) => setEditingSource({ ...editingSource, autoCall: checked })}
                  />
                </div>

                {editingSource.autoCall && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Dial Delay (Seconds)</Label>
                      <Input 
                        type="number"
                        min="5"
                        max="300"
                        value={editingSource.autoCallDelaySeconds}
                        onChange={(e) => setEditingSource({ ...editingSource, autoCallDelaySeconds: Number(e.target.value) })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Property / Project Name</Label>
                      <Input 
                        placeholder="e.g. DLF Cyber Heights"
                        value={editingSource.propertyName}
                        onChange={(e) => setEditingSource({ ...editingSource, propertyName: e.target.value })}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Custom AI Prompt Context / Greeting Note</Label>
                <Textarea 
                  placeholder="e.g. Inquire about 3BHK high-rise apartment preferences."
                  value={editingSource.customGreeting}
                  onChange={(e) => setEditingSource({ ...editingSource, customGreeting: e.target.value })}
                  rows={2}
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button 
                className="bg-emerald-600 hover:bg-emerald-700 text-white" 
                onClick={() => updateLeadSourceMutation.mutate()}
                disabled={updateLeadSourceMutation.isPending || !editingSource?.name}
              >
                {updateLeadSourceMutation.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Company Custom Email & SMTP Configuration Dialog */}
      <CompanyEmailSettingsDialog
        open={emailSettingsOpen}
        onOpenChange={(open) => {
          setEmailSettingsOpen(open);
          if (!open) refetchSmtp();
        }}
      />
    </div>
  );
}
