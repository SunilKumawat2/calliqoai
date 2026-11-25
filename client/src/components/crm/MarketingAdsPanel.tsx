import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Video,
  Clapperboard,
  Sparkles,
  Copy,
  Check,
  Calendar,
  CheckCircle2,
  Clock,
  Target,
  TrendingUp,
  DollarSign,
  Megaphone,
  Layers,
  Plus,
  Trash2,
  ExternalLink,
  MessageSquare,
  PhoneCall,
  ArrowUpRight,
  BarChart3,
  RefreshCw,
  Zap,
  BookmarkCheck,
  FileText,
  Play,
  Download,
  Film,
  Key,
  Sliders,
  Eye,
  EyeOff,
  Tv,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

export interface MarketingScriptItem {
  id: string;
  title: string;
  scriptType: string;
  sourceTopic?: string;
  targetAudience?: string;
  hook: string;
  bodyText: string;
  callToAction: string;
  language: string;
  estimatedDuration?: string;
  status: "draft" | "approved" | "scheduled" | "published";
  approvedAt?: string;
  approvedBy?: string;
  scheduledFor?: string;
  notes?: string;
  videoStatus?: "none" | "rendering" | "completed" | "failed";
  videoUrl?: string;
  videoThumbnailUrl?: string;
  videoProvider?: string;
  videoJobId?: string;
  videoDuration?: string;
  createdAt: string;
}

export interface BrandKitData {
  id?: string;
  brandName: string;
  brandVoice: string;
  targetAudience: string;
  coreOffer: string;
  ctaLink: string;
  primaryLanguage: string;
  keyUSPs: string[];
  videoProvider?: string;
  videoApiKey?: string;
  videoAvatarId?: string;
  videoVoiceId?: string;
}

export interface AdAttributionItem {
  id: string;
  campaignName: string;
  adsetName?: string;
  adName: string;
  platform: string;
  utmCampaign?: string;
  clicks: number;
  enquiriesCount: number;
  qualifiedCount: number;
  appointmentsCount: number;
  salesCount: number;
  totalRevenue: string;
  adSpend: string;
  createdAt: string;
}

const BRAND_KIT_KEY = ["/api/marketing/brand-kit"];
const OBJECTIONS_KEY = ["/api/marketing/call-objections"];
const SCRIPTS_KEY = ["/api/marketing/scripts"];
const ATTRIBUTION_KEY = ["/api/marketing/ad-attributions"];

export function MarketingAdsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Active sub-tab
  const [activeSubTab, setActiveSubTab] = useState<"scripts" | "approval" | "attribution">("scripts");

  // Script Generator Form State
  const [selectedTopic, setSelectedTopic] = useState("");
  const [scriptType, setScriptType] = useState<"instagram_reel" | "meta_ad" | "whatsapp_broadcast" | "youtube_short">("instagram_reel");
  const [scriptLanguage, setScriptLanguage] = useState<"hinglish" | "hindi" | "english">("hinglish");
  const [customInstructions, setCustomInstructions] = useState("");
  const [copiedScriptId, setCopiedScriptId] = useState<string | null>(null);

  // New Ad Campaign Modal / Input state
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newAdSpend, setNewAdSpend] = useState("5000");
  const [showNewAdBox, setShowNewAdBox] = useState(false);

  // ── Queries ──
  const { data: brandKit, isLoading: isBrandKitLoading } = useQuery<BrandKitData>({
    queryKey: BRAND_KIT_KEY,
  });

  const { data: objectionsData } = useQuery<{
    totalCallsAnalyzed: number;
    objections: Array<{
      id: string;
      topic: string;
      question: string;
      callMentions: number;
      recommendedHook: string;
      suggestedType: string;
    }>;
  }>({
    queryKey: OBJECTIONS_KEY,
  });

  const { data: scripts = [], isLoading: isScriptsLoading } = useQuery<MarketingScriptItem[]>({
    queryKey: SCRIPTS_KEY,
  });

  const { data: adAttributionsList = [], isLoading: isAttributionLoading } = useQuery<AdAttributionItem[]>({
    queryKey: ATTRIBUTION_KEY,
  });

  // ── Brand Kit Form State ──
  const [brandForm, setBrandForm] = useState<BrandKitData | null>(null);

  // Keep brandForm updated when brandKit loads
  if (brandKit && !brandForm) {
    setBrandForm(brandKit);
  }

  // ── Mutations ──
  const saveBrandKitMutation = useMutation({
    mutationFn: async (data: Partial<BrandKitData>) => {
      const res = await apiRequest("PUT", "/api/marketing/brand-kit", data);
      return res.json();
    },
    onSuccess: (updated: BrandKitData) => {
      setBrandForm(updated);
      queryClient.setQueryData(BRAND_KIT_KEY, updated);
      toast({ title: "✅ Brand Kit Saved", description: "AI scripts will now use your updated brand identity." });
    },
    onError: (err: any) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  const generateScriptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketing/scripts/generate", {
        scriptType,
        sourceTopic: selectedTopic || "Price vs Value & Ready-to-Move Advantage",
        language: scriptLanguage,
        customInstructions,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCRIPTS_KEY });
      toast({
        title: "✨ Script Generated Successfully!",
        description: "New viral video script with Hook, Scene Breakdown & CTA added to your drafts.",
      });
    },
    onError: (err: any) => toast({ title: "Generation Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/marketing/scripts/${id}/status`, { status, notes });
      return res.json();
    },
    onSuccess: (updated: MarketingScriptItem) => {
      queryClient.invalidateQueries({ queryKey: SCRIPTS_KEY });
      toast({
        title: updated.status === "approved" ? "✅ Script Approved!" : `Status updated to ${updated.status}`,
        description: updated.status === "approved" ? "Script is now ready to shoot and publish." : undefined,
      });
    },
    onError: (err: any) => toast({ title: "Update Failed", description: err.message, variant: "destructive" }),
  });

  const deleteScriptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/marketing/scripts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCRIPTS_KEY });
      toast({ title: "Script Deleted" });
    },
  });

  // AI Video Generation State
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [selectedScriptForVideo, setSelectedScriptForVideo] = useState<MarketingScriptItem | null>(null);
  const [modalProvider, setModalProvider] = useState<string>("simulator");
  const [modalAvatarId, setModalAvatarId] = useState<string>("Daisy-in-blazer");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testKeyStatus, setTestKeyStatus] = useState<{ testing?: boolean; success?: boolean; message?: string } | null>(null);

  // Video mutations
  const generateVideoMutation = useMutation({
    mutationFn: async ({
      scriptId,
      provider,
      avatarId,
      apiKey,
    }: {
      scriptId: string;
      provider?: string;
      avatarId?: string;
      apiKey?: string;
    }) => {
      const res = await apiRequest("POST", `/api/marketing/scripts/${scriptId}/generate-video`, {
        provider,
        avatarId,
        apiKey,
      });
      return res.json();
    },
    onSuccess: (updated: MarketingScriptItem) => {
      queryClient.invalidateQueries({ queryKey: SCRIPTS_KEY });
      setVideoModalOpen(false);
      if (updated.videoStatus === "rendering") {
        toast({
          title: "⏳ AI Video Generation Started!",
          description: `Rendering on ${updated.videoProvider || "AI Engine"}. Check back shortly.`,
        });
      } else {
        toast({
          title: "🎉 AI Video Created Successfully!",
          description: "Your 9:16 vertical video reel is ready to preview, play, and download.",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Video Generation Error", description: err.message, variant: "destructive" });
    },
  });

  const checkVideoStatusMutation = useMutation({
    mutationFn: async (scriptId: string) => {
      const res = await apiRequest("GET", `/api/marketing/scripts/${scriptId}/video-status`, {});
      return res.json();
    },
    onSuccess: (updated: MarketingScriptItem) => {
      queryClient.invalidateQueries({ queryKey: SCRIPTS_KEY });
      if (updated.videoStatus === "completed") {
        toast({ title: "✅ Video Ready!", description: "Video render completed successfully." });
      } else {
        toast({ title: "Status: " + updated.videoStatus, description: "Video is still processing..." });
      }
    },
  });

  const testCredentialsMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) => {
      const res = await apiRequest("POST", "/api/marketing/test-video-credentials", { provider, apiKey });
      return res.json();
    },
    onSuccess: (res: any) => {
      setTestKeyStatus({ testing: false, success: res.success, message: res.message });
      if (res.success) {
        toast({ title: "✅ Connection Verified", description: res.message });
      } else {
        toast({ title: "❌ Connection Failed", description: res.message, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      setTestKeyStatus({ testing: false, success: false, message: err.message });
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createAdMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketing/ad-attributions", {
        campaignName: newCampaignName,
        adName: `${newCampaignName} - CTWA WhatsApp Creative`,
        adSpend: parseFloat(newAdSpend) || 5000,
        platform: "ctwa_whatsapp",
      });
      return res.json();
    },
    onSuccess: () => {
      setNewCampaignName("");
      setShowNewAdBox(false);
      queryClient.invalidateQueries({ queryKey: ATTRIBUTION_KEY });
      toast({ title: "🎯 Ad Campaign Link Created!", description: "Tracked WhatsApp link ready for Meta Ads Manager." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCopyScript = (script: MarketingScriptItem) => {
    const text = `🎬 TITLE: ${script.title}
⏱ DURATION: ${script.estimatedDuration || "30-45 sec"}
🎯 FORMAT: ${script.scriptType.replace("_", " ").toUpperCase()}

⚡ 3-SEC VIRAL HOOK:
${script.hook}

📝 FULL VIDEO SCRIPT & SCENE BREAKDOWN:
${script.bodyText}

📢 CALL TO ACTION (CTA):
${script.callToAction}`;

    navigator.clipboard.writeText(text);
    setCopiedScriptId(script.id);
    setTimeout(() => setCopiedScriptId(null), 2500);
    toast({
      title: "📋 Script Copied to Clipboard!",
      description: "Paste into Teleprompter, Google Docs, or WhatsApp to share with your video editor.",
    });
  };

  // Attribution KPI totals
  const totalSpend = adAttributionsList.reduce((acc, a) => acc + parseFloat(a.adSpend || "0"), 0);
  const totalRevenue = adAttributionsList.reduce((acc, a) => acc + parseFloat(a.totalRevenue || "0"), 0);
  const totalClicks = adAttributionsList.reduce((acc, a) => acc + a.clicks, 0);
  const totalEnquiries = adAttributionsList.reduce((acc, a) => acc + a.enquiriesCount, 0);
  const totalAppointments = adAttributionsList.reduce((acc, a) => acc + a.appointmentsCount, 0);
  const totalSales = adAttributionsList.reduce((acc, a) => acc + a.salesCount, 0);
  const overallRoas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {/* ── TOP HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 via-pink-500/5 to-transparent">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Clapperboard className="w-5 h-5 text-purple-400" />
            <h3 className="text-base font-bold text-foreground">Marketing, Video Scripts & Ad Engine</h3>
            <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-[10px] font-bold">
              🎬 AI Video, Scripts & Meta Ads
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Customer calls ke objections se viral Instagram Reels & Meta Ads scripts banayein, Brand Kit se approve karein, aur Click-to-WhatsApp (CTWA) conversion track karein.
          </p>
        </div>

        {/* Sub-tab pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-card/80 border border-border/70 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveSubTab("scripts")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === "scripts"
                ? "bg-purple-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Call-to-Script AI</span>
            <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5 border-purple-400/40">
              {scripts.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("approval")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === "approval"
                ? "bg-purple-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Brand Kit & Approval</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("attribution")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === "attribution"
                ? "bg-purple-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>Click-to-WhatsApp Ads</span>
            <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5 border-emerald-400/40 text-emerald-500">
              {adAttributionsList.length}
            </Badge>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SUB-TAB 1: 🎬 CALL-TO-SCRIPT AI GENERATOR
      ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "scripts" && (
        <div className="space-y-6">
          {/* Objections / FAQs Extracted from Calls */}
          <Card className="border-border/70 bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-purple-400" />
                  Real Customer Objections Heard on Calls ({objectionsData?.totalCallsAnalyzed || 36} calls analyzed)
                </CardTitle>
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                  Tap topic to auto-fill
                </Badge>
              </div>
              <CardDescription className="text-xs">
                AI ne customer calls ke common sawal analyze kiye hain. Kisi bhi topic par click karke turant script banayein:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(objectionsData?.objections || []).map((obj) => (
                  <div
                    key={obj.id}
                    onClick={() => {
                      setSelectedTopic(obj.topic);
                      if (obj.suggestedType) setScriptType(obj.suggestedType as any);
                    }}
                    className={`p-3 rounded-lg border transition-all cursor-pointer text-xs space-y-1.5 ${
                      selectedTopic === obj.topic
                        ? "border-purple-500 bg-purple-500/10 shadow-xs"
                        : "border-border/60 hover:border-purple-400/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{obj.topic}</span>
                      <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-300 text-[9px] font-normal">
                        {obj.callMentions} calls
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">
                      "{obj.question}"
                    </p>
                    <div className="text-[10px] text-purple-400 flex items-center gap-1 pt-0.5">
                      <Zap className="w-3 h-3" />
                      <span className="truncate">{obj.recommendedHook}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Generator Controls Card */}
          <Card className="border-purple-500/30 bg-gradient-to-br from-card via-card to-purple-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                Generate Viral Marketing Script with AI (GPT-4o)
              </CardTitle>
              <CardDescription className="text-xs">
                Choose format, language, and topic to create a complete script with 3-second hook, visual cues, dialogue, and CTA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Script Format */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Content Format</Label>
                  <Select value={scriptType} onValueChange={(val: any) => setScriptType(val)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram_reel">📱 Instagram Reel (9:16 Video)</SelectItem>
                      <SelectItem value="meta_ad">🎯 Meta Ads Creative (Paid Video)</SelectItem>
                      <SelectItem value="whatsapp_broadcast">💬 WhatsApp Broadcast Copy</SelectItem>
                      <SelectItem value="youtube_short">⚡ YouTube Short (Viral Fact)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Language */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Language & Tone</Label>
                  <Select value={scriptLanguage} onValueChange={(val: any) => setScriptLanguage(val)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hinglish">🇮🇳 Hinglish (Natural Indian Conversational)</SelectItem>
                      <SelectItem value="hindi">🇮🇳 Pure Hindi (Shuddh Hindi)</SelectItem>
                      <SelectItem value="english">🌐 Professional English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Selected Topic */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Core Topic / Customer Objection</Label>
                  <Input
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                    placeholder="e.g. Under-construction vs Ready-to-move"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Creator instructions */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Special Creative Instructions (Optional)</Label>
                <Input
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. Focus on our zero brokerage offer and highlight that club house is ready..."
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <BookmarkCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span>Using Brand: <strong>{brandKit?.brandName || "Apex Realty & Living"}</strong> ({brandKit?.brandVoice || "Energetic"})</span>
                </div>

                <Button
                  onClick={() => generateScriptMutation.mutate()}
                  disabled={generateScriptMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
                >
                  {generateScriptMutation.isPending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Writing Viral Script...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>✨ Generate Script with AI</span>
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Generated Scripts Library */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                Script Library & Production Queue ({scripts.length})
              </h4>
              <span className="text-[11px] text-muted-foreground">Click "Copy Script" to shoot or share with video team</span>
            </div>

            {isScriptsLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                <span>Loading scripts...</span>
              </div>
            ) : scripts.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-xs text-muted-foreground space-y-2">
                  <p>Abhi tak koi script generate nahi hui.</p>
                  <Button
                    size="sm"
                    onClick={() => generateScriptMutation.mutate()}
                    className="bg-purple-600 text-white text-xs gap-1.5"
                  >
                    Generate First Script
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {scripts.map((script) => (
                  <Card key={script.id} className="border-border/70 hover:border-purple-500/30 transition-all">
                    <CardHeader className="pb-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground">{script.title}</span>
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {script.scriptType.replace("_", " ")}
                            </Badge>
                            <Badge className="bg-muted text-muted-foreground text-[10px]">
                              {script.language}
                            </Badge>
                            {script.estimatedDuration && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {script.estimatedDuration}
                              </span>
                            )}
                          </div>
                          {script.sourceTopic && (
                            <div className="text-[11px] text-muted-foreground">
                              Topic: <em>{script.sourceTopic}</em>
                            </div>
                          )}
                        </div>

                        {/* Status Badge & 1-Click Approve */}
                        <div className="flex items-center gap-2">
                          {script.status === "approved" ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Approved for Shooting
                            </Badge>
                          ) : script.status === "scheduled" ? (
                            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px] gap-1">
                              <Calendar className="w-3 h-3" /> Scheduled
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[10px]">
                              Draft (Pending Approval)
                            </Badge>
                          )}

                          {script.status === "draft" && (
                            <Button
                              size="sm"
                              onClick={() => updateStatusMutation.mutate({ id: script.id, status: "approved" })}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            >
                              <Check className="w-3 h-3" />
                              <span>1-Click Approve</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3 pt-0">
                      {/* Viral Hook */}
                      <div className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 space-y-1">
                        <span className="text-[10px] font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider flex items-center gap-1">
                          <Zap className="w-3 h-3" /> 0-3 Sec Viral Hook (Video Opening):
                        </span>
                        <p className="text-xs font-semibold text-foreground leading-relaxed">
                          {script.hook}
                        </p>
                      </div>

                      {/* Script Body Breakdown */}
                      <div className="p-3.5 rounded-lg border bg-muted/30 space-y-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Full Script & Scene Direction:
                        </span>
                        <pre className="text-xs font-sans text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {script.bodyText}
                        </pre>
                      </div>

                      {/* Call to Action (CTA) */}
                      <div className="p-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-xs flex items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-purple-400 uppercase">Call To Action (CTA):</span>
                          <div className="font-medium text-foreground">{script.callToAction}</div>
                        </div>
                      </div>

                      {/* AI Video Preview / Player Block */}
                      {script.videoStatus === "completed" && script.videoUrl && (
                        <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] gap-1 font-bold">
                                <Film className="w-3 h-3" /> 🎬 9:16 AI Video Reel Ready
                              </Badge>
                              <span className="text-[10px] text-muted-foreground uppercase">
                                Provider: {script.videoProvider || "Simulator"} • {script.videoDuration || "0:38"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  navigator.clipboard.writeText(script.videoUrl!);
                                  toast({ title: "🔗 Video Link Copied to Clipboard!" });
                                }}
                                className="h-7 text-xs gap-1"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copy Link</span>
                              </Button>
                              <a
                                href={script.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                download={`calliqo-reel-${script.id}.mp4`}
                                className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md bg-purple-600 hover:bg-purple-700 text-white gap-1 transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download MP4</span>
                              </a>
                            </div>
                          </div>

                          {/* Video player view */}
                          <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
                            <div className="relative w-full max-w-[210px] aspect-[9/16] rounded-xl overflow-hidden border border-purple-500/40 shadow-xl bg-black shrink-0">
                              <video
                                src={script.videoUrl}
                                poster={script.videoThumbnailUrl}
                                controls
                                playsInline
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="text-xs space-y-2 flex-1">
                              <p className="font-semibold text-foreground flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                <span>High-Converting Vertical Video Ready for Meta Ads & Instagram Reels</span>
                              </p>
                              <p className="text-muted-foreground text-[11px] leading-relaxed">
                                Ye video customer calls ke real objections aur script hook ke anusaar 9:16 format me render ho chuka hai. Aap ise seedha Instagram Reel, Facebook Ad ya WhatsApp Status par use kar sakte hain.
                              </p>
                              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                                <div className="p-2 rounded border bg-card/60">
                                  <span className="text-muted-foreground block text-[10px]">Aspect Ratio</span>
                                  <span className="font-semibold text-foreground">9:16 Vertical (1080x1920)</span>
                                </div>
                                <div className="p-2 rounded border bg-card/60">
                                  <span className="text-muted-foreground block text-[10px]">Optimal Duration</span>
                                  <span className="font-semibold text-foreground">{script.videoDuration || "30-45 sec"}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {script.videoStatus === "rendering" && (
                        <div className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 flex items-center justify-between flex-wrap gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-yellow-500" />
                            <span className="font-semibold text-foreground">AI Video is rendering...</span>
                            <span className="text-[11px] text-muted-foreground">({script.videoProvider || "AI Engine"})</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => checkVideoStatusMutation.mutate(script.id)}
                            className="h-7 text-xs gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Check Status</span>
                          </Button>
                        </div>
                      )}

                      {/* Card Actions Footer */}
                      <div className="flex items-center justify-between pt-2 border-t text-xs">
                        <div className="text-[11px] text-muted-foreground">
                          Created {new Date(script.createdAt).toLocaleDateString("en-IN")}
                          {script.approvedBy && ` • Approved by ${script.approvedBy}`}
                        </div>

                        <div className="flex items-center gap-2">
                          {script.videoStatus === "completed" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedScriptForVideo(script);
                                setModalProvider(brandKit?.videoProvider || "simulator");
                                setModalAvatarId(brandKit?.videoAvatarId || "Daisy-in-blazer");
                                setVideoModalOpen(true);
                              }}
                              className="h-7 text-xs border-purple-500/40 text-purple-600 dark:text-purple-300 hover:bg-purple-500/10 gap-1.5"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Re-generate Video</span>
                            </Button>
                          ) : script.videoStatus === "rendering" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              className="h-7 text-xs gap-1.5 text-yellow-500"
                            >
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Rendering...</span>
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedScriptForVideo(script);
                                setModalProvider(brandKit?.videoProvider || "simulator");
                                setModalAvatarId(brandKit?.videoAvatarId || "Daisy-in-blazer");
                                setVideoModalOpen(true);
                              }}
                              className="h-7 text-xs bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white gap-1.5 shadow-sm font-semibold"
                            >
                              <Video className="w-3.5 h-3.5" />
                              <span>🎥 Generate AI Video</span>
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopyScript(script)}
                            className="h-7 text-xs gap-1.5"
                          >
                            {copiedScriptId === script.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span className="text-emerald-500">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Script</span>
                              </>
                            )}
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteScriptMutation.mutate(script.id)}
                            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 px-2"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SUB-TAB 2: 📋 BRAND KIT & APPROVAL PIPELINE
      ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "approval" && (
        <div className="space-y-6">
          {/* Brand Kit Card */}
          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookmarkCheck className="w-4 h-4 text-purple-400" />
                Brand Kit & Content Identity
              </CardTitle>
              <CardDescription className="text-xs">
                AI inhi details aur tone ko use karke aapke brand ke anuroop scripts generate karega.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Brand / Business Name</Label>
                  <Input
                    value={brandForm?.brandName || ""}
                    onChange={(e) => setBrandForm((prev) => prev ? { ...prev, brandName: e.target.value } : prev)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Brand Voice & Persona</Label>
                  <Select
                    value={brandForm?.brandVoice || "energetic"}
                    onValueChange={(val) => setBrandForm((prev) => prev ? { ...prev, brandVoice: val } : prev)}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="energetic">⚡ Energetic & Action-Oriented (High Reels Reach)</SelectItem>
                      <SelectItem value="authoritative">🏛️ Authoritative & Trusted Real Estate Expert</SelectItem>
                      <SelectItem value="friendly_helpful">🤝 Friendly, Sincere & Helpful Consultant</SelectItem>
                      <SelectItem value="luxury_premium">💎 Luxury & Ultra-High-End Exclusive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Core Offer & Irresistible Hook</Label>
                <Input
                  value={brandForm?.coreOffer || ""}
                  onChange={(e) => setBrandForm((prev) => prev ? { ...prev, coreOffer: e.target.value } : prev)}
                  className="text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Target Audience Persona</Label>
                  <Input
                    value={brandForm?.targetAudience || ""}
                    onChange={(e) => setBrandForm((prev) => prev ? { ...prev, targetAudience: e.target.value } : prev)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">WhatsApp Direct CTA Link</Label>
                  <Input
                    value={brandForm?.ctaLink || ""}
                    onChange={(e) => setBrandForm((prev) => prev ? { ...prev, ctaLink: e.target.value } : prev)}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => brandForm && saveBrandKitMutation.mutate(brandForm)}
                  disabled={saveBrandKitMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Brand Kit</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Video Generation Credentials Card */}
          <Card className="border-purple-500/30 bg-gradient-to-br from-card via-card to-purple-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Video className="w-4 h-4 text-purple-400" />
                  AI Video Generation Tool & API Credentials
                </CardTitle>
                <Badge className="bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30 text-[10px]">
                  HeyGen • D-ID • Instant Simulator
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Apne pasandida AI video tool ke credentials yahan connect karein. Agar aapke paas API key nahi hai, toh Built-in Simulator se turant 9:16 vertical test videos generate kiye ja sakte hain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Provider Selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Video AI Platform</Label>
                  <Select
                    value={brandForm?.videoProvider || "simulator"}
                    onValueChange={(val) => setBrandForm((prev) => prev ? { ...prev, videoProvider: val } : prev)}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simulator">⚡ Instant AI Video Simulator (Ready to Use)</SelectItem>
                      <SelectItem value="heygen">🤖 HeyGen API (Talking Avatars & 9:16 Reels)</SelectItem>
                      <SelectItem value="did">🎭 D-ID API (Interactive Presenters)</SelectItem>
                      <SelectItem value="creatomate">🎬 Creatomate / InVideo AI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Avatar Style */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Presenter / Avatar Style</Label>
                  <Select
                    value={brandForm?.videoAvatarId || "Daisy-in-blazer"}
                    onValueChange={(val) => setBrandForm((prev) => prev ? { ...prev, videoAvatarId: val } : prev)}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Daisy-in-blazer">👩 Daisy - Corporate Real Estate Host</SelectItem>
                      <SelectItem value="josh_lite3_20230714">👨 Josh - Energetic Modern Consultant</SelectItem>
                      <SelectItem value="Wayne_20240711">👨 Wayne - Senior Luxury Advisor</SelectItem>
                      <SelectItem value="Ann_Doctor_Sitting_public">👩 Ann - Warm & Friendly Consultant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* API Key Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">API Key / Token</Label>
                    {brandForm?.videoProvider !== "simulator" && (
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="text-[10px] text-purple-400 hover:underline flex items-center gap-0.5"
                      >
                        {showApiKey ? "Hide Key" : "Show Key"}
                      </button>
                    )}
                  </div>
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={brandForm?.videoApiKey || ""}
                    onChange={(e) => setBrandForm((prev) => prev ? { ...prev, videoApiKey: e.target.value } : prev)}
                    placeholder={
                      brandForm?.videoProvider === "simulator"
                        ? "Key not required for Instant Simulator"
                        : "Paste your API Key here (e.g. hey_... or d-id token)"
                    }
                    disabled={brandForm?.videoProvider === "simulator"}
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t flex-wrap gap-2">
                <div className="text-xs">
                  {brandForm?.videoProvider === "simulator" ? (
                    <span className="text-emerald-500 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Instant Video Simulator ready: Har script ka 9:16 vertical reel bina API key ke turant banega.
                    </span>
                  ) : testKeyStatus?.message ? (
                    <span className={testKeyStatus.success ? "text-emerald-500 font-medium" : "text-red-500 font-medium"}>
                      {testKeyStatus.message}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">
                      Enter your {brandForm?.videoProvider === "heygen" ? "HeyGen" : "D-ID"} API key to generate high-end talking avatar reels.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {brandForm?.videoProvider !== "simulator" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (brandForm) {
                          testCredentialsMutation.mutate({
                            provider: brandForm.videoProvider || "heygen",
                            apiKey: brandForm.videoApiKey || "",
                          });
                        }
                      }}
                      disabled={testCredentialsMutation.isPending || !brandForm?.videoApiKey}
                      className="h-8 text-xs gap-1"
                    >
                      {testCredentialsMutation.isPending ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Test Key</span>
                    </Button>
                  )}

                  <Button
                    type="button"
                    onClick={() => brandForm && saveBrandKitMutation.mutate(brandForm)}
                    disabled={saveBrandKitMutation.isPending}
                    className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Credentials</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Kanban / Approval Board */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Content Approval & Publishing Pipeline
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Column 1: Drafts */}
              <div className="space-y-2.5 p-3 rounded-xl border bg-muted/20">
                <div className="flex items-center justify-between pb-1 border-b">
                  <span className="font-bold text-xs text-amber-500">📝 Drafts for Review</span>
                  <Badge variant="outline" className="text-[10px]">
                    {scripts.filter((s) => s.status === "draft").length}
                  </Badge>
                </div>
                {scripts.filter((s) => s.status === "draft").length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">Koi draft pending nahi hai</div>
                ) : (
                  scripts
                    .filter((s) => s.status === "draft")
                    .map((s) => (
                      <div key={s.id} className="p-3 rounded-lg border bg-card text-xs space-y-2">
                        <div className="font-semibold text-foreground line-clamp-1">{s.title}</div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{s.hook}</p>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] uppercase text-muted-foreground">{s.scriptType}</span>
                          <Button
                            size="sm"
                            onClick={() => updateStatusMutation.mutate({ id: s.id, status: "approved" })}
                            className="h-6 text-[10px] bg-emerald-600 text-white px-2 gap-1"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Column 2: Approved */}
              <div className="space-y-2.5 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-center justify-between pb-1 border-b border-emerald-500/20">
                  <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">
                    ✅ Approved (Ready to Shoot)
                  </span>
                  <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px]">
                    {scripts.filter((s) => s.status === "approved").length}
                  </Badge>
                </div>
                {scripts.filter((s) => s.status === "approved").length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">Approve scripts to shoot here</div>
                ) : (
                  scripts
                    .filter((s) => s.status === "approved")
                    .map((s) => (
                      <div key={s.id} className="p-3 rounded-lg border border-emerald-500/30 bg-card text-xs space-y-2">
                        <div className="font-semibold text-foreground line-clamp-1">{s.title}</div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{s.hook}</p>
                        <div className="flex items-center justify-between pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopyScript(s)}
                            className="h-6 text-[10px] gap-1 px-2"
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => updateStatusMutation.mutate({ id: s.id, status: "scheduled" })}
                            className="h-6 text-[10px] bg-purple-600 text-white px-2 gap-1"
                          >
                            <Calendar className="w-3 h-3" /> Mark Scheduled
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Column 3: Scheduled / Published */}
              <div className="space-y-2.5 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center justify-between pb-1 border-b border-blue-500/20">
                  <span className="font-bold text-xs text-blue-600 dark:text-blue-400">🚀 Scheduled / Live</span>
                  <Badge className="bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px]">
                    {scripts.filter((s) => s.status === "scheduled" || s.status === "published").length}
                  </Badge>
                </div>
                {scripts.filter((s) => s.status === "scheduled" || s.status === "published").length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">No scheduled scripts</div>
                ) : (
                  scripts
                    .filter((s) => s.status === "scheduled" || s.status === "published")
                    .map((s) => (
                      <div key={s.id} className="p-3 rounded-lg border border-blue-500/30 bg-card text-xs space-y-2">
                        <div className="font-semibold text-foreground line-clamp-1">{s.title}</div>
                        <div className="text-[10px] text-blue-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Content Ready for Social Media
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SUB-TAB 3: 🎯 CLICK-TO-WHATSAPP (CTWA) AD ATTRIBUTION
      ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "attribution" && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="p-3 border-border/70">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Total Ad Spend</span>
              <div className="text-lg font-bold text-foreground mt-0.5">₹{totalSpend.toLocaleString("en-IN")}</div>
              <span className="text-[10px] text-muted-foreground">Across all Meta ads</span>
            </Card>

            <Card className="p-3 border-border/70">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Total Ad Clicks</span>
              <div className="text-lg font-bold text-foreground mt-0.5">{totalClicks}</div>
              <span className="text-[10px] text-muted-foreground">CTWA link clicks</span>
            </Card>

            <Card className="p-3 border-border/70">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">WhatsApp Enquiries</span>
              <div className="text-lg font-bold text-purple-400 mt-0.5">{totalEnquiries}</div>
              <span className="text-[10px] text-muted-foreground">CPL: ₹{(totalSpend / Math.max(totalEnquiries, 1)).toFixed(0)}</span>
            </Card>

            <Card className="p-3 border-border/70">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Site Visits Booked</span>
              <div className="text-lg font-bold text-yellow-500 mt-0.5">{totalAppointments}</div>
              <span className="text-[10px] text-muted-foreground">{((totalAppointments / Math.max(totalEnquiries, 1)) * 100).toFixed(0)}% conversion</span>
            </Card>

            <Card className="p-3 border-border/70">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Closed Sales</span>
              <div className="text-lg font-bold text-emerald-500 mt-0.5">{totalSales}</div>
              <span className="text-[10px] text-muted-foreground">Deals Converted</span>
            </Card>

            <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-semibold">Total ROAS</span>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{overallRoas}x</div>
              <span className="text-[10px] text-muted-foreground">₹{(totalRevenue / 100000).toFixed(1)}L Revenue</span>
            </Card>
          </div>

          {/* Attribution Table Card */}
          <Card className="border-border/70">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-500" />
                  Meta Ads & Click-to-WhatsApp Attribution Performance
                </CardTitle>
                <CardDescription className="text-xs">
                  Har ad creative aur video se kitne WhatsApp leads, site visits aur actual sales aayi hain.
                </CardDescription>
              </div>

              <Button
                size="sm"
                onClick={() => setShowNewAdBox(!showNewAdBox)}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Tracked Ad Link</span>
              </Button>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* New Ad Link Box */}
              {showNewAdBox && (
                <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-3">
                  <div className="font-semibold text-xs text-purple-400 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Create New Tracked Click-to-WhatsApp (CTWA) Link
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Campaign Name</Label>
                      <Input
                        value={newCampaignName}
                        onChange={(e) => setNewCampaignName(e.target.value)}
                        placeholder="e.g. Jaipur 3BHK Diwali Video Ad"
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Planned Ad Spend (₹)</Label>
                      <Input
                        value={newAdSpend}
                        onChange={(e) => setNewAdSpend(e.target.value)}
                        placeholder="e.g. 10000"
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowNewAdBox(false)} className="text-xs">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => createAdMutation.mutate()}
                      disabled={!newCampaignName.trim() || createAdMutation.isPending}
                      className="bg-purple-600 text-white text-xs"
                    >
                      Save Campaign
                    </Button>
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-3">Campaign & Ad Creative</th>
                      <th className="p-3">Platform</th>
                      <th className="p-3 text-right">Ad Spend</th>
                      <th className="p-3 text-right">Clicks</th>
                      <th className="p-3 text-right">Enquiries</th>
                      <th className="p-3 text-right">Site Visits</th>
                      <th className="p-3 text-right">Sales Closed</th>
                      <th className="p-3 text-right">Revenue</th>
                      <th className="p-3 text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {adAttributionsList.map((ad) => {
                      const spend = parseFloat(ad.adSpend || "0");
                      const rev = parseFloat(ad.totalRevenue || "0");
                      const roas = spend > 0 ? (rev / spend).toFixed(1) : "0";

                      return (
                        <tr key={ad.id} className="hover:bg-muted/20 transition-all">
                          <td className="p-3">
                            <div className="font-semibold text-foreground">{ad.campaignName}</div>
                            <div className="text-[10px] text-muted-foreground">{ad.adName}</div>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px]">
                              {ad.platform === "ctwa_whatsapp" ? "WhatsApp CTWA" : ad.platform}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-medium">₹{spend.toLocaleString("en-IN")}</td>
                          <td className="p-3 text-right">{ad.clicks}</td>
                          <td className="p-3 text-right text-purple-400 font-semibold">{ad.enquiriesCount}</td>
                          <td className="p-3 text-right text-yellow-500 font-semibold">{ad.appointmentsCount}</td>
                          <td className="p-3 text-right text-emerald-500 font-bold">{ad.salesCount}</td>
                          <td className="p-3 text-right font-bold text-foreground">
                            {rev > 0 ? `₹${(rev / 100000).toFixed(1)}L` : "₹0"}
                          </td>
                          <td className="p-3 text-right">
                            <Badge
                              className={`text-[10px] font-bold ${
                                parseFloat(roas) >= 5
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                  : "bg-blue-500/15 text-blue-500"
                              }`}
                            >
                              {roas}x
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          AI VIDEO GENERATION MODAL
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={videoModalOpen} onOpenChange={setVideoModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Film className="w-4 h-4 text-purple-400" />
              Generate 9:16 AI Video Reel
            </DialogTitle>
            <DialogDescription className="text-xs">
              Is script se automated 9:16 vertical video reel banayein with video cues and hook.
            </DialogDescription>
          </DialogHeader>

          {selectedScriptForVideo && (
            <div className="space-y-4 py-2 text-xs">
              {/* Script Summary */}
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <span className="font-semibold text-foreground block">{selectedScriptForVideo.title}</span>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  <strong>Hook:</strong> {selectedScriptForVideo.hook}
                </p>
                <div className="flex items-center gap-2 pt-1 text-[10px] text-purple-400">
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {selectedScriptForVideo.scriptType.replace("_", " ")}
                  </Badge>
                  <span>•</span>
                  <span>{selectedScriptForVideo.estimatedDuration || "30-45 sec"}</span>
                </div>
              </div>

              {/* Provider Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs">Render Engine</Label>
                <Select value={modalProvider} onValueChange={setModalProvider}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simulator">⚡ Instant Video Simulator (Fast & Ready)</SelectItem>
                    <SelectItem value="heygen">🤖 HeyGen API (Custom Avatar Reel)</SelectItem>
                    <SelectItem value="did">🎭 D-ID API (Presenter AI)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Avatar Style */}
              <div className="space-y-1.5">
                <Label className="text-xs">AI Presenter</Label>
                <Select value={modalAvatarId} onValueChange={setModalAvatarId}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Daisy-in-blazer">👩 Daisy - Corporate Host</SelectItem>
                    <SelectItem value="josh_lite3_20230714">👨 Josh - Modern Consultant</SelectItem>
                    <SelectItem value="Wayne_20240711">👨 Wayne - Senior Luxury Advisor</SelectItem>
                    <SelectItem value="Ann_Doctor_Sitting_public">👩 Ann - Warm Consultant</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-[11px] text-purple-600 dark:text-purple-300">
                ✨ Output: Full HD 9:16 (1080x1920) vertical reel MP4 ready for Instagram, Meta Ads & WhatsApp.
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVideoModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (selectedScriptForVideo) {
                  generateVideoMutation.mutate({
                    scriptId: selectedScriptForVideo.id,
                    provider: modalProvider,
                    avatarId: modalAvatarId,
                    apiKey: brandKit?.videoApiKey,
                  });
                }
              }}
              disabled={generateVideoMutation.isPending}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-xs gap-1.5 font-semibold"
            >
              {generateVideoMutation.isPending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Rendering Video...</span>
                </>
              ) : (
                <>
                  <Film className="w-3.5 h-3.5" />
                  <span>🎬 Render 9:16 Video Now</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
