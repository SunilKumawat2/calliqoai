import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Bot,
  MessageSquare,
  PhoneCall,
  UserCheck,
  Sparkles,
  Send,
  Save,
  Loader2,
  Brain,
  FileText,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  History,
  RefreshCw,
  ShieldAlert,
  ArrowRightLeft,
  Share2,
  Mail,
} from "lucide-react";
import { SocialLeadCaptureSection, EmailAssistantSection } from "./SocialEmailAssistantPanel";

interface WhatsAppAiBotConfig {
  enabled: boolean;
  defaultAgentId: string;
  useCallMemory: boolean;
  useKnowledgeBase: boolean;
  autoQualifyLeads: boolean;
  autoBookAppointments: boolean;
  autoHandoverOnHumanRequest: boolean;
  handoverKeywords: string;
  brochureUrl: string;
  brochureTitle: string;
  collectDocumentsPrompt: string;
  customBotInstructions: string;
  managerWhatsAppPhones: string;
  managerEmails: string;
  notifyManagerOnHandoverWhatsApp: boolean;
  notifyManagerOnHandoverEmail: boolean;
  notifyManagerOnHotLead: boolean;
}

interface WhatsAppBotActivityLog {
  id: string;
  timestamp: string;
  conversationId: string;
  contactPhone: string;
  contactName: string;
  customerMessage: string;
  aiReply: string;
  category: string;
  leadScore: number;
  sentiment: string;
  handoverTriggered: boolean;
  handoverReason?: string | null;
  usedCallMemory: boolean;
  appointmentBooked?: string | null;
  deliveryChannel: string;
}

export function WhatsAppAiBotPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<WhatsAppAiBotConfig>({
    enabled: true,
    defaultAgentId: "default",
    useCallMemory: true,
    useKnowledgeBase: true,
    autoQualifyLeads: true,
    autoBookAppointments: true,
    autoHandoverOnHumanRequest: true,
    handoverKeywords: "human, manager, executive, agent, person, senior, complaint, refund, talk to someone, call me urgently",
    brochureUrl: "",
    brochureTitle: "Company Brochure & Price List",
    collectDocumentsPrompt: "If the customer wants to proceed with booking or verification, politely ask them to share their ID proof or relevant documents right here on WhatsApp.",
    customBotInstructions: "Reply concisely in a warm, natural conversational tone (match customer language: English, Hinglish, or Hindi). Qualify the customer by understanding their requirement, budget/timeline, and preferred date/time for a consultation or site visit.",
    managerWhatsAppPhones: "",
    managerEmails: "",
    notifyManagerOnHandoverWhatsApp: true,
    notifyManagerOnHandoverEmail: true,
    notifyManagerOnHotLead: true,
  });

  // Simulator state
  const [simPhone, setSimPhone] = useState("+919876543210");
  const [simName, setSimName] = useState("Rahul Sharma");
  const [simMessage, setSimMessage] = useState("Hi, we spoke on call earlier. Can you share the brochure and book my site visit tomorrow at 4:00 PM?");
  const [simSendRealWhatsApp, setSimSendRealWhatsApp] = useState(false);
  const [lastSimResult, setLastSimResult] = useState<any | null>(null);
  const [memoryPhoneInput, setMemoryPhoneInput] = useState("+919876543210");

  const { data: configData, isLoading: configLoading } = useQuery<WhatsAppAiBotConfig>({
    queryKey: ["/api/sales-team/whatsapp-ai-bot-config"],
  });

  const { data: logs = [], refetch: refetchLogs } = useQuery<WhatsAppBotActivityLog[]>({
    queryKey: ["/api/sales-team/whatsapp-ai-bot-logs"],
  });

  const { data: conversations = [], refetch: refetchConvs } = useQuery<any[]>({
    queryKey: ["/api/sales-team/whatsapp-ai-bot-conversations"],
  });

  const { data: agentsList = [] } = useQuery<any[]>({
    queryKey: ["/api/agents"],
    select: (res: any) => {
      const arr = res?.data || res || [];
      return Array.isArray(arr) ? arr : [];
    },
  });

  const { data: memorySnapshot, isFetching: memoryFetching, refetch: refetchMemory } = useQuery<any>({
    queryKey: ["/api/sales-team/whatsapp-ai-bot-memory", memoryPhoneInput],
    queryFn: async () => {
      if (!memoryPhoneInput.trim()) return null;
      const res = await apiRequest(
        "GET",
        `/api/sales-team/whatsapp-ai-bot-memory?phone=${encodeURIComponent(memoryPhoneInput.trim())}`
      );
      return res.json();
    },
    enabled: Boolean(memoryPhoneInput.trim()),
  });

  useEffect(() => {
    if (configData) {
      setForm(configData);
    }
  }, [configData]);

  const saveConfigMutation = useMutation({
    mutationFn: async (payload: Partial<WhatsAppAiBotConfig>) => {
      const res = await apiRequest("PUT", "/api/sales-team/whatsapp-ai-bot-config", payload);
      return res.json();
    },
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/whatsapp-ai-bot-config"] });
      toast({
        title: "WhatsApp AI Bot Settings Saved",
        description: "2-Way Conversational AI Qualification, Cross-Channel Memory, and Human Hand-over rules are active.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/whatsapp-ai-bot/simulate", {
        contactPhone: simPhone,
        contactName: simName,
        messageText: simMessage,
        sendRealWhatsApp: simSendRealWhatsApp,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLastSimResult(data);
      setMemoryPhoneInput(simPhone);
      refetchLogs();
      refetchConvs();
      refetchMemory();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({
        title: data?.handoverTriggered
          ? "Human Hand-over Triggered!"
          : "AI Reply Generated & CRM Updated",
        description: data?.handoverTriggered
          ? "AI auto-reply was paused for this chat and Manager alert was dispatched."
          : `Lead qualified as ${(data?.qualification?.category || "warm").toUpperCase()} (Score: ${data?.qualification?.leadScore || 70}/100).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Simulation failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleModeMutation = useMutation({
    mutationFn: async (params: { conversationId: string; autoReplyEnabled: boolean }) => {
      const res = await apiRequest("POST", "/api/sales-team/whatsapp-ai-bot/conversation-mode", params);
      return res.json();
    },
    onSuccess: (_, vars) => {
      refetchConvs();
      toast({
        title: vars.autoReplyEnabled ? "AI Bot Resumed" : "Switched to Human Hand-over",
        description: vars.autoReplyEnabled
          ? "AI Bot will automatically reply to incoming WhatsApp messages in this chat."
          : "AI auto-replies are paused so your human team can chat directly.",
      });
    },
  });

  const [activeChannelTab, setActiveChannelTab] = useState<"whatsapp" | "social" | "email">("whatsapp");

  const activeAiConvs = conversations.filter((c) => c.autoReplyEnabled !== false).length;
  const handoverConvs = conversations.filter((c) => c.autoReplyEnabled === false).length;

  return (
    <div className="space-y-6">
      {/* Omnichannel Section 1 Sub-Navigation Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-1.5 rounded-xl bg-muted/50 border">
        <button
          type="button"
          onClick={() => setActiveChannelTab("whatsapp")}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeChannelTab === "whatsapp"
              ? "bg-emerald-600 text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-card"
          }`}
        >
          <Bot className="w-4 h-4 shrink-0" />
          <span>2-Way WhatsApp AI Bot & Memory</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveChannelTab("social")}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeChannelTab === "social"
              ? "bg-pink-600 text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-card"
          }`}
        >
          <Share2 className="w-4 h-4 shrink-0" />
          <span>Instagram & Facebook Lead Capture</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveChannelTab("email")}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeChannelTab === "email"
              ? "bg-indigo-600 text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-card"
          }`}
        >
          <Mail className="w-4 h-4 shrink-0" />
          <span>AI Email Assistant & Sequences</span>
        </button>
      </div>

      {activeChannelTab === "social" ? (
        <SocialLeadCaptureSection />
      ) : activeChannelTab === "email" ? (
        <EmailAssistantSection />
      ) : (
        <>
      {/* Header Banner */}
      <Card className="border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Bot className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold tracking-tight">
                  2-Way Conversational WhatsApp AI Bot & Unified Cross-Channel Memory
                </h2>
                <Badge
                  variant="outline"
                  className={
                    form.enabled
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {form.enabled ? "AI Bot Active" : "Paused"}
                </Badge>
                {form.useCallMemory && (
                  <Badge variant="outline" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
                    <Brain className="w-3 h-3 mr-1" /> Voice ↔ WhatsApp Memory Synced
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-3xl">
                Automatically replies to incoming customer WhatsApp messages, remembers past phone call transcripts & summaries, qualifies leads into your CRM, shares brochures/documents, books appointments, and hands over to human staff with full chat context when needed.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-lg border">
                <Label htmlFor="wa-bot-master-toggle" className="text-xs font-semibold cursor-pointer">
                  2-Way AI Auto-Reply
                </Label>
                <Switch
                  id="wa-bot-master-toggle"
                  checked={form.enabled}
                  onCheckedChange={(checked) => {
                    setForm((prev) => ({ ...prev, enabled: checked }));
                    saveConfigMutation.mutate({ ...form, enabled: checked });
                  }}
                />
              </div>
              <Button
                size="sm"
                onClick={() => saveConfigMutation.mutate(form)}
                disabled={saveConfigMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1.5" />
                )}
                Save Configuration
              </Button>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/50">
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">AI-Managed Chats</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{activeAiConvs}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Human Hand-over Chats</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{handoverConvs}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">AI Replies & Qualifications</p>
              <p className="text-xl font-bold">{logs.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Cross-Channel Memory Hits</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                {logs.filter((l) => l.usedCallMemory).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid: Left = Live Simulator & Memory Inspector, Right = Bot Settings & Handover Config */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Live Simulator + Unified Memory Inspector + Active Conversations */}
        <div className="lg:col-span-7 space-y-6">
          {/* Interactive 2-Way Chat & Qualification Simulator */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                    Interactive WhatsApp AI Qualification & Hand-over Simulator
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Test how the AI Bot responds to customer messages using past phone call memory, qualifies leads in CRM, and triggers Human Hand-over.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Customer Phone Number</Label>
                  <Input
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    placeholder="+919876543210"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Customer Name</Label>
                  <Input
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    placeholder="Rahul Sharma"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Simulated Incoming Customer WhatsApp Message</Label>
                  <span className="text-[11px] text-muted-foreground">Quick test scenarios:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() =>
                      setSimMessage(
                        "Hi, we spoke on phone call earlier. Please share the brochure and book my site visit tomorrow at 4:00 PM."
                      )
                    }
                  >
                    Call Memory + Book Visit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() =>
                      setSimMessage(
                        "I am interested in your premium package. My budget is around 15 Lakhs, can you share the price list PDF?"
                      )
                    }
                  >
                    Hot Lead + Brochure Request
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 border-amber-500/40 text-amber-600 dark:text-amber-400"
                    onClick={() =>
                      setSimMessage(
                        "I have an urgent issue and want to talk to a human manager right now. Please connect me to a senior executive."
                      )
                    }
                  >
                    Trigger Human Hand-over
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  placeholder="Type a customer WhatsApp message to test AI response..."
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="sim-send-real-wa"
                    checked={simSendRealWhatsApp}
                    onCheckedChange={setSimSendRealWhatsApp}
                  />
                  <Label htmlFor="sim-send-real-wa" className="text-xs text-muted-foreground cursor-pointer">
                    Also send live reply via connected WhatsApp API
                  </Label>
                </div>

                <Button
                  onClick={() => simulateMutation.mutate()}
                  disabled={simulateMutation.isPending || !simPhone.trim() || !simMessage.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {simulateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-1.5" />
                  )}
                  Simulate Inbound WhatsApp Message
                </Button>
              </div>

              {lastSimResult && (
                <div className="mt-4 p-4 rounded-xl border bg-muted/30 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-600 text-white">AI Bot Reply</Badge>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        Category: {lastSimResult.qualification?.category || "warm"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Score: {lastSimResult.qualification?.leadScore || 70}/100
                      </Badge>
                      {lastSimResult.usedCallMemory && (
                        <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400">
                          <PhoneCall className="w-3 h-3 mr-1" /> Prior Call Memory Used
                        </Badge>
                      )}
                    </div>
                    {lastSimResult.handoverTriggered && (
                      <Badge variant="destructive" className="text-[11px]">
                        <ShieldAlert className="w-3 h-3 mr-1" /> Human Hand-over Triggered (AI Paused)
                      </Badge>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-[#d9fdd3]/60 dark:bg-[#005c4b]/50 border border-emerald-500/20 text-sm whitespace-pre-wrap">
                    {lastSimResult.aiReply}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground pt-1">
                    <div>
                      <span className="font-semibold text-foreground">AI CRM Summary: </span>
                      {lastSimResult.qualification?.summary}
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Next Action: </span>
                      {lastSimResult.qualification?.nextAction}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unified Cross-Channel Memory Inspector (Voice Calls <-> WhatsApp) */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="w-4 h-4 text-blue-500" />
                    Unified Cross-Channel Memory Inspector (Voice Calls ↔ WhatsApp)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Inspect the shared memory snapshot that allows the WhatsApp Bot to remember past phone calls and the Voice AI to remember WhatsApp chats.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={memoryPhoneInput}
                    onChange={(e) => setMemoryPhoneInput(e.target.value)}
                    placeholder="Enter phone number..."
                    className="h-8 w-44 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-8" onClick={() => refetchMemory()}>
                    {memoryFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {memorySnapshot ? (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="p-2.5 rounded-lg border bg-card">
                      <p className="text-[11px] text-muted-foreground">CRM Lead Record</p>
                      {memorySnapshot.lead ? (
                        <div className="mt-1 space-y-0.5">
                          <p className="font-semibold text-sm">{memorySnapshot.lead.name}</p>
                          <p className="text-muted-foreground">
                            Stage: <span className="text-foreground font-medium">{memorySnapshot.lead.stage}</span> • Score:{" "}
                            <span className="text-foreground font-medium">{memorySnapshot.lead.leadScore ?? "--"}/100</span>
                          </p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground mt-1">No CRM lead yet</p>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg border bg-card">
                      <p className="text-[11px] text-muted-foreground">Past Voice Calls Linked</p>
                      <p className="font-semibold text-sm mt-1">{memorySnapshot.pastCalls?.length || 0} Call(s)</p>
                      <p className="text-muted-foreground truncate">
                        {memorySnapshot.pastCalls?.[0]?.summary || "Synced with Plivo & ElevenLabs calls"}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg border bg-card">
                      <p className="text-[11px] text-muted-foreground">Appointments & WhatsApp Turns</p>
                      <p className="font-semibold text-sm mt-1">
                        {memorySnapshot.appointments?.length || 0} Visit(s) • {memorySnapshot.recentWhatsAppMessages?.length || 0} Chat Msg(s)
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/50 border font-mono text-[11px] whitespace-pre-wrap max-h-44 overflow-y-auto">
                    {memorySnapshot.unifiedContextPrompt}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Enter a phone number above to inspect its Unified Cross-Channel Memory.</p>
              )}
            </CardContent>
          </Card>

          {/* Active WhatsApp Conversations & Human Hand-over Control */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-amber-500" />
                    WhatsApp Conversations — AI Mode vs. Human Hand-over Control
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Switch any conversation between automated AI Qualification and Human Hand-over mode with one click.
                  </CardDescription>
                </div>
                <Button size="sm" variant="ghost" onClick={() => refetchConvs()}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No WhatsApp conversations yet. Use the simulator above or message your connected WhatsApp Business number.
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {conversations.map((conv) => {
                    const isAiActive = conv.autoReplyEnabled !== false;
                    return (
                      <div
                        key={conv.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">{conv.contactName}</span>
                            <span className="text-xs text-muted-foreground font-mono">{conv.contactPhone}</span>
                            <Badge
                              variant="outline"
                              className={
                                isAiActive
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]"
                              }
                            >
                              {isAiActive ? "AI Bot Active" : "Human Hand-over"}
                            </Badge>
                            {conv.pastCallCount > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                <PhoneCall className="w-2.5 h-2.5 mr-1" /> {conv.pastCallCount} Prior Call(s)
                              </Badge>
                            )}
                            {conv.lead?.aiCategory && (
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {conv.lead.aiCategory} ({conv.lead.leadScore || "--"})
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessagePreview || conv.lead?.aiSummary || "No recent message preview"}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setMemoryPhoneInput(conv.contactPhone)}
                          >
                            <Brain className="w-3 h-3 mr-1" /> Memory
                          </Button>
                          <Button
                            size="sm"
                            variant={isAiActive ? "outline" : "default"}
                            className={
                              isAiActive
                                ? "h-7 text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                                : "h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            }
                            onClick={() =>
                              toggleModeMutation.mutate({
                                conversationId: conv.id,
                                autoReplyEnabled: !isAiActive,
                              })
                            }
                          >
                            {isAiActive ? (
                              <>
                                <UserCheck className="w-3 h-3 mr-1" /> Hand Over to Human
                              </>
                            ) : (
                              <>
                                <Bot className="w-3 h-3 mr-1" /> Resume AI Bot
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (5 cols): Bot Configuration & Recent Activity Logs */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-500" />
                AI Qualification, Brochure & Human Hand-over Settings
              </CardTitle>
              <CardDescription className="text-xs">
                Configure how the WhatsApp AI Bot qualifies leads, shares brochures, remembers voice calls, and escalates to human staff.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">AI Agent Persona & System Prompt Source</Label>
                <Select
                  value={form.defaultAgentId || "default"}
                  onValueChange={(val) => setForm((p) => ({ ...p, defaultAgentId: val }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select AI Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Primary AI Agent</SelectItem>
                    {agentsList.map((ag: any) => (
                      <SelectItem key={ag.id} value={ag.id}>
                        {ag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <div>
                    <p className="text-xs font-semibold">Unified Cross-Channel Call Memory</p>
                    <p className="text-[11px] text-muted-foreground">
                      Remember customer's past phone call summaries & transcripts in WhatsApp chat
                    </p>
                  </div>
                  <Switch
                    checked={form.useCallMemory}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, useCallMemory: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <div>
                    <p className="text-xs font-semibold">Approved RAG Knowledge Base</p>
                    <p className="text-[11px] text-muted-foreground">
                      Answer product/service FAQs using uploaded Knowledge Base documents
                    </p>
                  </div>
                  <Switch
                    checked={form.useKnowledgeBase}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, useKnowledgeBase: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <div>
                    <p className="text-xs font-semibold">Self-Filling CRM Lead Qualification</p>
                    <p className="text-[11px] text-muted-foreground">
                      Auto-save customer name, requirement, Hot/Warm/Cold score & chat summary to CRM
                    </p>
                  </div>
                  <Switch
                    checked={form.autoQualifyLeads}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, autoQualifyLeads: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <div>
                    <p className="text-xs font-semibold">Auto-Book Appointments from WhatsApp</p>
                    <p className="text-[11px] text-muted-foreground">
                      Automatically schedule site visits / consultations when customer confirms date & time
                    </p>
                  </div>
                  <Switch
                    checked={form.autoBookAppointments}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, autoBookAppointments: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <div>
                    <p className="text-xs font-semibold">Automatic Human Hand-over & Escalation</p>
                    <p className="text-[11px] text-muted-foreground">
                      Pause AI Bot and alert Manager when customer asks for a human or raises a complaint
                    </p>
                  </div>
                  <Switch
                    checked={form.autoHandoverOnHumanRequest}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, autoHandoverOnHumanRequest: v }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Brochure / Catalog Title</Label>
                  <Input
                    className="h-8 text-xs"
                    value={form.brochureTitle}
                    onChange={(e) => setForm((p) => ({ ...p, brochureTitle: e.target.value }))}
                    placeholder="Company Brochure & Price List"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Brochure / Document Link (URL)</Label>
                  <Input
                    className="h-8 text-xs"
                    value={form.brochureUrl}
                    onChange={(e) => setForm((p) => ({ ...p, brochureUrl: e.target.value }))}
                    placeholder="https://example.com/brochure.pdf"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Human Hand-over Trigger Keywords (Comma-separated)</Label>
                <Input
                  className="h-8 text-xs"
                  value={form.handoverKeywords}
                  onChange={(e) => setForm((p) => ({ ...p, handoverKeywords: e.target.value }))}
                  placeholder="human, manager, executive, agent, complaint, refund"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Manager WhatsApp Number(s) for Hand-over Alerts</Label>
                  <Input
                    className="h-8 text-xs"
                    value={form.managerWhatsAppPhones}
                    onChange={(e) => setForm((p) => ({ ...p, managerWhatsAppPhones: e.target.value }))}
                    placeholder="+919876543210"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Manager Email(s) for Hand-over Transcripts</Label>
                  <Input
                    className="h-8 text-xs"
                    value={form.managerEmails}
                    onChange={(e) => setForm((p) => ({ ...p, managerEmails: e.target.value }))}
                    placeholder="manager@company.com"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Custom Qualification & Document Collection Instructions</Label>
                <Textarea
                  rows={3}
                  className="text-xs"
                  value={form.customBotInstructions}
                  onChange={(e) => setForm((p) => ({ ...p, customBotInstructions: e.target.value }))}
                />
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => saveConfigMutation.mutate(form)}
                disabled={saveConfigMutation.isPending}
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save WhatsApp AI Bot Settings
              </Button>
            </CardContent>
          </Card>

          {/* Recent AI Qualification & Hand-over Log */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  Recent WhatsApp AI Activity & Hand-over Log
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {logs.length} Events
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No WhatsApp AI Bot replies logged yet. Run a test in the simulator to see live qualification logs.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {logs.slice(0, 15).map((item) => (
                    <div key={item.id} className="p-2.5 rounded-lg border bg-card text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {item.contactName} ({item.contactPhone})
                        </span>
                        <div className="flex items-center gap-1">
                          {item.usedCallMemory && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400">
                              Call Memory
                            </Badge>
                          )}
                          {item.handoverTriggered ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Human Hand-over
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {item.category} ({item.leadScore})
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-muted-foreground">
                        <strong className="text-foreground">Customer:</strong> {item.customerMessage}
                      </p>
                      <p className="text-emerald-700 dark:text-emerald-400">
                        <strong>AI Bot:</strong> {item.aiReply}
                      </p>
                      {item.appointmentBooked && (
                        <p className="text-blue-600 dark:text-blue-400 font-medium">
                          📅 Appointment Booked: {item.appointmentBooked}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
