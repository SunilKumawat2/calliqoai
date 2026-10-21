import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Users, UserCheck, CalendarDays, Phone, Mail, MapPin, Building, 
  Plus, RefreshCw, MessageSquare, CheckCircle2, Clock, Check, 
  Trash2, Edit, AlertCircle, Sparkles, Send, Filter, Search, MoreHorizontal,
  Bell, UserPlus, FileText, CheckSquare, ShieldCheck, ArrowRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export interface SalesStaff {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  city: string | null;
  assignedProjects: string[];
  isActive: boolean;
  totalVisitsCount: number;
  notes: string | null;
  createdAt: string;
}

export interface SiteVisit {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  serviceName: string | null;
  notes: string | null;
  status: string;
  statusReason: string | null;
  googleCalendarEventId: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedStaffPhone: string | null;
  createdAt: string;
}

export function SalesTeamSiteVisits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<"visits" | "team">("visits");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Staff Dialog
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<SalesStaff | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: "",
    phone: "",
    email: "",
    role: "Sales Executive",
    city: "Gurugram",
    assignedProjects: "DLF Cyber Heights, Golf Course Ext",
    notes: "",
  });

  // Appoint Consultant Dialog (for an existing site visit)
  const [appointDialogOpen, setAppointDialogOpen] = useState(false);
  const [selectedVisitForAppoint, setSelectedVisitForAppoint] = useState<SiteVisit | null>(null);
  const [appointForm, setAppointForm] = useState({
    staffId: "",
    notes: "",
    notifyStaffWhatsApp: true,
    notifyClientWhatsApp: true,
  });

  // Manual New Site Visit Creation Dialog
  const [createVisitDialogOpen, setCreateVisitDialogOpen] = useState(false);
  const [createVisitForm, setCreateVisitForm] = useState({
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    serviceName: "DLF Cyber Heights Luxury Residences",
    appointmentDate: new Date().toISOString().split("T")[0],
    appointmentTime: "11:00",
    staffId: "",
    notes: "Site visit booked for 3BHK unit",
    notifyWhatsApp: true,
  });

  // Queries
  const { data: staffList = [], isLoading: staffLoading } = useQuery<SalesStaff[]>({
    queryKey: ["/api/sales-team"],
  });

  const { data: visitsList = [], isLoading: visitsLoading, refetch: refetchVisits } = useQuery<SiteVisit[]>({
    queryKey: ["/api/sales-team/site-visits/all"],
    refetchInterval: 15000, // auto refetch every 15s to catch new incoming visits live
  });

  // Mutations
  const createStaffMutation = useMutation({
    mutationFn: async (data: typeof staffForm) => {
      const projects = data.assignedProjects
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const res = await fetch("/api/sales-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, assignedProjects: projects }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      setStaffDialogOpen(false);
      resetStaffForm();
      toast({ title: "Staff Member Added", description: "New sales executive added successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Add Staff", description: err.message, variant: "destructive" });
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SalesStaff> }) => {
      const res = await fetch(`/api/sales-team/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      setStaffDialogOpen(false);
      resetStaffForm();
      toast({ title: "Staff Updated", description: "Sales executive updated successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/sales-team/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      toast({ title: "Staff Removed", description: "Sales executive removed." });
    },
  });

  // Assign / Appoint Mutation
  const assignVisitMutation = useMutation({
    mutationFn: async ({
      visitId,
      staffId,
      notes,
    }: {
      visitId: string;
      staffId: string;
      notes?: string;
    }) => {
      const res = await fetch(`/api/sales-team/site-visits/${visitId}/assign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (updatedAppointment) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });

      toast({
        title: "✅ Executive Appointed Successfully",
        description: `${updatedAppointment.assignedStaffName || 'Executive'} is now assigned to ${updatedAppointment.contactName}'s site visit.`,
      });

      // Handle WhatsApp notifications if selected
      if (selectedVisitForAppoint) {
        const mergedVisit: SiteVisit = {
          ...selectedVisitForAppoint,
          ...updatedAppointment,
          notes: appointForm.notes || selectedVisitForAppoint.notes,
        };

        if (appointForm.notifyStaffWhatsApp && mergedVisit.assignedStaffPhone) {
          sendStaffWhatsApp(mergedVisit);
        }
        if (appointForm.notifyClientWhatsApp && mergedVisit.contactPhone) {
          sendClientWhatsApp(mergedVisit);
        }
      }

      setAppointDialogOpen(false);
      setSelectedVisitForAppoint(null);
    },
    onError: (err: any) => {
      toast({ title: "Assignment Failed", description: err.message, variant: "destructive" });
    },
  });

  // Manual Site Visit Creation Mutation
  const createVisitMutation = useMutation({
    mutationFn: async (data: typeof createVisitForm) => {
      const res = await fetch("/api/sales-team/site-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (newVisit) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });

      toast({
        title: "✅ Site Visit Booked & Appointed",
        description: `Visit scheduled for ${newVisit.contactName} on ${newVisit.appointmentDate} at ${newVisit.appointmentTime}.`,
      });

      if (createVisitForm.notifyWhatsApp && newVisit.assignedStaffPhone) {
        sendStaffWhatsApp(newVisit);
      }

      setCreateVisitDialogOpen(false);
      setCreateVisitForm({
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        serviceName: "DLF Cyber Heights Luxury Residences",
        appointmentDate: new Date().toISOString().split("T")[0],
        appointmentTime: "11:00",
        staffId: "",
        notes: "",
        notifyWhatsApp: true,
      });
    },
    onError: (err: any) => {
      toast({ title: "Booking Failed", description: err.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      const res = await fetch(`/api/sales-team/site-visits/${visitId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      toast({ title: "Status Updated", description: "Visit outcome status updated." });
    },
  });

  const resetStaffForm = () => {
    setEditingStaff(null);
    setStaffForm({
      name: "",
      phone: "",
      email: "",
      role: "Sales Executive",
      city: "Gurugram",
      assignedProjects: "",
      notes: "",
    });
  };

  const handleEditClick = (staff: SalesStaff) => {
    setEditingStaff(staff);
    setStaffForm({
      name: staff.name,
      phone: staff.phone,
      email: staff.email || "",
      role: staff.role || "Sales Executive",
      city: staff.city || "",
      assignedProjects: Array.isArray(staff.assignedProjects) ? staff.assignedProjects.join(", ") : "",
      notes: staff.notes || "",
    });
    setStaffDialogOpen(true);
  };

  const openAppointModal = (visit: SiteVisit) => {
    setSelectedVisitForAppoint(visit);
    setAppointForm({
      staffId: visit.assignedStaffId || (staffList.find((s) => s.isActive)?.id || ""),
      notes: visit.notes || "",
      notifyStaffWhatsApp: true,
      notifyClientWhatsApp: true,
    });
    setAppointDialogOpen(true);
  };

  // WhatsApp Notification Helpers
  const sendStaffWhatsApp = (visit: SiteVisit) => {
    const staffPhone = visit.assignedStaffPhone || "";
    const cleanPhone = staffPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      toast({ title: "No Staff Phone", description: "Please assign a staff member with a valid phone number.", variant: "destructive" });
      return;
    }

    const message = `*Namaste ${visit.assignedStaffName || 'Team'}!* 🏢\n\n*New Site Visit Assigned via Calliqo AI:*\n• *Client:* ${visit.contactName}\n• *Phone:* ${visit.contactPhone}\n• *Service/Project:* ${visit.serviceName || 'Property Site Visit'}\n• *Date & Time:* ${visit.appointmentDate} at ${visit.appointmentTime}\n• *Customer Request / Notes:* ${visit.notes || 'Interested buyer'}\n\nPlease reach out to the customer and coordinate the visit!`;
    const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const sendClientWhatsApp = (visit: SiteVisit) => {
    const clientPhone = visit.contactPhone.replace(/\D/g, "");
    if (!clientPhone) {
      toast({ title: "Invalid Phone", description: "Customer phone number is invalid.", variant: "destructive" });
      return;
    }

    const consultantText = visit.assignedStaffName 
      ? `Hamare property consultant *${visit.assignedStaffName}* (${visit.assignedStaffPhone || ''}) aapko site par attend karenge.`
      : `Hamari sales team aapse jald hi sampark karegi.`;

    const message = `*Namaste ${visit.contactName} ji!* 🙏\n\nAapki *${visit.serviceName || 'Property Site Visit'}* confirm ho gayi hai:\n\n📅 *Date:* ${visit.appointmentDate}\n⏰ *Time:* ${visit.appointmentTime}\n\n${consultantText}\n\nKisi bhi sahayata ke liye aap hume is number par reply kar sakte hain. Aapka din shubh rahe!`;
    const url = `https://api.whatsapp.com/send?phone=${clientPhone}&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  // Unassigned visits calculation
  const unassignedVisits = visitsList.filter(
    (v) => !v.assignedStaffId || v.assignedStaffId === "unassigned" || v.assignedStaffId === ""
  );

  // Filtered visits
  const filteredVisits = visitsList.filter((v) => {
    const matchSearch =
      v.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.contactPhone.includes(searchTerm) ||
      (v.assignedStaffName && v.assignedStaffName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (v.serviceName && v.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

    if (statusFilter === "unassigned") {
      const isUnassigned = !v.assignedStaffId || v.assignedStaffId === "unassigned" || v.assignedStaffId === "";
      return matchSearch && isUnassigned;
    }

    const matchStatus = statusFilter === "all" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // KPI counts
  const totalVisits = visitsList.length;
  const completedVisits = visitsList.filter((v) => v.status === "completed_visited" || v.status === "deal_won").length;
  const scheduledVisits = visitsList.filter((v) => v.status === "scheduled").length;
  const activeStaffCount = staffList.filter((s) => s.isActive).length;

  return (
    <div className="space-y-6">
      {/* ── TOP NOTIFICATION BANNER IF UNASSIGNED VISITS EXIST ── */}
      {unassignedVisits.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border border-amber-500/40 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl shrink-0 mt-0.5 sm:mt-0">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-foreground">
                  🚨 New Site Visit Notification: {unassignedVisits.length} Visit{unassignedVisits.length > 1 ? "s" : ""} Awaiting Staff Appointment!
                </h4>
                <Badge className="bg-amber-500 text-white border-none text-[10px] px-1.5 py-0 font-semibold">
                  Action Required
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Latest: <strong className="text-foreground">{unassignedVisits[0]?.contactName}</strong> ({unassignedVisits[0]?.contactPhone}) — {unassignedVisits[0]?.serviceName || "Site Visit"} scheduled for {unassignedVisits[0]?.appointmentDate} at {unassignedVisits[0]?.appointmentTime}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
            <Button
              size="sm"
              onClick={() => openAppointModal(unassignedVisits[0])}
              className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-sm"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Appoint Staff Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveSubTab("visits");
                setStatusFilter("unassigned");
              }}
              className="h-8 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            >
              View All ({unassignedVisits.length})
            </Button>
          </div>
        </div>
      )}

      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Sales Team & Site Visit Assignment
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time site visit alerts, executive auto-assignment, and instant 1-click WhatsApp briefings.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchVisits();
              queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
              toast({ title: "Refreshed", description: "Checked for new visits and staff updates." });
            }}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateVisitDialogOpen(true)}
            className="h-8 gap-1.5 text-xs border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium"
          >
            <UserPlus className="w-3.5 h-3.5 text-blue-600" />
            + Appoint New Visit
          </Button>

          <Button
            size="sm"
            onClick={() => {
              resetStaffForm();
              setStaffDialogOpen(true);
            }}
            className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Sales Consultant
          </Button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500/5 to-blue-500/10 border-blue-200/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Site Visits</p>
              <h3 className="text-2xl font-bold text-foreground mt-0.5">{totalVisits}</h3>
            </div>
            <div className="p-2.5 bg-blue-500/15 rounded-xl text-blue-600">
              <CalendarDays className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card 
          onClick={() => {
            setActiveSubTab("visits");
            setStatusFilter("unassigned");
          }}
          className={`cursor-pointer transition-all ${
            unassignedVisits.length > 0
              ? "bg-gradient-to-br from-amber-500/10 to-orange-500/15 border-amber-300 dark:border-amber-600 shadow-sm ring-1 ring-amber-400/50"
              : "bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-200/50"
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Needs Staff Appointment</p>
                {unassignedVisits.length > 0 && (
                  <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                )}
              </div>
              <h3 className="text-2xl font-bold text-amber-600 mt-0.5 flex items-center gap-1.5">
                {unassignedVisits.length}
                {unassignedVisits.length > 0 && (
                  <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    Pending
                  </span>
                )}
              </h3>
            </div>
            <div className="p-2.5 bg-amber-500/15 rounded-xl text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 border-emerald-200/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Visits Completed / Won</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-0.5">{completedVisits}</h3>
            </div>
            <div className="p-2.5 bg-emerald-500/15 rounded-xl text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/5 to-purple-500/10 border-purple-200/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Active Consultants</p>
              <h3 className="text-2xl font-bold text-purple-600 mt-0.5">{activeStaffCount}</h3>
            </div>
            <div className="p-2.5 bg-purple-500/15 rounded-xl text-purple-600">
              <UserCheck className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex border-b border-border/80">
        <button
          onClick={() => setActiveSubTab("visits")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeSubTab === "visits"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          Site Visits & Appointments ({visitsList.length})
          {unassignedVisits.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-bold ml-1">
              {unassignedVisits.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab("team")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeSubTab === "team"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="w-4 h-4" />
          Sales Executives & Field Team ({staffList.length})
        </button>
      </div>

      {/* ── TAB 1: SITE VISITS & APPOINTMENTS ── */}
      {activeSubTab === "visits" && (
        <div className="space-y-4">
          {/* Search & Filter Bar + Quick Status Tabs */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search client, phone, consultant, project..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>

            {/* Quick Filter Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
              <Button
                variant={statusFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs px-2.5"
              >
                All ({visitsList.length})
              </Button>

              <Button
                variant={statusFilter === "unassigned" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("unassigned")}
                className={`h-7 text-xs px-2.5 gap-1 ${
                  unassignedVisits.length > 0
                    ? "text-amber-600 font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    : ""
                }`}
              >
                <AlertCircle className="w-3 h-3 text-amber-500" />
                Needs Staff ({unassignedVisits.length})
              </Button>

              <Button
                variant={statusFilter === "scheduled" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("scheduled")}
                className="h-7 text-xs px-2.5"
              >
                Scheduled ({scheduledVisits})
              </Button>

              <Button
                variant={statusFilter === "completed_visited" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("completed_visited")}
                className="h-7 text-xs px-2.5"
              >
                Visited ({completedVisits})
              </Button>
            </div>
          </div>

          {/* Visits Table / List */}
          {filteredVisits.length === 0 ? (
            <Card className="border-dashed p-8 text-center text-muted-foreground">
              <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No site visits found matching criteria.</p>
              <p className="text-xs text-muted-foreground mt-1">
                {statusFilter === "unassigned"
                  ? "Great job! All site visits currently have dedicated sales consultants appointed."
                  : "When AI agents book site visits with callers, they will automatically appear here with assigned field consultants."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateVisitDialogOpen(true)}
                className="mt-3 text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Book & Appoint Site Visit Manually
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredVisits.map((visit) => {
                const isUnassigned =
                  !visit.assignedStaffId ||
                  visit.assignedStaffId === "unassigned" ||
                  visit.assignedStaffId === "";

                return (
                  <Card 
                    key={visit.id} 
                    className={`transition-all border-border/70 hover:shadow-sm ${
                      isUnassigned 
                        ? "border-l-4 border-l-amber-500 bg-amber-500/[0.02]" 
                        : "hover:border-blue-500/30"
                    }`}
                  >
                    <CardContent className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                      {/* Left: Customer & Date Info */}
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">{visit.contactName}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="w-3 h-3 text-muted-foreground/80" />
                            {visit.contactPhone}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                            {visit.serviceName || "Property Site Visit"}
                          </Badge>
                          {isUnassigned && (
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] px-1.5 py-0 font-semibold gap-1">
                              <AlertCircle className="w-2.5 h-2.5 text-amber-500" />
                              Awaiting Appointment
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap pt-0.5">
                          <span className="flex items-center gap-1 font-medium text-foreground/90">
                            <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
                            {visit.appointmentDate} at {visit.appointmentTime}
                          </span>
                          {visit.notes && (
                            <span className="truncate max-w-md text-[11px] text-muted-foreground">
                              • {visit.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Middle: Consultant Assignment Card & Status */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        {/* Assigned Consultant Info or Appoint Button */}
                        <div className="text-left">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                            Assigned Consultant
                          </Label>

                          {isUnassigned ? (
                            <Button
                              size="sm"
                              onClick={() => openAppointModal(visit)}
                              className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium gap-1.5 shadow-sm"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Appoint Staff
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1.5 bg-blue-500/10 dark:bg-blue-950/40 border border-blue-500/20 px-2.5 py-1 rounded-md">
                              <UserCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <div className="text-xs">
                                <span className="font-semibold text-foreground">{visit.assignedStaffName}</span>
                                {visit.assignedStaffPhone && (
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    ({visit.assignedStaffPhone})
                                  </span>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openAppointModal(visit)}
                                title="Change Consultant"
                                className="h-5 px-1 text-[10px] text-blue-600 hover:text-blue-700 ml-1 hover:bg-blue-500/15"
                              >
                                Change
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Status Dropdown */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                            Visit Status
                          </Label>
                          <Select
                            value={visit.status}
                            onValueChange={(val) => updateStatusMutation.mutate({ visitId: visit.id, status: val })}
                          >
                            <SelectTrigger className="h-7 text-xs w-36 font-medium">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scheduled">Scheduled</SelectItem>
                              <SelectItem value="completed_visited">Visited</SelectItem>
                              <SelectItem value="interested_followup">Interested</SelectItem>
                              <SelectItem value="deal_won">Deal Won</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Right: WhatsApp 1-Click Dispatch Buttons */}
                      <div className="flex items-center gap-1.5 self-end lg:self-center shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendStaffWhatsApp(visit)}
                          disabled={isUnassigned}
                          title={isUnassigned ? "Appoint a consultant first to notify staff" : "Notify Assigned Sales Executive on WhatsApp"}
                          className="h-8 text-xs gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                          Notify Staff
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendClientWhatsApp(visit)}
                          title="Send Confirmation & Consultant Details to Client on WhatsApp"
                          className="h-8 text-xs gap-1.5 border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        >
                          <Send className="w-3.5 h-3.5 text-blue-600" />
                          Notify Client
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: SALES EXECUTIVES & FIELD TEAM ── */}
      {activeSubTab === "team" && (
        <div className="space-y-4">
          {staffList.length === 0 ? (
            <Card className="border-dashed p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No sales consultants added yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add your field executives to automatically assign them to incoming customer site visits.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  resetStaffForm();
                  setStaffDialogOpen(true);
                }}
                className="mt-3 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Add First Executive
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {staffList.map((staff) => (
                <Card key={staff.id} className="relative overflow-hidden hover:border-blue-500/40 transition-all">
                  <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-semibold">{staff.name}</CardTitle>
                        {staff.isActive ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-none text-[10px] px-1.5 py-0">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-xs font-medium text-foreground/80 mt-0.5">
                        {staff.role}
                      </CardDescription>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditClick(staff)}>
                          <Edit className="w-3.5 h-3.5 mr-2" /> Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => updateStaffMutation.mutate({ id: staff.id, data: { isActive: !staff.isActive } })}
                        >
                          <Switch className="scale-75 mr-2" checked={staff.isActive} />
                          {staff.isActive ? "Mark Inactive" : "Mark Active"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            if (confirm(`Remove ${staff.name}?`)) {
                              deleteStaffMutation.mutate(staff.id);
                            }
                          }}
                          className="text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>

                  <CardContent className="p-4 pt-2 space-y-2.5 text-xs">
                    <div className="space-y-1 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground/70" />
                        <span className="font-medium text-foreground">{staff.phone}</span>
                      </div>
                      {staff.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground/70" />
                          <span>{staff.email}</span>
                        </div>
                      )}
                      {staff.city && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground/70" />
                          <span>{staff.city}</span>
                        </div>
                      )}
                    </div>

                    {/* Assigned Projects */}
                    {Array.isArray(staff.assignedProjects) && staff.assignedProjects.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Assigned Projects</p>
                        <div className="flex flex-wrap gap-1">
                          {staff.assignedProjects.map((proj, idx) => (
                            <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                              {proj}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Bottom Stats */}
                    <div className="pt-2 border-t flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Assigned Site Visits:</span>
                      <span className="font-semibold text-blue-600">{staff.totalVisitsCount || 0} Visits</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── APPOINT CONSULTANT DIALOG MODAL ── */}
      <Dialog open={appointDialogOpen} onOpenChange={setAppointDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-600" />
              Appoint Sales Consultant to Site Visit
            </DialogTitle>
            <DialogDescription className="text-xs">
              Assign an on-ground property consultant to coordinate this client's site visit and send instant briefings.
            </DialogDescription>
          </DialogHeader>

          {selectedVisitForAppoint && (
            <div className="space-y-4 py-2 text-xs">
              {/* Visit Summary Box */}
              <div className="p-3 rounded-lg bg-muted/60 border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground text-sm">
                    {selectedVisitForAppoint.contactName}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {selectedVisitForAppoint.serviceName || "Site Visit"}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Phone className="w-3 h-3 text-muted-foreground" />
                    {selectedVisitForAppoint.contactPhone}
                  </span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <CalendarDays className="w-3 h-3 text-blue-500" />
                    {selectedVisitForAppoint.appointmentDate} at {selectedVisitForAppoint.appointmentTime}
                  </span>
                </div>
                {selectedVisitForAppoint.notes && (
                  <p className="text-[11px] text-muted-foreground pt-1 border-t mt-1">
                    <strong>Customer Request:</strong> {selectedVisitForAppoint.notes}
                  </p>
                )}
              </div>

              {/* Staff Selection */}
              <div>
                <Label className="text-[11px] font-semibold">Select Consultant to Appoint *</Label>
                <div className="mt-1.5 space-y-2 max-h-48 overflow-y-auto pr-1">
                  {staffList
                    .filter((s) => s.isActive)
                    .map((staff) => {
                      const isSelected = appointForm.staffId === staff.id;
                      const visitText = `${selectedVisitForAppoint.serviceName || ""} ${selectedVisitForAppoint.notes || ""}`.toLowerCase();
                      const projectMatch =
                        Array.isArray(staff.assignedProjects) &&
                        staff.assignedProjects.some((p) => visitText.includes(p.toLowerCase()));

                      return (
                        <div
                          key={staff.id}
                          onClick={() => setAppointForm({ ...appointForm, staffId: staff.id })}
                          className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? "border-blue-600 bg-blue-500/10 ring-1 ring-blue-500/40"
                              : "border-border hover:border-blue-500/30"
                          }`}
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground text-xs">{staff.name}</span>
                              <span className="text-[10px] text-muted-foreground">({staff.role})</span>
                              {projectMatch && (
                                <Badge className="bg-emerald-500/15 text-emerald-600 border-none text-[9px] px-1 py-0 font-medium">
                                  🎯 Project Match
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                              <span>📞 {staff.phone}</span>
                              {staff.city && <span>📍 {staff.city}</span>}
                              <span>• {staff.totalVisitsCount || 0} visits completed</span>
                            </div>
                          </div>

                          <div className="shrink-0 pl-2">
                            {isSelected ? (
                              <div className="h-4 w-4 rounded-full bg-blue-600 text-white flex items-center justify-center">
                                <Check className="w-2.5 h-2.5" />
                              </div>
                            ) : (
                              <div className="h-4 w-4 rounded-full border border-muted-foreground/40" />
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {staffList.filter((s) => s.isActive).length === 0 && (
                    <div className="p-4 border border-dashed rounded-lg text-center text-muted-foreground">
                      No active consultants available. Please add a consultant first.
                    </div>
                  )}
                </div>
              </div>

              {/* Special Instructions / Notes */}
              <div>
                <Label className="text-[11px] font-semibold">Instructions for Sales Executive (Optional)</Label>
                <Textarea
                  placeholder="e.g. Client is interested in 3BHK tower A, high floor. Keep brochure and pricing sheet ready..."
                  value={appointForm.notes}
                  onChange={(e) => setAppointForm({ ...appointForm, notes: e.target.value })}
                  className="text-xs h-16 resize-none mt-1"
                />
              </div>

              {/* Instant WhatsApp Alerts Checkboxes */}
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-2">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  Instant 1-Click WhatsApp Dispatches
                </span>

                <div className="flex items-center space-x-2 pt-0.5">
                  <Checkbox
                    id="notifyStaff"
                    checked={appointForm.notifyStaffWhatsApp}
                    onCheckedChange={(checked) =>
                      setAppointForm({ ...appointForm, notifyStaffWhatsApp: Boolean(checked) })
                    }
                  />
                  <label htmlFor="notifyStaff" className="text-[11px] text-foreground cursor-pointer font-medium">
                    Send briefing with client phone & site details to Executive on WhatsApp
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="notifyClient"
                    checked={appointForm.notifyClientWhatsApp}
                    onCheckedChange={(checked) =>
                      setAppointForm({ ...appointForm, notifyClientWhatsApp: Boolean(checked) })
                    }
                  />
                  <label htmlFor="notifyClient" className="text-[11px] text-foreground cursor-pointer font-medium">
                    Send confirmation with assigned Executive's name & phone to Customer
                  </label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAppointDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!appointForm.staffId || assignVisitMutation.isPending}
              onClick={() => {
                if (selectedVisitForAppoint) {
                  assignVisitMutation.mutate({
                    visitId: selectedVisitForAppoint.id,
                    staffId: appointForm.staffId,
                    notes: appointForm.notes,
                  });
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {assignVisitMutation.isPending ? "Appointing..." : "Confirm & Appoint Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MANUAL NEW SITE VISIT CREATION DIALOG ── */}
      <Dialog open={createVisitDialogOpen} onOpenChange={setCreateVisitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-blue-600" />
              Book & Appoint New Site Visit
            </DialogTitle>
            <DialogDescription className="text-xs">
              Manually schedule a customer property visit and assign a sales executive.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label className="text-[11px]">Customer Full Name *</Label>
              <Input
                placeholder="e.g. Vikas Sharma"
                value={createVisitForm.contactName}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactName: e.target.value })}
                className="h-8 mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Customer Mobile *</Label>
                <Input
                  placeholder="+91 9876543210"
                  value={createVisitForm.contactPhone}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactPhone: e.target.value })}
                  className="h-8 mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px]">Customer Email (Optional)</Label>
                <Input
                  placeholder="vikas@example.com"
                  value={createVisitForm.contactEmail}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactEmail: e.target.value })}
                  className="h-8 mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-[11px]">Project / Property Name *</Label>
              <Input
                placeholder="DLF Cyber Heights Luxury Residences"
                value={createVisitForm.serviceName}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, serviceName: e.target.value })}
                className="h-8 mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Visit Date *</Label>
                <Input
                  type="date"
                  value={createVisitForm.appointmentDate}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, appointmentDate: e.target.value })}
                  className="h-8 mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px]">Visit Time *</Label>
                <Input
                  type="time"
                  value={createVisitForm.appointmentTime}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, appointmentTime: e.target.value })}
                  className="h-8 mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-[11px]">Assign Sales Consultant</Label>
              <Select
                value={createVisitForm.staffId || "unassigned"}
                onValueChange={(val) => setCreateVisitForm({ ...createVisitForm, staffId: val === "unassigned" ? "" : val })}
              >
                <SelectTrigger className="h-8 mt-1 text-xs">
                  <SelectValue placeholder="-- Select Sales Consultant --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">-- Assign Later (Unassigned) --</SelectItem>
                  {staffList
                    .filter((s) => s.isActive)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.city || "Field"} - {s.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[11px]">Visit Notes / Preference</Label>
              <Textarea
                placeholder="Client looking for 3BHK high-rise, budget 1.5 Cr..."
                value={createVisitForm.notes}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, notes: e.target.value })}
                className="text-xs h-14 resize-none mt-1"
              />
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <Checkbox
                id="notifyWhatsAppManual"
                checked={createVisitForm.notifyWhatsApp}
                onCheckedChange={(checked) =>
                  setCreateVisitForm({ ...createVisitForm, notifyWhatsApp: Boolean(checked) })
                }
              />
              <label htmlFor="notifyWhatsAppManual" className="text-[11px] text-foreground cursor-pointer font-medium">
                Notify assigned consultant on WhatsApp immediately upon saving
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateVisitDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                !createVisitForm.contactName ||
                !createVisitForm.contactPhone ||
                !createVisitForm.appointmentDate ||
                !createVisitForm.appointmentTime ||
                createVisitMutation.isPending
              }
              onClick={() => createVisitMutation.mutate(createVisitForm)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {createVisitMutation.isPending ? "Booking..." : "Book & Appoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD / EDIT STAFF MODAL ── */}
      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingStaff ? "Edit Sales Consultant" : "Add New Sales Consultant"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Provide consultant details for auto-assignment and site visit coordination.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label className="text-[11px]">Full Name *</Label>
              <Input
                placeholder="e.g. Rahul Verma"
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                className="h-8"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Mobile / WhatsApp *</Label>
                <Input
                  placeholder="+91 9876543210"
                  value={staffForm.phone}
                  onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                  className="h-8"
                />
              </div>

              <div>
                <Label className="text-[11px]">Email Address</Label>
                <Input
                  placeholder="rahul@example.com"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className="h-8"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Role / Designation</Label>
                <Input
                  placeholder="e.g. Senior Consultant"
                  value={staffForm.role}
                  onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                  className="h-8"
                />
              </div>

              <div>
                <Label className="text-[11px]">City / Region</Label>
                <Input
                  placeholder="e.g. Gurugram, Mohali"
                  value={staffForm.city}
                  onChange={(e) => setStaffForm({ ...staffForm, city: e.target.value })}
                  className="h-8"
                />
              </div>
            </div>

            <div>
              <Label className="text-[11px]">Assigned Projects (comma separated)</Label>
              <Input
                placeholder="DLF Cyber Heights, Golf Course Ext, 3BHK"
                value={staffForm.assignedProjects}
                onChange={(e) => setStaffForm({ ...staffForm, assignedProjects: e.target.value })}
                className="h-8"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                AI uses these project tags to auto-assign incoming visits to this consultant.
              </p>
            </div>

            <div>
              <Label className="text-[11px]">Notes / Specialization</Label>
              <Textarea
                placeholder="Handles luxury properties, available weekends..."
                value={staffForm.notes}
                onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })}
                className="text-xs h-16 resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setStaffDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!staffForm.name || !staffForm.phone}
              onClick={() => {
                if (editingStaff) {
                  const projects = staffForm.assignedProjects
                    .split(",")
                    .map((p) => p.trim())
                    .filter(Boolean);
                  updateStaffMutation.mutate({
                    id: editingStaff.id,
                    data: {
                      name: staffForm.name,
                      phone: staffForm.phone,
                      email: staffForm.email || null,
                      role: staffForm.role,
                      city: staffForm.city || null,
                      assignedProjects: projects,
                      notes: staffForm.notes || null,
                    },
                  });
                } else {
                  createStaffMutation.mutate(staffForm);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {editingStaff ? "Save Changes" : "Add Consultant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
