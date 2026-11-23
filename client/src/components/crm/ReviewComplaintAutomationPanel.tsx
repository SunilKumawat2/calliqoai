import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Star, AlertTriangle, CheckCircle2, MessageSquare, Mail, Send, Clock, 
  ShieldAlert, History, Sparkles, Copy, Check, Trash2, Edit3, ThumbsUp, 
  RefreshCw, ChevronRight, MessageCircle, HeartHandshake, Zap, Globe, Bot,
  ExternalLink, User, ArrowRight
} from "lucide-react";
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

export interface ReviewDraftEntry {
  id: string;
  reviewerName: string;
  rating: number;
  reviewText: string;
  platform?: string;
  drafts: {
    warm: string;
    professional: string;
    crisp: string;
  };
  sentiment?: string;
  chosenReply?: string;
  status: "draft" | "replied";
  createdAt: string;
  repliedAt?: string;
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
const DRAFTS_HISTORY_KEY = ["/api/sales-team/review-reply-drafts/history"];
const GOOGLE_BUSINESS_STATUS_KEY = ["/api/google-business/status"];
const GOOGLE_BUSINESS_REVIEWS_KEY = ["/api/google-business/reviews"];

export interface GoogleBusinessStatus {
  connected: boolean;
  connectedEmail: string | null;
  accountName: string | null;
  locationName: string | null;
  autoReplyEnabled: boolean;
  autoReplyMinStars: number;
  requireApprovalBelowStars: number;
  lastSyncedAt: string | null;
}

export interface GoogleBusinessReviewItem {
  id: string;
  googleReviewId: string;
  reviewerName: string;
  reviewerPhotoUrl: string | null;
  starRating: number;
  comment: string | null;
  reviewCreateTime: string;
  replyComment: string | null;
  replyStatus: string;
  repliedAt: string | null;
}

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

const SAMPLE_REVIEWS = [
  {
    label: "🌟 5-Star (Super Happy)",
    name: "Rahul Sharma",
    rating: 5,
    text: "Visited the clinic yesterday. The doctor and staff were super polite and the consultation was very smooth! 5 stars to the entire team.",
    instructions: "Thank them warmly and mention we look forward to their routine dental checkup."
  },
  {
    label: "⚠️ 1-Star (Long Delay Complaint)",
    name: "Amit Verma",
    rating: 1,
    text: "Very poor management. Waited 45 mins past my appointment time and staff was completely unhelpful. Not recommended at all.",
    instructions: "Sincere apology, no defensive excuses, offer direct manager call to make it right."
  },
  {
    label: "💰 2-Star (Pricing Confusion)",
    name: "Pooja Patel",
    rating: 2,
    text: "Treatment was fine, but the final charges were higher than what was communicated on the initial phone call. Better transparency needed.",
    instructions: "Acknowledge billing transparency feedback, invite manager review of the invoice."
  },
  {
    label: "⭐ 4-Star (Good Service, Parking Issue)",
    name: "Vikram Singh",
    rating: 4,
    text: "Great consultation and doctor was very knowledgeable. Just parking was a bit crowded during peak afternoon hours.",
    instructions: "Acknowledge praise, note valet/parking assistance is being arranged."
  }
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

  // Active sub-view tab: 'google_live' | 'drafts' | 'rules' | 'logs'
  const [activeTab, setActiveTab] = useState<"google_live" | "drafts" | "rules" | "logs">("google_live");

  // Google Business integration status
  const { data: gmbStatus, refetch: refetchGmbStatus } = useQuery<GoogleBusinessStatus>({
    queryKey: GOOGLE_BUSINESS_STATUS_KEY,
  });

  // Google Business live reviews
  const { data: gmbReviews = [], refetch: refetchGmbReviews, isLoading: isReviewsLoading } = useQuery<GoogleBusinessReviewItem[]>({
    queryKey: GOOGLE_BUSINESS_REVIEWS_KEY,
    enabled: !!gmbStatus?.connected,
    refetchInterval: 30000,
  });

  // Replying state for live reviews
  const [activeReplyReviewId, setActiveReplyReviewId] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState<string>("");
  const [generatingReplyId, setGeneratingReplyId] = useState<string | null>(null);

  // Review & Complaint Automations config & logs
  const { data: savedConfig } = useQuery<ReviewComplaintConfig>({ queryKey: CONFIG_KEY });
  const { data: logs } = useQuery<LogsResponse>({ queryKey: LOGS_KEY, refetchInterval: 30000 });

  // AI Review Reply Drafts history
  const { data: draftsHistory = [], refetch: refetchDraftsHistory } = useQuery<ReviewDraftEntry[]>({
    queryKey: DRAFTS_HISTORY_KEY,
  });

  const [form, setForm] = useState<ReviewComplaintConfig | null>(null);
  const [customDelayValue, setCustomDelayValue] = useState<number>(2);
  const [customDelayUnit, setCustomDelayUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [delayPreset, setDelayPreset] = useState<string>("120");

  // ── AI Review Reply Generator State ──
  const [reviewerName, setReviewerName] = useState("Rahul Sharma");
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState(
    "Visited the clinic yesterday. The doctor and staff were super polite and the consultation was very smooth! 5 stars to the entire team."
  );
  const [platform, setPlatform] = useState("Google My Business");
  const [customInstructions, setCustomInstructions] = useState("");

  const [generatedDrafts, setGeneratedDrafts] = useState<{
    warm: string;
    professional: string;
    crisp: string;
  } | null>(null);
  const [detectedSentiment, setDetectedSentiment] = useState<string>("positive");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);

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

  // Save Review Rules Mutation
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

  // Test Alert Mutation
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

  // Generate Review Reply Drafts Mutation
  const generateDraftsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/review-reply-drafts/generate", {
        reviewerName,
        rating,
        reviewText,
        platform,
        customInstructions,
      });
      return res.json();
    },
    onSuccess: (data: { drafts: { warm: string; professional: string; crisp: string }; sentiment: string; keyPoints: string[] }) => {
      setGeneratedDrafts(data.drafts);
      setDetectedSentiment(data.sentiment || (rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative"));
      setKeyPoints(data.keyPoints || []);
      setSavedDraftId(null);
      toast({
        title: "✨ 3 AI Reply Drafts Ready!",
        description: "Review drafts generated in Warm, Professional, and Crisp tones. You can copy or save them with 1-click.",
      });
    },
    onError: (err: any) => toast({ title: "Generation Failed", description: err.message, variant: "destructive" }),
  });

  // Save/Mark Replied Mutation
  const saveReplyMutation = useMutation({
    mutationFn: async (chosenDraft: string) => {
      const res = await apiRequest("POST", "/api/sales-team/review-reply-drafts/save", {
        reviewerName,
        rating,
        reviewText,
        platform,
        drafts: generatedDrafts || { warm: chosenDraft, professional: chosenDraft, crisp: chosenDraft },
        chosenReply: chosenDraft,
        sentiment: detectedSentiment,
        status: "replied",
      });
      return res.json();
    },
    onSuccess: (saved: ReviewDraftEntry) => {
      setSavedDraftId(saved.id);
      queryClient.invalidateQueries({ queryKey: DRAFTS_HISTORY_KEY });
      toast({
        title: "💾 Marked as Replied & Saved to History",
        description: `Reply saved for ${reviewerName}'s ${rating}-star review.`,
      });
    },
    onError: (err: any) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  // Delete Draft Mutation
  const deleteDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/sales-team/review-reply-drafts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAFTS_HISTORY_KEY });
      toast({ title: "Entry deleted from history" });
    },
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
    toast({
      title: "📋 Copied to Clipboard!",
      description: "You can now paste this reply directly into your Google Business Profile.",
    });
  };

  // Connect Google Profile Mutation
  const connectGmbMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/google-business/auth");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: any) => {
      toast({ title: "Connection Failed", description: err.message, variant: "destructive" });
    },
  });

  // Quick Connect (Demo / Instant Sync)
  const quickConnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google-business/quick-connect", {
        email: "developer7023@gmail.com",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_REVIEWS_KEY });
      toast({ title: "✅ Google Profile Connected!", description: "Live reviews synced & Auto-Pilot is active." });
    },
  });

  // Disconnect Mutation
  const disconnectGmbMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google-business/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_REVIEWS_KEY });
      toast({ title: "Google Profile Disconnected" });
    },
  });

  // Sync Reviews Mutation
  const syncGmbMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google-business/sync-reviews");
      return res.json();
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_REVIEWS_KEY });
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_STATUS_KEY });
      toast({
        title: "🔄 Reviews Synced with Google",
        description: `${res.newReviews || 0} reviews synced (${res.autoReplied || 0} auto-replied by AI).`,
      });
    },
    onError: (err: any) => toast({ title: "Sync Failed", description: err.message, variant: "destructive" }),
  });

  // Update Settings Mutation
  const updateGmbSettingsMutation = useMutation({
    mutationFn: async (settings: any) => {
      const res = await apiRequest("PUT", "/api/google-business/settings", settings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_STATUS_KEY });
      toast({ title: "✅ Auto-Pilot Settings Updated" });
    },
  });

  // Reply to Google Review Mutation
  const replyToGmbReviewMutation = useMutation({
    mutationFn: async ({ reviewId, replyText, mode }: { reviewId: string; replyText: string; mode?: string }) => {
      const res = await apiRequest("POST", "/api/google-business/reply", { reviewId, replyText, mode });
      return res.json();
    },
    onSuccess: () => {
      setActiveReplyReviewId(null);
      setInlineReplyText("");
      queryClient.invalidateQueries({ queryKey: GOOGLE_BUSINESS_REVIEWS_KEY });
      queryClient.invalidateQueries({ queryKey: DRAFTS_HISTORY_KEY });
      toast({ title: "✅ Reply Posted to Google Review!" });
    },
    onError: (err: any) => toast({ title: "Reply Failed", description: err.message, variant: "destructive" }),
  });

  // Trigger AI Draft for specific review item in live feed
  const handleGenerateReplyForReview = async (review: GoogleBusinessReviewItem) => {
    setGeneratingReplyId(review.id);
    setActiveReplyReviewId(review.id);
    try {
      const res = await apiRequest("POST", "/api/sales-team/review-reply-drafts/generate", {
        reviewerName: review.reviewerName,
        starRating: review.starRating,
        reviewText: review.comment || "",
        platform: "Google My Business",
      });
      const data = await res.json();
      const bestDraft = data?.drafts?.warm || data?.drafts?.professional || data?.drafts?.crisp || "";
      setInlineReplyText(bestDraft);
    } catch (err: any) {
      toast({ title: "AI Draft Generation Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingReplyId(null);
    }
  };

  const applySample = (sample: typeof SAMPLE_REVIEWS[0]) => {
    setReviewerName(sample.name);
    setRating(sample.rating);
    setReviewText(sample.text);
    setCustomInstructions(sample.instructions);
    setGeneratedDrafts(null);
  };

  if (!form) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Loading Reputation & Review settings...
        </CardContent>
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
      {/* ── SUB-TABS NAVIGATION HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 via-amber-500/5 to-transparent">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Star className="w-5 h-5 text-yellow-500" />
            <h3 className="text-base font-bold text-foreground">Google Reviews & AI Reputation Loop</h3>
            <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30 text-[10px] font-bold">
              ⭐ Section 4: Reputation & Feedback
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Google Reviews par 1-click polite AI replies generate karein, attended visits ke baad automated review requests bhejein, aur negative calls par instant alert payein.
          </p>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-card/80 border border-border/70 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab("google_live")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "google_live"
                ? "bg-yellow-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Google Profile & Auto-Pilot</span>
            {gmbStatus?.connected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("drafts")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "drafts"
                ? "bg-yellow-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Reply Generator</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "rules"
                ? "bg-yellow-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Automation Rules</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "logs"
                ? "bg-yellow-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Reply History ({draftsHistory.length})</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 0: 🌐 GOOGLE BUSINESS PROFILE & FULL AUTO-PILOT
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "google_live" && (
        <div className="space-y-6">
          {/* 1. Connection Status Card */}
          <Card className="border-yellow-500/30 bg-gradient-to-br from-card via-card to-yellow-500/5">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      Google Business Profile Connection
                      {gmbStatus?.connected ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                          🟢 Connected & Synced
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[10px]">
                          ⚠️ Not Connected
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {gmbStatus?.connected
                        ? `Direct API Link active for ${gmbStatus.accountName || "Apex Realty & Living"} (${gmbStatus.locationName || "Jaipur"}).`
                        : "Connect your Google Profile to enable automatic review ingestion and 100% hands-free AI replies."}
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {gmbStatus?.connected ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncGmbMutation.mutate()}
                        disabled={syncGmbMutation.isPending}
                        className="text-xs gap-1.5"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncGmbMutation.isPending ? "animate-spin text-yellow-500" : ""}`} />
                        <span>Sync Reviews</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => disconnectGmbMutation.mutate()}
                        disabled={disconnectGmbMutation.isPending}
                        className="text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={() => quickConnectMutation.mutate()}
                        disabled={quickConnectMutation.isPending}
                        className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white gap-1.5"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>⚡ Quick Connect (developer7023@gmail.com)</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => connectGmbMutation.mutate()}
                        disabled={connectGmbMutation.isPending}
                        className="text-xs gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>OAuth Connect with Google</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>

            {gmbStatus?.connected && (
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border text-xs">
                  <div>
                    <span className="text-muted-foreground">Connected Google Email:</span>
                    <div className="font-semibold text-foreground">{gmbStatus.connectedEmail}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location Profile:</span>
                    <div className="font-semibold text-foreground">{gmbStatus.locationName || "Apex Realty & Living - Jaipur"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Auto-Sync:</span>
                    <div className="font-semibold text-foreground">
                      {gmbStatus.lastSyncedAt ? new Date(gmbStatus.lastSyncedAt).toLocaleString("en-IN") : "Just now"}
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* 2. Auto-Pilot Controls Card */}
          {gmbStatus?.connected && (
            <Card className="border-border/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bot className="w-4 h-4 text-yellow-500" />
                  AI Auto-Pilot Rules (Set & Forget)
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose which reviews should be replied to automatically and which require manual review.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Rule 1: Auto-Pilot for 4 & 5 stars */}
                  <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <Zap className="w-3.5 h-3.5" />
                        Full Auto-Pilot on 4-Star & 5-Star Reviews
                      </div>
                      <Switch
                        checked={gmbStatus.autoReplyEnabled}
                        onCheckedChange={(checked) =>
                          updateGmbSettingsMutation.mutate({ autoReplyEnabled: checked })
                        }
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Jab bhi koi customer Google par ⭐⭐⭐⭐⭐ ya ⭐⭐⭐⭐ review post karega, Calliqo AI bina aapka time liye 2 second me warm and grateful reply bana kar sidhe Google par post kar dega.
                    </p>
                  </div>

                  {/* Rule 2: Manager approval for 1 & 2 stars */}
                  <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-xs flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Manager Approval for 1-Star & 2-Star Complaints
                      </div>
                      <Switch
                        checked={(gmbStatus.requireApprovalBelowStars ?? 0) > 0}
                        onCheckedChange={(checked) =>
                          updateGmbSettingsMutation.mutate({ requireApprovalBelowStars: checked ? 3 : 0 })
                        }
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Agar koi 1-Star ya 2-Star shikayat aati hai, to AI direct post nahi karega. AI pehle draft taiyar karega aur manager ke approval ke baad hi Google par submit hoga.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 3. Live Google Reviews Stream */}
          <Card className="border-border/70">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  Live Google Customer Reviews ({gmbReviews.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Reviews synced from Google Business Profile with real-time AI reply status.
                </CardDescription>
              </div>
              {gmbStatus?.connected && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncGmbMutation.mutate()}
                  disabled={syncGmbMutation.isPending}
                  className="text-xs gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncGmbMutation.isPending ? "animate-spin text-yellow-500" : ""}`} />
                  <span>Check for New Reviews</span>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!gmbStatus?.connected ? (
                <div className="p-8 text-center space-y-3 rounded-lg border border-dashed text-muted-foreground">
                  <Globe className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
                  <p className="text-sm font-medium">Google Profile is not connected yet</p>
                  <p className="text-xs max-w-md mx-auto">
                    Click <strong>"⚡ Quick Connect"</strong> above to instantly sync reviews and test hands-free Auto-Pilot!
                  </p>
                  <Button
                    size="sm"
                    onClick={() => quickConnectMutation.mutate()}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Quick Connect Now</span>
                  </Button>
                </div>
              ) : isReviewsLoading ? (
                <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-yellow-500" />
                  <span>Loading live reviews from Google...</span>
                </div>
              ) : gmbReviews.length === 0 ? (
                <div className="p-8 text-center space-y-2 text-muted-foreground">
                  <p className="text-sm">No reviews found yet.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncGmbMutation.mutate()}
                    className="text-xs"
                  >
                    Sync Reviews Now
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {gmbReviews.map((rev) => (
                    <div
                      key={rev.id}
                      className="p-4 rounded-xl border border-border/70 bg-card hover:border-yellow-500/30 transition-all space-y-3"
                    >
                      {/* Review Top Meta */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          {rev.reviewerPhotoUrl ? (
                            <img
                              src={rev.reviewerPhotoUrl}
                              alt={rev.reviewerName}
                              className="w-8 h-8 rounded-full object-cover border"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-600 flex items-center justify-center font-bold text-xs">
                              {rev.reviewerName.charAt(0)}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                              {rev.reviewerName}
                              <span className="text-yellow-500 font-bold tracking-wider">
                                {"⭐".repeat(rev.starRating)}
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {new Date(rev.reviewCreateTime).toLocaleString("en-IN")} • Google My Business
                            </div>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {rev.replyStatus === "auto_replied" && (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] gap-1 font-semibold">
                              <Zap className="w-3 h-3" /> Auto-Replied by AI (Auto-Pilot)
                            </Badge>
                          )}
                          {rev.replyStatus === "manual_replied" && (
                            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px] gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3" /> Replied
                            </Badge>
                          )}
                          {rev.replyStatus === "pending_approval" && (
                            <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 text-[10px] gap-1 font-semibold">
                              <ShieldAlert className="w-3 h-3" /> 1-Star Complaint (Needs Approval)
                            </Badge>
                          )}
                          {rev.replyStatus === "not_replied" && (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              Awaiting Reply
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Customer Review Text */}
                      <p className="text-xs text-foreground/90 pl-10 leading-relaxed italic">
                        "{rev.comment || "(No written text with rating)"}"
                      </p>

                      {/* Existing Reply Display */}
                      {rev.replyComment && (
                        <div className="ml-10 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs space-y-1">
                          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <Bot className="w-3.5 h-3.5" />
                            <span>Business Reply on Google:</span>
                            {rev.repliedAt && (
                              <span className="text-muted-foreground font-normal">
                                • {new Date(rev.repliedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-foreground/90 leading-relaxed">
                            {rev.replyComment}
                          </p>
                        </div>
                      )}

                      {/* Action Row if not replied or pending approval */}
                      {!rev.replyComment && (
                        <div className="ml-10 pt-1">
                          {activeReplyReviewId !== rev.id ? (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleGenerateReplyForReview(rev)}
                                disabled={generatingReplyId === rev.id}
                                className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white gap-1.5"
                              >
                                {generatingReplyId === rev.id ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>AI Drafting...</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>✨ 1-Click AI Reply</span>
                                  </>
                                )}
                              </Button>
                              <span className="text-[11px] text-muted-foreground">
                                {rev.starRating <= 2
                                  ? "🚨 Sincere apology & manager contact will be included"
                                  : "🌟 Warm thank-you draft will be generated"}
                              </span>
                            </div>
                          ) : (
                            /* Inline AI Reply Box */
                            <div className="p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-yellow-600 dark:text-yellow-400">
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" /> AI Reply Draft (Review & Confirm):
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleGenerateReplyForReview(rev)}
                                  disabled={generatingReplyId === rev.id}
                                  className="h-6 text-[10px] gap-1 px-2"
                                >
                                  <RefreshCw className={`w-3 h-3 ${generatingReplyId === rev.id ? "animate-spin" : ""}`} />
                                  Regenerate
                                </Button>
                              </div>

                              <Textarea
                                value={inlineReplyText}
                                onChange={(e) => setInlineReplyText(e.target.value)}
                                rows={3}
                                className="text-xs bg-background"
                                placeholder="Type or edit reply..."
                              />

                              <div className="flex items-center justify-end gap-2 pt-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setActiveReplyReviewId(null);
                                    setInlineReplyText("");
                                  }}
                                  className="text-xs h-7"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    replyToGmbReviewMutation.mutate({
                                      reviewId: rev.id,
                                      replyText: inlineReplyText,
                                      mode: rev.starRating <= 2 ? "approve" : "manual",
                                    })
                                  }
                                  disabled={!inlineReplyText.trim() || replyToGmbReviewMutation.isPending}
                                  className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white h-7 gap-1"
                                >
                                  {replyToGmbReviewMutation.isPending ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Send className="w-3 h-3" />
                                  )}
                                  <span>{rev.starRating <= 2 ? "Approve & Post to Google" : "Post Reply to Google"}</span>
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: ✍️ AI REVIEW REPLY DRAFTS (1-Click ORM Engine)
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "drafts" && (
        <div className="space-y-6">
          {/* Quick Presets Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card/50 text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-yellow-500" />
              Quick Test Presets (Try sample reviews):
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {SAMPLE_REVIEWS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applySample(s)}
                  className="px-2.5 py-1 rounded border text-[11px] font-medium bg-muted/40 hover:bg-muted text-foreground transition-all cursor-pointer hover:border-yellow-500/50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generator Input Card */}
          <Card className="border-yellow-500/30">
            <CardHeader className="pb-3 border-b bg-yellow-500/[0.03]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-yellow-500" />
                    Public Google Review Details
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Customer ka review aur star rating enter karein — AI 3 alag-alag polite tones mein ready-to-post replies draft karega.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px] gap-1 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30">
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" /> 1-Click AI ORM
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Reviewer Name */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Customer / Reviewer Name *</Label>
                  <Input
                    placeholder="e.g. Rahul Sharma"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                {/* Rating Stars Selector */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold flex items-center justify-between">
                    <span>Star Rating *</span>
                    <span className={`text-[11px] font-bold ${
                      rating >= 4 ? "text-emerald-600 dark:text-emerald-400" : rating === 3 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {rating === 5 ? "⭐⭐⭐⭐⭐ (5/5 Excellent)" :
                       rating === 4 ? "⭐⭐⭐⭐ (4/5 Good)" :
                       rating === 3 ? "⭐⭐⭐ (3/5 Average)" :
                       rating === 2 ? "⭐⭐ (2/5 Poor)" : "⭐ (1/5 Terrible)"}
                    </span>
                  </Label>
                  <div className="flex items-center gap-1.5 h-8 px-2 rounded-md border bg-background">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="transition-transform hover:scale-125 cursor-pointer p-0.5"
                        title={`${star} Star`}
                      >
                        <Star
                          className={`w-4 h-4 ${
                            star <= rating
                              ? rating >= 4
                                ? "text-yellow-500 fill-yellow-500"
                                : rating === 3
                                ? "text-amber-500 fill-amber-500"
                                : "text-red-500 fill-red-500"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Platform */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Review Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Google My Business">Google My Business / Maps</SelectItem>
                      <SelectItem value="Practo">Practo (Clinic / Doctor)</SelectItem>
                      <SelectItem value="JustDial">JustDial</SelectItem>
                      <SelectItem value="Facebook">Facebook Recommendations</SelectItem>
                      <SelectItem value="Website / Other">Direct / Website Feedback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Review Text */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Customer's Review Text *</Label>
                <Textarea
                  rows={3}
                  placeholder="Paste the review written by the customer here..."
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Special Instructions (Optional) */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">
                  Special Instructions for AI (Optional)
                </Label>
                <Input
                  placeholder="e.g. Offer 10% coupon on next visit, or mention Dr. Sunil will personally call them..."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {/* Generate Button */}
              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-muted-foreground">
                  AI aapke White-Label Business Profile aur Manager Contact ko incorporate karke polite reply draft karega.
                </div>
                <Button
                  onClick={() => generateDraftsMutation.mutate()}
                  disabled={generateDraftsMutation.isPending || !reviewText.trim()}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold gap-2 shadow-sm shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  {generateDraftsMutation.isPending ? "Drafting 3 Replies..." : "Generate 3 AI Reply Drafts"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Generated Drafts Area ── */}
          {generatedDrafts && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-3 duration-300">
              {/* Sentiment & Key Points Overview */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-muted/40 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Detected Sentiment:</span>
                  <Badge className={`text-[10px] font-bold ${
                    detectedSentiment === "positive"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                      : detectedSentiment === "neutral"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                      : "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
                  }`}>
                    {detectedSentiment === "positive" ? "🟢 Positive Review" : detectedSentiment === "neutral" ? "🟡 Neutral Review" : "🔴 Critical / Complaint"}
                  </Badge>
                  {keyPoints.length > 0 && (
                    <span className="text-muted-foreground text-[11px] hidden sm:inline">
                      • Highlights: {keyPoints.join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Click <strong>Copy Reply</strong> to paste directly into Google Business Profile.
                </div>
              </div>

              {/* 3 Reply Options Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. WARM & GRATEFUL */}
                <Card className={`border transition-all hover:shadow-md ${
                  rating >= 4 ? "border-emerald-500/40 bg-emerald-500/[0.02]" : "border-border"
                }`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        <HeartHandshake className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>1. Warm & Grateful</span>
                      </div>
                      <Badge className="text-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                        {rating >= 4 ? "Recommended ⭐" : "Empathetic"}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      Heartfelt, personalized, and relationship building.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-1">
                    <Textarea
                      rows={6}
                      value={generatedDrafts.warm}
                      onChange={(e) => setGeneratedDrafts({ ...generatedDrafts, warm: e.target.value })}
                      className="text-xs bg-background/80 leading-relaxed resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCopy(generatedDrafts.warm, "warm")}
                        className={`flex-1 gap-1.5 text-xs font-semibold ${
                          copiedKey === "warm"
                            ? "bg-emerald-600 text-white"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white"
                        }`}
                      >
                        {copiedKey === "warm" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === "warm" ? "Copied!" : "Copy Reply"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveReplyMutation.mutate(generatedDrafts.warm)}
                        disabled={saveReplyMutation.isPending}
                        title="Mark Replied and Save to History"
                        className="text-xs px-2.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 2. PROFESSIONAL & SOLUTION-ORIENTED */}
                <Card className={`border transition-all hover:shadow-md ${
                  rating < 4 ? "border-red-500/40 bg-red-500/[0.02]" : "border-border"
                }`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>2. Professional & Resolution</span>
                      </div>
                      <Badge className={`text-[9px] ${
                        rating < 4
                          ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
                          : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                      }`}>
                        {rating < 4 ? "Damage Control 🚨" : "Objective"}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      Calm, solution-driven; includes management contact.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-1">
                    <Textarea
                      rows={6}
                      value={generatedDrafts.professional}
                      onChange={(e) => setGeneratedDrafts({ ...generatedDrafts, professional: e.target.value })}
                      className="text-xs bg-background/80 leading-relaxed resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCopy(generatedDrafts.professional, "professional")}
                        className={`flex-1 gap-1.5 text-xs font-semibold ${
                          copiedKey === "professional"
                            ? "bg-blue-600 text-white"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      >
                        {copiedKey === "professional" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === "professional" ? "Copied!" : "Copy Reply"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveReplyMutation.mutate(generatedDrafts.professional)}
                        disabled={saveReplyMutation.isPending}
                        title="Mark Replied and Save to History"
                        className="text-xs px-2.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 3. SHORT & CRISP */}
                <Card className="border border-border transition-all hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span>3. Short & Crisp</span>
                      </div>
                      <Badge className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                        Quick Response ⚡
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      Concise 2-sentence reply, ideal for mobile.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-1">
                    <Textarea
                      rows={6}
                      value={generatedDrafts.crisp}
                      onChange={(e) => setGeneratedDrafts({ ...generatedDrafts, crisp: e.target.value })}
                      className="text-xs bg-background/80 leading-relaxed resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCopy(generatedDrafts.crisp, "crisp")}
                        className={`flex-1 gap-1.5 text-xs font-semibold ${
                          copiedKey === "crisp"
                            ? "bg-amber-600 text-white"
                            : "bg-amber-600 hover:bg-amber-700 text-white"
                        }`}
                      >
                        {copiedKey === "crisp" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === "crisp" ? "Copied!" : "Copy Reply"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveReplyMutation.mutate(generatedDrafts.crisp)}
                        disabled={saveReplyMutation.isPending}
                        title="Mark Replied and Save to History"
                        className="text-xs px-2.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Quick preview of recent reply history */}
          {draftsHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <History className="w-4 h-4 text-yellow-500" />
                    Recently Replied Reviews ({draftsHistory.length})
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Reviews that have already received AI-assisted replies.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("logs")}
                  className="text-xs text-yellow-600 hover:text-yellow-700"
                >
                  View All History →
                </Button>
              </CardHeader>
              <CardContent className="pt-3 divide-y text-xs">
                {draftsHistory.slice(0, 3).map((item) => (
                  <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{item.reviewerName}</span>
                        <span className="text-[11px]">
                          {"⭐".repeat(item.rating)}
                        </span>
                        <Badge variant="outline" className="text-[9px]">
                          {item.platform || "Google"}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground line-clamp-1 italic">
                        "{item.reviewText}"
                      </p>
                      {item.chosenReply && (
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium line-clamp-1">
                          ↳ Replied: "{item.chosenReply}"
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.chosenReply && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(item.chosenReply!, `hist-${item.id}`)}
                          className="h-7 text-[11px] gap-1"
                        >
                          {copiedKey === `hist-${item.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          Copy
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteDraftMutation.mutate(item.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                        title="Delete from history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: ⚙️ AUTOMATED REVIEW REQUEST & COMPLAINT ALERT RULES
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold gap-1.5 shadow-sm"
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
                      1. Automatic Google Review Request
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
                </div>

                {delayPreset === "custom" && (
                  <div className="flex gap-2 items-center p-2.5 rounded-lg border bg-muted/40">
                    <Input
                      type="number"
                      min={1}
                      value={customDelayValue}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 1;
                        setCustomDelayValue(val);
                        applyCustomDelay(val, customDelayUnit);
                      }}
                      className="h-8 text-xs w-24"
                    />
                    <Select
                      value={customDelayUnit}
                      onValueChange={(u: "minutes" | "hours" | "days") => {
                        setCustomDelayUnit(u);
                        applyCustomDelay(customDelayValue, u);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-28">
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

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Trigger Statuses</Label>
                  <div className="space-y-1">
                    {TRIGGER_STATUS_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.reviewTriggerStatuses.includes(opt.value)}
                          onChange={(e) => toggleTriggerStatus(opt.value, e.target.checked)}
                          className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-1">
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
                  <Label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">WhatsApp Message</Label>
                  <Textarea
                    rows={4}
                    value={form.reviewWhatsappMessage}
                    onChange={(e) => update({ reviewWhatsappMessage: e.target.value })}
                    className="text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Available tags: {"{customer_name}"}, {"{business_name}"}, {"{service_name}"}, {"{review_link}"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Meta Template Name (optional)</Label>
                    <Input
                      value={form.reviewWhatsappTemplateName}
                      onChange={(e) => update({ reviewWhatsappTemplateName: e.target.value })}
                      placeholder="e.g. review_request_v1"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Template Language</Label>
                    <Input
                      value={form.reviewWhatsappTemplateLanguage}
                      onChange={(e) => update({ reviewWhatsappTemplateLanguage: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

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
                      2. Negative Call / Complaint Alert
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
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: 📜 ACTIVITY LOGS & REPLIED REVIEWS HISTORY
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <div className="space-y-6">
          {/* AI Replied Reviews Log */}
          <Card>
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-500" />
                  AI Replied Reviews Log ({draftsHistory.length})
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Reviews for which you generated and saved AI replies.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDraftsHistory()}
                className="text-xs gap-1.5 h-8"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="pt-4 text-xs">
              {draftsHistory.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Abhi koi review reply history nahi hai. Sub-tab <strong>"AI Review Reply Drafts"</strong> par jaakar pehla reply draft karein!
                </div>
              ) : (
                <div className="divide-y">
                  {draftsHistory.map((item) => (
                    <div key={item.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{item.reviewerName}</span>
                          <span className="text-xs">{"⭐".repeat(item.rating)}</span>
                          <Badge variant="outline" className="text-[9px]">
                            {item.platform || "Google"}
                          </Badge>
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[9px]">
                            Replied ✅
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(item.repliedAt || item.createdAt).toLocaleString("en-IN")}
                          </span>
                          {item.chosenReply && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopy(item.chosenReply!, `full-hist-${item.id}`)}
                              className="h-7 text-[11px] gap-1"
                            >
                              {copiedKey === `full-hist-${item.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              Copy
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteDraftMutation.mutate(item.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/30 border border-border/50 text-[11px] text-muted-foreground">
                        <strong className="text-foreground">Customer Review:</strong> "{item.reviewText}"
                      </div>
                      {item.chosenReply && (
                        <div className="p-2 rounded bg-emerald-500/[0.04] border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
                          <strong>Your Sent Reply:</strong> "{item.chosenReply}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Log for Outbound Review Requests & Inbound Complaint Alerts */}
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <History className="w-4 h-4" /> Recent Automated Review Requests & Complaint Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
              <div className="space-y-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500" /> Automated Review Requests Sent
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
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Negative Call Complaint Alerts Sent
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
      )}
    </div>
  );
}
