import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail,
  MessageCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  FileText,
  BarChart3,
  Send,
  Copy,
  Key,
  Settings,
  Globe,
  Shield,
  Check,
} from "lucide-react";
const apiRequest = (typeof window !== 'undefined' && (window as any).apiRequest)
  ? (window as any).apiRequest
  : (async (method: string, url: string, data?: any) => {
    const res = await fetch(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res;
  });


function useGlobalToast() {
  return {
    toast: (props: any) => {
      const globalToast = typeof window !== 'undefined' ? (window as any).__AGENTLABS_TOAST__ : null;
      if (globalToast) {
        globalToast(props);
      } else {
        console.warn('[Messaging Plugin] Toast not available, message:', props?.title);
      }
    },
  };
}

interface WhatsAppAdminConfig {
  id: string;
  whatsappProviderMode: string;
  metaAppId: string;
  metaAppSecret: string;
  metaConfigId: string;
  embeddedSignupEnabled: boolean;
  coexistenceEnabled: boolean;
  webhookVerifyToken: string;
}

interface MessagingLog {
  id: string;
  userId: string;
  userName: string;
  channel: string;
  recipientEmail: string;
  recipientPhone: string;
  templateName: string;
  status: string;
  errorMessage: string;
  messageContent: string | null;
  messageType: string | null;
  createdAt: string;
}

interface MessagingStats {
  totalSent: number;
  emailCount: number;
  whatsappCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
}

export default function AdminMessagingPage() {
  const { t } = useTranslation();
  const { toast } = useGlobalToast();
  const queryClient = useQueryClient();
  const [logFilters, setLogFilters] = useState({
    channel: "all",
    status: "all",
    page: 1,
  });

  const [waConfigForm, setWaConfigForm] = useState({
    providerMode: "both",
    metaAppId: "",
    metaAppSecret: "",
    metaConfigId: "",
    embeddedSignupEnabled: false,
    coexistenceEnabled: false,
  });

  const [adminConnectionResult, setAdminConnectionResult] = useState<{
    status: string;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    appName?: string;
    error?: string;
  } | null>(null);

  const [providerModeSaved, setProviderModeSaved] = useState(false);
  const [metaConfigSaved, setMetaConfigSaved] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<MessagingStats>({
    queryKey: ["/api/admin/messaging/stats"],
    select: (res: any) => res?.data ?? res,
  });

  const { data: waConfig, isLoading: waConfigLoading } = useQuery<WhatsAppAdminConfig | null>({
    queryKey: ["/api/admin/messaging/whatsapp-config"],
    select: (res: any) => res?.data ?? null,
  });

  const { data: webhookUrlData } = useQuery<{ webhookUrl: string }>({
    queryKey: ["/api/admin/messaging/whatsapp-config/webhook-url"],
    select: (res: any) => res?.data ?? { webhookUrl: '' },
  });

  useEffect(() => {
    if (waConfig) {
      setWaConfigForm({
        providerMode: waConfig.whatsappProviderMode || "both",
        metaAppId: waConfig.metaAppId || "",
        metaAppSecret: waConfig.metaAppSecret || "",
        metaConfigId: waConfig.metaConfigId || "",
        embeddedSignupEnabled: waConfig.embeddedSignupEnabled ?? false,
        coexistenceEnabled: waConfig.coexistenceEnabled ?? false,
      });
    }
  }, [waConfig]);

  const saveProviderModeMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", "/api/admin/messaging/whatsapp-config", data);
      return res.json();
    },
    onSuccess: (res: any) => {
      toast({ title: "Provider mode saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messaging/whatsapp-config"] });
      const config = res?.data;
      if (config) {
        setWaConfigForm((prev: any) => ({ ...prev, providerMode: config.whatsappProviderMode || prev.providerMode }));
      }
      setProviderModeSaved(true);
      setTimeout(() => setProviderModeSaved(false), 2000);
    },
    onError: (err: any) => {
      toast({ title: "Failed to save provider mode", description: err.message, variant: "destructive" });
    },
  });

  const saveMetaConfigMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", "/api/admin/messaging/whatsapp-config", data);
      return res.json();
    },
    onSuccess: (res: any) => {
      toast({ title: "Meta configuration saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messaging/whatsapp-config"] });
      const config = res?.data;
      if (config) {
        setWaConfigForm((prev: any) => ({
          ...prev,
          metaAppId: config.metaAppId || "",
          metaAppSecret: config.metaAppSecret || "",
          metaConfigId: config.metaConfigId || "",
          embeddedSignupEnabled: config.embeddedSignupEnabled ?? false,
          coexistenceEnabled: config.coexistenceEnabled ?? false,
        }));
      }
      setMetaConfigSaved(true);
      setTimeout(() => setMetaConfigSaved(false), 2000);
    },
    onError: (err: any) => {
      toast({ title: "Failed to save Meta configuration", description: err.message, variant: "destructive" });
    },
  });

  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/messaging/whatsapp-config/generate-verify-token");
      return res.json();
    },
    onSuccess: (res: any) => {
      const newToken = res?.data?.verifyToken;
      if (newToken) {
        queryClient.setQueryData(["/api/admin/messaging/whatsapp-config"], (old: any) => {
          if (!old) return old;
          const oldData = old?.data ?? old;
          return { ...old, data: { ...oldData, webhookVerifyToken: newToken } };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messaging/whatsapp-config"] });
      toast({ title: "New webhook verify token generated", description: "Copy the new token and update it in your Meta Developer Dashboard." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate token", description: err.message, variant: "destructive" });
    },
  });

  const testAdminConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/messaging/whatsapp-config/test-connection");
      return res.json();
    },
    onSuccess: (res: any) => {
      const data = res?.data;
      if (data) {
        setAdminConnectionResult(data);
      }
    },
    onError: (err: any) => {
      setAdminConnectionResult({ status: "failed", error: err.message || "Connection test failed" });
    },
  });

  const ADMIN_LOGS_PAGE_SIZE = 50;
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery<{ logs: MessagingLog[], total: number }>({
    queryKey: ["/api/admin/messaging/logs", { channel: logFilters.channel, status: logFilters.status, page: logFilters.page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (logFilters.channel !== "all") params.set("channel", logFilters.channel);
      if (logFilters.status !== "all") params.set("status", logFilters.status);
      params.set("limit", String(ADMIN_LOGS_PAGE_SIZE));
      params.set("offset", String((logFilters.page - 1) * ADMIN_LOGS_PAGE_SIZE));
      const res = await apiRequest("GET", `/api/admin/messaging/logs?${params.toString()}`);
      return res.json();
    },
    select: (res: any) => {
      if (res?.data) return { logs: res.data.logs || [], total: res.data.total || 0 };
      return { logs: res?.logs || [], total: res?.total || 0 };
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied to clipboard` });
    }).catch(() => {
      toast({ title: "Failed to copy", variant: "destructive" });
    });
  };

  const isMetaMode = waConfigForm.providerMode === 'meta_only' || waConfigForm.providerMode === 'both';

  return (
    <div className="space-y-6" data-testid="admin-messaging-page">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-admin-messaging-title">
          {t("messaging.admin.title", "Messaging Overview")}
        </h2>
        <p className="text-muted-foreground">
          {t("messaging.admin.description", "Monitor messaging activity across all users.")}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">{t("messaging.admin.totalSent", "Total Messages")}</CardTitle>
            <Send className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-sent">
              {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (stats?.totalSent ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">{t("messaging.admin.emailsSent", "Emails")}</CardTitle>
            <Mail className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-email-count">
              {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (stats?.emailCount ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">{t("messaging.admin.whatsappSent", "WhatsApp")}</CardTitle>
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-whatsapp-count">
              {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (stats?.whatsappCount ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">{t("messaging.admin.successRate", "Success Rate")}</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-success-rate">
              {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : `${(stats?.successRate ?? 0).toFixed(1)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>WhatsApp Provider Settings</CardTitle>
            <CardDescription>Control which WhatsApp providers are available to users.</CardDescription>
          </div>
          <Settings className="w-5 h-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider Mode</Label>
            <Select
              value={waConfigForm.providerMode}
              onValueChange={(v) => setWaConfigForm({ ...waConfigForm, providerMode: v })}
            >
              <SelectTrigger data-testid="select-provider-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Both Providers</SelectItem>
                <SelectItem value="whatsway_only">WhatsWay Only</SelectItem>
                <SelectItem value="meta_only">Meta WABA Only</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {waConfigForm.providerMode === 'both' && "Users can choose between WhatsWay and Meta WhatsApp Business API."}
              {waConfigForm.providerMode === 'whatsway_only' && "Only WhatsWay is available. Meta WhatsApp settings will be hidden from users."}
              {waConfigForm.providerMode === 'meta_only' && "Only Meta WhatsApp Business API is available. WhatsWay settings will be hidden from users."}
              {waConfigForm.providerMode === 'disabled' && "WhatsApp messaging is disabled for all users."}
            </p>
          </div>
          <Button
            onClick={() => saveProviderModeMutation.mutate({ provider_mode: waConfigForm.providerMode })}
            disabled={saveProviderModeMutation.isPending || providerModeSaved}
            data-testid="button-save-provider-mode"
          >
            {saveProviderModeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {providerModeSaved && <Check className="w-4 h-4 mr-2" />}
            {providerModeSaved ? "Saved!" : "Save Provider Mode"}
          </Button>
        </CardContent>
      </Card>

      {isMetaMode && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Meta Embedded Signup Configuration</CardTitle>
              <CardDescription>Configure Meta WhatsApp Business API settings for Embedded Signup and webhooks.</CardDescription>
            </div>
            <Globe className="w-5 h-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adminMetaAppId">Meta App ID</Label>
                <Input
                  id="adminMetaAppId"
                  value={waConfigForm.metaAppId}
                  onChange={(e) => setWaConfigForm({ ...waConfigForm, metaAppId: e.target.value })}
                  placeholder="Your Meta App ID"
                  data-testid="input-admin-meta-app-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminMetaAppSecret">Meta App Secret</Label>
                <Input
                  id="adminMetaAppSecret"
                  type="password"
                  value={waConfigForm.metaAppSecret}
                  onChange={(e) => setWaConfigForm({ ...waConfigForm, metaAppSecret: e.target.value })}
                  placeholder={waConfig?.metaAppSecret ? "Secret saved — leave to keep" : "Enter App Secret"}
                  data-testid="input-admin-meta-app-secret"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminMetaConfigId">Configuration ID (Facebook Login for Business)</Label>
              <Input
                id="adminMetaConfigId"
                value={waConfigForm.metaConfigId}
                onChange={(e) => setWaConfigForm({ ...waConfigForm, metaConfigId: e.target.value })}
                placeholder="Enter your Meta configuration ID"
                data-testid="input-admin-meta-config-id"
              />
              <p className="text-xs text-muted-foreground">
                Found in Meta Developer Dashboard under Facebook Login for Business settings.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label>Enable Embedded Signup</Label>
                  <p className="text-xs text-muted-foreground">When enabled, users see a "Connect with Facebook" button instead of manual API credential entry.</p>
                </div>
                <Switch
                  checked={waConfigForm.embeddedSignupEnabled}
                  onCheckedChange={(checked) => setWaConfigForm({ ...waConfigForm, embeddedSignupEnabled: checked })}
                  data-testid="switch-embedded-signup"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label>Enable Coexistence</Label>
                  <p className="text-xs text-muted-foreground">Allow users to keep their existing WhatsApp Business App alongside the API integration. Subject to limitations (20 MPS, no disappearing messages).</p>
                </div>
                <Switch
                  checked={waConfigForm.coexistenceEnabled}
                  onCheckedChange={(checked) => setWaConfigForm({ ...waConfigForm, coexistenceEnabled: checked })}
                  data-testid="switch-coexistence"
                />
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={webhookUrlData?.webhookUrl || ''}
                    className="font-mono text-xs"
                    data-testid="input-webhook-url"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(webhookUrlData?.webhookUrl || '', 'Webhook URL')}
                    data-testid="button-copy-webhook-url"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Webhook Verify Token</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={waConfig?.webhookVerifyToken || ''}
                    className="font-mono text-xs"
                    data-testid="input-verify-token"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(waConfig?.webhookVerifyToken || '', 'Verify token')}
                    data-testid="button-copy-verify-token"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => generateTokenMutation.mutate()}
                    disabled={generateTokenMutation.isPending}
                    data-testid="button-regenerate-token"
                  >
                    {generateTokenMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Add the webhook URL and verify token in your Meta Developer Dashboard under WhatsApp app configuration. Subscribe to messages and message_template_status_update webhook fields.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <Label>OAuth Redirect URI</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}/`}
                  className="font-mono text-xs"
                  data-testid="input-redirect-uri"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(`${window.location.origin}/`, 'Redirect URI')}
                  data-testid="button-copy-redirect-uri"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Add this URL to your Meta Developer Dashboard: App Settings &gt; Facebook Login for Business &gt; Valid OAuth Redirect URIs. This is required for the Embedded Signup flow to work correctly.
              </p>
            </div>

            <Button
              onClick={() => saveMetaConfigMutation.mutate({
                meta_app_id: waConfigForm.metaAppId,
                meta_app_secret: waConfigForm.metaAppSecret,
                meta_config_id: waConfigForm.metaConfigId,
                embedded_signup_enabled: waConfigForm.embeddedSignupEnabled,
                coexistence_enabled: waConfigForm.coexistenceEnabled,
              })}
              disabled={saveMetaConfigMutation.isPending || metaConfigSaved}
              data-testid="button-save-meta-config"
            >
              {saveMetaConfigMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {metaConfigSaved && <Check className="w-4 h-4 mr-2" />}
              {metaConfigSaved ? "Saved!" : "Save Meta Configuration"}
            </Button>

            {waConfig && (
            <div className="mt-6 pt-6 border-t space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="text-sm font-medium">Connection Health</h4>
                  <p className="text-xs text-muted-foreground">Verify webhook configuration and test your Meta App credentials.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={waConfig.webhookVerifyToken ? "default" : "secondary"} data-testid="badge-webhook-status">
                    {waConfig.webhookVerifyToken ? "Verify Token Set" : "Verify Token Not Set"}
                  </Badge>
                  <Badge variant={waConfig.metaAppId && waConfig.metaAppSecret ? "default" : "secondary"} data-testid="badge-api-status">
                    {waConfig.metaAppId && waConfig.metaAppSecret ? "API Credentials Set" : "API Credentials Missing — Save Required"}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => testAdminConnectionMutation.mutate()}
                  disabled={testAdminConnectionMutation.isPending}
                  data-testid="button-test-admin-connection"
                >
                  {testAdminConnectionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Test Meta App Connection
                </Button>
              </div>

              {adminConnectionResult && (
                <div
                  className={`flex flex-col gap-1 p-3 rounded-md text-sm ${
                    adminConnectionResult.status === "connected"
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                  data-testid="text-admin-connection-result"
                >
                  <div className="flex items-center gap-2">
                    {adminConnectionResult.status === "connected" ? (
                      <CheckCircle className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span className="font-medium">
                      {adminConnectionResult.status === "connected" ? "Meta App Credentials Valid" : "Connection Failed"}
                    </span>
                  </div>
                  {adminConnectionResult.appName && (
                    <span>App Name: {adminConnectionResult.appName}</span>
                  )}
                  {adminConnectionResult.error && (
                    <span>{adminConnectionResult.error}</span>
                  )}
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>{t("messaging.admin.allLogs", "All Messaging Logs")}</CardTitle>
            <CardDescription>{t("messaging.admin.logsDescription", "Messages sent by all users across all channels.")}</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={logFilters.channel} onValueChange={(v) => setLogFilters({ ...logFilters, channel: v, page: 1 })}>
              <SelectTrigger className="w-[130px]" data-testid="select-admin-log-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logFilters.status} onValueChange={(v) => setLogFilters({ ...logFilters, status: v, page: 1 })}>
              <SelectTrigger className="w-[130px]" data-testid="select-admin-log-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => refetchLogs()}
              data-testid="button-refresh-admin-logs"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : !logsData?.logs || logsData.logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t("messaging.admin.noLogs", "No messaging logs found.")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("messaging.logs.timestamp", "Time")}</TableHead>
                  <TableHead>{t("messaging.admin.user", "User")}</TableHead>
                  <TableHead>{t("messaging.logs.channel", "Channel")}</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>{t("messaging.logs.recipient", "Recipient")}</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>{t("messaging.logs.status", "Status")}</TableHead>
                  <TableHead>{t("messaging.logs.error", "Error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData.logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-admin-log-${log.id}`}>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{log.userName || log.userId}</TableCell>
                    <TableCell>
                      {log.channel === "email" ? (
                        <Badge variant="secondary"><Mail className="w-3 h-3 mr-1" />Email</Badge>
                      ) : (
                        <Badge variant="secondary"><MessageCircle className="w-3 h-3 mr-1" />WhatsApp</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs" data-testid={`badge-admin-log-type-${log.id}`}>
                        {log.messageType || log.templateName || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {log.recipientEmail || log.recipientPhone || "-"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm" data-testid={`text-admin-log-content-${log.id}`} title={log.messageContent || ""}>
                      {log.messageContent ? (log.messageContent.length > 60 ? log.messageContent.substring(0, 60) + "..." : log.messageContent) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                        {log.status === "sent" && <CheckCircle className="w-3 h-3 mr-1" />}
                        {log.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {log.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {logsData && logsData.total > 0 && (
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground" data-testid="text-admin-log-count">
                Showing {Math.min((logFilters.page - 1) * ADMIN_LOGS_PAGE_SIZE + 1, logsData.total)}-{Math.min(logFilters.page * ADMIN_LOGS_PAGE_SIZE, logsData.total)} of {logsData.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logFilters.page <= 1}
                  onClick={() => setLogFilters({ ...logFilters, page: logFilters.page - 1 })}
                  data-testid="button-admin-prev-page"
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground" data-testid="text-admin-page-info">
                  Page {logFilters.page} of {Math.max(1, Math.ceil(logsData.total / ADMIN_LOGS_PAGE_SIZE))}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logFilters.page * ADMIN_LOGS_PAGE_SIZE >= logsData.total}
                  onClick={() => setLogFilters({ ...logFilters, page: logFilters.page + 1 })}
                  data-testid="button-admin-next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
