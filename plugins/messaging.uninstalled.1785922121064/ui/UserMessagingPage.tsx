import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail,
  MessageCircle,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  Send,
  Eye,
  Pencil,
  AlertCircle,
  FileText,
  Save,
  Inbox,
  Zap,
  TrendingUp,
  ShieldCheck,
  User,
  Unplug,
  Globe,
  Clock,
  Smartphone,
  AlertTriangle,
  Info,
} from "lucide-react";
import UnlayerEmailEditor, { type UnlayerEditorHandle } from "./UnlayerEmailEditor";

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

const DRAFT_KEY = "messaging_email_draft_v2";

function useGlobalToast() {
  return {
    toast: (props: any) => {
      const globalToast = typeof window !== 'undefined' ? (window as any).__AGENTLABS_TOAST__ : null;
      if (globalToast) {
        return globalToast(props);
      }
      console.warn('[Messaging Plugin] Toast not available', props?.title);
    },
  };
}

interface DraftData {
  name: string;
  subject: string;
  variables: string;
  design?: any;
  savedAt: number;
}

function saveDraftToStorage(data: DraftData) {
  try {
    if (!data.name && !data.subject && !data.variables && !data.design) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch { }
}

function loadDraftFromStorage(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.name && !data.subject && !data.variables && !data.design) return null;
    return data;
  } catch {
    return null;
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { }
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  designJson?: any;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WhatswaySettings {
  id: string;
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  channelId: string;
  isActive: boolean;
}

interface WhatswayTemplate {
  name: string;
  status: string;
  language: string;
}

interface MetaWhatsAppSettings {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  businessName: string;
  isActive: boolean;
}

interface MetaWhatsAppTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

interface WhatsAppProviderConfig {
  providerMode: string;
  embeddedSignupEnabled: boolean;
  metaAppId?: string;
  metaConfigId?: string;
  coexistenceEnabled: boolean;
}

interface MessagingLog {
  id: string;
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

export default function UserMessagingPage() {
  const { t } = useTranslation();
  const { toast } = useGlobalToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("email");
  const [templateDialog, setTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [testEmailDialog, setTestEmailDialog] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [testTemplateId, setTestTemplateId] = useState("");
  const [testEmailVars, setTestEmailVars] = useState<Record<string, string>>({});
  const [connectionStatus, setConnectionStatus] = useState<{ type: "success" | "error" | "idle"; message: string }>({ type: "idle", message: "" });
  const [templateForm, setTemplateForm] = useState({
    name: "",
    subject: "",
    variables: "",
  });
  const [editorDesign, setEditorDesign] = useState<any>(null);
  const [editorKey, setEditorKey] = useState(0);
  const unlayerRef = useRef<UnlayerEditorHandle>(null);
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const templateFormRef = useRef(templateForm);
  templateFormRef.current = templateForm;

  useEffect(() => {
    if (draftTimerRef.current) {
      clearInterval(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    if (templateDialog && !editingTemplate) {
      draftTimerRef.current = setInterval(async () => {
        try {
          const form = templateFormRef.current;
          const design = unlayerRef.current ? await unlayerRef.current.getDesign() : null;
          saveDraftToStorage({
            name: form.name,
            subject: form.subject,
            variables: form.variables,
            design,
            savedAt: Date.now(),
          });
        } catch { }
      }, 30000);
    }
    return () => {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [templateDialog, editingTemplate]);

  const [whatsappProvider, setWhatsappProvider] = useState<"whatsway" | "meta">("meta");

  const [whatswayForm, setWhatswayForm] = useState({
    apiKey: "",
    apiSecret: "",
    baseUrl: "https://whatsway.diploy.in",
    channelId: "",
  });

  const [metaWaForm, setMetaWaForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
  });

  const [metaConnectionStatus, setMetaConnectionStatus] = useState<{ type: "success" | "error" | "idle"; message: string }>({ type: "idle", message: "" });

  const [embeddedSignupLoading, setEmbeddedSignupLoading] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [testWhatsappDialog, setTestWhatsappDialog] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState("");
  const [selectedTestTemplate, setSelectedTestTemplate] = useState<MetaWhatsAppTemplate | null>(null);
  const [bodyVariables, setBodyVariables] = useState<string[]>([]);
  const [buttonVariables, setButtonVariables] = useState<Record<number, string>>({});
  const [channelChoiceDialogOpen, setChannelChoiceDialogOpen] = useState(false);
  const [showCoexistenceRequirements, setShowCoexistenceRequirements] = useState(false);
  const [capturedWabaId, setCapturedWabaId] = useState<string | null>(null);
  const [capturedPhoneNumberId, setCapturedPhoneNumberId] = useState<string | null>(null);
  const [fbSdkReady, setFbSdkReady] = useState(false);

  const LOGS_PAGE_SIZE = 50;

  const [logFilters, setLogFilters] = useState({
    channel: "all",
    status: "all",
    page: 1,
  });

  const { data: emailTemplates = [], isLoading: templatesLoading, refetch: refetchTemplates } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/messaging/email-templates"],
    select: (res: any) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []),
  });

  const { data: whatswaySettings, isLoading: settingsLoading, refetch: refetchSettings } = useQuery<WhatswaySettings>({
    queryKey: ["/api/messaging/whatsway/settings"],
    select: (res: any) => res?.data ?? res,
  });

  const { data: whatswayTemplates = [], isLoading: waTemplatesLoading, refetch: refetchWaTemplates } = useQuery<WhatswayTemplate[]>({
    queryKey: ["/api/messaging/whatsway/templates"],
    enabled: !!whatswaySettings?.isActive,
    select: (res: any) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []),
  });

  const { data: metaWaSettings, isLoading: metaSettingsLoading, refetch: refetchMetaSettings } = useQuery<MetaWhatsAppSettings>({
    queryKey: ["/api/messaging/meta-whatsapp/settings"],
    select: (res: any) => res?.data ?? res,
  });

  const { data: metaWaTemplates = [], isLoading: metaTemplatesLoading, refetch: refetchMetaTemplates } = useQuery<MetaWhatsAppTemplate[]>({
    queryKey: ["/api/messaging/meta-whatsapp/templates"],
    enabled: !!metaWaSettings?.isActive,
    select: (res: any) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []),
  });

  const { data: providerConfig } = useQuery<WhatsAppProviderConfig>({
    queryKey: ["/api/messaging/whatsapp-provider-config"],
    select: (res: any) => res?.data ?? res,
  });

  const { data: channelHealth, isLoading: channelHealthLoading, refetch: refetchChannelHealth } = useQuery<{
    accountMode: string;
    qualityRating: string;
    messagingLimit: string;
    throughput: string;
    verification: string;
    nameStatus: string;
    phoneNumber: string;
    businessName: string;
    lastChecked: string;
  }>({
    queryKey: ["/api/messaging/meta-whatsapp/channel-health"],
    enabled: !!metaWaSettings?.isActive,
    select: (res: any) => res?.data ?? res,
  });

  const disconnectMetaMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/messaging/meta-whatsapp/settings");
    },
    onSuccess: () => {
      toast({ title: "WhatsApp disconnected", description: "Your Meta WhatsApp Business Account has been disconnected." });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/channel-health"] });
      refetchMetaSettings();
    },
    onError: (err: any) => {
      toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" });
    },
  });

  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery<{ logs: MessagingLog[], total: number }>({
    queryKey: ["/api/messaging/logs", { channel: logFilters.channel, status: logFilters.status, page: logFilters.page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (logFilters.channel !== "all") params.set("channel", logFilters.channel);
      if (logFilters.status !== "all") params.set("status", logFilters.status);
      params.set("limit", String(LOGS_PAGE_SIZE));
      params.set("offset", String((logFilters.page - 1) * LOGS_PAGE_SIZE));
      const res = await apiRequest("GET", `/api/messaging/logs?${params.toString()}`);
      return res.json();
    },
    select: (res: any) => {
      if (res?.data) return { logs: res.data.logs || [], total: res.data.total || 0 };
      return { logs: res?.logs || [], total: res?.total || 0 };
    },
  });

  useEffect(() => {
    if (whatswaySettings) {
      setWhatswayForm({
        apiKey: whatswaySettings.apiKey || "",
        apiSecret: whatswaySettings.apiSecret || "",
        baseUrl: whatswaySettings.baseUrl || "https://whatsway.diploy.in",
        channelId: whatswaySettings.channelId || "",
      });
    }
  }, [whatswaySettings]);

  useEffect(() => {
    if (metaWaSettings) {
      setMetaWaForm({
        phoneNumberId: metaWaSettings.phoneNumberId || "",
        wabaId: metaWaSettings.wabaId || "",
        accessToken: "",
      });
    }
  }, [metaWaSettings]);

  useEffect(() => {
    if (providerConfig?.providerMode === 'meta_only') {
      setWhatsappProvider("meta");
    } else if (providerConfig?.providerMode === 'whatsway_only') {
      setWhatsappProvider("whatsway");
    } else if (metaWaSettings?.isActive) {
      setWhatsappProvider("meta");
    } else if (whatswaySettings?.isActive) {
      setWhatsappProvider("whatsway");
    }
  }, [metaWaSettings, whatswaySettings, providerConfig]);

  useEffect(() => {
    if (!providerConfig?.metaAppId || !providerConfig?.embeddedSignupEnabled) return;
    if ((window as any).FB) {
      (window as any).FB.init({
        appId: providerConfig.metaAppId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v22.0',
      });
      setFbSdkReady(true);
      return;
    }
    const existingScript = document.getElementById('facebook-jssdk');
    if (existingScript) existingScript.remove();
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: providerConfig.metaAppId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v22.0',
      });
      setFbSdkReady(true);
    };
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.onerror = () => console.error('[Messaging] Failed to load Facebook SDK');
    document.body.appendChild(script);
  }, [providerConfig?.metaAppId, providerConfig?.embeddedSignupEnabled]);

  const createTemplateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/messaging/email-templates", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template created successfully" });
      clearDraft();
      setTemplateDialog(false);
      resetTemplateForm();
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/email-templates"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create template", description: err.message, variant: "destructive" });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/messaging/email-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template updated successfully" });
      clearDraft();
      setTemplateDialog(false);
      setEditingTemplate(null);
      resetTemplateForm();
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/email-templates"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update template", description: err.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/messaging/email-templates/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Template deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/email-templates"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async ({ id, email, variables }: { id: string; email: string; variables: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/messaging/email-templates/${id}/test`, { recipientEmail: email, variables });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Test email sent successfully" });
      setTestEmailDialog(false);
      setTestEmailAddress("");
      setTestEmailVars({});
    },
    onError: (err: any) => {
      toast({ title: "Failed to send test email", description: err.message, variant: "destructive" });
    },
  });

  const testWhatsappMutation = useMutation({
    mutationFn: async ({ phoneNumber, templateName, language, components }: { phoneNumber: string; templateName: string; language: string; components: any[] }) => {
      const res = await apiRequest("POST", "/api/messaging/whatsapp/test", { phoneNumber, templateName, language, components });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Test WhatsApp message sent successfully" });
      setTestWhatsappDialog(false);
      setTestPhoneNumber("");
      setSelectedTestTemplate(null);
      setBodyVariables([]);
      setButtonVariables({});
    },
    onError: (err: any) => {
      toast({ title: "Failed to send test message", description: err.message, variant: "destructive" });
    },
  });

  const saveWhatswayMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/messaging/whatsway/settings", data);
      return res.json();
    },
    onSuccess: (result: any) => {
      const data = result?.data;
      if (data?.verified) {
        const name = data.accountName || "WhatsWay";
        setConnectionStatus({ type: "success", message: `Connected to ${name}` });
        toast({ title: "Settings saved & verified", description: `Connected to ${name}` });
      } else {
        const errMsg = data?.verifyError || "Could not verify credentials";
        setConnectionStatus({ type: "error", message: errMsg });
        toast({ title: "Settings saved", description: `Credentials saved but verification failed: ${errMsg}`, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/whatsway/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/whatsway/templates"] });
    },
    onError: (err: any) => {
      setConnectionStatus({ type: "error", message: err.message });
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/messaging/whatsway/test-connection");
      return res.json();
    },
    onSuccess: (result: any) => {
      const name = result?.data?.name || result?.data?.businessName || "WhatsWay";
      setConnectionStatus({ type: "success", message: `Connected to ${name}` });
      toast({ title: "Connection successful", description: `Connected to ${name}` });
    },
    onError: (err: any) => {
      setConnectionStatus({ type: "error", message: err.message });
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMetaWaMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/messaging/meta-whatsapp/settings", data);
      return res.json();
    },
    onSuccess: (result: any) => {
      const data = result?.data;
      if (data?.verified) {
        const name = data.businessName || "Meta WhatsApp";
        setMetaConnectionStatus({ type: "success", message: `Connected to ${name}` });
        toast({ title: "Settings saved & verified", description: `Connected to ${name}` });
      } else {
        const errMsg = data?.verifyError || "Could not verify credentials";
        setMetaConnectionStatus({ type: "error", message: errMsg });
        toast({ title: "Settings saved", description: `Credentials saved but verification failed: ${errMsg}`, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/templates"] });
    },
    onError: (err: any) => {
      setMetaConnectionStatus({ type: "error", message: err.message });
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  const testMetaConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/messaging/meta-whatsapp/test-connection");
      return res.json();
    },
    onSuccess: (result: any) => {
      const name = result?.data?.businessName || "Meta WhatsApp";
      setMetaConnectionStatus({ type: "success", message: `Connected to ${name}` });
      toast({ title: "Connection successful", description: `Connected to ${name}` });
    },
    onError: (err: any) => {
      setMetaConnectionStatus({ type: "error", message: err.message });
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const handleConnectWhatsApp = useCallback(() => {
    if (providerConfig?.coexistenceEnabled) {
      setChannelChoiceDialogOpen(true);
    } else {
      handleEmbeddedSignup(false);
    }
  }, [providerConfig?.coexistenceEnabled]);

  const handleEmbeddedSignup = useCallback((useCoexistence: boolean) => {
    console.log('[Messaging] handleEmbeddedSignup called', {
      metaAppId: providerConfig?.metaAppId,
      metaConfigId: providerConfig?.metaConfigId,
      fbAvailable: !!(window as any).FB,
      useCoexistence,
    });

    if (!providerConfig?.metaAppId || !providerConfig?.metaConfigId) {
      toast({ title: "Embedded Signup not configured", description: "Admin has not configured Meta App ID or Config ID.", variant: "destructive" });
      return;
    }

    setEmbeddedSignupLoading(true);

    const proceedWithFBLogin = () => {
      console.log('[Messaging] proceedWithFBLogin executing, FB:', !!(window as any).FB);
      if (!(window as any).FB) {
        console.error('[Messaging] FB still not available after SDK load');
        setEmbeddedSignupLoading(false);
        toast({ title: "Facebook SDK failed to load", description: "Please try opening the app in a new browser tab, or check if your browser blocks third-party scripts.", variant: "destructive" });
        return;
      }

      setCapturedWabaId(null);
      setCapturedPhoneNumberId(null);

      let capturedWaba: string | null = null;
      let capturedPhone: string | null = null;

      const sessionInfoListener = (event: MessageEvent) => {
        if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
        try {
          if (!event.data) return;
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data.type === 'WA_EMBEDDED_SIGNUP') {
            if (data.event === 'FINISH') {
              capturedWaba = data.data?.waba_id || null;
              capturedPhone = data.data?.phone_number_id || null;
              setCapturedWabaId(capturedWaba);
              setCapturedPhoneNumberId(capturedPhone);
            }
          }
        } catch { }
      };

      window.addEventListener('message', sessionInfoListener);

      try {
        (window as any).FB.login(
          (response: any) => {
            const authCode = response.authResponse?.code || response.code || null;
            const accessToken = response.authResponse?.accessToken || response.authResponse?.access_token || null;
            window.removeEventListener('message', sessionInfoListener);

            const codeOrToken = authCode || accessToken;
            if (codeOrToken) {
              (async () => {
                try {
                  const res = await apiRequest("POST", "/api/messaging/meta-whatsapp/embedded-signup/callback", {
                    code: codeOrToken,
                    wabaId: capturedWaba || undefined,
                    phoneNumberId: capturedPhone || undefined,
                    coexistenceMode: useCoexistence,
                  });
                  const result = await res.json();

                  if (result.success) {
                    if (result.data?.coexistenceFallback) {
                      toast({
                        title: "Connected in Standard Mode",
                        description: result.data.fallbackReason || "This number doesn't support coexistence. It was connected in standard mode instead.",
                      });
                    } else {
                      toast({ title: "WhatsApp connected successfully", description: result.data?.businessName ? `Connected to ${result.data.businessName}` : "Your WhatsApp Business Account has been connected." });
                    }

                    queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/settings"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/messaging/meta-whatsapp/templates"] });
                    refetchMetaSettings();
                  } else {
                    toast({ title: "Signup failed", description: result.error || "Something went wrong", variant: "destructive" });
                  }
                } catch (err: any) {
                  toast({ title: "Signup failed", description: err.message || "Failed to complete embedded signup", variant: "destructive" });
                } finally {
                  setEmbeddedSignupLoading(false);
                }
              })();
            } else {
              console.warn('[Messaging] FB.login returned no code or token');
              const hasSessionData = !!(capturedWaba || capturedPhone);
              toast({
                title: hasSessionData ? "Connection incomplete" : "Signup cancelled",
                description: hasSessionData
                  ? "The signup flow completed but no authorization code was returned. Please try again — if the issue persists, check your Meta App configuration."
                  : "Facebook login was cancelled or failed.",
                variant: "destructive",
              });
              setEmbeddedSignupLoading(false);
            }
          },
          {
            config_id: providerConfig!.metaConfigId,
            response_type: 'code',
            override_default_response_type: true,
            extras: useCoexistence
              ? {
                setup: {},
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
              }
              : {
                feature: 'whatsapp_embedded_signup',
                setup: { version: 2 },
              },
          }
        );
      } catch (err: any) {
        console.error('[Messaging] FB.login threw error:', err);
        window.removeEventListener('message', sessionInfoListener);
        setEmbeddedSignupLoading(false);
        toast({ title: "Failed to start signup", description: err.message || "Could not load Facebook SDK", variant: "destructive" });
      }
    };

    if ((window as any).FB) {
      console.log('[Messaging] FB SDK already available, proceeding directly');
      proceedWithFBLogin();
    } else {
      console.log('[Messaging] FB SDK not available, loading script...');
      const existingScript = document.getElementById('facebook-jssdk');
      if (existingScript) existingScript.remove();

      (window as any).fbAsyncInit = function () {
        console.log('[Messaging] fbAsyncInit fired, initializing FB SDK');
        (window as any).FB.init({
          appId: providerConfig!.metaAppId,
          autoLogAppEvents: true,
          xfbml: false,
          version: 'v22.0',
        });
        setFbSdkReady(true);
        proceedWithFBLogin();
      };

      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.onerror = () => {
        console.error('[Messaging] Failed to load Facebook SDK script');
        setEmbeddedSignupLoading(false);
        toast({ title: "Facebook SDK failed to load", description: "Could not load Facebook SDK. Check if your browser blocks third-party scripts, or try opening the app in a new tab.", variant: "destructive" });
      };
      document.body.appendChild(script);

      setTimeout(() => {
        if (!(window as any).FB) {
          console.warn('[Messaging] FB SDK load timeout after 8 seconds');
        }
      }, 8000);
    }
  }, [providerConfig, toast, refetchMetaSettings]);

  const resetTemplateForm = () => {
    setTemplateForm({ name: "", subject: "", variables: "" });
    setEditorDesign(null);
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    const draft = loadDraftFromStorage();
    if (draft && (draft.name || draft.subject || draft.design)) {
      setTemplateForm({ name: draft.name || "", subject: draft.subject || "", variables: draft.variables || "" });
      setEditorDesign(draft.design || null);
      toast({ title: "Draft restored", description: "Your previous unsaved template has been restored." });
    } else {
      resetTemplateForm();
    }
    setEditorKey((k) => k + 1);
    setTemplateDialog(true);
  };

  const openEditTemplate = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      subject: template.subject,
      variables: (template.variables || []).join(", "),
    });
    setEditorDesign(template.designJson ?? null);
    setEditorKey((k) => k + 1);
    setTemplateDialog(true);
  };

  const handleSaveTemplate = async () => {
    if (!unlayerRef.current) return;
    try {
      const { html, design } = await unlayerRef.current.exportHtml();
      const data = {
        name: templateForm.name,
        subject: templateForm.subject,
        htmlBody: html,
        designJson: design,
        variables: templateForm.variables.split(",").map(v => v.trim()).filter(Boolean),
      };
      if (editingTemplate) {
        updateTemplateMutation.mutate({ id: editingTemplate.id, data });
      } else {
        createTemplateMutation.mutate(data);
      }
    } catch (err: any) {
      toast({ title: "Failed to export email", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveDraftManual = async () => {
    try {
      const design = unlayerRef.current ? await unlayerRef.current.getDesign() : null;
      saveDraftToStorage({
        name: templateForm.name,
        subject: templateForm.subject,
        variables: templateForm.variables,
        design,
        savedAt: Date.now(),
      });
      toast({ title: "Draft saved", description: "Your template draft has been saved locally." });
    } catch {
      toast({ title: "Draft saved", description: "Form fields saved (editor design may not be included)." });
      saveDraftToStorage({
        name: templateForm.name,
        subject: templateForm.subject,
        variables: templateForm.variables,
        savedAt: Date.now(),
      });
    }
  };

  const handleDialogClose = async () => {
    if (!editingTemplate) {
      try {
        const design = unlayerRef.current ? await unlayerRef.current.getDesign() : null;
        saveDraftToStorage({
          name: templateForm.name,
          subject: templateForm.subject,
          variables: templateForm.variables,
          design,
          savedAt: Date.now(),
        });
      } catch {
        saveDraftToStorage({
          name: templateForm.name,
          subject: templateForm.subject,
          variables: templateForm.variables,
          savedAt: Date.now(),
        });
      }
    }
    setTemplateDialog(false);
    setEditingTemplate(null);
    resetTemplateForm();
  };

  return (
    <div className="space-y-6" data-testid="user-messaging-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-messaging-title">
            {t("messaging.title", "Messaging")}
          </h2>
          <p className="text-muted-foreground">
            {t("messaging.description", "Configure email templates and WhatsApp messaging for your AI agents.")}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="email" data-testid="tab-email">
            <Mail className="w-4 h-4 mr-2" />
            {t("messaging.tabs.email", "Email Templates")}
          </TabsTrigger>
          {providerConfig?.providerMode !== 'disabled' && (
            <TabsTrigger value="whatsapp" data-testid="tab-whatsapp">
              <MessageCircle className="w-4 h-4 mr-2" />
              {t("messaging.tabs.whatsapp", "WhatsApp")}
            </TabsTrigger>
          )}
          <TabsTrigger value="logs" data-testid="tab-logs">
            <FileText className="w-4 h-4 mr-2" />
            {t("messaging.tabs.logs", "Logs")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>{t("messaging.email.title", "Email Templates")}</CardTitle>
                <CardDescription>{t("messaging.email.description", "Create and manage email templates that your AI agents can send during calls.")}</CardDescription>
              </div>
              <Button
                onClick={openNewTemplate}
                data-testid="button-create-template"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("messaging.email.createTemplate", "New Template")}
              </Button>
            </CardHeader>
            <CardContent>
              {templatesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : !Array.isArray(emailTemplates) || emailTemplates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>{t("messaging.email.noTemplates", "No email templates yet. Create your first template to get started.")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("messaging.email.name", "Name")}</TableHead>
                      <TableHead>{t("messaging.email.subject", "Subject")}</TableHead>
                      <TableHead>{t("messaging.email.variables", "Variables")}</TableHead>
                      <TableHead>{t("messaging.email.status", "Status")}</TableHead>
                      <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emailTemplates.map((template) => (
                      <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                        <TableCell className="font-medium">{template.name}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{template.subject}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(template.variables || []).map((v, i) => (
                              <Badge key={v} variant="secondary">{v}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={template.isActive ? "default" : "secondary"}>
                            {template.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditTemplate(template)}
                              data-testid={`button-edit-template-${template.id}`}
                            >
                              <Pencil className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setTestTemplateId(template.id);
                                const initVars: Record<string, string> = {};
                                (template.variables || []).forEach((v: string) => { initVars[v] = `[${v}]`; });
                                setTestEmailVars(initVars);
                                setTestEmailDialog(true);
                              }}
                              data-testid={`button-test-template-${template.id}`}
                            >
                              <Send className="w-4 h-4 text-green-600 dark:text-green-400" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTemplateId(template.id)}
                              data-testid={`button-delete-template-${template.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {providerConfig?.providerMode !== 'whatsway_only' && (
              <Button
                variant={whatsappProvider === "meta" ? "default" : "outline"}
                style={whatsappProvider === "meta" ? { backgroundColor: '#25D366', borderColor: '#25D366', color: '#fff' } : undefined}
                onClick={() => setWhatsappProvider("meta")}
                data-testid="button-provider-meta"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Meta WhatsApp Business
                {metaWaSettings?.isActive && (
                  <Badge variant="secondary" className="ml-2 bg-green-600 text-white border-green-600">Active</Badge>
                )}
              </Button>
            )}
            {providerConfig?.providerMode !== 'meta_only' && (
              <Button
                variant={whatsappProvider === "whatsway" ? "default" : "outline"}
                onClick={() => setWhatsappProvider("whatsway")}
                data-testid="button-provider-whatsway"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                WhatsWay
                {whatswaySettings?.isActive && (
                  <Badge variant="secondary" className="ml-2 bg-green-600 text-white border-green-600">Active</Badge>
                )}
              </Button>
            )}
          </div>

          {whatsappProvider === "meta" && (
            <>
              {providerConfig?.embeddedSignupEnabled && (
                <Card>
                  <CardHeader>
                    <CardTitle>{metaWaSettings?.isActive ? 'WhatsApp Connected' : 'Quick Setup with Facebook'}</CardTitle>
                    <CardDescription>{metaWaSettings?.isActive ? 'Your WhatsApp Business Account is connected via Facebook Embedded Signup.' : 'Connect your WhatsApp Business Account instantly using Facebook Embedded Signup. This is the fastest way to get started.'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!metaWaSettings?.isActive && (!providerConfig?.metaAppId || !providerConfig?.metaConfigId) && (
                      <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm" data-testid="text-embedded-signup-not-configured">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>Embedded Signup is not fully configured yet. Please ask your administrator to set up the Meta App ID and Configuration ID.</p>
                      </div>
                    )}
                    {metaWaSettings?.isActive ? (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            onClick={() => setDisconnectConfirmOpen(true)}
                            disabled={disconnectMetaMutation.isPending}
                            data-testid="button-disconnect-meta"
                            className="text-destructive border-destructive/50"
                          >
                            {disconnectMetaMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            <Unplug className="w-4 h-4 mr-2" />
                            Disconnect WhatsApp
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setTestWhatsappDialog(true)}
                            data-testid="button-test-whatsapp"
                          >
                            <Send className="w-4 h-4 mr-2" />
                            Send Test Message
                          </Button>
                        </div>
                        <AlertDialog open={disconnectConfirmOpen} onOpenChange={setDisconnectConfirmOpen}>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle data-testid="text-disconnect-title">Disconnect WhatsApp?</AlertDialogTitle>
                              <AlertDialogDescription data-testid="text-disconnect-desc">
                                This will disconnect your WhatsApp Business Account. Incoming messages, auto-replies, and template messaging will stop working immediately. You can reconnect later using the embedded signup flow.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid="button-disconnect-cancel">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  disconnectMetaMutation.mutate();
                                  setDisconnectConfirmOpen(false);
                                }}
                                className="bg-destructive text-destructive-foreground"
                                data-testid="button-disconnect-confirm"
                              >
                                Disconnect
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    ) : (
                      <Button
                        style={{ backgroundColor: '#25D366', borderColor: '#25D366', color: '#fff' }}
                        onClick={handleConnectWhatsApp}
                        disabled={embeddedSignupLoading}
                        data-testid="button-embedded-signup"
                      >
                        {embeddedSignupLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Connect WhatsApp
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {!providerConfig?.embeddedSignupEnabled && (
              <Card>
                <CardHeader>
                  <CardTitle>Meta WhatsApp Business API</CardTitle>
                  <CardDescription>
                    Connect your own WhatsApp Business Account using Meta Cloud API. Create and manage templates on Meta Business Manager, then sync them here.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="metaPhoneNumberId">Phone Number ID</Label>
                      <Input
                        id="metaPhoneNumberId"
                        value={metaWaForm.phoneNumberId}
                        onChange={(e) => setMetaWaForm({ ...metaWaForm, phoneNumberId: e.target.value })}
                        placeholder="e.g., 123456789012345"
                        data-testid="input-meta-phone-number-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        Found in Meta Business Manager under WhatsApp &gt; API Setup.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="metaWabaId">WhatsApp Business Account ID</Label>
                      <Input
                        id="metaWabaId"
                        value={metaWaForm.wabaId}
                        onChange={(e) => setMetaWaForm({ ...metaWaForm, wabaId: e.target.value })}
                        placeholder="e.g., 123456789012345"
                        data-testid="input-meta-waba-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        Your WABA ID from Meta Business Settings.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metaAccessToken">Permanent Access Token</Label>
                    <Input
                      id="metaAccessToken"
                      type="password"
                      value={metaWaForm.accessToken}
                      onChange={(e) => setMetaWaForm({ ...metaWaForm, accessToken: e.target.value })}
                      placeholder={(metaWaSettings as any)?.hasAccessToken ? "Token saved — leave empty to keep current" : "Enter your Meta system user access token"}
                      data-testid="input-meta-access-token"
                    />
                    <p className="text-xs text-muted-foreground">
                      {(metaWaSettings as any)?.hasAccessToken
                        ? "Access token is saved. Leave empty to keep the current token, or enter a new one to replace it."
                        : "Generate a permanent token from Meta Business Settings > System Users. Requires whatsapp_business_management and whatsapp_business_messaging permissions."
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={() => saveMetaWaMutation.mutate(metaWaForm)}
                      disabled={saveMetaWaMutation.isPending}
                      data-testid="button-save-meta-wa"
                    >
                      {saveMetaWaMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => testMetaConnectionMutation.mutate()}
                      disabled={testMetaConnectionMutation.isPending || saveMetaWaMutation.isPending || !metaWaSettings}
                      data-testid="button-test-meta-wa"
                    >
                      {testMetaConnectionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Test Connection
                    </Button>
                    {metaWaSettings?.isActive && (
                      <Button
                        variant="outline"
                        onClick={() => setTestWhatsappDialog(true)}
                        data-testid="button-test-whatsapp-manual"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Send Test Message
                      </Button>
                    )}
                  </div>
                  {metaConnectionStatus.type !== "idle" && (
                    <div
                      className={`flex items-center gap-2 p-2.5 rounded-md text-sm ${
                        metaConnectionStatus.type === "success"
                          ? "bg-green-500/10 text-green-700 dark:text-green-400"
                          : "bg-destructive/10 text-destructive"
                      }`}
                      data-testid="text-meta-connection-status"
                    >
                      {metaConnectionStatus.type === "success" ? (
                        <CheckCircle className="w-4 h-4 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{metaConnectionStatus.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
              )}

              {metaWaSettings?.isActive && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MessageCircle className="w-5 h-5" />
                      <CardTitle>Channel Health</CardTitle>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {channelHealth && !channelHealthLoading && (
                        <Badge variant="secondary" className="bg-green-600 text-white border-green-600" data-testid="badge-channel-healthy">
                          Healthy
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {channelHealthLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : channelHealth ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="p-3 rounded-md border border-l-4 border-l-green-500 bg-green-500/5" data-testid="health-account-mode">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Zap className="w-3.5 h-3.5" />
                              Account Mode
                            </div>
                            <p className="font-semibold text-green-700 dark:text-green-400">{channelHealth.accountMode}</p>
                          </div>
                          <div className="p-3 rounded-md border border-l-4 border-l-green-500 bg-green-500/5" data-testid="health-quality-rating">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <TrendingUp className="w-3.5 h-3.5" />
                              Quality Rating
                            </div>
                            <p className={`font-semibold ${channelHealth.qualityRating === 'GREEN' ? 'text-green-700 dark:text-green-400' : channelHealth.qualityRating === 'YELLOW' ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'}`}>{channelHealth.qualityRating}</p>
                          </div>
                          <div className="p-3 rounded-md border border-l-4 border-l-purple-500 bg-purple-500/5" data-testid="health-messaging-limit">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Zap className="w-3.5 h-3.5" />
                              Messaging Limit
                            </div>
                            <p className="font-semibold text-purple-700 dark:text-purple-400">{channelHealth.messagingLimit}</p>
                          </div>
                          <div className="p-3 rounded-md border border-l-4 border-l-green-500 bg-green-500/5" data-testid="health-throughput">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <RefreshCw className="w-3.5 h-3.5" />
                              Throughput
                            </div>
                            <p className="font-semibold text-green-700 dark:text-green-400">{channelHealth.throughput}</p>
                          </div>
                          <div className="p-3 rounded-md border border-l-4 border-l-green-500 bg-green-500/5" data-testid="health-verification">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Verification
                            </div>
                            <p className="font-semibold text-green-700 dark:text-green-400">{channelHealth.verification}</p>
                          </div>
                          <div className="p-3 rounded-md border border-l-4 border-l-green-500 bg-green-500/5" data-testid="health-name-status">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <User className="w-3.5 h-3.5" />
                              Name Status
                            </div>
                            <p className="font-semibold text-green-700 dark:text-green-400">{channelHealth.nameStatus}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground pt-1">
                          <span>Last checked: {new Date(channelHealth.lastChecked).toLocaleString()}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => refetchChannelHealth()}
                            disabled={channelHealthLoading}
                            data-testid="button-refresh-channel-health"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${channelHealthLoading ? 'animate-spin' : ''}`} />
                            Refresh
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        <p>Unable to fetch channel health data.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {metaWaSettings?.isActive && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Approved Templates</CardTitle>
                      <CardDescription>Templates approved in your Meta WhatsApp Business Account. Create templates in Meta Business Manager, then sync them here.</CardDescription>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        const result = await refetchMetaTemplates();
                        const templates = result?.data;
                        const count = Array.isArray(templates) ? templates.length : 0;
                        toast({
                          title: count > 0 ? `${count} template${count > 1 ? 's' : ''} synced` : "No templates found",
                          description: count > 0 ? "Meta WhatsApp templates refreshed successfully." : "No approved templates found in your WABA.",
                        });
                      }}
                      disabled={metaTemplatesLoading}
                      data-testid="button-refresh-meta-templates"
                    >
                      <RefreshCw className={`w-4 h-4 ${metaTemplatesLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {metaTemplatesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : !Array.isArray(metaWaTemplates) || metaWaTemplates.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No approved templates found. Create templates in Meta Business Manager and ensure they are approved.</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Template Name</TableHead>
                            <TableHead>Language</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {metaWaTemplates.map((tmpl, idx) => (
                            <TableRow key={`${tmpl.name}-${tmpl.language}`} data-testid={`row-meta-template-${idx}`}>
                              <TableCell className="font-medium">{tmpl.name}</TableCell>
                              <TableCell>{tmpl.language}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{tmpl.category}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className="bg-green-600 text-white border-green-600"
                                >
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {tmpl.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {whatsappProvider === "whatsway" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("messaging.whatsapp.settingsTitle", "WhatsWay Settings")}</CardTitle>
                  <CardDescription>{t("messaging.whatsapp.settingsDescription", "Configure your WhatsWay API credentials to enable WhatsApp messaging.")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="waApiKey">{t("messaging.whatsapp.apiKey", "API Key")}</Label>
                      <Input
                        id="waApiKey"
                        type="password"
                        value={whatswayForm.apiKey}
                        onChange={(e) => setWhatswayForm({ ...whatswayForm, apiKey: e.target.value })}
                        placeholder="Enter your WhatsWay API key"
                        data-testid="input-whatsway-api-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="waApiSecret">{t("messaging.whatsapp.apiSecret", "API Secret")}</Label>
                      <Input
                        id="waApiSecret"
                        type="password"
                        value={whatswayForm.apiSecret}
                        onChange={(e) => setWhatswayForm({ ...whatswayForm, apiSecret: e.target.value })}
                        placeholder="Enter your WhatsWay API secret"
                        data-testid="input-whatsway-api-secret"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="waBaseUrl">{t("messaging.whatsapp.baseUrl", "Base URL")}</Label>
                      <Input
                        id="waBaseUrl"
                        value={whatswayForm.baseUrl}
                        onChange={(e) => setWhatswayForm({ ...whatswayForm, baseUrl: e.target.value })}
                        placeholder="https://whatsway.diploy.in"
                        data-testid="input-whatsway-base-url"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("messaging.whatsapp.baseUrlHint", "The base URL of your WhatsWay instance.")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="waChannelId">{t("messaging.whatsapp.channelId", "Channel ID")}</Label>
                      <Input
                        id="waChannelId"
                        value={whatswayForm.channelId}
                        onChange={(e) => setWhatswayForm({ ...whatswayForm, channelId: e.target.value })}
                        placeholder="Enter your WhatsWay Channel ID"
                        data-testid="input-whatsway-channel-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("messaging.whatsapp.channelIdHint", "Required by WhatsWay API. Find it in your WhatsWay dashboard under channel settings.")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={() => saveWhatswayMutation.mutate(whatswayForm)}
                      disabled={saveWhatswayMutation.isPending}
                      data-testid="button-save-whatsway"
                    >
                      {saveWhatswayMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("common.save", "Save")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => testConnectionMutation.mutate()}
                      disabled={testConnectionMutation.isPending || saveWhatswayMutation.isPending || !whatswaySettings}
                      data-testid="button-test-whatsway"
                    >
                      {testConnectionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t("messaging.whatsapp.testConnection", "Test Connection")}
                    </Button>
                  </div>
                  {connectionStatus.type !== "idle" && (
                    <div
                      className={`flex items-center gap-2 p-2.5 rounded-md text-sm ${
                        connectionStatus.type === "success"
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : "bg-destructive/10 text-destructive"
                      }`}
                      data-testid="text-connection-status"
                    >
                      {connectionStatus.type === "success" ? (
                        <CheckCircle className="w-4 h-4 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{connectionStatus.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {whatswaySettings?.isActive && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>{t("messaging.whatsapp.templatesTitle", "Approved Templates")}</CardTitle>
                      <CardDescription>{t("messaging.whatsapp.templatesDescription", "Templates approved in your WhatsWay account that agents can use.")}</CardDescription>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        const result = await refetchWaTemplates();
                        const templates = result?.data;
                        const count = Array.isArray(templates) ? templates.length : 0;
                        toast({
                          title: count > 0 ? `${count} template${count > 1 ? 's' : ''} synced` : "No templates found",
                          description: count > 0 ? "WhatsApp templates refreshed successfully." : "No approved templates found in your WhatsWay account.",
                        });
                      }}
                      disabled={waTemplatesLoading}
                      data-testid="button-refresh-wa-templates"
                    >
                      <RefreshCw className={`w-4 h-4 ${waTemplatesLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {waTemplatesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : !Array.isArray(whatswayTemplates) || whatswayTemplates.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>{t("messaging.whatsapp.noTemplates", "No approved templates found. Create templates in your WhatsWay dashboard.")}</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("messaging.whatsapp.templateName", "Template Name")}</TableHead>
                            <TableHead>{t("messaging.whatsapp.language", "Language")}</TableHead>
                            <TableHead>{t("messaging.whatsapp.templateStatus", "Status")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {whatswayTemplates.map((tmpl, idx) => (
                            <TableRow key={`${tmpl.name}-${tmpl.language}`} data-testid={`row-wa-template-${idx}`}>
                              <TableCell className="font-medium">{tmpl.name}</TableCell>
                              <TableCell>{tmpl.language}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={tmpl.status === "APPROVED" ? "bg-green-600 text-white border-green-600" : ""}
                                >
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {tmpl.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>{t("messaging.logs.title", "Messaging Logs")}</CardTitle>
                <CardDescription>{t("messaging.logs.description", "Track all messages sent by your AI agents.")}</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={logFilters.channel} onValueChange={(v) => setLogFilters({ ...logFilters, channel: v, page: 1 })}>
                  <SelectTrigger className="w-[130px]" data-testid="select-log-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={logFilters.status} onValueChange={(v) => setLogFilters({ ...logFilters, status: v, page: 1 })}>
                  <SelectTrigger className="w-[130px]" data-testid="select-log-status">
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
                  data-testid="button-refresh-logs"
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
                  <p>{t("messaging.logs.noLogs", "No messaging logs yet.")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("messaging.logs.timestamp", "Time")}</TableHead>
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
                      <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                        <TableCell className="text-sm whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {log.channel === "email" ? (
                            <Badge variant="secondary"><Mail className="w-3 h-3 mr-1" />Email</Badge>
                          ) : (
                            <Badge variant="secondary"><MessageCircle className="w-3 h-3 mr-1" />WhatsApp</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-log-type-${log.id}`}>
                            {log.messageType || log.templateName || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {log.recipientEmail || log.recipientPhone || "-"}
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-sm" data-testid={`text-log-content-${log.id}`} title={log.messageContent || ""}>
                          {log.messageContent ? (log.messageContent.length > 60 ? log.messageContent.substring(0, 60) + "..." : log.messageContent) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                            {log.status === "sent" && <CheckCircle className="w-3 h-3 mr-1" />}
                            {log.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {log.errorMessage || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {logsData && logsData.total > 0 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-sm text-muted-foreground" data-testid="text-log-count">
                    Showing {Math.min((logFilters.page - 1) * LOGS_PAGE_SIZE + 1, logsData.total)}-{Math.min(logFilters.page * LOGS_PAGE_SIZE, logsData.total)} of {logsData.total}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={logFilters.page <= 1}
                      onClick={() => setLogFilters({ ...logFilters, page: logFilters.page - 1 })}
                      data-testid="button-prev-page"
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                      Page {logFilters.page} of {Math.max(1, Math.ceil(logsData.total / LOGS_PAGE_SIZE))}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={logFilters.page * LOGS_PAGE_SIZE >= logsData.total}
                      onClick={() => setLogFilters({ ...logFilters, page: logFilters.page + 1 })}
                      data-testid="button-next-page"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={templateDialog} onOpenChange={(open) => { if (!open) handleDialogClose(); }}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? t("messaging.email.editTemplate", "Edit Template") : t("messaging.email.createTemplate", "New Template")}</DialogTitle>
            <DialogDescription>
              {t("messaging.email.templateDialogDescription", "Design your email template using the drag & drop editor. Use merge tags to insert dynamic variables.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tplName">{t("messaging.email.templateName", "Template Name")}</Label>
                <Input
                  id="tplName"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                  placeholder="e.g., appointment_confirmation"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tplSubject">{t("messaging.email.subject", "Subject")}</Label>
                <Input
                  id="tplSubject"
                  value={templateForm.subject}
                  onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                  placeholder="e.g., Your appointment is confirmed, {{contact_name}}"
                  data-testid="input-template-subject"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tplVars">{t("messaging.email.variablesList", "Variables (comma-separated)")}</Label>
                <Input
                  id="tplVars"
                  value={templateForm.variables}
                  onChange={(e) => setTemplateForm({ ...templateForm, variables: e.target.value })}
                  placeholder="contact_name, appointment_date"
                  data-testid="input-template-variables"
                />
              </div>
            </div>
            {templateDialog && (
              <UnlayerEmailEditor
                key={editorKey}
                ref={unlayerRef}
                initialDesign={editorDesign}
                initialHtml={editingTemplate?.htmlBody}
                variables={templateForm.variables.split(",").map(v => v.trim()).filter(Boolean)}
              />
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleDialogClose} data-testid="button-cancel-template">
              {t("common.cancel", "Cancel")}
            </Button>
            {!editingTemplate && (
              <Button variant="secondary" onClick={handleSaveDraftManual} data-testid="button-save-draft">
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
            )}
            <Button
              onClick={handleSaveTemplate}
              disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending || !templateForm.name || !templateForm.subject}
              data-testid="button-save-template"
            >
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingTemplate ? t("common.update", "Update") : t("common.create", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTemplateId} onOpenChange={(open) => { if (!open) setDeleteTemplateId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-template-title">Delete Template?</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-template-desc">
              This will permanently delete this email template. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-template-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTemplateId) deleteTemplateMutation.mutate(deleteTemplateId);
                setDeleteTemplateId(null);
              }}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-delete-template-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={testEmailDialog} onOpenChange={(open) => { setTestEmailDialog(open); if (!open) { setTestEmailAddress(""); setTestEmailVars({}); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("messaging.email.sendTestEmail", "Send Test Email")}</DialogTitle>
            <DialogDescription>
              {t("messaging.email.testEmailDescription", "Send a test email using this template to verify it works correctly.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="testEmail">{t("messaging.email.recipientEmail", "Recipient Email")}</Label>
              <Input
                id="testEmail"
                type="email"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                placeholder="test@example.com"
                data-testid="input-test-email"
              />
            </div>
            {Object.keys(testEmailVars).length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("messaging.email.variableValues", "Variable Values (for preview)")}</Label>
                <div className="space-y-2">
                  {Object.entries(testEmailVars).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono w-32 shrink-0">{`{{${key}}}`}</span>
                      <Input
                        value={val}
                        onChange={(e) => setTestEmailVars(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={`Value for ${key}`}
                        data-testid={`input-test-var-${key}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestEmailDialog(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => testEmailMutation.mutate({ id: testTemplateId, email: testEmailAddress, variables: testEmailVars })}
              disabled={testEmailMutation.isPending || !testEmailAddress}
              data-testid="button-send-test-email"
            >
              {testEmailMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("messaging.email.sendTest", "Send Test")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testWhatsappDialog} onOpenChange={(open) => {
        setTestWhatsappDialog(open);
        if (!open) {
          setSelectedTestTemplate(null);
          setBodyVariables([]);
          setButtonVariables({});
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Test WhatsApp Message</DialogTitle>
            <DialogDescription>
              Send a test template message to verify your WhatsApp connection works correctly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="testPhone">Recipient Phone Number</Label>
              <Input
                id="testPhone"
                type="tel"
                value={testPhoneNumber}
                onChange={(e) => setTestPhoneNumber(e.target.value)}
                placeholder="+919310797700"
                data-testid="input-test-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value={selectedTestTemplate ? `${selectedTestTemplate.name}::${selectedTestTemplate.language}` : ""}
                onValueChange={(val) => {
                  const [name, lang] = val.split('::');
                  const tmpl = metaWaTemplates.find((t: MetaWhatsAppTemplate) => t.name === name && t.language === lang) || null;
                  setSelectedTestTemplate(tmpl);
                  if (tmpl) {
                    const bodyComp = (tmpl.components || []).find((c: any) => c.type === 'BODY' || c.type === 'body');
                    const bodyText = bodyComp?.text || '';
                    const rawMatches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
                    const uniqueIndexes = [...new Set(rawMatches.map((m: string) => parseInt(m.replace(/[{}]/g, ''))))].sort((a, b) => a - b);
                    setBodyVariables(new Array(uniqueIndexes.length).fill(''));
                    const buttonsComp = (tmpl.components || []).find((c: any) => c.type === 'BUTTONS' || c.type === 'buttons');
                    const dynBtns: Record<number, string> = {};
                    if (buttonsComp?.buttons) {
                      buttonsComp.buttons.forEach((btn: any, idx: number) => {
                        if (btn.type === 'URL' && btn.url?.includes('{{')) {
                          dynBtns[idx] = '';
                        }
                      });
                    }
                    setButtonVariables(dynBtns);
                  } else {
                    setBodyVariables([]);
                    setButtonVariables({});
                  }
                }}
              >
                <SelectTrigger data-testid="select-test-template">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {metaWaTemplates.filter((t: MetaWhatsAppTemplate) => t.status === 'APPROVED').map((t: MetaWhatsAppTemplate) => (
                    <SelectItem key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`} data-testid={`select-template-${t.name}`}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {bodyVariables.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Body Variables</Label>
                {bodyVariables.map((val, idx) => {
                  const bodyComp = selectedTestTemplate?.components?.find((c: any) => c.type === 'BODY' || c.type === 'body');
                  const bodyText = bodyComp?.text || '';
                  return (
                    <div key={idx} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{`{{${idx + 1}}}`} — from: "{bodyText.split(`{{${idx + 1}}}`)[0]?.slice(-30)}..."</Label>
                      <Input
                        value={val}
                        onChange={(e) => {
                          const updated = [...bodyVariables];
                          updated[idx] = e.target.value;
                          setBodyVariables(updated);
                        }}
                        placeholder={`Value for {{${idx + 1}}}`}
                        data-testid={`input-body-var-${idx}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {Object.keys(buttonVariables).length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Button URL Parameters</Label>
                {Object.entries(buttonVariables).map(([idxStr, val]) => {
                  const idx = parseInt(idxStr);
                  const buttonsComp = selectedTestTemplate?.components?.find((c: any) => c.type === 'BUTTONS' || c.type === 'buttons');
                  const btn = buttonsComp?.buttons?.[idx];
                  return (
                    <div key={idx} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Button {idx + 1}: {btn?.text || 'URL'} — {btn?.url || ''}</Label>
                      <Input
                        value={val}
                        onChange={(e) => setButtonVariables(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="Dynamic URL value"
                        data-testid={`input-btn-var-${idx}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestWhatsappDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const components: any[] = [];
                if (bodyVariables.length > 0) {
                  components.push({
                    type: 'body',
                    parameters: bodyVariables.map(v => ({ type: 'text', text: v || ' ' })),
                  });
                }
                Object.entries(buttonVariables).forEach(([idxStr, val]) => {
                  components.push({
                    type: 'button',
                    sub_type: 'url',
                    index: idxStr,
                    parameters: [{ type: 'text', text: val || 'details' }],
                  });
                });
                testWhatsappMutation.mutate({
                  phoneNumber: testPhoneNumber,
                  templateName: selectedTestTemplate?.name || '',
                  language: selectedTestTemplate?.language || 'en_US',
                  components,
                });
              }}
              disabled={testWhatsappMutation.isPending || !testPhoneNumber || !selectedTestTemplate}
              data-testid="button-send-test-whatsapp"
            >
              {testWhatsappMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={channelChoiceDialogOpen} onOpenChange={setChannelChoiceDialogOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-channel-choice">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-channel-choice-title">
              <MessageCircle className="w-5 h-5" />
              Connect WhatsApp Channel
            </DialogTitle>
            <DialogDescription data-testid="text-channel-choice-description">
              Choose how you want to connect your number to this platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <button
              type="button"
              onClick={() => {
                setChannelChoiceDialogOpen(false);
                setShowCoexistenceRequirements(true);
              }}
              className="w-full text-left p-4 rounded-md border border-border hover-elevate active-elevate-2 transition-colors"
              data-testid="button-coexistence-option"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">Connect Existing WhatsApp Business App</span>
                      <Badge variant="secondary" className="text-xs">Coexistence</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Keep using your WhatsApp Business App on your phone while also using this platform for automation, campaigns, and bulk messaging.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Keep mobile app access
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Sync chat history
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Same phone number
                      </span>
                    </div>
                  </div>
                </div>
                <TrendingUp className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setChannelChoiceDialogOpen(false);
                handleEmbeddedSignup(false);
              }}
              className="w-full text-left p-4 rounded-md border border-border hover-elevate active-elevate-2 transition-colors"
              data-testid="button-standard-option"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">Register New Number</span>
                      <Badge variant="secondary" className="text-xs">Standard</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Register a new or existing phone number exclusively for Cloud API use. The number will only work through this platform.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Full API features
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> No app required
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Dedicated number
                      </span>
                    </div>
                  </div>
                </div>
                <TrendingUp className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showCoexistenceRequirements} onOpenChange={setShowCoexistenceRequirements}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-coexistence-requirements">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-requirements-title">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Before You Connect
            </DialogTitle>
            <DialogDescription data-testid="text-requirements-description">
              Please ensure you meet these requirements for WhatsApp Business App coexistence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-3 p-3 rounded-md border border-border">
              <Smartphone className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-foreground">WhatsApp Business App v2.24.17+</p>
                <p className="text-xs text-muted-foreground mt-0.5">Update your app to the latest version from your app store.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-md border border-border">
              <Clock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-foreground">Active for at least 7 days</p>
                <p className="text-xs text-muted-foreground mt-0.5">Your WhatsApp Business App should have been actively used for at least 7 days (ideally 1-2 months).</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-md border border-border">
              <Globe className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-foreground">Supported country</p>
                <p className="text-xs text-muted-foreground mt-0.5">Nigeria and South Africa are currently not supported for coexistence.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-md border border-border">
              <User className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-foreground">Meta Business Account</p>
                <p className="text-xs text-muted-foreground mt-0.5">You need a valid Meta Business Account to complete the connection.</p>
              </div>
            </div>
            <div className="p-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">What happens during connection:</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-amber-700 dark:text-amber-400 list-disc pl-4">
                    <li>A QR code will appear — scan it with your WhatsApp Business App</li>
                    <li>Your chat history (up to 180 days) will sync to the platform</li>
                    <li>Linked companion devices will be temporarily unlinked</li>
                    <li>You can continue using both the app and this platform simultaneously</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCoexistenceRequirements(false);
                setChannelChoiceDialogOpen(true);
              }}
              data-testid="button-requirements-back"
            >
              Back
            </Button>
            <Button
              onClick={() => {
                setShowCoexistenceRequirements(false);
                handleEmbeddedSignup(true);
              }}
              data-testid="button-requirements-continue"
            >
              I Meet the Requirements — Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
