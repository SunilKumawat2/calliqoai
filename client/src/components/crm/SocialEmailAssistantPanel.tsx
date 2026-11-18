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
  Share2,
  Mail,
  Sparkles,
  Send,
  Save,
  Loader2,
  MessageCircle,
  CheckCircle2,
  Clock,
  Brain,
  UserPlus,
  Copy,
  FileText,
  History,
} from "lucide-react";

export function SocialLeadCaptureSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState({
    enabled: true,
    instagramDmEnabled: true,
    instagramCommentEnabled: true,
    facebookMessengerEnabled: true,
    facebookCommentEnabled: true,
    commentTriggerKeywords: "price, details, pp, interested, brochure, info, book, visit, cost, dm, link",
    autoReplyToComments: true,
    autoSendDmOnComment: true,
    autoCreateCrmLead: true,
    metaPageAccessToken: "",
    instagramAccountId: "",
    facebookPageId: "",
    webhookVerifyToken: "calliqo_social_verify_token",
    metaAppSecret: "",
    brochureUrl: "",
    defaultCommentReply:
      "Thank you for your interest! We have just sent you the complete details & brochure in your DM. Please check your inbox!",
    customQualificationPrompt:
      "Qualify the prospect warmly, share the brochure/pricing details if requested, and politely ask for their WhatsApp phone number and preferred date/time so our team or AI assistant can schedule their consultation/site visit.",
  });

  const [simPlatform, setSimPlatform] = useState<
    "instagram_comment" | "instagram_dm" | "facebook_comment" | "facebook_dm"
  >("instagram_comment");
  const [simHandle, setSimHandle] = useState("@rohit_verma_official");
  const [simName, setSimName] = useState("Rohit Verma");
  const [simPostTitle, setSimPostTitle] = useState("Luxury 3 BHK Residences — Sector 62 Launch Reel");
  const [simText, setSimText] = useState(
    "Interested! Please share price list and brochure. My WhatsApp number is +919876501234"
  );
  const [lastResult, setLastResult] = useState<any | null>(null);

  const { data: savedConfig } = useQuery<any>({
    queryKey: ["/api/sales-team/social-lead-capture-config"],
  });

  const { data: logs = [], refetch: refetchLogs } = useQuery<any[]>({
    queryKey: ["/api/sales-team/social-lead-capture-logs"],
  });

  useEffect(() => {
    if (savedConfig) setConfig((prev) => ({ ...prev, ...savedConfig }));
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("PUT", "/api/sales-team/social-lead-capture-config", payload);
      return res.json();
    },
    onSuccess: (data) => {
      setConfig(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/social-lead-capture-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/social-lead-capture/webhook-status"] });
      toast({
        title: "Social Media Lead Capture Settings Saved",
        description: "Instagram & Facebook DM/Comment lead capture rules are active.",
      });
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/social-lead-capture/simulate", {
        platform: simPlatform,
        senderHandle: simHandle,
        senderName: simName,
        postOrReelTitle: simPostTitle,
        incomingText: simText,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLastResult(data?.event || null);
      refetchLogs();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads/ai-kanban"] });
      toast({
        title: "Social Media Lead Captured into CRM!",
        description: `${data?.event?.senderName} (${data?.event?.platform?.replace("_", " ")}) qualified as ${(
          data?.event?.category || "hot"
        ).toUpperCase()} (Score: ${data?.event?.leadScore}/100).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to process social event", description: err.message, variant: "destructive" });
    },
  });

  const { data: webhookStatus, refetch: refetchWebhookStatus } = useQuery<any>({
    queryKey: ["/api/sales-team/social-lead-capture/webhook-status"],
    refetchInterval: 15000,
  });

  const webhookUrl =
    webhookStatus?.webhookUrl || `${window.location.origin}/api/webhooks/meta-social`;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Card className="border-pink-500/30 bg-gradient-to-r from-pink-500/10 via-purple-500/5 to-transparent">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="p-2 rounded-lg bg-pink-500/15 text-pink-600 dark:text-pink-400">
                  <Share2 className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold tracking-tight">
                  Instagram & Facebook DM / Comment Lead Capture
                </h2>
                <Badge
                  variant="outline"
                  className={
                    config.enabled
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {config.enabled ? "Auto-Capture Active" : "Paused"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-3xl">
                Automatically detects keywords in Instagram Reel/Post comments, Instagram DMs, Facebook comments, and Messenger chats — replies publicly, sends a personalized AI DM with your brochure, extracts contact details, and converts the user directly into a qualified CRM Lead.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-lg border">
                <Label htmlFor="social-capture-toggle" className="text-xs font-semibold cursor-pointer">
                  Auto-Capture Social Leads
                </Label>
                <Switch
                  id="social-capture-toggle"
                  checked={config.enabled}
                  onCheckedChange={(checked) => {
                    setConfig((p) => ({ ...p, enabled: checked }));
                    saveMutation.mutate({ ...config, enabled: checked });
                  }}
                />
              </div>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(config)}
                disabled={saveMutation.isPending}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1.5" />
                )}
                Save Settings
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/50">
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Total Social Leads Captured</p>
              <p className="text-xl font-bold text-pink-600 dark:text-pink-400">{logs.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Instagram DMs & Comments</p>
              <p className="text-xl font-bold">
                {logs.filter((l) => String(l.platform).startsWith("instagram")).length}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Facebook DMs & Comments</p>
              <p className="text-xl font-bold">
                {logs.filter((l) => String(l.platform).startsWith("facebook")).length}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Leads with Phone Extracted</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {logs.filter((l) => Boolean(l.extractedPhone)).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Live Social Lead Capture Simulator + Captured Leads Log */}
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-pink-500" />
                Interactive Instagram / Facebook DM & Comment Lead Capture Simulator
              </CardTitle>
              <CardDescription className="text-xs">
                Test how an Instagram Reel comment, Instagram DM, or Facebook message is automatically replied to by AI and converted into a CRM Lead.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Social Channel</Label>
                  <Select value={simPlatform} onValueChange={(v: any) => setSimPlatform(v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram_comment">Instagram Reel / Post Comment</SelectItem>
                      <SelectItem value="instagram_dm">Instagram Direct Message (DM)</SelectItem>
                      <SelectItem value="facebook_comment">Facebook Page Post Comment</SelectItem>
                      <SelectItem value="facebook_dm">Facebook Messenger DM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">User Handle / ID</Label>
                  <Input
                    className="h-9 text-xs"
                    value={simHandle}
                    onChange={(e) => setSimHandle(e.target.value)}
                    placeholder="@username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Full Name</Label>
                  <Input
                    className="h-9 text-xs"
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    placeholder="Rohit Verma"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Post / Reel / Ad Campaign Title</Label>
                <Input
                  className="h-9 text-xs"
                  value={simPostTitle}
                  onChange={(e) => setSimPostTitle(e.target.value)}
                  placeholder="Luxury 3 BHK Residences — Launch Reel"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Incoming Comment or DM Text</Label>
                  <span className="text-[11px] text-muted-foreground">Quick scenarios:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      setSimPlatform("instagram_comment");
                      setSimText(
                        "Price please! Interested in 3 BHK. My WhatsApp number is +919876501234"
                      );
                    }}
                  >
                    IG Reel Comment + Phone
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      setSimPlatform("instagram_dm");
                      setSimText(
                        "Hi, I saw your Instagram ad. Can you send me the brochure PDF and book a visit this Saturday?"
                      );
                    }}
                  >
                    IG DM Brochure Inquiry
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      setSimPlatform("facebook_dm");
                      setSimText(
                        "Hello, please share complete package details on my email rohit.verma@gmail.com and call me on +919812345678"
                      );
                    }}
                  >
                    FB Messenger Lead
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => simulateMutation.mutate()}
                  disabled={simulateMutation.isPending || !simHandle.trim() || !simText.trim()}
                  className="bg-pink-600 hover:bg-pink-700 text-white"
                >
                  {simulateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-1.5" />
                  )}
                  Capture Social Lead & Generate AI Reply
                </Button>
              </div>

              {lastResult && (
                <div className="p-4 rounded-xl border bg-muted/30 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-pink-600 text-white uppercase text-[10px]">
                        {lastResult.platform?.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        CRM Category: {lastResult.category} ({lastResult.leadScore}/100)
                      </Badge>
                      {lastResult.extractedPhone && (
                        <Badge variant="secondary" className="text-[10px]">
                          Phone: {lastResult.extractedPhone}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Saved to CRM Leads
                    </Badge>
                  </div>

                  {lastResult.publicCommentReply && (
                    <div className="p-2.5 rounded-lg bg-card border">
                      <p className="font-semibold text-[11px] text-muted-foreground mb-0.5">
                        Public Comment Auto-Reply:
                      </p>
                      <p>{lastResult.publicCommentReply}</p>
                    </div>
                  )}

                  <div className="p-2.5 rounded-lg bg-pink-500/10 border border-pink-500/20">
                    <p className="font-semibold text-[11px] text-pink-600 dark:text-pink-400 mb-0.5">
                      Automated Private DM Sent by AI:
                    </p>
                    <p className="whitespace-pre-wrap">{lastResult.aiDmReply}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Captured Social Media Leads */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  Captured Social Media Leads & Auto-Replies
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {logs.length} Captured
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No social media leads captured yet. Run the simulator above or connect your Meta Page/Instagram webhook.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {logs.slice(0, 15).map((item) => (
                    <div key={item.id} className="p-3 rounded-lg border bg-card text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {item.senderName} ({item.senderHandle})
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {item.platform?.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {item.extractedPhone && (
                            <Badge variant="secondary" className="text-[10px]">
                              {item.extractedPhone}
                            </Badge>
                          )}
                          <Badge className="bg-emerald-600 text-white text-[10px] uppercase">
                            {item.category} ({item.leadScore})
                          </Badge>
                        </div>
                      </div>
                      {item.postOrReelTitle && (
                        <p className="text-[11px] text-muted-foreground">
                          Post/Reel: <span className="text-foreground">{item.postOrReelTitle}</span>
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        <strong className="text-foreground">Comment/DM:</strong> "{item.incomingText}"
                      </p>
                      <p className="text-pink-600 dark:text-pink-400">
                        <strong>AI DM Reply:</strong> {item.aiDmReply}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 5 cols: Social Capture Configuration */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Instagram & Facebook Automation Settings</CardTitle>
              <CardDescription className="text-xs">
                Configure comment trigger keywords, auto-DM rules, brochure link, and Meta Graph API credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <div className="p-2.5 rounded-lg bg-muted/50 border space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold">Meta Social Webhook Callback URL</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast({ title: "Webhook URL copied" });
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground break-all">{webhookUrl}</p>
                <div className="flex items-center justify-between pt-1">
                  <Label className="text-[11px] font-semibold">Verify Token</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(config.webhookVerifyToken || "");
                      toast({ title: "Verify token copied" });
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground break-all">{config.webhookVerifyToken}</p>
                <p className="text-[10px] text-muted-foreground pt-1">
                  Meta Developer App → Webhooks: subscribe <b>Instagram</b> (messages, comments) and <b>Page</b> (messages, feed) to this URL.
                </p>
              </div>

              {/* Live connection status */}
              <div className="p-2.5 rounded-lg border bg-card space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold">Live Connection Status</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={() => refetchWebhookStatus()}
                  >
                    Refresh
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className={
                      webhookStatus?.tokenConfigured
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]"
                        : "bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]"
                    }
                  >
                    {webhookStatus?.tokenConfigured ? "Page Token Saved" : "Page Token Missing"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      webhookStatus?.facebookPageId || webhookStatus?.instagramAccountId
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]"
                        : "bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]"
                    }
                  >
                    {webhookStatus?.facebookPageId || webhookStatus?.instagramAccountId
                      ? "Page / IG ID Saved"
                      : "Page / IG ID Missing"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {webhookStatus?.appSecretConfigured ? "Signature Check ON" : "Signature Check OFF"}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Last live event:{" "}
                  {webhookStatus?.lastWebhookReceivedAt
                    ? new Date(webhookStatus.lastWebhookReceivedAt).toLocaleString()
                    : "No live Instagram/Facebook event received yet"}
                </p>
                {Array.isArray(webhookStatus?.recentActivity) && webhookStatus.recentActivity.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {webhookStatus.recentActivity.slice(0, 8).map((a: any, i: number) => (
                      <div key={i} className="text-[10px] p-1.5 rounded border bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">
                            {String(a.platform).replace("_", " ")} · {a.sender}
                          </span>
                          <span
                            className={
                              a.status === "processed"
                                ? "text-emerald-600"
                                : a.status === "error"
                                ? "text-red-600"
                                : "text-muted-foreground"
                            }
                          >
                            {a.status}
                          </span>
                        </div>
                        <p className="text-muted-foreground truncate">"{a.text}"</p>
                        {a.status === "processed" && (
                          <p className="text-muted-foreground">
                            Comment reply: {a.commentReplySent ? "✓" : "—"} · DM: {a.dmSent ? "✓" : "—"}
                          </p>
                        )}
                        {(a.reason || a.deliveryError) && (
                          <p className="text-amber-600">{a.reason || a.deliveryError}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Meta Page Access Token (Required for live replies)</Label>
                <Input
                  type="password"
                  className="h-8 text-xs"
                  value={config.metaPageAccessToken}
                  onChange={(e) => setConfig((p) => ({ ...p, metaPageAccessToken: e.target.value }))}
                  placeholder="EAAG..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Meta App Secret (Recommended)</Label>
                  <Input
                    type="password"
                    className="h-8 text-xs"
                    value={(config as any).metaAppSecret || ""}
                    onChange={(e) => setConfig((p) => ({ ...p, metaAppSecret: e.target.value }))}
                    placeholder="App Secret for signature check"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Webhook Verify Token</Label>
                  <Input
                    className="h-8 text-xs"
                    value={config.webhookVerifyToken}
                    onChange={(e) => setConfig((p) => ({ ...p, webhookVerifyToken: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <span className="text-xs font-medium">Instagram DMs</span>
                  <Switch
                    checked={config.instagramDmEnabled}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, instagramDmEnabled: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <span className="text-xs font-medium">IG Reel Comments</span>
                  <Switch
                    checked={config.instagramCommentEnabled}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, instagramCommentEnabled: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <span className="text-xs font-medium">FB Messenger</span>
                  <Switch
                    checked={config.facebookMessengerEnabled}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, facebookMessengerEnabled: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                  <span className="text-xs font-medium">FB Post Comments</span>
                  <Switch
                    checked={config.facebookCommentEnabled}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, facebookCommentEnabled: v }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Comment Trigger Keywords (Comma-separated)</Label>
                <Input
                  className="h-8 text-xs"
                  value={config.commentTriggerKeywords}
                  onChange={(e) => setConfig((p) => ({ ...p, commentTriggerKeywords: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Brochure / Offer Link Sent in Auto-DM</Label>
                <Input
                  className="h-8 text-xs"
                  value={config.brochureUrl}
                  onChange={(e) => setConfig((p) => ({ ...p, brochureUrl: e.target.value }))}
                  placeholder="https://example.com/brochure.pdf"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Default Public Comment Reply</Label>
                <Textarea
                  rows={2}
                  className="text-xs"
                  value={config.defaultCommentReply}
                  onChange={(e) => setConfig((p) => ({ ...p, defaultCommentReply: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">AI Private DM Qualification Instructions</Label>
                <Textarea
                  rows={2}
                  className="text-xs"
                  value={config.customQualificationPrompt}
                  onChange={(e) => setConfig((p) => ({ ...p, customQualificationPrompt: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Instagram Account ID (Optional)</Label>
                  <Input
                    className="h-8 text-xs"
                    value={config.instagramAccountId}
                    onChange={(e) => setConfig((p) => ({ ...p, instagramAccountId: e.target.value }))}
                    placeholder="1784140..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Facebook Page ID (Optional)</Label>
                  <Input
                    className="h-8 text-xs"
                    value={config.facebookPageId}
                    onChange={(e) => setConfig((p) => ({ ...p, facebookPageId: e.target.value }))}
                    placeholder="1049281..."
                  />
                </div>
              </div>

              <Button
                className="w-full bg-pink-600 hover:bg-pink-700 text-white"
                onClick={() => saveMutation.mutate(config)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Social Capture Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function EmailAssistantSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState<any>({
    enabled: true,
    senderDisplayName: "",
    replyToEmail: "",
    signatureText: "Best Regards,\nSales & Advisory Team",
    brochureUrl: "",
    bookingLink: "",
    autoEnrollHotLeads: true,
    autoEnrollWarmLeads: true,
    useCrossChannelMemory: true,
    autoSequenceEnabled: false,
    autoSequenceEnabledAt: null,
    sequences: [],
  });

  // Draft Composer State
  const [recipientName, setRecipientName] = useState("Sunil Kumawat");
  const [recipientEmail, setRecipientEmail] = useState("snk90790@gmail.com");
  const [recipientPhone, setRecipientPhone] = useState("+917023088303");
  const [purpose, setPurpose] = useState("Step 1: Instant Call/Chat Recap & Brochure Email");
  const [customNotes, setCustomNotes] = useState(
    "Customer spoke with our AI voice assistant and booked a site visit tomorrow at 4:00 PM."
  );

  const [activeDraftId, setActiveDraftId] = useState<string | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const { data: savedConfig } = useQuery<any>({
    queryKey: ["/api/sales-team/email-assistant-config"],
  });

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: ["/api/sales-team/email-assistant-drafts"],
  });

  const { data: enrollments = [], refetch: refetchEnrollments } = useQuery<any[]>({
    queryKey: ["/api/sales-team/email-assistant/sequence-enrollments"],
    refetchInterval: 30000,
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/email-assistant/sequence-enroll", {
        recipientName,
        recipientEmail,
        recipientPhone,
      });
      return res.json();
    },
    onSuccess: (data) => {
      refetchEnrollments();
      refetchDrafts();
      toast({
        title: "Enrolled in Follow-up Sequence",
        description: `${data?.recipientEmail} enrolled (Step 1 sends immediately if enabled).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to enroll", description: err.message, variant: "destructive" });
    },
  });

  const stopEnrollmentMutation = useMutation({
    mutationFn: async (enrollmentId: string) => {
      const res = await apiRequest("POST", `/api/sales-team/email-assistant/sequence-stop/${enrollmentId}`);
      return res.json();
    },
    onSuccess: () => {
      refetchEnrollments();
      toast({ title: "Sequence Stopped" });
    },
  });

  const runSequenceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/email-assistant/sequence-run-now");
      return res.json();
    },
    onSuccess: (data) => {
      refetchEnrollments();
      refetchDrafts();
      toast({
        title: "Sequence Check Complete",
        description: `Sent: ${data?.sent || 0}, Failed: ${data?.failed || 0}`,
      });
    },
  });

  useEffect(() => {
    if (savedConfig) setConfig((prev: any) => ({ ...prev, ...savedConfig }));
  }, [savedConfig]);

  const saveConfigMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("PUT", "/api/sales-team/email-assistant-config", payload);
      return res.json();
    },
    onSuccess: (data) => {
      setConfig(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/email-assistant-config"] });
      toast({
        title: "Email Assistant Settings Saved",
        description: "Automated follow-up sequence templates and signature settings updated.",
      });
    },
  });

  const generateDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/email-assistant/generate-draft", {
        recipientName,
        recipientEmail,
        recipientPhone,
        purpose,
        customNotes,
      });
      return res.json();
    },
    onSuccess: (draft) => {
      setActiveDraftId(draft.id);
      setSubject(draft.subject);
      setBody(draft.body);
      refetchDrafts();
      toast({
        title: "AI Email Draft Generated!",
        description: draft.usedCallAndChatMemory
          ? "Personalized using customer's prior Phone Call & WhatsApp Chat memory."
          : "AI follow-up email draft is ready to review and send.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate draft", description: err.message, variant: "destructive" });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/email-assistant/send-email", {
        draftId: activeDraftId,
        recipientName,
        recipientEmail,
        subject,
        body,
        purpose,
      });
      return res.json();
    },
    onSuccess: (data) => {
      refetchDrafts();
      if (data?.success) {
        toast({
          title: "Email Sent Successfully!",
          description: `Follow-up email delivered to ${recipientEmail}.`,
        });
      } else {
        toast({
          title: "Email Delivery Error",
          description: data?.error || "Check SMTP configuration",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to send email", description: err.message, variant: "destructive" });
    },
  });

  const sentCount = drafts.filter((d) => d.status === "sent").length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Card className="border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-blue-500/5 to-transparent">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                  <Mail className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold tracking-tight">
                  AI Email Assistant — Automated Follow-up Sequences & Personalized Drafts
                </h2>
                <Badge
                  variant="outline"
                  className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                >
                  SMTP & AI Composer Ready
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-3xl">
                Generates personalized follow-up email drafts using past Phone Call & WhatsApp conversations, manages multi-step drip sequences (0h Welcome, 24h Value Follow-up, 72h Consultation Invite), and dispatches live emails directly to leads.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/50">
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Active Sequence Steps</p>
              <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                {(config.sequences || []).filter((s: any) => s.enabled).length} Steps
              </p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">AI Email Drafts Generated</p>
              <p className="text-xl font-bold">{drafts.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Emails Sent via SMTP</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{sentCount}</p>
            </div>
            <div className="p-3 rounded-lg bg-card/80 border">
              <p className="text-[11px] text-muted-foreground font-medium">Memory-Enriched Emails</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                {drafts.filter((d) => d.usedCallAndChatMemory).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: AI Email Draft Composer & Live Sender */}
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                AI Follow-up Email Draft Generator & Live Sender
              </CardTitle>
              <CardDescription className="text-xs">
                Generate a personalized follow-up email enriched with the customer's Voice Call & WhatsApp memory, then send it immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Customer Name</Label>
                  <Input
                    className="h-9 text-xs"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Sunil Kumawat"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Recipient Email Address</Label>
                  <Input
                    className="h-9 text-xs"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Customer Phone (For Call Memory)</Label>
                  <Input
                    className="h-9 text-xs"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    placeholder="+917023088303"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sequence Stage / Email Purpose</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Step 1: Instant Call/Chat Recap & Brochure Email">
                        Step 1: Instant Call/Chat Recap & Brochure Email
                      </SelectItem>
                      <SelectItem value="Step 2: 24-Hour Value & FAQ Follow-up">
                        Step 2: 24-Hour Value & FAQ Follow-up
                      </SelectItem>
                      <SelectItem value="Step 3: 72-Hour Priority Consultation / Site Visit Invite">
                        Step 3: 72-Hour Priority Consultation / Site Visit Invite
                      </SelectItem>
                      <SelectItem value="Custom Proposal & Pricing Quotation">
                        Custom Proposal & Pricing Quotation
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Additional Context / Offer Note</Label>
                  <Input
                    className="h-9 text-xs"
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    placeholder="Optional context for AI..."
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => generateDraftMutation.mutate()}
                  disabled={generateDraftMutation.isPending || !recipientEmail.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {generateDraftMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1.5" />
                  )}
                  Generate AI Email Draft (Using Call & Chat Memory)
                </Button>
              </div>

              {/* Editable Subject & Body Preview */}
              <div className="pt-2 border-t space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Email Subject Line</Label>
                  <Input
                    className="text-xs font-medium"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Click 'Generate AI Email Draft' above or type subject..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email Body (Editable before sending)</Label>
                  <Textarea
                    rows={7}
                    className="text-xs leading-relaxed"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Generated AI email content will appear here..."
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => sendEmailMutation.mutate()}
                    disabled={
                      sendEmailMutation.isPending ||
                      !recipientEmail.trim() ||
                      !subject.trim() ||
                      !body.trim()
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {sendEmailMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-1.5" />
                    )}
                    Send Live Email Now to {recipientEmail || "Recipient"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Drafts & Sent History */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  Recent AI Email Drafts & Sent Sequence History
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {drafts.length} Emails
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {drafts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No email drafts generated yet. Click "Generate AI Email Draft" above to create and send your first email.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {drafts.slice(0, 15).map((d) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-lg border bg-card text-xs space-y-1 cursor-pointer hover:bg-muted/30"
                      onClick={() => {
                        setActiveDraftId(d.id);
                        setRecipientName(d.recipientName);
                        setRecipientEmail(d.recipientEmail);
                        if (d.recipientPhone) setRecipientPhone(d.recipientPhone);
                        setSubject(d.subject);
                        setBody(d.body);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {d.recipientName} ({d.recipientEmail})
                        </span>
                        <div className="flex items-center gap-1.5">
                          {d.usedCallAndChatMemory && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600">
                              Call+Chat Memory
                            </Badge>
                          )}
                          <Badge
                            className={
                              d.status === "sent"
                                ? "bg-emerald-600 text-white text-[10px]"
                                : "bg-amber-500/20 text-amber-600 border-amber-500/30 text-[10px]"
                            }
                          >
                            {d.status === "sent" ? "SENT" : "DRAFT"}
                          </Badge>
                        </div>
                      </div>
                      <p className="font-medium text-foreground">{d.subject}</p>
                      <p className="text-muted-foreground line-clamp-2">{d.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 5 cols: Multi-Step Automated Follow-up Sequence Configuration */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Automated Email Follow-up Sequences</CardTitle>
              <CardDescription className="text-xs">
                Configure multi-step email follow-up cadences and sender signature settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Master switch for automatic background sequences */}
              <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">Automatic Email Sequences</p>
                    <p className="text-[10px] text-muted-foreground">
                      New Hot/Warm CRM leads with an email are auto-enrolled. Steps are sent on schedule; the sequence stops when an appointment is booked.
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(config.autoSequenceEnabled)}
                    onCheckedChange={(v) => setConfig((p: any) => ({ ...p, autoSequenceEnabled: v }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between p-2 rounded border bg-card">
                    <span className="text-[11px]">Auto-enroll Hot</span>
                    <Switch
                      checked={config.autoEnrollHotLeads !== false}
                      onCheckedChange={(v) => setConfig((p: any) => ({ ...p, autoEnrollHotLeads: v }))}
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded border bg-card">
                    <span className="text-[11px]">Auto-enroll Warm</span>
                    <Switch
                      checked={config.autoEnrollWarmLeads !== false}
                      onCheckedChange={(v) => setConfig((p: any) => ({ ...p, autoEnrollWarmLeads: v }))}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {config.autoSequenceEnabled && config.autoSequenceEnabledAt
                    ? `ON since ${new Date(config.autoSequenceEnabledAt).toLocaleString()} — only leads created after this time are auto-enrolled.`
                    : "OFF — turn ON and click Save to start automatic follow-ups (existing old leads are never emailed automatically)."}
                </p>
              </div>

              <div className="space-y-2">
                {(config.sequences || []).map((step: any, idx: number) => (
                  <div key={step.id || idx} className="p-3 rounded-lg border bg-card space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {step.delayHours === 0 ? "Immediate (0h)" : `+${step.delayHours} Hours`}
                        </Badge>
                        <span className="text-xs font-semibold">{step.name}</span>
                      </div>
                      <Switch
                        checked={step.enabled !== false}
                        onCheckedChange={(v) => {
                          const next = [...(config.sequences || [])];
                          next[idx] = { ...next[idx], enabled: v };
                          setConfig((p: any) => ({ ...p, sequences: next }));
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">{step.instructions}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Brochure / Catalog URL</Label>
                  <Input
                    className="h-8 text-xs"
                    value={config.brochureUrl || ""}
                    onChange={(e) => setConfig((p: any) => ({ ...p, brochureUrl: e.target.value }))}
                    placeholder="https://example.com/brochure.pdf"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Booking / Calendar Link</Label>
                  <Input
                    className="h-8 text-xs"
                    value={config.bookingLink || ""}
                    onChange={(e) => setConfig((p: any) => ({ ...p, bookingLink: e.target.value }))}
                    placeholder="https://calliqoai.com/book"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Email Signature</Label>
                <Textarea
                  rows={3}
                  className="text-xs"
                  value={config.signatureText || ""}
                  onChange={(e) => setConfig((p: any) => ({ ...p, signatureText: e.target.value }))}
                />
              </div>

              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => saveConfigMutation.mutate(config)}
                disabled={saveConfigMutation.isPending}
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Email Sequence Settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Active Sequence Enrollments</CardTitle>
                  <CardDescription className="text-xs">
                    Leads enrolled in automated follow-up steps (Step 1 → 0h, Step 2 → +24h, Step 3 → +72h).
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => runSequenceMutation.mutate()}
                  disabled={runSequenceMutation.isPending}
                >
                  {runSequenceMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  Run Due Now
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => enrollMutation.mutate()}
                disabled={enrollMutation.isPending || !recipientEmail}
              >
                {enrollMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                )}
                Enroll Current Recipient ({recipientEmail || "—"}) in Sequence
              </Button>

              {enrollments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  No leads enrolled in email sequences yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {enrollments.slice(0, 20).map((enr: any) => (
                    <div key={enr.id} className="p-2.5 rounded-lg border bg-card text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate">
                          {enr.recipientName} ({enr.recipientEmail})
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant="outline"
                            className={
                              enr.status === "active"
                                ? "text-[10px] border-indigo-500/40 text-indigo-600"
                                : enr.status === "completed"
                                ? "text-[10px] border-emerald-500/40 text-emerald-600"
                                : "text-[10px] text-muted-foreground"
                            }
                          >
                            {enr.status}
                          </Badge>
                          {enr.status === "active" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[10px] text-red-600"
                              onClick={() => stopEnrollmentMutation.mutate(enr.id)}
                            >
                              Stop
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Steps completed: {(enr.stepLogs || []).filter((l: any) => l.status === "sent").length} ·{" "}
                        {enr.status === "active" && enr.nextDueAt
                          ? `Next Step ${enr.nextStepNumber} due ${new Date(enr.nextDueAt).toLocaleString()}`
                          : enr.stopReason || "All steps finished"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
