import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Server,
  HelpCircle,
  ExternalLink,
} from "lucide-react";

interface CompanyEmailSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SmtpSettingsResponse {
  configured: boolean;
  settings: {
    id: string;
    provider: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordSet: boolean;
    fromEmail: string;
    fromName: string;
    replyTo?: string;
    isActive: boolean;
    lastTestedAt?: string;
    updatedAt?: string;
  } | null;
}

const PROVIDER_PRESETS: Record<string, { name: string; host: string; port: number; secure: boolean; note: string }> = {
  gmail: {
    name: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    note: "Use your Google account email and 16-letter Google App Password (not your normal Gmail login password).",
  },
  custom: {
    name: "Custom SMTP (Mailbux / Zoho / Private)",
    host: "my.mailbux.com",
    port: 587,
    secure: false,
    note: "Enter your domain mail server hostname (e.g. my.mailbux.com, smtppro.zoho.com, or mail.yourdomain.com).",
  },
  outlook: {
    name: "Microsoft 365 / Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    note: "Use your Microsoft 365 email and account/app password.",
  },
  sendgrid: {
    name: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    note: "Username is always 'apikey' and password is your SendGrid API key.",
  },
};

export function CompanyEmailSettingsDialog({ open, onOpenChange }: CompanyEmailSettingsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState<string>("gmail");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Test email state
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch current company SMTP settings
  const { data, isLoading } = useQuery<SmtpSettingsResponse>({
    queryKey: ["/api/crm/smtp-settings"],
    enabled: open,
  });

  // Populate form when data is loaded
  useEffect(() => {
    if (data?.settings) {
      setProvider(data.settings.provider || "custom");
      setHost(data.settings.host || "");
      setPort(data.settings.port || 587);
      setSecure(Boolean(data.settings.secure));
      setUsername(data.settings.username || "");
      setPassword(data.settings.passwordSet ? "********" : "");
      setFromEmail(data.settings.fromEmail || "");
      setFromName(data.settings.fromName || "");
      setReplyTo(data.settings.replyTo || "");
      setTestEmail(data.settings.fromEmail || "");
    } else if (data && !data.configured) {
      // Default to Gmail preset for new setup
      setProvider("gmail");
      setHost(PROVIDER_PRESETS.gmail.host);
      setPort(PROVIDER_PRESETS.gmail.port);
      setSecure(PROVIDER_PRESETS.gmail.secure);
      setPassword("");
    }
  }, [data]);

  const handleSelectPreset = (presetKey: string) => {
    setProvider(presetKey);
    const preset = PROVIDER_PRESETS[presetKey];
    if (preset) {
      setHost(preset.host);
      setPort(preset.port);
      setSecure(preset.secure);
      if (presetKey === "sendgrid") {
        setUsername("apikey");
      }
    }
  };

  // Save Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/crm/smtp-settings", {
        provider,
        host,
        port: Number(port),
        secure,
        username,
        password,
        fromEmail,
        fromName,
        replyTo: replyTo || undefined,
        isActive: true,
      });
      return res.json();
    },
    onSuccess: (resData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/smtp-settings"] });
      toast({
        title: "Company Email Saved",
        description: resData.message || "Your custom email configuration is active for all CRM notifications.",
      });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to Save",
        description: err.message || "Could not save company SMTP settings",
        variant: "destructive",
      });
    },
  });

  // Live Test Mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      setTestResult(null);
      const res = await apiRequest("POST", "/api/crm/smtp-settings/test", {
        testEmail,
        provider,
        host,
        port: Number(port),
        secure,
        username,
        password,
        fromEmail,
        fromName,
      });
      return res.json();
    },
    onSuccess: (resData) => {
      setTestResult({
        success: true,
        message: resData.message || `Test email sent to ${testEmail}!`,
      });
      toast({
        title: "Email Test Successful ✅",
        description: `Delivered test email to ${testEmail}`,
      });
    },
    onError: (err: any) => {
      setTestResult({
        success: false,
        message: err.message || "Connection failed. Please check host, port, username, or password.",
      });
      toast({
        title: "Connection Failed ❌",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Delete Mutation (revert to system default)
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/crm/smtp-settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/smtp-settings"] });
      toast({
        title: "Reset to Default",
        description: "Company custom email removed. System default will be used.",
      });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  Company Email & SMTP Setup
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Connect your company's own email gateway so site visits, staff briefings, and client confirmations are sent from your brand.
                </DialogDescription>
              </div>
            </div>
            {data?.configured ? (
              <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[11px] font-semibold gap-1 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-500/30 text-[11px] gap-1 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> Using System Default
              </Badge>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Quick Provider Presets */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Email Provider Preset
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectPreset(key)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      provider === key
                        ? "border-blue-600 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold shadow-xs"
                        : "border-border/60 hover:bg-muted/40 text-muted-foreground hover:text-foreground text-xs"
                    }`}
                  >
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{p.host}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
                <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                {PROVIDER_PRESETS[provider]?.note || "Enter your SMTP server host details."}
              </p>
            </div>

            {/* Sender Branding (Name & Email) */}
            <div className="p-4 bg-muted/30 border border-border/70 rounded-xl space-y-3">
              <div className="text-xs font-bold text-foreground flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-600" />
                1. Sender Branding (What recipients see)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Company / Sender Display Name</Label>
                  <Input
                    placeholder="e.g. DLF Realty Sales Team"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    className="h-9 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">Appears in client inbox as sender name.</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Sender Email Address</Label>
                  <Input
                    type="email"
                    placeholder="e.g. sales@dlfrealty.com"
                    value={fromEmail}
                    onChange={(e) => {
                      setFromEmail(e.target.value);
                      if (!username || username.includes("@")) {
                        setUsername(e.target.value);
                      }
                      if (!testEmail) setTestEmail(e.target.value);
                    }}
                    className="h-9 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">The "From" address recipients will receive mail from.</span>
                </div>
              </div>
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-medium">Reply-To Email Address (Optional)</Label>
                <Input
                  type="email"
                  placeholder="e.g. info@dlfrealty.com (Leave blank to use sender email)"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* SMTP Server Connection Details */}
            <div className="p-4 bg-muted/30 border border-border/70 rounded-xl space-y-3">
              <div className="text-xs font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                2. SMTP Credentials
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium">SMTP Server Host</Label>
                  <Input
                    placeholder="e.g. smtp.gmail.com or my.mailbux.com"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Port</Label>
                  <Input
                    type="number"
                    placeholder="587"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">SMTP Username</Label>
                  <Input
                    placeholder="e.g. sales@dlfrealty.com"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Password / App Password</Label>
                    {provider === "gmail" && (
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        Generate App Password <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder={data?.settings?.passwordSet ? "********" : "Enter email password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 text-xs pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <div className="text-xs">
                  <span className="font-medium text-foreground">SSL / TLS Direct</span>
                  <span className="block text-[11px] text-muted-foreground">Enable for port 465 (SSL). Keep off for port 587 (STARTTLS).</span>
                </div>
                <Switch
                  checked={secure}
                  onCheckedChange={setSecure}
                />
              </div>
            </div>

            {/* Test Connection Box */}
            <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-3">
              <div className="text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center justify-between">
                <span>3. Live Test Email Delivery</span>
                {data?.settings?.lastTestedAt && (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    Last verified: {new Date(data.settings.lastTestedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  placeholder="Enter test email address..."
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="h-9 text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !testEmail}
                  className="h-9 text-xs gap-1.5 border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950 font-medium shrink-0"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {testMutation.isPending ? "Testing..." : "Send Test Email"}
                </Button>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                    testResult.success
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                      : "bg-destructive/10 text-destructive border border-destructive/30"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold block">{testResult.success ? "Success!" : "Connection Error:"}</span>
                    <span className="text-[11px] leading-relaxed">{testResult.message}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t">
          <div>
            {data?.configured && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm("Are you sure you want to delete custom company SMTP and revert to system default?")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset to Default
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !host || !username || !fromEmail || !fromName}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Saving...
                </>
              ) : (
                "Save Company Email Settings"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
