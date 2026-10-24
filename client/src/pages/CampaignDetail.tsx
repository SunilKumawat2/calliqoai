/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, PhoneCall, Download, CheckCircle2, XCircle, Clock, Loader2, TrendingUp, Users, Target, Pause, StopCircle, Play, Flame, ThermometerSun, Snowflake, RefreshCw, RotateCcw, Layers, PhoneForwarded, Sparkles, ThumbsUp, ThumbsDown, AlertTriangle, MessageSquare, Quote, Vote, Landmark, Building, Activity, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from 'react-i18next';
import { AuthStorage } from "@/lib/auth-storage";

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  customFields?: Record<string, any>;
  status: string;
  createdAt: string;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
}

interface Call {
  id: string;
  contactId: string | null;
  status: string;
  duration: number | null;
  startedAt: string | null;
  endedAt: string | null;
  classification: string | null;
  sentiment: string | null;
  aiSummary?: string | null;
  transcript?: string | null;
  phoneNumber?: string | null;
  keyPoints?: string[] | string | null;
  nextActions?: string[] | string | null;
  metadata?: Record<string, any> | null;
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  totalContacts: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  batchJobId: string | null;
  batchJobStatus: string | null;
  retryEnabled: boolean;
  retryMaxAttempts?: number;
  retryIntervalMinutes?: number;
  retryOnNoAnswer?: boolean;
  retryOnBusy?: boolean;
  retryOnFailed?: boolean;
  currentRetryPass?: number;
  batchJobHistory?: Array<{ batchJobId: string; pass: number; contactCount: number; createdAt: string }>;
  autoFollowUpEnabled?: boolean;
}

interface BatchJobStats {
  pending: number;
  scheduled: number;
  dispatched: number;
  in_progress: number;
  completed: number;
  failed: number;
  total: number;
  progress: number;
}

export default function CampaignDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const currentUser = AuthStorage.getUser();
  const isAdmin = currentUser?.role === 'admin';

  const { data: campaign, isLoading: campaignLoading } = useQuery<Campaign>({
    queryKey: [`/api/campaigns/${id}`],
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as Campaign | undefined;
      return data?.status === 'running' || data?.status === 'in-progress' ? 3000 : false;
    },
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: [`/api/campaigns/${id}/contacts`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 5000 : false;
    },
  });

  const { data: calls = [] } = useQuery<Call[]>({
    queryKey: [`/api/campaigns/${id}/calls`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 3000 : false;
    },
  });

  const { data: campaignFollowUps = [] } = useQuery<any[]>({
    queryKey: [`/api/followups?campaignId=${id}`],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/followups?campaignId=${id}`);
      return res.json();
    }
  });

  const [selectedSentimentFilter, setSelectedSentimentFilter] = useState<'negative' | 'positive' | 'parties' | 'all'>('negative');

  const { data: sentimentInsights, isLoading: insightsLoading } = useQuery<any>({
    queryKey: [`/api/campaigns/${id}/sentiment-insights`],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/campaigns/${id}/sentiment-insights`);
      return res.json();
    }
  });

  const analyzeInsightsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/campaigns/${id}/sentiment-insights`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/campaigns/${id}/sentiment-insights`], data);
      toast({
        title: "Voter Sentiment Analysis Complete",
        description: "Public feedback and key political issues have been successfully synthesized.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Analysis Failed",
        description: err?.message || "Could not analyze voter feedback. Please try again.",
        variant: "destructive",
      });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/pause`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignPaused'),
        description: t('campaignDetail.toast.campaignPausedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.pauseFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/resume`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignResumed'),
        description: t('campaignDetail.toast.campaignResumedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.resumeFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignStopped'),
        description: t('campaignDetail.toast.campaignStoppedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.stopFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const cancelBatchMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/batch/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/batch`] });
      toast({
        title: t('campaignDetail.toast.batchCancelled'),
        description: t('campaignDetail.toast.batchCancelledDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('campaignDetail.toast.batchCancelFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const retryBatchMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/batch/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/batch`] });
      toast({
        title: t('campaignDetail.toast.retryInitiated'),
        description: t('campaignDetail.toast.retryInitiatedDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('campaignDetail.toast.retryFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const toggleAutoFollowUpMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", `/api/campaigns/${id}`, { autoFollowUpEnabled: enabled });
      return res.json();
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({
        title: enabled ? "Automated Follow-Up Activated" : "Automated Follow-Up Deactivated",
        description: enabled 
          ? "Callback requests from leads will now be dialed automatically at their scheduled time." 
          : "Automatic calling paused. Callbacks will remain in pending state until triggered manually.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Update Failed",
        description: err.message || "Failed to update follow-up setting",
        variant: "destructive",
      });
    },
  });

  const { data: batchJobData, isLoading: batchLoading } = useQuery<{ batchJob: any; stats: BatchJobStats }>({
    queryKey: [`/api/campaigns/${id}/batch`],
    enabled: !!id && !!campaign?.batchJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.batchJob?.status;
      return status === 'in_progress' || status === 'pending' || status === 'scheduled' ? 5000 : false;
    },
  });

  const handleExportCSV = async () => {
    try {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(`/api/campaigns/${id}/export`, {
        headers
      });

      if (!response.ok) {
        throw new Error("Failed to export campaign");
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `campaign-export-${new Date().toISOString().split('T')[0]}.csv`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t('campaignDetail.toast.exportSuccess'),
        description: t('campaignDetail.toast.exportSuccessDesc'),
      });
    } catch (error) {
      toast({
        title: t('campaignDetail.toast.exportFailed'),
        description: t('campaignDetail.toast.exportFailedDesc'),
        variant: "destructive",
      });
    }
  };

  if (campaignLoading || contactsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setLocation("/app/campaigns")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('campaignDetail.backToCampaigns')}
        </Button>
        <Card className="p-16 text-center">
          <h3 className="text-lg font-semibold mb-2">{t('campaignDetail.notFound')}</h3>
          <p className="text-muted-foreground">{t('campaignDetail.notFoundDesc')}</p>
        </Card>
      </div>
    );
  }

  const progress = campaign.totalContacts > 0 
    ? Math.round((campaign.completedCalls / campaign.totalContacts) * 100)
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">{t('campaignDetail.status.completed')}</Badge>;
      case "in_progress":
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">{t('campaignDetail.status.inProgress')}</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{t('campaignDetail.status.pending')}</Badge>;
      case "scheduled":
        return <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">{t('campaignDetail.status.scheduled')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Return the most-recent call for a contact (retries create additional rows).
  const getLatestCallForContact = (contactId: string) => {
    const contactCalls = calls.filter(c => c.contactId === contactId);
    if (contactCalls.length === 0) return undefined;
    // Sort by createdAt (always set) descending so the most-recent retry row wins.
    // Fall back to startedAt only when createdAt is identical (should not happen in practice).
    return contactCalls.reduce((latest, c) => {
      const latestTime = latest.createdAt ? new Date(latest.createdAt).getTime() : 0;
      const cTime = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      if (cTime !== latestTime) return cTime > latestTime ? c : latest;
      const latestStarted = latest.startedAt ? new Date(latest.startedAt).getTime() : 0;
      const cStarted = c.startedAt ? new Date(c.startedAt).getTime() : 0;
      return cStarted > latestStarted ? c : latest;
    });
  };

  const getCallStatusIcon = (contactId: string) => {
    const call = getLatestCallForContact(contactId);
    if (!call) return <Clock className="h-4 w-4 text-muted-foreground" />;
    
    switch (call.status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "credit_failed":
      case "failed":
      case "no-answer":
      case "busy":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getCallStatus = (contactId: string) => {
    const call = getLatestCallForContact(contactId);
    if (!call) return t('campaignDetail.callStatus.pending');
    
    switch (call.status) {
      case "completed":
        return t('campaignDetail.callStatus.completed');
      case "credit_failed":
        return "Not Billed - Low Credits";
      case "failed":
        return t('campaignDetail.callStatus.failed');
      case "no-answer":
        return t('campaignDetail.callStatus.noAnswer');
      case "busy":
        return t('campaignDetail.callStatus.busy');
      case "in-progress":
      case "ringing":
        return t('campaignDetail.callStatus.inProgress');
      default:
        return call.status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/app/campaigns")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('campaignDetail.backToCampaigns')}
        </Button>
        <div className="flex gap-2">
          {campaign.status === "in-progress" && (
            <Button 
              variant="outline" 
              data-testid="button-pause"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              {pauseMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.pauseCampaign')}
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button 
              variant="outline" 
              data-testid="button-resume"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.resumeCampaign')}
            </Button>
          )}
          {campaign.status === "failed" && (
            <Button 
              variant="outline" 
              data-testid="button-retry"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.retryCampaign', 'Retry Campaign')}
            </Button>
          )}
          {(campaign.status === "in-progress" || campaign.status === "paused" || campaign.status === "pending") && (
            <Button 
              variant="destructive" 
              data-testid="button-stop"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              {stopMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.stopCampaign')}
            </Button>
          )}
          <Button variant="outline" onClick={handleExportCSV} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            {t('campaignDetail.actions.exportCSV')}
          </Button>
          <Button 
            variant="default" 
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={() => setLocation(`/app/crm?campaignId=${campaign.id}`)}
            data-testid="button-view-crm"
          >
            <Users className="h-4 w-4" />
            <span>View Leads in CRM</span>
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold text-foreground">{campaign.name}</h1>
          {campaign.retryEnabled && campaign.currentRetryPass !== undefined && campaign.currentRetryPass > 0 && (
            <Badge
              variant="outline"
              className="bg-orange-500/10 text-orange-600 border-orange-500/30"
              data-testid="badge-retry-pass"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Pass {campaign.currentRetryPass + 1}/{campaign.retryMaxAttempts ?? 3}
            </Badge>
          )}
          {campaign.retryEnabled && contacts.some(c => c.nextRetryAt) && (() => {
            const earliest = contacts
              .filter(c => c.nextRetryAt)
              .map(c => new Date(c.nextRetryAt!).getTime())
              .reduce((min, t) => Math.min(min, t), Infinity);
            return (
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-600 border-blue-500/30"
                data-testid="badge-next-retry-at"
              >
                <Clock className="h-3 w-3 mr-1" />
                Next retry at {format(new Date(earliest), 'h:mm a')}
              </Badge>
            );
          })()}
        </div>
        <p className="text-muted-foreground mt-1">{t('campaignDetail.campaignId')}: {campaign.id}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.status')}</p>
            <div>{getStatusBadge(campaign.status)}</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.totalRecipients')}</p>
            <p className="text-2xl font-semibold">{campaign.totalContacts}</p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.started')}</p>
            <p className="text-sm font-medium">
              {campaign.startedAt ? format(new Date(campaign.startedAt), "MMM d, yyyy 'at' h:mm a") : t('campaignDetail.labels.notStarted')}
            </p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.progress')}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-sm font-medium">{progress}%</span>
            </div>
          </div>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">{t('campaignDetail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">{t('campaignDetail.tabs.analytics')}</TabsTrigger>
          <TabsTrigger value="recipients" data-testid="tab-recipients">{t('campaignDetail.tabs.recipients')}</TabsTrigger>
          <TabsTrigger value="lead-quality" data-testid="tab-lead-quality">{t('campaignDetail.tabs.leadQuality')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6" data-testid="card-successful-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.successfulCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-successful-calls-count">{campaign.successfulCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-success-rate">
                    {campaign.completedCalls > 0 ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100) : 0}% {t('campaignDetail.stats.successRate')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-failed-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <XCircle className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.failedCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-failed-calls-count">{campaign.failedCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-failure-rate">
                    {campaign.completedCalls > 0 ? Math.round((campaign.failedCalls / campaign.completedCalls) * 100) : 0}% {t('campaignDetail.stats.failureRate')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-pending-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <Clock className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.pendingCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-pending-calls-count">{campaign.totalContacts - campaign.completedCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-remaining-percentage">
                    {campaign.totalContacts > 0 ? Math.round(((campaign.totalContacts - campaign.completedCalls) / campaign.totalContacts) * 100) : 0}% {t('campaignDetail.stats.remaining')}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.sections.campaignDetails')}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.campaignType')}</p>
                <p className="font-medium">{campaign.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.status')}</p>
                <div className="mt-1">{getStatusBadge(campaign.status)}</div>
              </div>
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.created')}</p>
                <p className="font-medium">{format(new Date(campaign.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
              </div>
              {campaign.completedAt && (
                <div>
                  <p className="text-muted-foreground">{t('campaignDetail.labels.completedAt')}</p>
                  <p className="font-medium">{format(new Date(campaign.completedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Automated Follow-Up Calls Switch Card */}
          <Card className="p-6 border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-transparent to-transparent">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-amber-500/10 rounded-lg text-amber-500 mt-0.5 shrink-0">
                  <PhoneForwarded className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">Automated Follow-Up Calls</h3>
                    <Badge variant="outline" className={campaign.autoFollowUpEnabled !== false ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}>
                      {campaign.autoFollowUpEnabled !== false ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                    {campaign.autoFollowUpEnabled !== false
                      ? "Active: When a lead requests a callback (e.g., '10 min baad', 'kal 4 baje'), the AI scheduler will automatically call them back at that exact scheduled time with conversation memory."
                      : "Inactive: Callback requests will be recorded in pending state, but automatic calls will NOT be placed until manually triggered."}
                  </p>
                </div>
              </div>
              <Switch
                checked={campaign.autoFollowUpEnabled !== false}
                onCheckedChange={(checked) => toggleAutoFollowUpMutation.mutate(checked)}
                disabled={toggleAutoFollowUpMutation.isPending}
                data-testid="switch-campaign-detail-auto-follow-up"
              />
            </div>
          </Card>

          {campaign.batchJobId && (
            <Card className="p-6" data-testid="card-batch-job-status">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  {t('campaignDetail.batch.title')}
                </h3>
                <div className="flex gap-2">
                  {(batchJobData?.batchJob?.status === 'in_progress' || batchJobData?.batchJob?.status === 'pending' || batchJobData?.batchJob?.status === 'scheduled') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelBatchMutation.mutate()}
                      disabled={cancelBatchMutation.isPending}
                      data-testid="button-cancel-batch"
                    >
                      {cancelBatchMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <StopCircle className="h-4 w-4 mr-2" />
                      )}
                      {t('campaignDetail.batch.cancel')}
                    </Button>
                  )}
                  {(batchJobData?.stats?.failed ?? 0) > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryBatchMutation.mutate()}
                      disabled={retryBatchMutation.isPending}
                      data-testid="button-retry-batch"
                    >
                      {retryBatchMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4 mr-2" />
                      )}
                      {t('campaignDetail.batch.retryFailed')}
                    </Button>
                  )}
                </div>
              </div>

              {batchLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : batchJobData?.batchJob ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.labels.status')}</p>
                      <Badge 
                        variant={
                          batchJobData.batchJob.status === 'completed' ? 'default' :
                          batchJobData.batchJob.status === 'in_progress' ? 'secondary' :
                          batchJobData.batchJob.status === 'failed' ? 'destructive' : 'outline'
                        }
                        className={
                          batchJobData.batchJob.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                          batchJobData.batchJob.status === 'in_progress' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                          ''
                        }
                        data-testid="badge-batch-status"
                      >
                        {batchJobData.batchJob.status === 'in_progress' && (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        )}
                        {batchJobData.batchJob.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.jobId')}</p>
                      <p className="font-mono text-xs" data-testid="text-batch-job-id">
                        {campaign.batchJobId?.slice(0, 12)}...
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.totalCalls')}</p>
                      <p className="font-medium" data-testid="text-batch-total-calls">
                        {batchJobData.stats?.total || batchJobData.batchJob.total_calls_scheduled || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.dispatched')}</p>
                      <p className="font-medium" data-testid="text-batch-dispatched">
                        {batchJobData.batchJob.total_calls_dispatched || 0}
                      </p>
                    </div>
                  </div>

                  {batchJobData.stats && (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t('campaignDetail.labels.progress')}</span>
                          <span className="font-medium" data-testid="text-batch-progress">
                            {batchJobData.stats.progress}%
                          </span>
                        </div>
                        <Progress value={batchJobData.stats.progress} className="h-2" />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-slate-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.pending')}:</span>
                          <span className="font-medium" data-testid="text-batch-pending">
                            {batchJobData.stats.pending}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.scheduled')}:</span>
                          <span className="font-medium" data-testid="text-batch-scheduled">
                            {batchJobData.stats.scheduled}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.inProgress')}:</span>
                          <span className="font-medium" data-testid="text-batch-in-progress">
                            {batchJobData.stats.in_progress}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.completed')}:</span>
                          <span className="font-medium" data-testid="text-batch-completed">
                            {batchJobData.stats.completed}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.failed')}:</span>
                          <span className="font-medium" data-testid="text-batch-failed">
                            {batchJobData.stats.failed}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <p>{t('campaignDetail.batch.unavailable')}</p>
                  <p className="text-xs mt-1">{t('campaignDetail.batch.jobId')}: {campaign.batchJobId}</p>
                </div>
              )}
            </Card>
          )}

          {/* Retry Batch History */}
          {campaign.retryEnabled && campaign.batchJobHistory && campaign.batchJobHistory.length > 0 && (
            <Card className="p-6" data-testid="card-retry-history">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Retry Pass History
              </h3>
              <div className="space-y-2">
                {campaign.batchJobHistory.map((entry, index) => (
                  <div key={entry.batchJobId} className="flex items-center justify-between text-sm py-2 border-b last:border-0" data-testid={`row-batch-history-${index}`}>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        Pass {entry.pass + 1}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{entry.batchJobId?.slice(0, 16)}...</span>
                    </div>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span>{entry.contactCount} contacts</span>
                      <span>{format(new Date(entry.createdAt), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6" data-testid="card-call-performance">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.callPerformance')}</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">{t('campaignDetail.analytics.completionRate')}</span>
                    <span className="font-medium" data-testid="text-completion-rate">
                      {campaign.totalContacts > 0 ? Math.round((campaign.completedCalls / campaign.totalContacts) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${campaign.totalContacts > 0 ? (campaign.completedCalls / campaign.totalContacts) * 100 : 0}%` }}
                      data-testid="progress-completion-rate"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">{t('campaignDetail.analytics.successRate')}</span>
                    <span className="font-medium" data-testid="text-analytics-success-rate">
                      {campaign.completedCalls > 0 ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500" 
                      style={{ width: `${campaign.completedCalls > 0 ? (campaign.successfulCalls / campaign.completedCalls) * 100 : 0}%` }}
                      data-testid="progress-success-rate"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-status-distribution">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.callStatusDistribution')}</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center" data-testid="row-distribution-successful">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.successful')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-successful">{campaign.successfulCalls}</span>
                </div>
                <div className="flex justify-between items-center" data-testid="row-distribution-failed">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.failed')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-failed">{campaign.failedCalls}</span>
                </div>
                <div className="flex justify-between items-center" data-testid="row-distribution-pending">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.pending')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-pending">{campaign.totalContacts - campaign.completedCalls}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6" data-testid="card-lead-quality-distribution">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.leadQualityDistribution')}</h3>
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-red-500" />
                      <span className="text-sm">{t('campaignDetail.leads.hotLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "hot").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-red-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "hot").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <ThermometerSun className="h-4 w-4 text-orange-500" />
                      <span className="text-sm">{t('campaignDetail.leads.warmLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "warm").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "warm").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Snowflake className="h-4 w-4 text-blue-500" />
                      <span className="text-sm">{t('campaignDetail.leads.lostLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "cold" || c.classification === "lost").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "cold" || c.classification === "lost").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-sentiment-distribution">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{t('campaignDetail.analytics.sentimentAnalysis')}</h3>
                <span className="text-xs text-muted-foreground">Click row to filter issues below</span>
              </div>
              <div className="space-y-3">
                <div 
                  onClick={() => setSelectedSentimentFilter('positive')}
                  className={`flex justify-between items-center p-2.5 rounded-lg cursor-pointer transition-all ${selectedSentimentFilter === 'positive' ? 'bg-green-500/20 border border-green-500/40 shadow-sm' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm font-medium">{t('campaignDetail.sentiment.positive')}</span>
                  </div>
                  <span className="font-semibold text-green-500">{calls.filter(c => c.sentiment === "positive").length}</span>
                </div>
                <div 
                  onClick={() => setSelectedSentimentFilter('all')}
                  className={`flex justify-between items-center p-2.5 rounded-lg cursor-pointer transition-all ${selectedSentimentFilter === 'all' ? 'bg-gray-500/20 border border-gray-500/40 shadow-sm' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-gray-500" />
                    <span className="text-sm font-medium">{t('campaignDetail.sentiment.neutral')}</span>
                  </div>
                  <span className="font-semibold text-muted-foreground">{calls.filter(c => c.sentiment === "neutral").length}</span>
                </div>
                <div 
                  onClick={() => setSelectedSentimentFilter('negative')}
                  className={`flex justify-between items-center p-2.5 rounded-lg cursor-pointer transition-all ${selectedSentimentFilter === 'negative' ? 'bg-red-500/20 border border-red-500/40 shadow-sm' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm font-medium">{t('campaignDetail.sentiment.negative')}</span>
                  </div>
                  <span className="font-semibold text-red-500">{calls.filter(c => c.sentiment === "negative").length}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Smart Adaptive Feedback & Sentiment Intelligence */}
          {(() => {
            const cType = sentimentInsights?.campaignType || 'political';
            const audLabel = sentimentInsights?.audienceLabel || (cType === 'real_estate' ? 'Buyer' : cType === 'healthcare' ? 'Patient' : cType === 'general_business' ? 'Customer' : 'Voter');
            const bTitle = sentimentInsights?.badgeTitle || (cType === 'real_estate' ? 'Real Estate Intelligence' : cType === 'healthcare' ? 'Healthcare & Clinic Intelligence' : cType === 'general_business' ? 'Customer Feedback Intelligence' : 'Political Survey Intelligence');
            const mainTitle = cType === 'real_estate' ? 'Buyer Sentiment & Objections Analysis' : cType === 'healthcare' ? 'Patient Feedback & Care Analysis' : cType === 'general_business' ? 'Customer Sentiment & Market Intelligence' : 'Voter Sentiment & Issues Analysis';
            const subtitle = cType === 'real_estate' 
              ? 'ग्राहक प्रतिक्रिया: आपत्तियां (Objections), प्रोजेक्ट खूबियां (Positive Highlights) एवं प्रतिस्पर्धी प्रोजेक्ट्स (Competitors)'
              : cType === 'healthcare'
              ? 'मरीज़ प्रतिक्रिया: मुख्य समस्याएं (Concerns), संतुष्टि के बिंदु (Satisfied Points) एवं सुझाव'
              : cType === 'general_business'
              ? 'ग्राहक प्रतिक्रिया: समस्याएं (Complaints), पसंद की बातें (Praises) एवं विकल्प (Competitor Alternatives)'
              : 'जनता का फीडबैक: मुख्य समस्याएं (Negative Issues), काम जो पसंद आया (Positive Reasons) एवं विपक्षी दल की प्राथमिकता';

            const negTitle = sentimentInsights?.negativeTitle || (cType === 'real_estate' ? 'Customer Objections / आपत्तियां' : cType === 'healthcare' ? 'Patient Concerns / समस्याएं' : cType === 'general_business' ? 'Key Complaints / समस्याएं' : 'Negative Issues / कमियां');
            const posTitle = sentimentInsights?.positiveTitle || (cType === 'real_estate' ? 'What Buyers Liked / खूबियां' : cType === 'healthcare' ? 'Satisfied Feedback / संतुष्टि' : cType === 'general_business' ? 'What Customers Liked / अच्छाई' : 'Positive Highlights / प्रशंसा');
            const altTitle = sentimentInsights?.alternativeTitle || (cType === 'real_estate' ? 'Competitor Projects Considered' : cType === 'healthcare' ? 'Other Clinics Considered' : cType === 'general_business' ? 'Competitor Alternatives' : 'Opposition / Other Parties');
            const summaryTitle = cType === 'real_estate' ? 'Project Market & Buyer Summary:' : cType === 'healthcare' ? 'Clinic & Patient Care Summary:' : cType === 'general_business' ? 'Customer Sentiment Executive Summary:' : 'Constituency Executive Summary:';

            const BadgeIcon = cType === 'real_estate' ? Building : cType === 'healthcare' ? Activity : cType === 'general_business' ? Briefcase : Vote;

            return (
              <Card className="p-6 border border-border/80 shadow-md bg-card/60">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-border/60">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs py-0.5 px-2.5">
                        <BadgeIcon className="h-3.5 w-3.5 mr-1 text-primary inline" /> {bTitle}
                      </Badge>
                      <h3 className="text-xl font-bold tracking-tight text-foreground">
                        {mainTitle}
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {subtitle}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => analyzeInsightsMutation.mutate()}
                      disabled={analyzeInsightsMutation.isPending || calls.filter(c => c.transcript || c.aiSummary).length === 0}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm h-9 px-4 font-medium"
                    >
                      {analyzeInsightsMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing Transcripts...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-1.5 text-yellow-300" />
                          {sentimentInsights ? `Re-Analyze ${audLabel} Feedback` : `Analyze ${audLabel} Sentiment (AI)`}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Executive Summary Banner */}
                {sentimentInsights?.summary && (
                  <div className="mt-5 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex gap-3 items-start">
                    <Sparkles className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-sm">
                      <span className="font-semibold text-blue-400">{summaryTitle}</span>
                      <p className="text-muted-foreground leading-relaxed">{sentimentInsights.summary}</p>
                      {sentimentInsights.generatedAt && (
                        <span className="text-[11px] text-muted-foreground/70 block pt-1">
                          Last synthesized: {format(new Date(sentimentInsights.generatedAt), "MMM d, yyyy 'at' h:mm a")} ({sentimentInsights.totalAnalyzed || 0} calls analyzed)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Filter Navigation Pills */}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button
                    variant={selectedSentimentFilter === 'negative' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedSentimentFilter('negative')}
                    className={`text-xs h-8 rounded-lg ${selectedSentimentFilter === 'negative' ? 'bg-red-600 hover:bg-red-700 text-white' : 'hover:bg-red-500/10 hover:text-red-400'}`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                    {negTitle}
                    <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] bg-red-950/60 text-red-300">
                      {sentimentInsights?.topNegativeIssues?.length ?? calls.filter(c => c.sentiment === 'negative').length}
                    </Badge>
                  </Button>

                  <Button
                    variant={selectedSentimentFilter === 'positive' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedSentimentFilter('positive')}
                    className={`text-xs h-8 rounded-lg ${selectedSentimentFilter === 'positive' ? 'bg-green-600 hover:bg-green-700 text-white' : 'hover:bg-green-500/10 hover:text-green-400'}`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                    {posTitle}
                    <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] bg-green-950/60 text-green-300">
                      {sentimentInsights?.topPositivePoints?.length ?? calls.filter(c => c.sentiment === 'positive').length}
                    </Badge>
                  </Button>

                  <Button
                    variant={selectedSentimentFilter === 'parties' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedSentimentFilter('parties')}
                    className={`text-xs h-8 rounded-lg ${selectedSentimentFilter === 'parties' ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'hover:bg-indigo-500/10 hover:text-indigo-400'}`}
                  >
                    <Landmark className="h-3.5 w-3.5 mr-1.5" />
                    {altTitle}
                    <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] bg-indigo-950/60 text-indigo-300">
                      {sentimentInsights?.alternativePartyPreferences?.length ?? 0}
                    </Badge>
                  </Button>

                  <Button
                    variant={selectedSentimentFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedSentimentFilter('all')}
                    className="text-xs h-8 rounded-lg"
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                    All {audLabel} Calls ({calls.length})
                  </Button>
                </div>

                {/* TAB CONTENT: Negative Issues */}
                {selectedSentimentFilter === 'negative' && (
                  <div className="mt-5 space-y-3">
                    {sentimentInsights?.topNegativeIssues && sentimentInsights.topNegativeIssues.length > 0 ? (
                      sentimentInsights.topNegativeIssues.map((item: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl border border-red-500/25 bg-red-500/5 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                              <h4 className="font-semibold text-base text-red-400">{item.issue}</h4>
                            </div>
                            {item.count && (
                              <Badge variant="outline" className="text-xs border-red-500/30 text-red-400 bg-red-500/10">
                                {item.count} {audLabel.toLowerCase()}{item.count > 1 ? 's' : ''} mentioned
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-foreground/90">{item.description}</p>
                          {item.sampleQuotes && item.sampleQuotes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                <Quote className="h-3 w-3 text-red-400" /> Exact {audLabel} Statements:
                              </span>
                              <div className="space-y-1">
                                {item.sampleQuotes.map((q: string, qIdx: number) => (
                                  <div key={qIdx} className="text-xs italic bg-background/60 p-2.5 rounded-lg border border-border/50 text-foreground/80">
                                    "{q}"
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center border border-dashed rounded-xl space-y-3 bg-muted/20">
                        <div className="mx-auto w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
                          <ThumbsDown className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">Negative Feedback & Objections Deep-Dive</h4>
                          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                            Click "Analyze {audLabel} Sentiment (AI)" above to automatically extract all specific complaints, objections, and reasons {audLabel.toLowerCase()}s mentioned.
                          </p>
                        </div>
                        {calls.filter(c => c.sentiment === 'negative').length > 0 && (
                          <div className="pt-2 text-left space-y-2">
                            <span className="text-xs font-semibold text-muted-foreground">Recorded Negative Calls ({calls.filter(c => c.sentiment === 'negative').length}):</span>
                            {calls.filter(c => c.sentiment === 'negative').map(c => (
                              <div key={c.id} className="text-xs p-3 rounded-lg border bg-card/70 space-y-1">
                                <div className="flex justify-between font-medium text-muted-foreground">
                                  <span>Call ID: {c.id.substring(0, 8)}...</span>
                                  <span className="text-red-400 font-semibold">Negative</span>
                                </div>
                                <p className="text-foreground leading-relaxed">{c.aiSummary || c.transcript || "No transcript recorded"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB CONTENT: Positive Highlights */}
                {selectedSentimentFilter === 'positive' && (
                  <div className="mt-5 space-y-3">
                    {sentimentInsights?.topPositivePoints && sentimentInsights.topPositivePoints.length > 0 ? (
                      sentimentInsights.topPositivePoints.map((item: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl border border-green-500/25 bg-green-500/5 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <ThumbsUp className="h-4 w-4 text-green-500 shrink-0" />
                              <h4 className="font-semibold text-base text-green-400">{item.point}</h4>
                            </div>
                            {item.count && (
                              <Badge variant="outline" className="text-xs border-green-500/30 text-green-400 bg-green-500/10">
                                {item.count} {audLabel.toLowerCase()}{item.count > 1 ? 's' : ''} mentioned
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-foreground/90">{item.description}</p>
                          {item.sampleQuotes && item.sampleQuotes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                <Quote className="h-3 w-3 text-green-400" /> {audLabel} Quotes:
                              </span>
                              <div className="space-y-1">
                                {item.sampleQuotes.map((q: string, qIdx: number) => (
                                  <div key={qIdx} className="text-xs italic bg-background/60 p-2.5 rounded-lg border border-border/50 text-foreground/80">
                                    "{q}"
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center border border-dashed rounded-xl space-y-3 bg-muted/20">
                        <div className="mx-auto w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-400">
                          <ThumbsUp className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">
                            {calls.filter(c => c.sentiment === 'positive').length === 0 ? `No Positive Calls In This Campaign` : "Positive Insights Ready For Analysis"}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                            Click "Analyze {audLabel} Sentiment (AI)" to automatically detect what features, works, and qualities {audLabel.toLowerCase()}s appreciated.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB CONTENT: Opposition / Alternative Party Preferences */}
                {selectedSentimentFilter === 'parties' && (
                  <div className="mt-5 space-y-3">
                    {sentimentInsights?.alternativePartyPreferences && sentimentInsights.alternativePartyPreferences.length > 0 ? (
                      sentimentInsights.alternativePartyPreferences.map((item: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl border border-indigo-500/25 bg-indigo-500/5 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Landmark className="h-4 w-4 text-indigo-400 shrink-0" />
                              <h4 className="font-semibold text-base text-indigo-300">
                                Preferred Alternative: <span className="text-indigo-200 underline underline-offset-4">{item.party}</span>
                              </h4>
                            </div>
                            <Badge variant="outline" className="text-xs border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
                              {cType === 'political' ? 'Opposition Lean' : 'Competitor Mention'}
                            </Badge>
                          </div>
                          <div className="text-sm text-foreground/90">
                            <span className="font-medium text-indigo-300">Reason / Why they prefer them: </span>
                            {item.reason}
                          </div>
                          {item.sampleQuotes && item.sampleQuotes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                <Quote className="h-3 w-3 text-indigo-400" /> {audLabel} Statement:
                              </span>
                              <div className="space-y-1">
                                {item.sampleQuotes.map((q: string, qIdx: number) => (
                                  <div key={qIdx} className="text-xs italic bg-background/60 p-2.5 rounded-lg border border-border/50 text-foreground/80">
                                    "{q}"
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center border border-dashed rounded-xl space-y-3 bg-muted/20">
                        <div className="mx-auto w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                          <Landmark className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">Alternative & Competitor Analysis</h4>
                          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                            Click "Analyze {audLabel} Sentiment (AI)" above to scan which competitors or alternative choices {audLabel.toLowerCase()}s mentioned and why.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB CONTENT: All Calls Transcripts */}
                {selectedSentimentFilter === 'all' && (
                  <div className="mt-5 space-y-3">
                    {calls.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No calls recorded yet for this campaign.</p>
                    ) : (
                      calls.map((c, idx) => (
                        <div key={c.id || idx} className="p-4 rounded-xl border border-border bg-card/60 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs font-mono">
                                Call #{idx + 1}
                              </Badge>
                              <Badge 
                                variant="outline"
                                className={`text-xs ${
                                  c.sentiment === 'positive' 
                                    ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                    : c.sentiment === 'negative' 
                                    ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                                    : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                }`}
                              >
                                {c.sentiment || 'neutral'}
                              </Badge>
                              {c.classification && (
                                <Badge variant="secondary" className="text-xs capitalize">
                                  {c.classification}
                                </Badge>
                              )}
                            </div>
                            {c.duration && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {Math.floor(c.duration / 60)}m {c.duration % 60}s
                              </span>
                            )}
                          </div>

                          {c.aiSummary && (
                            <p className="text-sm text-foreground/90 bg-muted/30 p-2.5 rounded-lg border border-border/40">
                              <span className="font-semibold text-xs text-muted-foreground block mb-0.5">AI Summary:</span>
                              {c.aiSummary}
                            </p>
                          )}

                          {c.transcript && (
                            <div className="text-xs text-muted-foreground max-h-36 overflow-y-auto space-y-1 bg-background/50 p-2.5 rounded-lg border border-border/40 font-sans leading-relaxed whitespace-pre-wrap">
                              {c.transcript}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Key Actionable Takeaways */}
                {sentimentInsights?.keyTakeaways && sentimentInsights.keyTakeaways.length > 0 && (
                  <div className="mt-5 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
                    <span className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-purple-400" /> Strategic Takeaways for Campaign Team:
                    </span>
                    <ul className="text-xs space-y-1.5 text-foreground/90 list-disc list-inside">
                      {sentimentInsights.keyTakeaways.map((point: string, pIdx: number) => (
                        <li key={pIdx} className="leading-relaxed">{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })()}
        </TabsContent>

        <TabsContent value="recipients">
          <Card>
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold">{t('campaignDetail.recipients.title')}</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaignDetail.recipients.phoneNumber')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.name')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.email')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.language')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.city')}</TableHead>
                    <TableHead>{t('campaignDetail.labels.status')}</TableHead>
                    {campaign?.retryEnabled && <TableHead>Attempts</TableHead>}
                    <TableHead>{t('campaignDetail.recipients.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => {
                    const call = getLatestCallForContact(contact.id);
                    return (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.phone}</TableCell>
                        <TableCell>
                          {contact.firstName && contact.firstName.toLowerCase() !== 'unknown'
                            ? `${contact.firstName} ${contact.lastName || ""}`.trim()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{contact.email || "—"}</TableCell>
                        <TableCell>
                          {contact.customFields?.language ? (
                            <Badge variant="outline" className="text-xs">
                              {contact.customFields.language === "en" && t('campaignDetail.languages.english')}
                              {contact.customFields.language === "hi" && t('campaignDetail.languages.hindi')}
                              {contact.customFields.language === "es" && t('campaignDetail.languages.spanish')}
                              {contact.customFields.language === "fr" && t('campaignDetail.languages.french')}
                              {contact.customFields.language === "de" && t('campaignDetail.languages.german')}
                              {contact.customFields.language === "it" && t('campaignDetail.languages.italian')}
                              {contact.customFields.language === "pt" && t('campaignDetail.languages.portuguese')}
                              {contact.customFields.language === "ja" && t('campaignDetail.languages.japanese')}
                              {contact.customFields.language === "ko" && t('campaignDetail.languages.korean')}
                              {contact.customFields.language === "zh" && t('campaignDetail.languages.chinese')}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.customFields?.city || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getCallStatusIcon(contact.id)}
                            <span className="text-sm">{getCallStatus(contact.id)}</span>
                          </div>
                        </TableCell>
                        {campaign?.retryEnabled && (
                          <TableCell data-testid={`text-attempts-${contact.id}`}>
                            <span className="text-sm text-muted-foreground">
                              {Math.min(Math.max(0, (contact.attemptCount ?? 1) - 1), campaign.retryMaxAttempts ?? 1)}
                              {campaign.retryMaxAttempts ? `/${campaign.retryMaxAttempts}` : ''}
                            </span>
                            {contact.nextRetryAt && (
                              <span className="block text-xs text-orange-500">
                                Retry scheduled
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          {call && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setLocation(`/app/calls/${call.id}`)}
                              data-testid={`button-view-call-${contact.id}`}
                            >
                              <PhoneCall className="h-4 w-4 mr-2" />
                              {t('common.view')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {contacts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={campaign?.retryEnabled ? 8 : 7} className="text-center text-muted-foreground py-8">
                        {t('campaignDetail.recipients.noContacts')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="lead-quality" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-5" data-testid="card-hot-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <Flame className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.hotLeads', 'Hot Leads')}</p>
                  <p className="text-2xl font-semibold text-red-500" data-testid="text-hot-leads-count">
                    {calls.filter(c => (c.classification || (c.metadata as any)?.leadClassification) === "hot").length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => (c.classification || (c.metadata as any)?.leadClassification) === "hot").length / calls.length) * 100) : 0}% of calls
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5" data-testid="card-warm-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-500/10 rounded-lg">
                  <ThermometerSun className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.warmLeads', 'Warm Leads')}</p>
                  <p className="text-2xl font-semibold text-orange-500" data-testid="text-warm-leads-count">
                    {calls.filter(c => (c.classification || (c.metadata as any)?.leadClassification) === "warm").length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => (c.classification || (c.metadata as any)?.leadClassification) === "warm").length / calls.length) * 100) : 0}% of calls
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5" data-testid="card-lost-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Snowflake className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.lostLeads', 'Cold / Lost')}</p>
                  <p className="text-2xl font-semibold text-blue-500" data-testid="text-lost-leads-count">
                    {calls.filter(c => {
                      const cls = c.classification || (c.metadata as any)?.leadClassification;
                      return cls === "cold" || cls === "lost";
                    }).length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => {
                      const cls = c.classification || (c.metadata as any)?.leadClassification;
                      return cls === "cold" || cls === "lost";
                    }).length / calls.length) * 100) : 0}% of calls
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5" data-testid="card-total-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-500/10 rounded-lg">
                  <Target className="h-6 w-6 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Qualified</p>
                  <p className="text-2xl font-semibold text-emerald-500">
                    {calls.filter(c => {
                      const cls = c.classification || (c.metadata as any)?.leadClassification;
                      return cls === "hot" || cls === "warm" || cls === "cold" || cls === "lost";
                    }).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Captured by AI</p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="text-lg font-semibold">{t('campaignDetail.leads.classificationDetails', 'Lead Classification & Captured Details')}</h3>
                <p className="text-sm text-muted-foreground">Dynamic lead details and AI qualification captured across all campaign contacts</p>
              </div>
              <Button 
                variant="default" 
                onClick={handleExportCSV} 
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-sm gap-2"
                data-testid="button-download-leads-csv"
              >
                <Download className="h-4 w-4" />
                Download Leads CSV
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold">{t('campaignDetail.leads.contact', 'Contact')}</TableHead>
                    <TableHead className="font-semibold">{t('campaignDetail.leads.phone', 'Phone')}</TableHead>
                    <TableHead className="font-semibold">{t('campaignDetail.leads.classification', 'Classification')}</TableHead>
                    <TableHead className="font-semibold">Requirement / Topic</TableHead>
                    <TableHead className="font-semibold">Captured Details</TableHead>
                    <TableHead className="font-semibold">{t('campaignDetail.leads.sentiment', 'Sentiment')}</TableHead>
                    <TableHead className="font-semibold">{t('campaignDetail.leads.callDuration', 'Duration')}</TableHead>
                    <TableHead className="font-semibold text-right">{t('campaignDetail.recipients.actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls
                    .filter(call => {
                      const cls = call.classification || (call.metadata as any)?.leadClassification;
                      return cls === "hot" || cls === "warm" || cls === "cold" || cls === "lost" || call.aiSummary;
                    })
                    .map((call) => {
                      const contact = contacts.find(c => c.id === call.contactId);
                      const meta = (call.metadata as Record<string, any>) || {};
                      const cls = call.classification || meta.leadClassification;
                      const customerName = meta.customerName || (contact && contact.firstName && contact.firstName.toLowerCase() !== 'unknown'
                        ? `${contact.firstName} ${contact.lastName || ""}`.trim()
                        : (contact?.phone || call.phoneNumber || "—"));
                      const serviceReq = meta.serviceOrRequirement || meta.requirement || meta.propertyType;
                      const leadDetails = meta.leadDetails && typeof meta.leadDetails === 'object' ? meta.leadDetails : null;

                      const followUp = campaignFollowUps.find((fu: any) => fu.callId === call.id || (contact && fu.contactId === contact.id) || (contact && fu.phoneNumber === contact.phone) || fu.phoneNumber === call.phoneNumber);

                      return (
                        <TableRow key={call.id} data-testid={`row-lead-${call.id}`} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-1">
                              <span className="font-medium text-foreground">{customerName}</span>
                              {contact?.email && (
                                <span className="text-xs text-muted-foreground">{contact.email}</span>
                              )}
                              {followUp && (
                                <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 text-[10px] font-medium w-fit gap-1">
                                  <span>⏰ Follow-up:</span>
                                  <strong>{followUp.preferredTimeText || (followUp.status === 'completed' ? 'Completed' : 'Scheduled')}</strong>
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {contact?.phone || call.phoneNumber || meta.phoneNumber || "—"}
                          </TableCell>
                          <TableCell>
                            {cls === "hot" && (
                              <Badge className="bg-red-500/10 text-red-500 border-red-500/20 font-medium">
                                <Flame className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.hot', 'Hot 🔥')}
                              </Badge>
                            )}
                            {cls === "warm" && (
                              <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 font-medium">
                                <ThermometerSun className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.warm', 'Warm')}
                              </Badge>
                            )}
                            {(cls === "cold" || cls === "lost") && (
                              <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 font-medium">
                                <Snowflake className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.lost', 'Cold / Lost')}
                              </Badge>
                            )}
                            {!cls && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">Completed</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {serviceReq ? (
                              <span className="font-medium text-xs text-primary bg-primary/10 px-2 py-1 rounded-md inline-block">
                                {serviceReq}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            {leadDetails && Object.keys(leadDetails).length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 py-1">
                                {Object.entries(leadDetails).slice(0, 3).map(([key, val]) => (
                                  <span key={key} className="text-[11px] bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/50">
                                    <strong className="font-medium">{key}:</strong> {String(val)}
                                  </span>
                                ))}
                                {Object.keys(leadDetails).length > 3 && (
                                  <span className="text-[10px] text-muted-foreground self-center">
                                    +{Object.keys(leadDetails).length - 3} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground truncate block max-w-[220px]">
                                {call.aiSummary || "—"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {call.sentiment && (
                              <Badge 
                                variant="outline" 
                                className={`text-xs capitalize ${
                                  call.sentiment === 'positive' ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5' :
                                  call.sentiment === 'negative' ? 'border-red-500/30 text-red-500 bg-red-500/5' : ''
                                }`}
                              >
                                {call.sentiment}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setLocation(`/app/calls/${call.id}`)}
                              data-testid={`button-view-lead-call-${call.id}`}
                              className="hover:bg-primary/10 hover:text-primary"
                            >
                              <PhoneCall className="h-4 w-4 mr-1.5" />
                              View Call
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {calls.filter(c => {
                    const cls = c.classification || (c.metadata as any)?.leadClassification;
                    return cls === "hot" || cls === "warm" || cls === "cold" || cls === "lost" || c.aiSummary;
                  }).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Target className="h-8 w-8 text-muted-foreground/50 mb-1" />
                          <p className="font-medium text-foreground">{t('campaignDetail.leads.noClassifiedLeads', 'No classified leads yet.')}</p>
                          <p className="text-xs text-muted-foreground">Complete calls in this campaign to see AI lead qualifications and dynamic details.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
