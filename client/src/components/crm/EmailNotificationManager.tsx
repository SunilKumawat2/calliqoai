import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Send,
  Save,
  RotateCcw,
  Sparkles,
  Server,
  CheckCircle2,
  AlertCircle,
  Eye,
  Code2,
  Copy,
  Check,
  UserCheck,
  Users,
  Settings,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { CompanyEmailSettingsDialog } from "./CompanyEmailSettingsDialog";

export interface EmailTemplateItem {
  key: string;
  name: string;
  description: string;
  recipientType: string;
  variables: string[];
  defaultSubject: string;
  defaultHtmlBody: string;
  subject: string;
  htmlBody: string;
  isActive: boolean;
  isCustomized: boolean;
  updatedAt: string | null;
}

interface SmtpSettingsResponse {
  configured: boolean;
  settings: {
    id: string;
    provider: string;
    host: string;
    port: number;
    username: string;
    fromEmail: string;
    fromName: string;
    isActive: boolean;
    lastTestedAt?: string;
  } | null;
}

export function EmailNotificationManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [smtpDialogOpen, setSmtpDialogOpen] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("staff_site_visit_assignment");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [testEmail, setTestEmail] = useState("");
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  // Form states per template
  const [editedSubjects, setEditedSubjects] = useState<Record<string, string>>({});
  const [editedHtml, setEditedHtml] = useState<Record<string, string>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Fetch SMTP settings
  const { data: smtpData, isLoading: smtpLoading } = useQuery<SmtpSettingsResponse>({
    queryKey: ["/api/crm/smtp-settings"],
  });

  // 2. Fetch Templates
  const { data: templatesData, isLoading: templatesLoading } = useQuery<{ success: boolean; templates: EmailTemplateItem[] }>({
    queryKey: ["/api/crm/email-templates"],
  });

  const templates = templatesData?.templates || [];
  const currentTemplate = templates.find((t) => t.key === selectedTemplateKey) || templates[0];

  // Current values (either edited or from server)
  const currentSubject = currentTemplate
    ? editedSubjects[currentTemplate.key] ?? currentTemplate.subject
    : "";
  const currentHtml = currentTemplate
    ? editedHtml[currentTemplate.key] ?? currentTemplate.htmlBody
    : "";

  // Mutation: Save Template
  const saveMutation = useMutation({
    mutationFn: async ({ key, subject, htmlBody }: { key: string; subject: string; htmlBody: string }) => {
      const res = await apiRequest("PUT", `/api/crm/email-templates/${key}`, { subject, htmlBody });
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/email-templates"] });
      toast({
        title: "✅ Template Saved",
        description: data.message || "Your custom email template has been saved and is now active.",
      });
      // Clear edited state for this key so it uses fresh server data
      setEditedSubjects((prev) => {
        const next = { ...prev };
        delete next[variables.key];
        return next;
      });
      setEditedHtml((prev) => {
        const next = { ...prev };
        delete next[variables.key];
        return next;
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Save Template", description: err.message, variant: "destructive" });
    },
  });

  // Mutation: Reset Template
  const resetMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", `/api/crm/email-templates/${key}/reset`);
      return res.json();
    },
    onSuccess: (data, key) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/email-templates"] });
      setEditedSubjects((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setEditedHtml((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast({
        title: "🔄 Template Reset",
        description: data.message || "Restored factory default template.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Reset", description: err.message, variant: "destructive" });
    },
  });

  // Mutation: Send Test Preview
  const testMutation = useMutation({
    mutationFn: async ({ key, testEmail, subject, htmlBody }: { key: string; testEmail: string; subject: string; htmlBody: string }) => {
      const res = await apiRequest("POST", `/api/crm/email-templates/${key}/test`, {
        testEmail,
        subject,
        htmlBody,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "📧 Test Email Sent!",
        description: data.message || `Check your inbox at ${testEmail}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Test Send Failed", description: err.message, variant: "destructive" });
    },
  });

  // Handle inserting variable into textarea
  const handleInsertVariable = (varName: string) => {
    const tag = `{{${varName}}}`;
    if (textareaRef.current) {
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = currentHtml;
      const updated = val.substring(0, start) + tag + val.substring(end);
      if (currentTemplate) {
        setEditedHtml((prev) => ({ ...prev, [currentTemplate.key]: updated }));
      }
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 50);
    } else {
      // Fallback copy to clipboard
      navigator.clipboard.writeText(tag);
      setCopiedVar(varName);
      setTimeout(() => setCopiedVar(null), 2000);
      toast({ title: "Copied Tag", description: `Copied ${tag} to clipboard. You can paste it into the editor.` });
    }
  };

  // Generate preview HTML with sample values
  const getPreviewHtml = (rawHtml: string) => {
    const sampleVars: Record<string, string> = {
      staff_name: "Rahul Verma",
      client_name: "Rohan Sharma",
      client_phone: "+91 98765 43210",
      client_email: "rohan.sharma@example.com",
      project_name: "DLF Cyber Heights (3BHK Luxury Residences)",
      service_name: "DLF Cyber Heights 3BHK",
      visit_date: "Saturday, Oct 24, 2026",
      visit_time: "11:30 AM",
      assigned_consultant_name: "Rahul Verma",
      assigned_consultant_phone: "+91 98765 43210",
      assigned_consultant_role: "Senior Property Consultant",
      notes: "Looking for 3BHK East facing, budget 2.5 - 3.2 Cr. High-floor priority.",
      admin_instructions: "Customer requested parking demo and clubhouse tour. Keep physical floor brochure ready.",
      company_name: smtpData?.settings?.fromName || "ABC Real Estate",
    };

    let result = rawHtml;
    for (const [k, v] of Object.entries(sampleVars)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "gi"), v);
    }
    return result;
  };

  const isConfigured = smtpData?.configured;
  const isDirty = currentTemplate && (
    (editedSubjects[currentTemplate.key] !== undefined && editedSubjects[currentTemplate.key] !== currentTemplate.subject) ||
    (editedHtml[currentTemplate.key] !== undefined && editedHtml[currentTemplate.key] !== currentTemplate.htmlBody)
  );

  return (
    <div className="space-y-6">
      {/* ── Top SMTP Status Banner ── */}
      <Card className="bg-slate-900/90 border-slate-800 shadow-xl overflow-hidden">
        <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 bg-gradient-to-r from-blue-950/30 via-slate-900 to-indigo-950/20">
          <div className="flex items-center gap-4">
            <div className={`p-3.5 rounded-xl border ${isConfigured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
              <Server className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-white tracking-tight">Admin Email & SMTP Connection</h3>
                {isConfigured ? (
                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1.5 py-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    Connected & Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-500/30 flex items-center gap-1.5 py-0.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                    Custom SMTP Not Connected
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {isConfigured ? (
                  <span>
                    Sending via <strong className="text-slate-200">{smtpData?.settings?.fromName}</strong> &lt;{smtpData?.settings?.fromEmail}&gt; on <code className="text-blue-400">{smtpData?.settings?.host}:{smtpData?.settings?.port}</code>
                  </span>
                ) : (
                  "Connect your company email (Gmail, Google Workspace, Zoho, or Custom Domain) to send branded site visit & lead emails from your own domain."
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button
              onClick={() => setSmtpDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-500/20 text-xs px-4 py-2 h-9"
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              {isConfigured ? "Manage SMTP Credentials" : "Connect Email Credentials"}
            </Button>
          </div>
        </div>

        {/* Quick feature overview pills */}
        <div className="p-4 bg-slate-950/40 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
            <UserCheck className="h-4 w-4 text-blue-400 shrink-0" />
            <span><strong>Sales Staff Alert:</strong> Auto-briefing on site visit deploy</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
            <Users className="h-4 w-4 text-emerald-400 shrink-0" />
            <span><strong>Client Confirmation:</strong> Auto-confirmation with consultant info</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
            <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
            <span><strong>Dynamic Variables:</strong> Auto-fills client name, date, time & notes</span>
          </div>
        </div>
      </Card>

      {/* ── Main Template Editor Card ── */}
      <Card className="bg-slate-900/90 border-slate-800 shadow-xl overflow-hidden">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-400" />
                  Dynamic Email Templates
                </CardTitle>
                {currentTemplate?.isCustomized ? (
                  <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[11px]">
                    Customized by Admin
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-800 text-slate-400 border-slate-700 text-[11px]">
                    Factory Default
                  </Badge>
                )}
              </div>
              <CardDescription className="text-slate-400 text-xs mt-1">
                Customize the email subject lines, greeting text, and HTML layout. Real data will be substituted into tags automatically.
              </CardDescription>
            </div>

            {/* Template Selector Tabs */}
            <div className="flex items-center gap-2">
              <Tabs
                value={selectedTemplateKey}
                onValueChange={(val) => {
                  setSelectedTemplateKey(val);
                  setViewMode("edit");
                }}
                className="w-full sm:w-auto"
              >
                <TabsList className="bg-slate-950 border border-slate-800 p-1">
                  {templates.map((tpl) => (
                    <TabsTrigger
                      key={tpl.key}
                      value={tpl.key}
                      className="text-xs data-[state=active]:bg-blue-600 data-[state=active]:text-white font-medium px-3 py-1.5"
                    >
                      {tpl.key === "staff_site_visit_assignment" ? (
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5" />
                          Sales Staff Briefing
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Client Confirmation
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-5">
          {templatesLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-2" />
              <p className="text-xs">Loading email templates...</p>
            </div>
          ) : currentTemplate ? (
            <>
              {/* Template Meta Banner */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Target Recipient:</span>
                    <strong className="text-blue-400 font-semibold">{currentTemplate.recipientType}</strong>
                  </div>
                  <p className="text-slate-400 mt-0.5">{currentTemplate.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("edit")}
                      className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === "edit" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === "preview" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Live Preview
                    </button>
                  </div>
                </div>
              </div>

              {/* Dynamic Variables Pill Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    Click to Insert Dynamic Variables:
                  </Label>
                  <span className="text-[11px] text-slate-500">Auto-filled with live customer & visit details</span>
                </div>
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  {currentTemplate.variables.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleInsertVariable(v)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-900 hover:bg-blue-600/30 text-blue-300 hover:text-blue-200 border border-slate-800 hover:border-blue-500/50 transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
                      title={`Click to insert {{${v}}} into template`}
                    >
                      {copiedVar === v ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <span className="text-blue-400/70">+</span>
                      )}
                      <span>&#123;&#123;{v}&#125;&#125;</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject Line Field */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300">
                  Email Subject Line:
                </Label>
                <Input
                  value={currentSubject}
                  onChange={(e) => {
                    setEditedSubjects((prev) => ({
                      ...prev,
                      [currentTemplate.key]: e.target.value,
                    }));
                  }}
                  className="bg-slate-950 border-slate-800 text-white font-mono text-xs focus:border-blue-500 h-9"
                  placeholder="e.g. New Site Visit Assigned: {{client_name}} - {{project_name}}"
                />
              </div>

              {/* Content Mode: Edit (Textarea) or Preview (Iframe / Safe container) */}
              {viewMode === "edit" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-300">
                      HTML Email Layout & Content:
                    </Label>
                    <span className="text-[11px] text-slate-500">Supports standard HTML, CSS styles, &amp; {"{{variable}}"} tags</span>
                  </div>
                  <Textarea
                    ref={textareaRef}
                    value={currentHtml}
                    onChange={(e) => {
                      setEditedHtml((prev) => ({
                        ...prev,
                        [currentTemplate.key]: e.target.value,
                      }));
                    }}
                    rows={16}
                    className="bg-slate-950 border-slate-800 text-slate-200 font-mono text-xs leading-relaxed focus:border-blue-500 resize-y"
                    placeholder="Enter HTML template here..."
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5 text-blue-400" />
                      Live Visual Email Preview:
                    </Label>
                    <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-800">
                      Sample Data Simulated
                    </Badge>
                  </div>
                  <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-100 p-4">
                    <div className="max-w-[620px] mx-auto bg-white rounded-lg shadow-md p-2">
                      <div className="text-xs font-mono text-slate-500 border-b pb-2 mb-3">
                        <strong>Subject:</strong> {interpolateVariables(currentSubject, {
                          client_name: "Rohan Sharma",
                          project_name: "DLF Cyber Heights Luxury Residences",
                          visit_date: "Oct 24, 2026",
                          visit_time: "11:30 AM",
                        })}
                      </div>
                      <iframe
                        srcDoc={getPreviewHtml(currentHtml)}
                        title="Email Preview"
                        className="w-full h-[480px] border-0 rounded bg-white"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Action Toolbar */}
              <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                {/* Test Email Section */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="Enter your email to test..."
                    className="bg-slate-950 border-slate-800 text-xs text-white h-9 w-full sm:w-64"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!testEmail || testMutation.isPending}
                    onClick={() => {
                      testMutation.mutate({
                        key: currentTemplate.key,
                        testEmail: testEmail.trim(),
                        subject: currentSubject,
                        htmlBody: currentHtml,
                      });
                    }}
                    className="border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs h-9 shrink-0"
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Send className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                    )}
                    Send Test Preview
                  </Button>
                </div>

                {/* Save & Reset Buttons */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={resetMutation.isPending}
                    onClick={() => {
                      if (confirm(`Reset ${currentTemplate.name} back to factory default?`)) {
                        resetMutation.mutate(currentTemplate.key);
                      }
                    }}
                    className="text-slate-400 hover:text-white hover:bg-slate-800 text-xs h-9"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Reset to Default
                  </Button>

                  <Button
                    type="button"
                    disabled={saveMutation.isPending || (!isDirty && !currentTemplate.isCustomized)}
                    onClick={() => {
                      saveMutation.mutate({
                        key: currentTemplate.key,
                        subject: currentSubject,
                        htmlBody: currentHtml,
                      });
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs h-9 shadow-lg shadow-emerald-600/20 px-4"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Save Template Changes
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 text-center py-6">No templates available</p>
          )}
        </CardContent>
      </Card>

      {/* SMTP Settings Dialog */}
      <CompanyEmailSettingsDialog
        open={smtpDialogOpen}
        onOpenChange={setSmtpDialogOpen}
      />
    </div>
  );
}
