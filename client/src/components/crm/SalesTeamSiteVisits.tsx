import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Users, UserCheck, CalendarDays, Phone, Mail, MapPin, Building, 
  Plus, RefreshCw, MessageSquare, CheckCircle2, Clock, Check, 
  Trash2, Edit, AlertCircle, Sparkles, Send, Filter, Search, MoreHorizontal,
  Bell, UserPlus, FileText, CheckSquare, ShieldCheck, ArrowRight,
  XCircle, CalendarClock, CalendarCheck, HelpCircle, X, ExternalLink,
  ChevronRight, Calendar as CalendarIcon, UserX
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompanyEmailSettingsDialog } from "./CompanyEmailSettingsDialog";
import { EmailNotificationManager } from "./EmailNotificationManager";

interface SalesStaff {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  city: string | null;
  assignedProjects: string[];
  totalVisitsCount: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

interface SiteVisit {
  id: string;
  userId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  serviceName: string | null;
  notes: string | null;
  status: string; // 'new' | 'scheduled' | 'confirmed' | 'completed_visited' | 'deal_won' | 'interested_followup' | 'cancelled' | 'rescheduled'
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

  const [activeSubTab, setActiveSubTab] = useState<"visits" | "team" | "email">("visits");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "confirmed" | "upcoming" | "past" | "cancelled" | "unassigned" | "overdue">("all");

  // Staff Dialog
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<SalesStaff | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: "",
    phone: "",
    email: "",
    role: "",
    city: "",
    assignedProjects: "",
    notes: "",
  });

  // Appoint Staff Dialog (for an existing visit)
  const [appointDialogOpen, setAppointDialogOpen] = useState(false);
  const [selectedVisitForAppoint, setSelectedVisitForAppoint] = useState<SiteVisit | null>(null);
  const [appointForm, setAppointForm] = useState({
    staffId: "",
    notes: "",
    clientEmail: "",
    sendEmailToStaff: true,
    sendEmailToClient: true,
    notifyStaffWhatsApp: true,
    notifyClientWhatsApp: true,
  });

  // Manual New Appointment Creation Dialog
  const [createVisitDialogOpen, setCreateVisitDialogOpen] = useState(false);
  const [createVisitForm, setCreateVisitForm] = useState({
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    serviceName: "",
    appointmentDate: new Date().toISOString().split("T")[0],
    appointmentTime: "",
    staffId: "",
    notes: "",
    notifyWhatsApp: true,
  });

  // Cancel Dialog
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedVisitForCancel, setSelectedVisitForCancel] = useState<SiteVisit | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Reschedule Dialog
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [selectedVisitForReschedule, setSelectedVisitForReschedule] = useState<SiteVisit | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    appointmentDate: "",
    appointmentTime: "",
    notes: "",
  });

  // Mark Completed / Outcome Dialog
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedVisitForComplete, setSelectedVisitForComplete] = useState<SiteVisit | null>(null);
  const [completeOutcome, setCompleteOutcome] = useState("completed_visited");
  const [completeNotes, setCompleteNotes] = useState("");

  // Queries
  const { data: staffList = [], isLoading: staffLoading } = useQuery<SalesStaff[]>({
    queryKey: ["/api/sales-team"],
  });

  const { data: visitsList = [], isLoading: visitsLoading, refetch: refetchVisits } = useQuery<SiteVisit[]>({
    queryKey: ["/api/sales-team/site-visits/all"],
    refetchInterval: 15000,
  });

  // White-label & Brand Profile
  const { data: whitelabelConfig } = useQuery<{
    businessName?: string;
    appointmentTerm?: string;
    leadTerm?: string;
  }>({
    queryKey: ["/api/crm/whitelabel"],
  });
  const brandName = whitelabelConfig?.businessName || "AI Assistant";

  // Google Calendar Connection Status
  const { data: gcalStatus, refetch: refetchGCalStatus } = useQuery<{
    connected: boolean;
    email?: string;
  }>({
    queryKey: ["/api/google-calendar/status"],
  });

  // Company Custom SMTP Settings
  const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
  const { data: smtpData } = useQuery<{
    configured: boolean;
    settings: {
      fromEmail: string;
      fromName: string;
      provider: string;
    } | null;
  }>({
    queryKey: ["/api/crm/smtp-settings"],
  });

  // ── MUTATIONS ──

  // 1. Staff CRUD Mutations
  const createStaffMutation = useMutation({
    mutationFn: async (data: typeof staffForm) => {
      const projects = data.assignedProjects
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const res = await apiRequest("POST", "/api/sales-team", { ...data, assignedProjects: projects });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      setStaffDialogOpen(false);
      resetStaffForm();
      toast({ title: "Staff Member Added", description: "New staff member added successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Add Staff", description: err.message, variant: "destructive" });
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SalesStaff> }) => {
      const res = await apiRequest("PUT", `/api/sales-team/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      setStaffDialogOpen(false);
      resetStaffForm();
      toast({ title: "Staff Updated", description: "Staff member updated successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/sales-team/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      toast({ title: "Staff Removed", description: "Staff member removed." });
    },
  });

  // 2. Assign / Appoint Staff Mutation
  const assignVisitMutation = useMutation({
    mutationFn: async ({
      visitId,
      staffId,
      notes,
      clientEmail,
      sendEmailToStaff,
      sendEmailToClient,
    }: {
      visitId: string;
      staffId: string;
      notes?: string;
      clientEmail?: string;
      sendEmailToStaff?: boolean;
      sendEmailToClient?: boolean;
    }) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/assign`, {
        staffId,
        notes,
        clientEmail,
        sendEmailToStaff,
        sendEmailToClient,
      });
      return res.json();
    },
    onSuccess: (updatedAppointment) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });

      toast({
        title: "✅ Staff Appointed Successfully",
        description: `${updatedAppointment.assignedStaffName || 'Staff'} assigned to ${updatedAppointment.contactName}'s appointment.`,
      });

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

  // 3. Confirm Appointment Mutation
  const confirmAppointmentMutation = useMutation({
    mutationFn: async (visitId: string) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/confirm`);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      toast({
        title: "✅ Appointment Confirmed",
        description: `Appointment for ${updated.contactName} is now confirmed and synced.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Confirmation Failed", description: err.message, variant: "destructive" });
    },
  });

  // 4. Cancel Appointment Mutation
  const cancelAppointmentMutation = useMutation({
    mutationFn: async ({ visitId, reason }: { visitId: string; reason: string }) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/cancel`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      setCancelDialogOpen(false);
      setSelectedVisitForCancel(null);
      setCancelReason("");
      toast({
        title: "Appointment Cancelled",
        description: "The appointment has been moved to Cancelled.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Cancellation Failed", description: err.message, variant: "destructive" });
    },
  });

  // 5. Reschedule Appointment Mutation
  const rescheduleAppointmentMutation = useMutation({
    mutationFn: async ({
      visitId,
      appointmentDate,
      appointmentTime,
      notes,
    }: {
      visitId: string;
      appointmentDate: string;
      appointmentTime: string;
      notes?: string;
    }) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/reschedule`, {
        appointmentDate,
        appointmentTime,
        notes,
      });
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      setRescheduleDialogOpen(false);
      setSelectedVisitForReschedule(null);
      toast({
        title: "✅ Appointment Rescheduled",
        description: `New schedule set for ${updated.appointmentDate} at ${updated.appointmentTime}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Reschedule Failed", description: err.message, variant: "destructive" });
    },
  });

  // 6. Complete / Mark Visited Mutation
  const completeAppointmentMutation = useMutation({
    mutationFn: async ({
      visitId,
      status,
      statusReason,
    }: {
      visitId: string;
      status: string;
      statusReason: string;
    }) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/status`, {
        status,
        statusReason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      setCompleteDialogOpen(false);
      setSelectedVisitForComplete(null);
      setCompleteNotes("");
      toast({
        title: "✅ Appointment Outcome Saved",
        description: "Status and notes recorded into historical records.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  // Push Single Appointment to Google Calendar Mutation
  const pushToCalendarMutation = useMutation({
    mutationFn: async (visitId: string) => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/${visitId}/push-calendar`);
      return res.json();
    },
    onSuccess: (data, visitId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      if (data.googleCalendarEventId) {
        toast({
          title: "📅 Synced to Google Calendar",
          description: "Appointment synced! Opening in Google Calendar...",
        });
        const calendarEmail = gcalStatus?.email || "primary";
        const raw = `${data.googleCalendarEventId} ${calendarEmail}`;
        const eid = btoa(raw).replace(/=/g, "");
        window.open(`https://www.google.com/calendar/event?eid=${eid}`, "_blank");
      } else {
        toast({
          title: "Google Calendar",
          description: "Could not sync. Please ensure Google Calendar is connected.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Sync Error", description: err.message, variant: "destructive" });
    },
  });

  // 7. Manual Booking Mutation
  const createVisitMutation = useMutation({
    mutationFn: async (data: typeof createVisitForm) => {
      const res = await apiRequest("POST", "/api/sales-team/site-visits", data);
      return res.json();
    },
    onSuccess: (newVisit) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });

      toast({
        title: "✅ Appointment Booked",
        description: `Appointment scheduled for ${newVisit.contactName} on ${newVisit.appointmentDate} at ${newVisit.appointmentTime}.`,
      });

      if (createVisitForm.notifyWhatsApp && newVisit.assignedStaffPhone) {
        sendStaffWhatsApp(newVisit);
      }

      setCreateVisitDialogOpen(false);
      setCreateVisitForm({
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        serviceName: "",
        appointmentDate: new Date().toISOString().split("T")[0],
        appointmentTime: "",
        staffId: "",
        notes: "",
        notifyWhatsApp: true,
      });
    },
    onError: (err: any) => {
      toast({ title: "Booking Failed", description: err.message, variant: "destructive" });
    },
  });

  // 8. Google Calendar Sync Mutation
  const syncCalendarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-team/sync-calendar");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      refetchGCalStatus();
      if (data.synced) {
        toast({
          title: "📅 Google Calendar Synced",
          description: `Checked ${data.total} calendar events. Synced ${data.imported} new appointments, updated ${data.updated}.`,
        });
      } else {
        toast({
          title: "Calendar Sync",
          description: data.error || "Could not sync Google Calendar",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Sync Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // 9. Unassign Staff Mutation
  const unassignVisitMutation = useMutation({
    mutationFn: async (visitId: string) => {
      const res = await apiRequest("PUT", `/api/sales-team/site-visits/${visitId}/unassign`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      toast({
        title: "Staff Unassigned",
        description: "Sent back to 'Needs Staff Assignment' queue.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Unassign", description: err.message, variant: "destructive" });
    },
  });

  // 10. Pre-Appointment Reminder Mutation (WhatsApp + Email + Optional AI Voice Call)
  const sendReminderMutation = useMutation({
    mutationFn: async ({ visitId, triggerVoiceCall }: { visitId: string; triggerVoiceCall?: boolean }) => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/${visitId}/send-reminder`, {
        reminderType: "manual",
        triggerVoiceCall: Boolean(triggerVoiceCall),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      const channels = [
        data.whatsappSent ? "WhatsApp" : null,
        data.emailSent ? "Email" : null,
        data.voiceCallScheduled ? "AI Voice Reminder Call" : null,
      ].filter(Boolean);
      toast({
        title: "🔔 Appointment Reminder Dispatched",
        description: channels.length > 0
          ? `Sent via ${channels.join(" + ")}.`
          : "Reminder recorded for this appointment.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Reminder Failed", description: err.message, variant: "destructive" });
    },
  });

  // 11. No-Show Recovery Mutation (Marks No-Show + Schedules AI Recovery Call + WhatsApp Recovery)
  const noShowRecoveryMutation = useMutation({
    mutationFn: async ({ visitId, notes }: { visitId: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/${visitId}/no-show-recovery`, {
        delaySeconds: 30,
        notes: notes || "Customer did not attend appointment (No-Show) - AI Recovery triggered",
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      setCompleteDialogOpen(false);
      toast({
        title: "🔄 No-Show Recovery Triggered",
        description: data.voiceRecoveryScheduled
          ? "Marked as No-Show. AI Recovery Call scheduled in 30s & WhatsApp reschedule message sent!"
          : "Marked as No-Show & recovery notifications dispatched.",
      });
    },
    onError: (err: any) => {
      toast({ title: "No-Show Recovery Failed", description: err.message, variant: "destructive" });
    },
  });

  // 12. Smart Auto-Assign Single Appointment Mutation
  const autoAssignSingleMutation = useMutation({
    mutationFn: async (visitId: string) => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/${visitId}/auto-assign`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      toast({
        title: "⚡ Smart Auto-Assigned",
        description: `Assigned to ${data.staff?.name || "Staff Member"} (${data.staff?.role || "Consultant"}) based on specialty & round-robin workload.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Auto-Assign Failed", description: err.message, variant: "destructive" });
    },
  });

  // 13. Smart Auto-Assign All Unassigned Appointments Mutation
  const autoAssignAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/auto-assign-all`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/notifications/stats"] });
      toast({
        title: "⚡ Smart Auto-Assign Complete",
        description: `Automatically assigned ${data.assignedCount || 0} appointment(s) across your active team members.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Auto-Assign All Failed", description: err.message, variant: "destructive" });
    },
  });

  // Helpers
  const resetStaffForm = () => {
    setEditingStaff(null);
    setStaffForm({
      name: "",
      phone: "",
      email: "",
      role: "",
      city: "",
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
      role: staff.role || "Consultant",
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
      clientEmail: visit.contactEmail || "",
      sendEmailToStaff: true,
      sendEmailToClient: true,
      notifyStaffWhatsApp: true,
      notifyClientWhatsApp: true,
    });
    setAppointDialogOpen(true);
  };

  const openRescheduleModal = (visit: SiteVisit) => {
    setSelectedVisitForReschedule(visit);
    setRescheduleForm({
      appointmentDate: visit.appointmentDate,
      appointmentTime: visit.appointmentTime ? visit.appointmentTime.substring(0, 5) : "11:00",
      notes: visit.notes || "",
    });
    setRescheduleDialogOpen(true);
  };

  const openCancelModal = (visit: SiteVisit) => {
    setSelectedVisitForCancel(visit);
    setCancelReason("");
    setCancelDialogOpen(true);
  };

  const openCompleteModal = (visit: SiteVisit) => {
    setSelectedVisitForComplete(visit);
    setCompleteOutcome("completed_visited");
    setCompleteNotes(visit.statusReason || "");
    setCompleteDialogOpen(true);
  };

  // WhatsApp Helpers
  const sendStaffWhatsApp = (visit: SiteVisit) => {
    const staffPhone = visit.assignedStaffPhone || "";
    const cleanPhone = staffPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      toast({ title: "No Staff Phone", description: "Please assign a staff member with a valid phone number.", variant: "destructive" });
      return;
    }

    const message = `*Namaste ${visit.assignedStaffName || 'Team'}!* 🏢\n\n*New ${whitelabelConfig?.appointmentTerm || 'Appointment'} Assigned via ${brandName}:*\n• *${whitelabelConfig?.leadTerm || 'Client'}:* ${visit.contactName}\n• *Phone:* ${visit.contactPhone}\n• *Service / Purpose:* ${visit.serviceName || 'Scheduled Appointment'}\n• *Date & Time:* ${visit.appointmentDate} at ${visit.appointmentTime}\n• *Notes:* ${visit.notes || 'Appointment Booking'}\n\nPlease coordinate with the customer for this appointment!`;
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
      ? `Hamare staff member *${visit.assignedStaffName}* (${visit.assignedStaffPhone || ''}) aapko attend karenge.`
      : `Hamari team aapse jald hi sampark karegi.`;

    const message = `*Namaste ${visit.contactName} ji!* 🙏\n\nAapki appointment *${visit.serviceName || 'Scheduled Booking'}* confirm ho gayi hai:\n\n📅 *Date:* ${visit.appointmentDate}\n⏰ *Time:* ${visit.appointmentTime}\n\n${consultantText}\n\nKisi bhi sahayata ke liye aap hume is number par reply kar sakte hain. Aapka din shubh rahe!`;
    const url = `https://api.whatsapp.com/send?phone=${clientPhone}&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  // ── DATE & LIFECYCLE CLASSIFICATION ──
  const todayStr = new Date().toISOString().split("T")[0];

  const isCancelled = (v: SiteVisit) => v.status === "cancelled";
  const isNoShow = (v: SiteVisit) => v.status === "no_show";
  const isCompleted = (v: SiteVisit) => ["completed", "completed_visited", "deal_won"].includes(v.status);
  const isOverdueOrNoShow = (v: SiteVisit) =>
    isNoShow(v) || (v.appointmentDate < todayStr && !isCancelled(v) && !isCompleted(v));
  const isPast = (v: SiteVisit) => (v.appointmentDate < todayStr && !isCancelled(v)) || isCompleted(v);
  const isConfirmed = (v: SiteVisit) => v.status === "confirmed" && !isPast(v) && !isCancelled(v);
  const isNew = (v: SiteVisit) => !isCancelled(v) && !isCompleted(v) && !isConfirmed(v) && v.appointmentDate >= todayStr;
  const isUpcoming = (v: SiteVisit) => v.appointmentDate >= todayStr && !isCancelled(v) && !isCompleted(v);
  const isUnassigned = (v: SiteVisit) => !v.assignedStaffId || v.assignedStaffId === "unassigned" || v.assignedStaffId === "";

  // Filtered arrays
  const newVisits = visitsList.filter(isNew);
  const confirmedVisits = visitsList.filter(isConfirmed);
  const upcomingVisits = visitsList.filter(isUpcoming);
  const pastVisits = visitsList.filter(isPast);
  const cancelledVisits = visitsList.filter(isCancelled);
  const unassignedVisits = visitsList.filter(isUnassigned);
  const overdueVisits = visitsList.filter(isOverdueOrNoShow);

  // Active Filter Applied
  const filteredVisits = visitsList.filter((v) => {
    // 1. Search term match
    const matchSearch =
      v.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.contactPhone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.assignedStaffName && v.assignedStaffName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (v.serviceName && v.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!matchSearch) return false;

    // 2. Status category match
    if (statusFilter === "new") return isNew(v);
    if (statusFilter === "confirmed") return isConfirmed(v);
    if (statusFilter === "upcoming") return isUpcoming(v);
    if (statusFilter === "past") return isPast(v);
    if (statusFilter === "cancelled") return isCancelled(v);
    if (statusFilter === "unassigned") return isUnassigned(v);
    if (statusFilter === "overdue") return isOverdueOrNoShow(v);
    return true; // "all"
  });

  // Google Calendar Direct Event URL Generator
  const getGoogleCalendarUrl = (visit: SiteVisit) => {
    if (visit.googleCalendarEventId) {
      const calendarEmail = gcalStatus?.email || "primary";
      try {
        const raw = `${visit.googleCalendarEventId} ${calendarEmail}`;
        const eid = btoa(raw).replace(/=/g, "");
        return `https://www.google.com/calendar/event?eid=${eid}`;
      } catch (e) {
        return `https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(visit.contactName)}`;
      }
    }

    if (visit.appointmentDate) {
      const [y, m, d] = visit.appointmentDate.split("-");
      if (y && m && d) {
        return `https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${d}`;
      }
    }

    return "https://calendar.google.com/calendar/u/0/r";
  };

  // Relative Date Helper
  const getRelativeDateInfo = (dateStr: string, timeStr?: string) => {
    if (!dateStr) return { label: "", badgeClass: "" };
    const [y, m, d] = dateStr.split("-").map(Number);
    const aptDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.round((aptDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const timeFormatted = timeStr ? ` ${timeStr.substring(0, 5)}` : "";

    if (diffDays === 0) {
      return {
        label: `Today ${timeFormatted}`,
        badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 font-bold",
        isToday: true,
      };
    }
    if (diffDays === 1) {
      return {
        label: `Tomorrow ${timeFormatted}`,
        badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40 font-semibold",
        isTomorrow: true,
      };
    }
    if (diffDays > 1) {
      return {
        label: `In ${diffDays} days (${dateStr}${timeFormatted})`,
        badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
        isUpcoming: true,
      };
    }
    if (diffDays === -1) {
      return {
        label: `Yesterday ${timeFormatted}`,
        badgeClass: "bg-muted text-muted-foreground border-border",
        isPast: true,
      };
    }
    return {
      label: `${Math.abs(diffDays)} days ago (${dateStr})`,
      badgeClass: "bg-muted text-muted-foreground border-border",
      isPast: true,
    };
  };

  return (
    <div className="space-y-6">
      {/* ── UNASSIGNED APPOINTMENTS TOP BANNER ── */}
      {unassignedVisits.length > 0 && (
        <div className="p-3.5 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-600 rounded-lg shrink-0 animate-pulse">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">
                  New Appointment Notification: {unassignedVisits.length} Appointment(s) Awaiting Staff Assignment!
                </span>
                <Badge className="bg-amber-500 text-white border-none text-[10px] px-1.5 py-0 font-bold">
                  Action Required
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Latest: <strong className="text-foreground">{unassignedVisits[0]?.contactName}</strong> ({unassignedVisits[0]?.contactPhone}) — {unassignedVisits[0]?.serviceName || "Appointment"} scheduled for {unassignedVisits[0]?.appointmentDate} at {unassignedVisits[0]?.appointmentTime}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-center flex-wrap">
            <Button
              size="sm"
              onClick={() => autoAssignAllMutation.mutate()}
              disabled={autoAssignAllMutation.isPending}
              className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm"
              title="Automatically assign all unassigned appointments to active staff based on specialty, city, and round-robin workload"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {autoAssignAllMutation.isPending ? "Auto-Assigning..." : "⚡ Smart Auto-Assign All"}
            </Button>
            <Button
              size="sm"
              onClick={() => openAppointModal(unassignedVisits[0])}
              className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-sm"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Assign Staff Now
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
              View Unassigned ({unassignedVisits.length})
            </Button>
          </div>
        </div>
      )}

      {/* ── TOP HEADER & CONTROLS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Staff & Appointments Management
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time appointment alerts, staff assignment, Google Calendar sync, and instant WhatsApp briefings.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchVisits();
              queryClient.invalidateQueries({ queryKey: ["/api/sales-team"] });
              refetchGCalStatus();
              toast({ title: "Refreshed", description: "Checked for new appointments and staff updates." });
            }}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>

          {/* Google Calendar Status & 1-Click Sync */}
          {gcalStatus?.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncCalendarMutation.mutate()}
              disabled={syncCalendarMutation.isPending}
              title={`Connected as ${gcalStatus.email || 'Google User'}. Click to force sync now.`}
              className="h-8 gap-1.5 text-xs border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-medium shadow-xs"
            >
              <span className="relative flex h-2 w-2 mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <CalendarDays className={`w-3.5 h-3.5 text-emerald-600 ${syncCalendarMutation.isPending ? "animate-spin" : ""}`} />
              {syncCalendarMutation.isPending ? "Syncing..." : `Google Calendar (${gcalStatus.email?.split('@')[0] || 'Synced'})`}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const res = await apiRequest("GET", "/api/google-calendar/auth");
                  const data = await res.json();
                  if (data.url) window.location.href = data.url;
                } catch (err: any) {
                  toast({ title: "Connection Error", description: err.message, variant: "destructive" });
                }
              }}
              className="h-8 gap-1.5 text-xs border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-medium"
            >
              <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
              Connect Google Calendar
            </Button>
          )}

          {/* Company Email Setup */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveSubTab("email")}
            title={smtpData?.configured ? `Connected: ${smtpData.settings?.fromEmail}` : "Setup company email gateway for briefings"}
            className={`h-8 gap-1.5 text-xs font-medium shadow-xs ${
              smtpData?.configured
                ? "border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                : "border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
            }`}
          >
            <Mail className={`w-3.5 h-3.5 ${smtpData?.configured ? "text-purple-600" : "text-blue-600"}`} />
            {smtpData?.configured ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Company Email ({smtpData.settings?.fromEmail?.split("@")[0] || "Custom"})
              </span>
            ) : (
              "Setup Company Email"
            )}
          </Button>

          {/* Book New Appointment Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreateVisitForm({
                contactName: "",
                contactPhone: "",
                contactEmail: "",
                serviceName: "",
                appointmentDate: new Date().toISOString().split("T")[0],
                appointmentTime: "",
                staffId: "",
                notes: "",
                notifyWhatsApp: true,
              });
              setCreateVisitDialogOpen(true);
            }}
            className="h-8 gap-1.5 text-xs border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50 font-medium"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            + Book New Appointment
          </Button>

          {/* Add Staff Button */}
          <Button
            size="sm"
            onClick={() => {
              resetStaffForm();
              setStaffDialogOpen(true);
            }}
            className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Staff Member
          </Button>
        </div>
      </div>

      {/* ── ENTERPRISE STATS OVERVIEW CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {/* Total Appointments */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("all"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "all" ? "ring-2 ring-blue-500 bg-blue-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total</span>
              <CalendarDays className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-foreground">{visitsList.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">All Bookings</div>
          </CardContent>
        </Card>

        {/* New / Pending */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("new"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "new" ? "ring-2 ring-sky-500 bg-sky-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400 uppercase tracking-wider">New</span>
              <Clock className="w-4 h-4 text-sky-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-sky-600 dark:text-sky-400">{newVisits.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Awaiting Review</div>
          </CardContent>
        </Card>

        {/* Confirmed */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("confirmed"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "confirmed" ? "ring-2 ring-emerald-500 bg-emerald-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Confirmed</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{confirmedVisits.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Ready to Attend</div>
          </CardContent>
        </Card>

        {/* Upcoming (Today & Future) */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("upcoming"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "upcoming" ? "ring-2 ring-indigo-500 bg-indigo-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Upcoming</span>
              <CalendarClock className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-indigo-600 dark:text-indigo-400">{upcomingVisits.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Today & Future</div>
          </CardContent>
        </Card>

        {/* Overdue & No-Show (Manager View) */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("overdue"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "overdue" ? "ring-2 ring-orange-500 bg-orange-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-orange-700 dark:text-orange-400 uppercase tracking-wider">Overdue / No-Show</span>
              <UserX className="w-4 h-4 text-orange-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-orange-600 dark:text-orange-400">{overdueVisits.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">AI Recovery Queue</div>
          </CardContent>
        </Card>

        {/* Past & Completed */}
        <Card 
          onClick={() => { setActiveSubTab("visits"); setStatusFilter("past"); }}
          className={`cursor-pointer transition-all hover:shadow-xs ${statusFilter === "past" ? "ring-2 ring-purple-500 bg-purple-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wider">Past</span>
              <CalendarCheck className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-purple-600 dark:text-purple-400">{pastVisits.length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Attended History</div>
          </CardContent>
        </Card>

        {/* Active Staff */}
        <Card 
          onClick={() => setActiveSubTab("team")}
          className={`cursor-pointer transition-all hover:shadow-xs ${activeSubTab === "team" ? "ring-2 ring-blue-500 bg-blue-500/5" : ""}`}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Staff</span>
              <Users className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold mt-1 text-foreground">{staffList.filter(s => s.isActive).length}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Active Team Members</div>
          </CardContent>
        </Card>
      </div>

      {/* ── MAIN SUB-TABS NAVIGATION ── */}
      <div className="flex items-center justify-between border-b pb-1 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant={activeSubTab === "visits" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("visits")}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Appointments & Bookings ({visitsList.length})
          </Button>

          <Button
            variant={activeSubTab === "team" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("team")}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            <Users className="w-3.5 h-3.5" />
            Staff & Team Members ({staffList.length})
          </Button>

          <Button
            variant={activeSubTab === "email" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("email")}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            <Mail className="w-3.5 h-3.5" />
            Email Setup & Templates
          </Button>
        </div>
      </div>

      {/* ── TAB 1: APPOINTMENTS & BOOKINGS ── */}
      {activeSubTab === "visits" && (
        <div className="space-y-4">
          {/* Search Bar + Lifecycle Stage Filters */}
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            {/* Search Input */}
            <div className="relative w-full lg:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search client, phone, staff, service..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>

            {/* Lifecycle Filter Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* New & Incoming */}
              <Button
                variant={statusFilter === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("new")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "new"
                    ? "bg-sky-600 hover:bg-sky-700 text-white"
                    : newVisits.length > 0
                    ? "border-sky-500/40 text-sky-700 dark:text-sky-300 font-semibold"
                    : ""
                }`}
              >
                <Clock className="w-3 h-3 text-sky-500" />
                New & Incoming
                <Badge className="ml-1 bg-sky-500/20 text-sky-800 dark:text-sky-200 border-none text-[10px] px-1 py-0 font-bold">
                  {newVisits.length}
                </Badge>
              </Button>

              {/* Confirmed */}
              <Button
                variant={statusFilter === "confirmed" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("confirmed")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "confirmed"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                Confirmed ({confirmedVisits.length})
              </Button>

              {/* Upcoming */}
              <Button
                variant={statusFilter === "upcoming" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("upcoming")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "upcoming"
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                    : "border-indigo-500/30 text-indigo-700 dark:text-indigo-300"
                }`}
              >
                <CalendarClock className="w-3 h-3 text-indigo-500" />
                Upcoming ({upcomingVisits.length})
              </Button>

              {/* Past Appointments */}
              <Button
                variant={statusFilter === "past" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("past")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "past"
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border-purple-500/30 text-purple-700 dark:text-purple-300"
                }`}
              >
                <CalendarCheck className="w-3 h-3 text-purple-500" />
                Past Appointments ({pastVisits.length})
              </Button>

              {/* Cancelled */}
              <Button
                variant={statusFilter === "cancelled" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("cancelled")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "cancelled"
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : cancelledVisits.length > 0
                    ? "border-red-500/30 text-red-700 dark:text-red-300"
                    : ""
                }`}
              >
                <XCircle className="w-3 h-3 text-red-500" />
                Cancelled ({cancelledVisits.length})
              </Button>

              {/* Needs Staff Filter */}
              <Button
                variant={statusFilter === "unassigned" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("unassigned")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "unassigned"
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : unassignedVisits.length > 0
                    ? "border-amber-500/40 text-amber-700 dark:text-amber-400 font-semibold"
                    : ""
                }`}
              >
                <AlertCircle className="w-3 h-3 text-amber-500" />
                Needs Staff ({unassignedVisits.length})
              </Button>

              {/* Overdue & No-Show Filter (Manager View) */}
              <Button
                variant={statusFilter === "overdue" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("overdue")}
                className={`h-7 text-xs px-2.5 gap-1.5 ${
                  statusFilter === "overdue"
                    ? "bg-orange-600 hover:bg-orange-700 text-white"
                    : overdueVisits.length > 0
                    ? "border-orange-500/40 text-orange-700 dark:text-orange-400 font-semibold"
                    : ""
                }`}
              >
                <UserX className="w-3 h-3 text-orange-500" />
                Overdue & No-Show ({overdueVisits.length})
              </Button>

              {/* All */}
              <Button
                variant={statusFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs px-2"
              >
                All ({visitsList.length})
              </Button>
            </div>
          </div>

          {/* Appointments List */}
          {filteredVisits.length === 0 ? (
            <Card className="border-dashed p-8 text-center text-muted-foreground">
              <CalendarDays className="w-9 h-9 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-semibold text-foreground">No appointments found in this category.</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                {statusFilter === "new"
                  ? "No pending new appointments! All incoming bookings have been confirmed or attended."
                  : statusFilter === "confirmed"
                  ? "No confirmed appointments right now. Confirm appointments from the 'New & Incoming' queue."
                  : statusFilter === "upcoming"
                  ? "No upcoming appointments scheduled for today or upcoming dates."
                  : statusFilter === "past"
                  ? "No past appointments found in records."
                  : statusFilter === "cancelled"
                  ? "No cancelled appointments recorded."
                  : statusFilter === "unassigned"
                  ? "Great! All appointments currently have dedicated staff members assigned."
                  : "When callers book appointments via AI voice calls or Google Calendar, they will automatically appear here."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateVisitDialogOpen(true)}
                className="mt-3 text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Book New Appointment
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredVisits.map((visit) => {
                const unassigned = isUnassigned(visit);
                const confirmed = isConfirmed(visit);
                const completed = isCompleted(visit);
                const cancelled = isCancelled(visit);
                const past = isPast(visit);
                const relDate = getRelativeDateInfo(visit.appointmentDate, visit.appointmentTime);

                return (
                  <Card 
                    key={visit.id} 
                    className={`transition-all border hover:shadow-xs ${
                      cancelled
                        ? "border-l-4 border-l-red-500 bg-red-500/[0.02] opacity-85"
                        : confirmed
                        ? "border-l-4 border-l-emerald-500 bg-emerald-500/[0.02]"
                        : completed
                        ? "border-l-4 border-l-purple-500 bg-purple-500/[0.02]"
                        : unassigned
                        ? "border-l-4 border-l-amber-500 bg-amber-500/[0.02]"
                        : "border-l-4 border-l-blue-500 hover:border-blue-500/40"
                    }`}
                  >
                    <CardContent className="p-4 space-y-3">
                      {/* Top Row: Client Info, Relative Timing, and Status Badge */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        {/* Client Identity & Contact */}
                        <div className="flex items-center gap-2.5 flex-wrap">
                          {/* Avatar Initials */}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            completed 
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                              : confirmed
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : cancelled
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          }`}>
                            {visit.contactName ? visit.contactName.slice(0, 2).toUpperCase() : "AP"}
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-foreground">{visit.contactName}</span>
                              
                              <Badge variant="outline" className={`text-[10px] px-2 py-0.5 border ${relDate.badgeClass}`}>
                                <Clock className="w-2.5 h-2.5 mr-1" />
                                {relDate.label}
                              </Badge>

                              {/* Google Calendar Direct Link Badge */}
                              {visit.googleCalendarEventId ? (
                                <a
                                  href={getGoogleCalendarUrl(visit)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500 transition-all cursor-pointer group shadow-2xs"
                                  title="Click to open this exact booking in Google Calendar in a new tab"
                                >
                                  <CalendarDays className="w-3 h-3 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                                  <span>Google Calendar</span>
                                  <ExternalLink className="w-2.5 h-2.5 text-indigo-500" />
                                </a>
                              ) : gcalStatus?.connected ? (
                                <button
                                  type="button"
                                  onClick={() => pushToCalendarMutation.mutate(visit.id)}
                                  disabled={pushToCalendarMutation.isPending}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-indigo-500/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                                  title="Sync this appointment to Google Calendar"
                                >
                                  <CalendarDays className="w-3 h-3 text-indigo-500" />
                                  <span>+ Sync to Google Calendar</span>
                                </button>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mt-0.5">
                              <a 
                                href={`tel:${visit.contactPhone}`} 
                                className="flex items-center gap-1 hover:text-foreground font-medium transition-colors"
                              >
                                <Phone className="w-3 h-3 text-muted-foreground" />
                                {visit.contactPhone}
                              </a>
                              {visit.contactEmail && (
                                <a 
                                  href={`mailto:${visit.contactEmail}`}
                                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                                >
                                  <Mail className="w-3 h-3 text-muted-foreground" />
                                  {visit.contactEmail}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                          {cancelled ? (
                            <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              Cancelled
                            </Badge>
                          ) : visit.status === "no_show" ? (
                            <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <UserX className="w-3.5 h-3.5 text-orange-600" />
                              No-Show (AI Recovery)
                            </Badge>
                          ) : completed ? (
                            <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <CalendarCheck className="w-3.5 h-3.5 text-purple-600" />
                              {visit.status === "deal_won" ? "Deal Won / Converted" : "Completed / Attended"}
                            </Badge>
                          ) : confirmed ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Confirmed
                            </Badge>
                          ) : unassigned ? (
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                              Awaiting Staff
                            </Badge>
                          ) : (
                            <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 text-xs gap-1 py-1 px-2.5 font-semibold">
                              <Clock className="w-3.5 h-3.5 text-sky-600" />
                              New / Scheduled
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Middle Details Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-2.5 rounded-lg bg-muted/40 border text-xs">
                        {/* Service & Purpose */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                            Service / Purpose
                          </span>
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span>{visit.serviceName || "Scheduled Appointment"}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="w-3 h-3 text-muted-foreground" />
                            <span>{visit.appointmentDate} at {visit.appointmentTime} ({visit.duration || 30} mins)</span>
                          </div>
                        </div>

                        {/* Assigned Staff Member */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                            Assigned Staff Member
                          </span>
                          {unassigned ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-amber-600 dark:text-amber-400 font-medium text-xs">
                                No staff assigned
                              </span>
                              <Button
                                size="sm"
                                onClick={() => openAppointModal(visit)}
                                className="h-6 text-[11px] px-2 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                              >
                                + Appoint Staff
                              </Button>
                              {staffList.filter((s) => s.isActive).length > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={autoAssignSingleMutation.isPending}
                                  onClick={() => autoAssignSingleMutation.mutate(visit.id)}
                                  className="h-6 text-[11px] px-2 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 font-medium gap-1"
                                  title="Smart auto-assign based on specialty, city & lowest workload"
                                >
                                  <Sparkles className="w-3 h-3 text-indigo-600" />
                                  Auto-Assign
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <div>
                                  <span className="font-semibold text-foreground">{visit.assignedStaffName}</span>
                                  {visit.assignedStaffPhone && (
                                    <span className="text-[11px] text-muted-foreground ml-1">
                                      ({visit.assignedStaffPhone})
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openAppointModal(visit)}
                                  className="h-5 px-1.5 text-[10px] text-blue-600 hover:text-blue-700"
                                >
                                  Change
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Unassign staff for ${visit.contactName}?`)) {
                                      unassignVisitMutation.mutate(visit.id);
                                    }
                                  }}
                                  className="h-5 px-1.5 text-[10px] text-amber-600 hover:text-amber-700"
                                >
                                  Unassign
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Booking Notes / Call Transcript Summary */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                            Booking Notes & Requirements
                          </span>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">
                            {visit.notes || "Standard appointment booking."}
                          </p>
                        </div>
                      </div>

                      {/* Cancellation Reason or Completion Outcome Banner */}
                      {cancelled && visit.statusReason && (
                        <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <strong className="font-semibold">Cancellation Reason:</strong> {visit.statusReason}
                          </div>
                        </div>
                      )}

                      {completed && (
                        <div className="p-2 rounded-md bg-purple-500/10 border border-purple-500/20 text-xs text-purple-700 dark:text-purple-300 flex items-start gap-2">
                          <CalendarCheck className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="font-semibold">Meeting Outcome:</strong> {visit.statusReason || "Appointment completed successfully."}
                          </div>
                        </div>
                      )}

                      {/* Bottom Action Controls Toolbar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t">
                        {/* Left Actions: Lifecycle status updates */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Confirm Button (for New/Scheduled) */}
                          {!confirmed && !completed && !cancelled && (
                            <Button
                              size="sm"
                              onClick={() => confirmAppointmentMutation.mutate(visit.id)}
                              disabled={confirmAppointmentMutation.isPending}
                              className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirm Appointment
                            </Button>
                          )}

                          {/* Direct Google Calendar Button */}
                          {visit.googleCalendarEventId ? (
                            <a
                              href={getGoogleCalendarUrl(visit)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs font-semibold border border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/60 transition-all cursor-pointer shadow-2xs group"
                              title="Click to open and view this exact booking in Google Calendar"
                            >
                              <CalendarDays className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                              <span>View in Google Calendar</span>
                              <ExternalLink className="w-3 h-3 text-indigo-500" />
                            </a>
                          ) : gcalStatus?.connected ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => pushToCalendarMutation.mutate(visit.id)}
                              disabled={pushToCalendarMutation.isPending}
                              className="h-7 text-xs gap-1 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                              title="Push this booking to Google Calendar"
                            >
                              <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
                              {pushToCalendarMutation.isPending ? "Syncing..." : "Sync to Google Calendar"}
                            </Button>
                          ) : null}

                          {/* Mark Completed Button */}
                          {!completed && !cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openCompleteModal(visit)}
                              className="h-7 text-xs gap-1 border-purple-500/30 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                            >
                              <CalendarCheck className="w-3.5 h-3.5 text-purple-600" />
                              Mark Attended / Completed
                            </Button>
                          )}

                          {/* Send Reminder Button (WhatsApp + Email) */}
                          {!completed && !cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendReminderMutation.isPending}
                              onClick={() => sendReminderMutation.mutate({ visitId: visit.id, triggerVoiceCall: false })}
                              className="h-7 text-xs gap-1 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              title="Send automated WhatsApp & Email appointment reminder to client"
                            >
                              <Bell className="w-3.5 h-3.5 text-amber-600" />
                              Send Reminder
                            </Button>
                          )}

                          {/* No-Show Recovery Button (AI Recovery Call + WhatsApp Reschedule) */}
                          {!completed && !cancelled && visit.status !== "no_show" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={noShowRecoveryMutation.isPending}
                              onClick={() => {
                                if (confirm(`Mark ${visit.contactName} as No-Show and trigger AI Recovery Call + WhatsApp reschedule message?`)) {
                                  noShowRecoveryMutation.mutate({ visitId: visit.id });
                                }
                              }}
                              className="h-7 text-xs gap-1 border-orange-500/40 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40"
                              title="Mark as No-Show and automatically schedule an AI Voice Call & WhatsApp to reschedule"
                            >
                              <UserX className="w-3.5 h-3.5 text-orange-600" />
                              No-Show (AI Recovery)
                            </Button>
                          )}

                          {/* Reschedule Button */}
                          {!completed && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRescheduleModal(visit)}
                              className="h-7 text-xs gap-1 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                            >
                              <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
                              Reschedule
                            </Button>
                          )}

                          {/* Cancel Button */}
                          {!cancelled && !completed && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openCancelModal(visit)}
                              className="h-7 text-xs gap-1 border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                              Cancel
                            </Button>
                          )}

                          {/* Reopen Button for Cancelled */}
                          {cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRescheduleModal(visit)}
                              className="h-7 text-xs gap-1 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                              Reopen & Reschedule
                            </Button>
                          )}
                        </div>

                        {/* Right Actions: 1-Click WhatsApp Dispatches */}
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendStaffWhatsApp(visit)}
                            disabled={unassigned}
                            title={unassigned ? "Assign staff first to notify" : "Send WhatsApp briefing to assigned staff"}
                            className="h-7 text-xs gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40"
                          >
                            <MessageSquare className="w-3 h-3 text-emerald-600" />
                            Notify Staff
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendClientWhatsApp(visit)}
                            title="Send WhatsApp confirmation & staff details to client"
                            className="h-7 text-xs gap-1.5 border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          >
                            <Send className="w-3 h-3 text-blue-600" />
                            Notify Client
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: STAFF & TEAM MEMBERS ── */}
      {activeSubTab === "team" && (
        <div className="space-y-4">
          {staffList.length === 0 ? (
            <Card className="border-dashed p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No staff members added yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add your team members, doctors, or consultants to assign them to incoming customer appointments.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  resetStaffForm();
                  setStaffDialogOpen(true);
                }}
                className="mt-3 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Add First Staff Member
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
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-none text-[10px] px-1.5 py-0 font-semibold">
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

                    {/* Assigned Services/Projects */}
                    {Array.isArray(staff.assignedProjects) && staff.assignedProjects.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Specialties & Services</p>
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
                      <span className="text-muted-foreground">Assigned Appointments:</span>
                      <span className="font-semibold text-blue-600">{staff.totalVisitsCount || 0}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: EMAIL SETUP & TEMPLATES ── */}
      {activeSubTab === "email" && (
        <EmailNotificationManager />
      )}

      {/* ════════════════════════════════════════════════════════════
          DIALOG 1: APPOINT / REASSIGN STAFF MEMBER
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={appointDialogOpen} onOpenChange={setAppointDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              Assign Staff Member
            </DialogTitle>
            <DialogDescription className="text-xs">
              Assign a staff member, doctor, or consultant to attend this customer's appointment.
            </DialogDescription>
          </DialogHeader>

          {selectedVisitForAppoint && (
            <div className="space-y-4 py-2 text-xs">
              {/* Summary Box */}
              <div className="p-3 rounded-lg bg-muted/60 border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground text-sm">
                    {selectedVisitForAppoint.contactName}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {selectedVisitForAppoint.serviceName || "Appointment"}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Phone className="w-3 h-3 text-muted-foreground" />
                    {selectedVisitForAppoint.contactPhone}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3 text-blue-500" />
                    {selectedVisitForAppoint.appointmentDate} at {selectedVisitForAppoint.appointmentTime}
                  </span>
                </div>
              </div>

              {/* Staff Select */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Select Staff Member *</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={autoAssignSingleMutation.isPending}
                    onClick={() => {
                      if (selectedVisitForAppoint) {
                        autoAssignSingleMutation.mutate(selectedVisitForAppoint.id, {
                          onSuccess: () => setAppointDialogOpen(false),
                        });
                      }
                    }}
                    className="h-6 text-[11px] px-2 border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 font-semibold gap-1"
                    title="Automatically pick & assign the best staff member based on specialty, city & workload"
                  >
                    <Sparkles className="w-3 h-3 text-indigo-500" />
                    {autoAssignSingleMutation.isPending ? "Auto-Assigning..." : "⚡ Smart Auto-Assign Best Staff"}
                  </Button>
                </div>
                <Select
                  value={appointForm.staffId}
                  onValueChange={(val) => setAppointForm({ ...appointForm, staffId: val })}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="-- Select Staff Member --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned" className="text-amber-600 font-medium">
                      -- Assign Later (Unassigned) --
                    </SelectItem>
                    {staffList
                      .filter((s) => s.isActive)
                      .map((staff) => (
                        <SelectItem key={staff.id} value={staff.id}>
                          {staff.name} — {staff.role} ({staff.phone})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Client Email for Confirmation */}
              <div className="space-y-1.5">
                <Label className="text-xs">Customer Email Address</Label>
                <Input
                  type="email"
                  placeholder="customer@example.com"
                  value={appointForm.clientEmail}
                  onChange={(e) => setAppointForm({ ...appointForm, clientEmail: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              {/* Admin Instructions / Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Instructions for Assigned Staff</Label>
                <Textarea
                  placeholder="Special instructions, patient history, client budget, or meeting agenda..."
                  value={appointForm.notes}
                  onChange={(e) => setAppointForm({ ...appointForm, notes: e.target.value })}
                  rows={3}
                  className="text-xs resize-none"
                />
              </div>

              {/* Notification Toggles */}
              <div className="pt-2 border-t space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs">Send Email Confirmation to Customer</span>
                  <Switch
                    checked={appointForm.sendEmailToClient}
                    onCheckedChange={(checked) => setAppointForm({ ...appointForm, sendEmailToClient: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Send Email Briefing to Assigned Staff</span>
                  <Switch
                    checked={appointForm.sendEmailToStaff}
                    onCheckedChange={(checked) => setAppointForm({ ...appointForm, sendEmailToStaff: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Auto-Open WhatsApp Briefing for Staff</span>
                  <Switch
                    checked={appointForm.notifyStaffWhatsApp}
                    onCheckedChange={(checked) => setAppointForm({ ...appointForm, notifyStaffWhatsApp: checked })}
                  />
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
              disabled={assignVisitMutation.isPending}
              onClick={() => {
                if (selectedVisitForAppoint) {
                  assignVisitMutation.mutate({
                    visitId: selectedVisitForAppoint.id,
                    staffId: appointForm.staffId,
                    notes: appointForm.notes,
                    clientEmail: appointForm.clientEmail,
                    sendEmailToStaff: appointForm.sendEmailToStaff,
                    sendEmailToClient: appointForm.sendEmailToClient,
                  });
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              <UserCheck className="w-3.5 h-3.5" />
              {assignVisitMutation.isPending ? "Assigning..." : "Confirm & Save Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════
          DIALOG 2: RESCHEDULE APPOINTMENT
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-indigo-600" />
              Reschedule Appointment
            </DialogTitle>
            <DialogDescription className="text-xs">
              Change the scheduled date and time for {selectedVisitForReschedule?.contactName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">New Date *</Label>
                <Input
                  type="date"
                  value={rescheduleForm.appointmentDate}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, appointmentDate: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">New Time *</Label>
                <Input
                  type="time"
                  value={rescheduleForm.appointmentTime}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, appointmentTime: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Reason / Reschedule Notes</Label>
              <Textarea
                placeholder="Reason for rescheduling or customer preference..."
                value={rescheduleForm.notes}
                onChange={(e) => setRescheduleForm({ ...rescheduleForm, notes: e.target.value })}
                rows={3}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRescheduleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={rescheduleAppointmentMutation.isPending}
              onClick={() => {
                if (selectedVisitForReschedule) {
                  rescheduleAppointmentMutation.mutate({
                    visitId: selectedVisitForReschedule.id,
                    appointmentDate: rescheduleForm.appointmentDate,
                    appointmentTime: rescheduleForm.appointmentTime,
                    notes: rescheduleForm.notes,
                  });
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {rescheduleAppointmentMutation.isPending ? "Rescheduling..." : "Save New Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════
          DIALOG 3: CANCEL APPOINTMENT
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-red-600">
              <XCircle className="w-4 h-4 text-red-600" />
              Cancel Appointment
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to cancel the appointment for{" "}
              <strong className="text-foreground">{selectedVisitForCancel?.contactName}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Select or Enter Reason for Cancellation</Label>
              <Select onValueChange={(val) => setCancelReason(val)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="-- Quick Reasons --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Customer requested cancellation">Customer requested cancellation</SelectItem>
                  <SelectItem value="Customer not reachable / no answer">Customer not reachable / no answer</SelectItem>
                  <SelectItem value="Customer no longer interested">Customer no longer interested</SelectItem>
                  <SelectItem value="Staff unavailable / scheduling conflict">Staff unavailable / scheduling conflict</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Detailed Cancellation Notes</Label>
              <Textarea
                placeholder="Enter cancellation reason or feedback..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelDialogOpen(false)}>
              Keep Appointment
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={cancelAppointmentMutation.isPending}
              onClick={() => {
                if (selectedVisitForCancel) {
                  cancelAppointmentMutation.mutate({
                    visitId: selectedVisitForCancel.id,
                    reason: cancelReason || "Cancelled by user",
                  });
                }
              }}
            >
              {cancelAppointmentMutation.isPending ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════
          DIALOG 4: MARK COMPLETED / ATTENDED OUTCOME
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-purple-700 dark:text-purple-300">
              <CalendarCheck className="w-4 h-4 text-purple-600" />
              Record Appointment Outcome
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mark appointment as attended/completed and save notes to historical records.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Outcome Status *</Label>
              <Select value={completeOutcome} onValueChange={setCompleteOutcome}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed_visited">Attended & Completed</SelectItem>
                  <SelectItem value="deal_won">Deal Won / Converted</SelectItem>
                  <SelectItem value="interested_followup">Interested - Follow-up Needed</SelectItem>
                  <SelectItem value="no_show">Client Did Not Attend (No-show)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Meeting Notes & Summary</Label>
              <Textarea
                placeholder="What happened during the meeting? Any follow-up tasks or feedback..."
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                rows={3}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={completeAppointmentMutation.isPending || noShowRecoveryMutation.isPending}
              onClick={() => {
                if (selectedVisitForComplete) {
                  if (completeOutcome === "no_show") {
                    noShowRecoveryMutation.mutate({
                      visitId: selectedVisitForComplete.id,
                      notes: completeNotes,
                    });
                  } else {
                    completeAppointmentMutation.mutate({
                      visitId: selectedVisitForComplete.id,
                      status: completeOutcome,
                      statusReason: completeNotes,
                    });
                  }
                }
              }}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {completeAppointmentMutation.isPending || noShowRecoveryMutation.isPending ? "Saving..." : "Save Outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════
          DIALOG 5: MANUAL BOOK NEW APPOINTMENT
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={createVisitDialogOpen} onOpenChange={setCreateVisitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-600" />
              Book & Schedule New Appointment
            </DialogTitle>
            <DialogDescription className="text-xs">
              Manually schedule a customer appointment and assign a staff member.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Customer Full Name *</Label>
              <Input
                placeholder="e.g. John Doe / Amit Sharma"
                value={createVisitForm.contactName}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactName: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Phone Number *</Label>
                <Input
                  placeholder="e.g. +91 98765 43210"
                  value={createVisitForm.contactPhone}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactPhone: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email Address</Label>
                <Input
                  type="email"
                  placeholder="e.g. client@example.com"
                  value={createVisitForm.contactEmail}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, contactEmail: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Service / Purpose / Specialty</Label>
              <Input
                placeholder="e.g. Consultation / Checkup / Property Visit"
                value={createVisitForm.serviceName}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, serviceName: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Appointment Date *</Label>
                <Input
                  type="date"
                  value={createVisitForm.appointmentDate}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, appointmentDate: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Appointment Time *</Label>
                <Input
                  type="time"
                  value={createVisitForm.appointmentTime}
                  onChange={(e) => setCreateVisitForm({ ...createVisitForm, appointmentTime: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Assign Staff Member</Label>
              <Select
                value={createVisitForm.staffId}
                onValueChange={(val) => setCreateVisitForm({ ...createVisitForm, staffId: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="-- Select Staff (or Assign Later) --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">-- Assign Later (Unassigned) --</SelectItem>
                  {staffList
                    .filter((s) => s.isActive)
                    .map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.name} — {staff.role}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Special Notes / Requirements</Label>
              <Textarea
                placeholder="Enter client requirements or meeting agenda..."
                value={createVisitForm.notes}
                onChange={(e) => setCreateVisitForm({ ...createVisitForm, notes: e.target.value })}
                rows={2}
                className="text-xs resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">Auto-Open WhatsApp Briefing</span>
              <Switch
                checked={createVisitForm.notifyWhatsApp}
                onCheckedChange={(checked) => setCreateVisitForm({ ...createVisitForm, notifyWhatsApp: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateVisitDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                createVisitMutation.isPending ||
                !createVisitForm.contactName.trim() ||
                !createVisitForm.contactPhone.trim() ||
                !createVisitForm.appointmentDate ||
                !createVisitForm.appointmentTime
              }
              onClick={() => createVisitMutation.mutate(createVisitForm)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createVisitMutation.isPending ? "Booking..." : "Book & Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════
          DIALOG 6: ADD / EDIT STAFF MEMBER
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingStaff ? "Edit Staff Member" : "Add Staff Member"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Staff members will receive automated appointment alerts and briefings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Full Name *</Label>
              <Input
                placeholder="e.g. Dr. Ramesh Gupta / Rahul Verma"
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">WhatsApp / Phone *</Label>
                <Input
                  placeholder="e.g. +91 98765 43210"
                  value={staffForm.phone}
                  onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email Address</Label>
                <Input
                  type="email"
                  placeholder="e.g. staff@example.com"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Role / Title</Label>
                <Input
                  placeholder="e.g. Doctor, Specialist, Consultant, Executive"
                  value={staffForm.role}
                  onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City / Branch</Label>
                <Input
                  placeholder="e.g. Mumbai, Delhi, Branch A"
                  value={staffForm.city}
                  onChange={(e) => setStaffForm({ ...staffForm, city: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Specialties / Assigned Services (comma separated)</Label>
              <Input
                placeholder="e.g. Cardiology, OPD, Consultation, General"
                value={staffForm.assignedProjects}
                onChange={(e) => setStaffForm({ ...staffForm, assignedProjects: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Internal Notes</Label>
              <Textarea
                placeholder="Internal notes or shift timings..."
                value={staffForm.notes}
                onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })}
                rows={2}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setStaffDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={createStaffMutation.isPending || updateStaffMutation.isPending || !staffForm.name.trim() || !staffForm.phone.trim()}
              onClick={() => {
                if (editingStaff) {
                  const projects = staffForm.assignedProjects
                    .split(",")
                    .map((p) => p.trim())
                    .filter(Boolean);
                  updateStaffMutation.mutate({
                    id: editingStaff.id,
                    data: { ...staffForm, assignedProjects: projects },
                  });
                } else {
                  createStaffMutation.mutate(staffForm);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createStaffMutation.isPending || updateStaffMutation.isPending
                ? "Saving..."
                : editingStaff
                ? "Save Changes"
                : "Add Staff Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
