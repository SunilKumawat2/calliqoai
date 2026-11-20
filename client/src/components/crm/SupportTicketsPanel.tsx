import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Headset, AlertTriangle, CheckCircle2, Clock, PhoneCall, MessageSquare, 
  Share2, UserCheck, Search, Filter, Plus, RefreshCw, Send, Trash2, 
  ChevronRight, ArrowUpRight, ShieldCheck, Zap, Sparkles, Building2, Flame
} from "lucide-react";

interface SupportTicket {
  id: string;
  ticketNumber: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  channel: string;
  sourceId?: string | null;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  subject: string;
  description?: string | null;
  aiSummary?: string | null;
  sentiment?: string | null;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  assignedStaffPhone?: string | null;
  assignedStaffEmail?: string | null;
  escalated: boolean;
  escalatedAt?: string | null;
  escalationSentWhatsapp?: boolean;
  escalationSentEmail?: boolean;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
  resolutionSource?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface SupportMetrics {
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  escalatedCount: number;
  aiAutoResolvedCount: number;
  humanResolvedCount: number;
  aiResolutionRate: number;
  totalCustomerQueries: number;
  avgResolutionHours: number;
  categoryBreakdown: Record<string, number>;
  channelBreakdown: Record<string, number>;
  urgentPendingCount: number;
}

interface StaffMember {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
}

export function SupportTicketsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters & State
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals state
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState<boolean>(false);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);

  // New Ticket Form State
  const [newTicketForm, setNewTicketForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    channel: "manual",
    category: "service_complaint",
    priority: "high",
    subject: "",
    description: "",
    assignedStaffId: "none",
    sendAlertNow: true,
  });

  // Update Ticket Form State
  const [updateForm, setUpdateForm] = useState<{
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: string;
    assignedStaffId: string;
    resolutionNotes: string;
  }>({
    status: "open",
    priority: "medium",
    category: "service_complaint",
    assignedStaffId: "none",
    resolutionNotes: "",
  });

  // 1. Fetch Tickets
  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } = useQuery<{
    tickets: SupportTicket[];
    total: number;
    openCount: number;
  }>({
    queryKey: [
      "/api/support-tickets",
      { status: statusFilter, priority: priorityFilter, category: categoryFilter, channel: channelFilter, search: searchQuery },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (priorityFilter !== "all") params.append("priority", priorityFilter);
      if (categoryFilter !== "all") params.append("category", categoryFilter);
      if (channelFilter !== "all") params.append("channel", channelFilter);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());
      const res = await apiRequest("GET", `/api/support-tickets?${params.toString()}`);
      return res.json();
    },
  });

  // 2. Fetch Resolution Rate & Metrics
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery<SupportMetrics>({
    queryKey: ["/api/support-tickets/metrics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support-tickets/metrics");
      return res.json();
    },
  });

  // 3. Fetch Staff Members
  const { data: staffList = [] } = useQuery<StaffMember[]>({
    queryKey: ["/api/support-tickets/staff/list"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support-tickets/staff/list");
      return res.json();
    },
  });

  // 4. Create Ticket Mutation
  const createTicketMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerName: newTicketForm.customerName.trim(),
        customerPhone: newTicketForm.customerPhone.trim(),
        customerEmail: newTicketForm.customerEmail.trim() || undefined,
        channel: newTicketForm.channel,
        category: newTicketForm.category,
        priority: newTicketForm.priority,
        subject: newTicketForm.subject.trim(),
        description: newTicketForm.description.trim() || undefined,
        assignedStaffId: newTicketForm.assignedStaffId !== "none" ? newTicketForm.assignedStaffId : undefined,
        escalated: newTicketForm.sendAlertNow,
      };
      const res = await apiRequest("POST", "/api/support-tickets", payload);
      return res.json();
    },
    onSuccess: (data: SupportTicket) => {
      toast({
        title: `Ticket #${data.ticketNumber} Created!`,
        description: newTicketForm.sendAlertNow
          ? "Ticket saved & instant escalation alert sent to staff/manager."
          : "Support ticket logged successfully.",
      });
      setCreateDialogOpen(false);
      setNewTicketForm({
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        channel: "manual",
        category: "service_complaint",
        priority: "high",
        subject: "",
        description: "",
        assignedStaffId: "none",
        sendAlertNow: true,
      });
      refetchTickets();
      refetchMetrics();
      queryClient.invalidateQueries({ queryKey: ["/api/support-tickets"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create ticket", description: err.message, variant: "destructive" });
    },
  });

  // 5. Update Ticket Mutation
  const updateTicketMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) return;
      const payload = {
        status: updateForm.status,
        priority: updateForm.priority,
        category: updateForm.category,
        assignedStaffId: updateForm.assignedStaffId !== "none" ? updateForm.assignedStaffId : null,
        resolutionNotes: updateForm.resolutionNotes.trim() || undefined,
      };
      const res = await apiRequest("PATCH", `/api/support-tickets/${selectedTicket.id}`, payload);
      return res.json();
    },
    onSuccess: (updated: SupportTicket) => {
      toast({
        title: `Ticket #${updated.ticketNumber} Updated!`,
        description: updated.status === "resolved" ? "Ticket marked as Resolved." : "Ticket updated successfully.",
      });
      setUpdateDialogOpen(false);
      setSelectedTicket(null);
      refetchTickets();
      refetchMetrics();
      queryClient.invalidateQueries({ queryKey: ["/api/support-tickets"] });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  // 6. 1-Click Re-Escalate Mutation
  const escalateMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      setEscalatingId(ticketId);
      const res = await apiRequest("POST", `/api/support-tickets/${ticketId}/escalate`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "⚡ Escalation Alert Dispatched!",
        description: data.message || "Instant WhatsApp and Email alerts sent to staff & manager.",
      });
      refetchTickets();
      refetchMetrics();
    },
    onError: (err: any) => {
      toast({ title: "Escalation Failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setEscalatingId(null),
  });

  // 7. Delete Ticket Mutation
  const deleteMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      const res = await apiRequest("DELETE", `/api/support-tickets/${ticketId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ticket Deleted", description: "Support ticket removed." });
      refetchTickets();
      refetchMetrics();
    },
    onError: (err: any) => {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleOpenUpdate = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setUpdateForm({
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      assignedStaffId: ticket.assignedStaffId || "none",
      resolutionNotes: ticket.resolutionNotes || "",
    });
    setUpdateDialogOpen(true);
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "urgent":
        return <Badge className="bg-red-500/20 text-red-600 border border-red-500/30 text-[10px] gap-1 font-bold animate-pulse"><Flame className="w-3 h-3 text-red-500" /> Urgent</Badge>;
      case "high":
        return <Badge className="bg-orange-500/15 text-orange-600 border border-orange-500/30 text-[10px] gap-1 font-semibold"><AlertTriangle className="w-3 h-3 text-orange-500" /> High</Badge>;
      case "medium":
        return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px] font-medium">Medium</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] text-muted-foreground">Low</Badge>;
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case "open":
        return <Badge className="bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 text-[10px] font-semibold">Open</Badge>;
      case "in_progress":
        return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-semibold">In Progress</Badge>;
      case "resolved":
        return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] gap-1 font-semibold"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Resolved</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">Closed</Badge>;
    }
  };

  const getChannelIcon = (ch: string) => {
    switch (ch) {
      case "voice_call":
        return <PhoneCall className="w-3.5 h-3.5 text-blue-500" title="Voice Call" />;
      case "whatsapp":
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-500" title="WhatsApp Bot" />;
      case "instagram_dm":
      case "facebook_dm":
        return <Share2 className="w-3.5 h-3.5 text-purple-500" title="Social DM" />;
      default:
        return <Headset className="w-3.5 h-3.5 text-amber-500" title="Manual Helpdesk" />;
    }
  };

  const tickets = ticketsData?.tickets || [];
  const resolutionRate = metrics?.aiResolutionRate ?? 85.0;

  return (
    <div className="space-y-6">
      {/* ── TOP SECTION: RESOLUTION RATE & CUSTOMER SUPPORT KPI DASHBOARD ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: AI Resolution Rate (Hero KPI) */}
        <Card className="border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent relative overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-purple-600 dark:text-purple-400 uppercase">
                AI Resolution Rate
              </span>
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <CardTitle className="text-3xl font-extrabold text-foreground mt-1">
              {resolutionRate}%
            </CardTitle>
            <CardDescription className="text-xs">
              Queries resolved by AI without human staff
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="w-full bg-muted/40 rounded-full h-2 mt-2 overflow-hidden border border-purple-500/20">
              <div 
                className="bg-gradient-to-r from-purple-600 to-pink-500 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(resolutionRate, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 font-medium">
              <span>Auto-Resolved: {metrics?.aiAutoResolvedCount ?? 0}</span>
              <span>Escalated: {metrics?.escalatedCount ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Open & In-Progress Tickets */}
        <Card className="border border-sky-500/30 bg-sky-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-sky-600 dark:text-sky-400 uppercase">
                Active Tickets
              </span>
              <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-600 flex items-center justify-center">
                <Headset className="w-4 h-4" />
              </div>
            </div>
            <CardTitle className="text-3xl font-extrabold text-foreground mt-1">
              {(metrics?.openTickets ?? 0) + (metrics?.inProgressTickets ?? 0)}
            </CardTitle>
            <CardDescription className="text-xs">
              Needs staff action or investigation
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mt-3 text-xs">
              <Badge className="bg-sky-500/15 text-sky-600 border-0 text-[10px]">
                {metrics?.openTickets ?? 0} Open
              </Badge>
              <Badge className="bg-amber-500/15 text-amber-600 border-0 text-[10px]">
                {metrics?.inProgressTickets ?? 0} In Progress
              </Badge>
              {(metrics?.urgentPendingCount ?? 0) > 0 && (
                <Badge className="bg-red-500/20 text-red-600 border border-red-500/30 text-[10px] font-bold">
                  {metrics?.urgentPendingCount} Urgent
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Resolved Tickets */}
        <Card className="border border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase">
                Resolved Tickets
              </span>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <CardTitle className="text-3xl font-extrabold text-foreground mt-1">
              {metrics?.resolvedTickets ?? 0}
            </CardTitle>
            <CardDescription className="text-xs">
              Successfully resolved complaints & issues
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              Avg Resolution Time: <strong className="text-foreground">{metrics?.avgResolutionHours ?? 0} hrs</strong>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Total Customer Interactions */}
        <Card className="border border-border/70 bg-card/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                Customer Inquiries
              </span>
              <div className="w-7 h-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <Zap className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <CardTitle className="text-3xl font-extrabold text-foreground mt-1">
              {metrics?.totalCustomerQueries ?? 0}
            </CardTitle>
            <CardDescription className="text-xs">
              Total voice calls & bot conversations
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
              Total Tickets Logged: <strong className="text-foreground">{metrics?.totalTickets ?? 0}</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── TOOLBAR & FILTERS ── */}
      <Card className="border border-border/60 shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by Ticket #, customer name, phone, or issue keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs bg-background"
              />
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs gap-1.5 font-medium"
                onClick={() => {
                  refetchTickets();
                  refetchMetrics();
                }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${ticketsLoading || metricsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                className="h-9 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="w-4 h-4" />
                New Support Ticket
              </Button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50 text-xs">
            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
              <Filter className="w-3 h-3" /> Filters:
            </span>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 text-xs w-[110px] bg-background">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>

            {/* Priority Filter */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-7 text-xs w-[110px] bg-background">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-7 text-xs w-[150px] bg-background">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="service_complaint">Service Complaint</SelectItem>
                <SelectItem value="billing_refund">Billing & Refund</SelectItem>
                <SelectItem value="technical_issue">Technical Issue</SelectItem>
                <SelectItem value="escalation_request">Escalation Request</SelectItem>
                <SelectItem value="appointment_issue">Appointment Issue</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>

            {/* Channel Filter */}
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px] bg-background">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="voice_call">Voice Call</SelectItem>
                <SelectItem value="whatsapp">WhatsApp Bot</SelectItem>
                <SelectItem value="instagram_dm">Instagram DM</SelectItem>
                <SelectItem value="facebook_dm">Facebook DM</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>

            {(statusFilter !== "all" || priorityFilter !== "all" || categoryFilter !== "all" || channelFilter !== "all" || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-2"
                onClick={() => {
                  setStatusFilter("all");
                  setPriorityFilter("all");
                  setCategoryFilter("all");
                  setChannelFilter("all");
                  setSearchQuery("");
                }}
              >
                Clear Filters
              </Button>
            )}

            <span className="ml-auto text-[11px] text-muted-foreground">
              Showing <strong>{tickets.length}</strong> of {ticketsData?.total || 0} tickets
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── TICKETS LIST ── */}
      {ticketsLoading ? (
        <Card className="p-12 text-center text-xs text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
          Loading Support Tickets...
        </Card>
      ) : tickets.length === 0 ? (
        <Card className="border-dashed border-2 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 mx-auto flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">No Support Tickets Found</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
            Great job! Customer complaints or escalated queries will automatically appear here from AI Voice Calls, WhatsApp Bots, and Social DMs.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 text-xs gap-1.5"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Log Manual Ticket
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Card
              key={t.id}
              className={`border transition-all hover:shadow-md ${
                t.priority === "urgent" && t.status !== "resolved"
                  ? "border-red-500/50 bg-red-500/5 dark:bg-red-500/10"
                  : t.status === "open"
                  ? "border-sky-500/30 bg-sky-500/5 dark:bg-sky-500/5"
                  : "border-border/60 hover:border-border"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  {/* Left: Ticket Header info */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/60">
                        {t.ticketNumber}
                      </span>
                      {getPriorityBadge(t.priority)}
                      {getStatusBadge(t.status)}
                      <Badge variant="outline" className="text-[10px] gap-1 font-normal capitalize">
                        {getChannelIcon(t.channel)}
                        {t.channel.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground capitalize">
                        {t.category.replace("_", " ")}
                      </Badge>
                      {t.escalated && (
                        <Badge className="bg-orange-500/15 text-orange-600 border border-orange-500/30 text-[10px] gap-1">
                          <Zap className="w-3 h-3 text-orange-500" />
                          Escalated
                        </Badge>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-foreground pt-0.5">
                      {t.subject}
                    </h4>
                  </div>

                  {/* Right: Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 font-semibold"
                      onClick={() => handleOpenUpdate(t)}
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {t.status === "resolved" ? "View / Reopen" : "Resolve / Update"}
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs gap-1.5 font-medium"
                      disabled={escalatingId === t.id}
                      onClick={() => escalateMutation.mutate(t.id)}
                      title="Send instant WhatsApp & Email escalation alert to staff & manager"
                    >
                      <Send className={`w-3.5 h-3.5 ${escalatingId === t.id ? "animate-spin" : ""}`} />
                      {escalatingId === t.id ? "Alerting..." : "⚡ Escalate"}
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete ticket #${t.ticketNumber}?`)) {
                          deleteMutation.mutate(t.id);
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Body Details: Customer Contact + Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-xl bg-background/80 border border-border/50 text-xs">
                  <div>
                    <span className="text-[10px] text-muted-foreground block font-medium">Customer Details</span>
                    <span className="font-semibold text-foreground">{t.customerName}</span>
                    <span className="text-muted-foreground block font-mono text-[11px] mt-0.5">
                      <a href={`tel:${t.customerPhone}`} className="text-primary hover:underline">{t.customerPhone}</a>
                      {t.customerEmail ? ` • ${t.customerEmail}` : ""}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-muted-foreground block font-medium">Assigned Staff</span>
                    {t.assignedStaffName ? (
                      <div>
                        <span className="font-semibold text-foreground flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-blue-500" />
                          {t.assignedStaffName}
                        </span>
                        {t.assignedStaffPhone && (
                          <span className="text-muted-foreground text-[11px] font-mono block">
                            {t.assignedStaffPhone}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">Unassigned (Manager Pool)</span>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] text-muted-foreground block font-medium">Timeline & Alerts</span>
                    <span className="text-muted-foreground text-[11px] block">
                      Created: {new Date(t.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {t.resolvedAt ? (
                      <span className="text-emerald-600 text-[11px] font-semibold block mt-0.5">
                        ✓ Resolved: {new Date(t.resolvedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 block mt-0.5">
                        Escalation Alerts: {t.escalationSentWhatsapp ? "WA ✓" : "WA —"} • {t.escalationSentEmail ? "Email ✓" : "Email —"}
                      </span>
                    )}
                  </div>
                </div>

                {/* AI Summary or Resolution Notes */}
                {(t.aiSummary || t.description || t.resolutionNotes) && (
                  <div className="space-y-1.5 text-xs pt-1">
                    {t.aiSummary && (
                      <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/20 text-muted-foreground">
                        <strong className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> AI Summary & Diagnostic:
                        </strong>
                        <p className="mt-0.5 text-foreground/90">{t.aiSummary}</p>
                      </div>
                    )}
                    {t.resolutionNotes && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                        <strong className="font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Resolution Notes ({t.resolvedBy || "Staff"}):
                        </strong>
                        <p className="mt-0.5">{t.resolutionNotes}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── MODAL 1: CREATE NEW SUPPORT TICKET ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <div className="p-6 pb-4 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Headset className="w-5 h-5 text-primary" />
                Create Support Ticket
              </DialogTitle>
              <DialogDescription>
                Log a customer complaint, refund issue, or technical problem and automatically alert your team.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 p-6 overflow-y-auto flex-1 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Customer Name *</Label>
                <Input
                  placeholder="e.g. Rahul Sharma"
                  value={newTicketForm.customerName}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, customerName: e.target.value })}
                  className="h-8 text-xs bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mobile Number *</Label>
                <Input
                  placeholder="+919876543210"
                  value={newTicketForm.customerPhone}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, customerPhone: e.target.value })}
                  className="h-8 text-xs bg-background font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Customer Email (Optional)</Label>
                <Input
                  placeholder="customer@example.com"
                  value={newTicketForm.customerEmail}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, customerEmail: e.target.value })}
                  className="h-8 text-xs bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Channel</Label>
                <Select
                  value={newTicketForm.channel}
                  onValueChange={(val) => setNewTicketForm({ ...newTicketForm, channel: val })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voice_call">Voice Call</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp Bot</SelectItem>
                    <SelectItem value="instagram_dm">Instagram DM</SelectItem>
                    <SelectItem value="facebook_dm">Facebook DM</SelectItem>
                    <SelectItem value="manual">Manual / Helpdesk</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Issue Category</Label>
                <Select
                  value={newTicketForm.category}
                  onValueChange={(val) => setNewTicketForm({ ...newTicketForm, category: val })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service_complaint">Service Complaint</SelectItem>
                    <SelectItem value="billing_refund">Billing & Refund</SelectItem>
                    <SelectItem value="technical_issue">Technical Issue</SelectItem>
                    <SelectItem value="escalation_request">Escalation Request</SelectItem>
                    <SelectItem value="appointment_issue">Appointment Issue</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select
                  value={newTicketForm.priority}
                  onValueChange={(val: any) => setNewTicketForm({ ...newTicketForm, priority: val })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">🔴 Urgent</SelectItem>
                    <SelectItem value="high">🟠 High</SelectItem>
                    <SelectItem value="medium">🔵 Medium</SelectItem>
                    <SelectItem value="low">⚪ Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Assign to Staff Member (Optional)</Label>
              <Select
                value={newTicketForm.assignedStaffId}
                onValueChange={(val) => setNewTicketForm({ ...newTicketForm, assignedStaffId: val })}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Select staff..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned (Notify Manager Pool)</SelectItem>
                  {staffList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.role}) — {s.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Subject / Issue Summary *</Label>
              <Input
                placeholder="e.g. Refund not received for booking #4102"
                value={newTicketForm.subject}
                onChange={(e) => setNewTicketForm({ ...newTicketForm, subject: e.target.value })}
                className="h-8 text-xs bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Detailed Notes / Description (Optional)</Label>
              <Textarea
                placeholder="Enter customer problem description, transaction IDs, or conversation notes..."
                value={newTicketForm.description}
                onChange={(e) => setNewTicketForm({ ...newTicketForm, description: e.target.value })}
                rows={3}
                className="text-xs bg-background"
              />
            </div>

            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <Checkbox
                id="sendAlertNow"
                checked={newTicketForm.sendAlertNow}
                onCheckedChange={(checked) => setNewTicketForm({ ...newTicketForm, sendAlertNow: !!checked })}
              />
              <label htmlFor="sendAlertNow" className="text-xs font-semibold text-orange-700 dark:text-orange-300 cursor-pointer">
                Send instant WhatsApp &amp; Email escalation alert to staff/manager now
              </label>
            </div>
          </div>

          <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                disabled={!newTicketForm.customerName || !newTicketForm.customerPhone || !newTicketForm.subject || createTicketMutation.isPending}
                onClick={() => createTicketMutation.mutate()}
              >
                {createTicketMutation.isPending ? "Creating..." : "Create Ticket"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── MODAL 2: RESOLVE & UPDATE TICKET ── */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-xl">
          <div className="p-6 pb-4 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-primary" />
                Update Ticket #{selectedTicket?.ticketNumber}
              </DialogTitle>
              <DialogDescription>
                Assign staff, update ticket status, and record resolution notes.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 p-6 overflow-y-auto flex-1 text-xs">
            {selectedTicket && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1">
                <div className="flex justify-between font-semibold">
                  <span>{selectedTicket.customerName}</span>
                  <span className="font-mono text-primary">{selectedTicket.customerPhone}</span>
                </div>
                <p className="text-muted-foreground">{selectedTicket.subject}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Ticket Status</Label>
                <Select
                  value={updateForm.status}
                  onValueChange={(val: any) => setUpdateForm({ ...updateForm, status: val })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open (Pending Action)</SelectItem>
                    <SelectItem value="in_progress">In Progress (Staff Assigned)</SelectItem>
                    <SelectItem value="resolved">Resolved (Completed)</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select
                  value={updateForm.priority}
                  onValueChange={(val: any) => setUpdateForm({ ...updateForm, priority: val })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">🔴 Urgent</SelectItem>
                    <SelectItem value="high">🟠 High</SelectItem>
                    <SelectItem value="medium">🔵 Medium</SelectItem>
                    <SelectItem value="low">⚪ Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Assign to Staff Member</Label>
              <Select
                value={updateForm.assignedStaffId}
                onValueChange={(val) => setUpdateForm({ ...updateForm, assignedStaffId: val })}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Select staff..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned (Manager Pool)</SelectItem>
                  {staffList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.role}) — {s.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Resolution Notes / Action Taken</Label>
              <Textarea
                placeholder="Describe how the complaint/issue was resolved (e.g. called customer, processed refund UTR #9012, rescheduled site visit)..."
                value={updateForm.resolutionNotes}
                onChange={(e) => setUpdateForm({ ...updateForm, resolutionNotes: e.target.value })}
                rows={4}
                className="text-xs bg-background"
              />
              <p className="text-[11px] text-muted-foreground">
                These notes will be logged in CRM and counted toward your Customer Support Resolution Rate report.
              </p>
            </div>
          </div>

          <div className="p-4 px-6 border-t border-border/50 bg-muted/20 shrink-0">
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setUpdateDialogOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                disabled={updateTicketMutation.isPending}
                onClick={() => updateTicketMutation.mutate()}
              >
                {updateTicketMutation.isPending ? "Saving..." : "Save & Update Ticket"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
