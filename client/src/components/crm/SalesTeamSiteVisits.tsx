import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Users, UserCheck, CalendarDays, Phone, Mail, MapPin, Building, 
  Plus, RefreshCw, MessageSquare, CheckCircle2, Clock, Check, 
  Trash2, Edit, AlertCircle, Sparkles, Send, Filter, Search, MoreHorizontal,
  Bell, UserPlus, FileText, CheckSquare, ShieldCheck, ArrowRight,
  XCircle, CalendarClock, CalendarCheck, HelpCircle, X, ExternalLink,
  ChevronRight, Calendar as CalendarIcon, UserX, Settings2, Bot, Zap
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

interface BookingTypeTemplate {
  id: string;
  label: string;
  serviceKeywords: string;
  voiceScript: string;
  whatsappMessage: string;
  agentId?: string;
}

interface ReminderAutomationConfig {
  autoReminderEnabled: boolean;
  reminder1OffsetMinutes: number;
  reminder2Enabled: boolean;
  reminder2OffsetMinutes: number;
  reminderChannels: {
    whatsapp: boolean;
    email: boolean;
    voiceCall: boolean;
  };
  reminderAgentId: string;
  autoNoShowEnabled: boolean;
  noShowAfterMinutes: number;
  noShowChannels: {
    whatsapp: boolean;
    voiceCall: boolean;
  };
  noShowAgentId: string;
  noShowVoiceScript: string;
  noShowWhatsappMessage: string;
  bookingTypeTemplates: BookingTypeTemplate[];
}

export function SalesTeamSiteVisits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<"visits" | "team" | "email" | "automation">("visits");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "confirmed" | "upcoming" | "past" | "cancelled" | "unassigned" | "overdue">("all");

  // Automation Controller State
  const [automationForm, setAutomationForm] = useState<ReminderAutomationConfig>({
    autoReminderEnabled: true,
    reminder1OffsetMinutes: 1440,
    reminder2Enabled: true,
    reminder2OffsetMinutes: 120,
    reminderChannels: { whatsapp: true, email: true, voiceCall: true },
    reminderAgentId: "default",
    autoNoShowEnabled: true,
    noShowAfterMinutes: 30,
    noShowChannels: { whatsapp: true, voiceCall: true },
    noShowAgentId: "default",
    noShowVoiceScript:
      "Namaste {customer_name} ji! Main {business_name} se call kar rahi hoon. Aaj {time} par aapki '{service_name}' ki appointment thi, lekin shayad aap kisi kaaran se nahi aa paaye. Kya main aapki appointment kisi naye date aur time ke liye reschedule kar doon?",
    noShowWhatsappMessage:
      "*Namaste {customer_name} ji!* 🙏\n\nHumne dekha ki aap aaj ({date}) *{time}* par apni *{service_name}* appointment mein shamil nahi ho paaye.\n\nAgar aap kisi naye din ya samay ke liye apni appointment *Reschedule* karna chahte hain, toh kripya is message ka reply karein!",
    bookingTypeTemplates: [
      {
        id: "general",
        label: "General Booking (Default)",
        serviceKeywords: "general, appointment, consultation, meeting, booking",
        voiceScript:
          "Namaste {customer_name} ji! Main {business_name} se call kar rahi hoon. Yeh call aapki '{service_name}' appointment ke reminder ke liye hai, jo {date} ko {time} par scheduled hai. Hamare {staff_name} aapko attend karenge. Kya aap is samay par aane ke liye confirm karte hain?",
        whatsappMessage:
          "*🔔 Appointment Reminder — {business_name}*\n\nNamaste *{customer_name}* ji! 🙏\nYeh aapki upcoming appointment ka friendly reminder hai:\n\n📋 *Service:* {service_name}\n📅 *Date:* {date}\n⏰ *Time:* {time}\n👤 *Assigned Staff:* {staff_name}\n\nHum aapka intezaar karenge!",
      },
      {
        id: "doctor_clinic",
        label: "🏥 Doctor / Clinic Consultation",
        serviceKeywords: "doctor, clinic, hospital, medical, neurology, dental, checkup, health, patient",
        voiceScript:
          "Namaste {customer_name} ji! Main {business_name} Clinic se bol rahi hoon. Aapki Doctor Consultation ('{service_name}') {date} ko {time} par Dr. {staff_name} ke saath book hai. Kripya samay se 10 minute pehle pahunchein. Kya aap apni visit confirm karte hain?",
        whatsappMessage:
          "*🏥 Clinic Appointment Reminder — {business_name}*\n\nNamaste *{customer_name}* ji! 🙏\nAapki Doctor Consultation ka reminder:\n\n🩺 *Consultation:* {service_name}\n📅 *Date:* {date}\n⏰ *Time:* {time}\n👨‍⚕️ *Doctor / Specialist:* {staff_name}\n\nKripya apni purani reports saath layein aur 10 min pehle pahunchein.",
      },
      {
        id: "real_estate",
        label: "🏢 Real Estate / Property Site Visit",
        serviceKeywords: "site visit, property, flat, plot, villa, realty, home, project, residency, sector",
        voiceScript:
          "Namaste {customer_name} ji! Main {business_name} se call kar rahi hoon. Aapki '{service_name}' ki Property Site Visit {date} ko {time} par scheduled hai. Hamare Property Expert {staff_name} aapko site par milenge. Kya aapki site visit confirm hai?",
        whatsappMessage:
          "*🏢 Property Site Visit Reminder — {business_name}*\n\nNamaste *{customer_name}* ji! 🙏\nAapki Property Site Visit ka reminder:\n\n🏡 *Project / Property:* {service_name}\n📅 *Date:* {date}\n⏰ *Time:* {time}\n🤝 *Property Advisor:* {staff_name}\n\nSite location ya cab assistance ke liye reply karein!",
      },
      {
        id: "custom_service",
        label: "✏️ Custom Service / Special Booking",
        serviceKeywords: "custom, special, demo, vip, interview, salon, spa",
        voiceScript:
          "Namaste {customer_name} ji! {business_name} ki taraf se aapki '{service_name}' booking ({date} at {time}) ka reminder call hai. Kya aap is samay par available rahenge?",
        whatsappMessage:
          "*✨ Special Booking Reminder — {business_name}*\n\nNamaste *{customer_name}* ji!\nAapki *{service_name}* booking *{date}* ko *{time}* par *{staff_name}* ke saath confirm hai.",
      },
    ],
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("general");
  const [customReminder1Value, setCustomReminder1Value] = useState<number>(24);
  const [customReminder1Unit, setCustomReminder1Unit] = useState<"minutes" | "hours" | "days">("hours");
  const [customReminder2Value, setCustomReminder2Value] = useState<number>(2);
  const [customReminder2Unit, setCustomReminder2Unit] = useState<"minutes" | "hours">("hours");
  const [customNoShowValue, setCustomNoShowValue] = useState<number>(30);
  const [customNoShowUnit, setCustomNoShowUnit] = useState<"minutes" | "hours">("minutes");

  // Custom Per-Card Reminder Dialog State
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [selectedVisitForReminder, setSelectedVisitForReminder] = useState<SiteVisit | null>(null);
  const [manualReminderForm, setManualReminderForm] = useState({
    bookingTypeId: "general",
    triggerVoiceCall: true,
    triggerWhatsapp: true,
    triggerEmail: true,
    customAgentId: "default",
    delaySeconds: 15,
    customVoiceScript: "",
    customWhatsappMessage: "",
  });

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

  // AI Voice Agents List (for Reminder & No-Show Agent selection)
  const { data: agentsList = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/agents"],
  });

  // Dynamic Reminder & No-Show Automation Config
  const { data: savedAutomationConfig } = useQuery<ReminderAutomationConfig>({
    queryKey: ["/api/sales-team/reminder-automation-config"],
  });

  useEffect(() => {
    if (savedAutomationConfig) {
      const raw = savedAutomationConfig as any;
      const safeReminderChannels = {
        whatsapp: raw.reminderChannels?.whatsapp ?? raw.reminderWhatsappEnabled ?? true,
        email: raw.reminderChannels?.email ?? raw.reminderEmailEnabled ?? true,
        voiceCall: raw.reminderChannels?.voiceCall ?? raw.reminderVoiceCallEnabled ?? true,
      };
      const safeNoShowChannels = {
        whatsapp: raw.noShowChannels?.whatsapp ?? raw.noShowWhatsappEnabled ?? true,
        voiceCall: raw.noShowChannels?.voiceCall ?? raw.noShowVoiceCallEnabled ?? true,
      };
      setAutomationForm((prev) => ({
        ...prev,
        ...savedAutomationConfig,
        reminderChannels: safeReminderChannels,
        noShowChannels: safeNoShowChannels,
        bookingTypeTemplates:
          Array.isArray(savedAutomationConfig.bookingTypeTemplates) &&
          savedAutomationConfig.bookingTypeTemplates.length > 0
            ? savedAutomationConfig.bookingTypeTemplates
            : prev.bookingTypeTemplates,
      }));
      if (savedAutomationConfig.bookingTypeTemplates?.length > 0) {
        setSelectedTemplateId(savedAutomationConfig.bookingTypeTemplates[0].id);
      }
      // Sync custom time helper states
      const r1 = savedAutomationConfig.reminder1OffsetMinutes || 1440;
      if (r1 % 1440 === 0) {
        setCustomReminder1Unit("days");
        setCustomReminder1Value(r1 / 1440);
      } else if (r1 % 60 === 0) {
        setCustomReminder1Unit("hours");
        setCustomReminder1Value(r1 / 60);
      } else {
        setCustomReminder1Unit("minutes");
        setCustomReminder1Value(r1);
      }

      const r2 = savedAutomationConfig.reminder2OffsetMinutes || 120;
      if (r2 % 60 === 0) {
        setCustomReminder2Unit("hours");
        setCustomReminder2Value(r2 / 60);
      } else {
        setCustomReminder2Unit("minutes");
        setCustomReminder2Value(r2);
      }

      const ns = savedAutomationConfig.noShowAfterMinutes || 30;
      if (ns >= 60 && ns % 60 === 0) {
        setCustomNoShowUnit("hours");
        setCustomNoShowValue(ns / 60);
      } else {
        setCustomNoShowUnit("minutes");
        setCustomNoShowValue(ns);
      }
    }
  }, [savedAutomationConfig]);

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

  // 10. Pre-Appointment Reminder Mutation (WhatsApp + Email + Optional AI Voice Call + Custom Overrides)
  const sendReminderMutation = useMutation({
    mutationFn: async ({
      visitId,
      triggerVoiceCall,
      triggerWhatsapp,
      triggerEmail,
      customVoiceScript,
      customWhatsappMessage,
      customAgentId,
      delaySeconds,
    }: {
      visitId: string;
      triggerVoiceCall?: boolean;
      triggerWhatsapp?: boolean;
      triggerEmail?: boolean;
      customVoiceScript?: string;
      customWhatsappMessage?: string;
      customAgentId?: string;
      delaySeconds?: number;
    }) => {
      const res = await apiRequest("POST", `/api/sales-team/site-visits/${visitId}/send-reminder`, {
        reminderType: "manual",
        triggerVoiceCall,
        triggerWhatsapp,
        triggerEmail,
        customVoiceScript,
        customWhatsappMessage,
        customAgentId,
        delaySeconds,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-team/site-visits/all"] });
      setReminderDialogOpen(false);
      setSelectedVisitForReminder(null);
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

  // 10B. Save Dynamic Reminder & No-Show Automation Config Mutation
  const saveAutomationMutation = useMutation({
    mutationFn: async (config: ReminderAutomationConfig) => {
      const res = await apiRequest("PUT", "/api/sales-team/reminder-automation-config", config);
      return res.json();
    },
    onSuccess: (saved: ReminderAutomationConfig) => {
      queryClient.setQueryData(["/api/sales-team/reminder-automation-config"], saved);
      toast({
        title: "✅ Automation Rules Saved & Active!",
        description: "System will now 100% automatically send reminders & no-show recovery based on your schedule and booking-type templates.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Save Rules", description: err.message, variant: "destructive" });
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

  const openReminderModal = (visit: SiteVisit) => {
    setSelectedVisitForReminder(visit);
    const templates = automationForm.bookingTypeTemplates || [];
    const s = (visit.serviceName || "").toLowerCase();
    let matched = templates[0];
    for (const tpl of templates) {
      if (tpl.id === "general" || tpl.id === "default") continue;
      const keywords = (tpl.serviceKeywords || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.some((kw) => s.includes(kw))) {
        matched = tpl;
        break;
      }
    }
    const chosen = matched || {
      id: "general",
      voiceScript: "",
      whatsappMessage: "",
    };
    const interpolatePreview = (text: string) =>
      text
        .replace(/\{customer_name\}/gi, visit.contactName || "Customer")
        .replace(/\{service_name\}/gi, visit.serviceName || "Scheduled Appointment")
        .replace(/\{date\}/gi, visit.appointmentDate || "")
        .replace(/\{time\}/gi, visit.appointmentTime || "")
        .replace(/\{staff_name\}/gi, visit.assignedStaffName || "our specialist")
        .replace(/\{business_name\}/gi, brandName);

    setManualReminderForm({
      bookingTypeId: chosen.id,
      triggerVoiceCall: automationForm.reminderChannels?.voiceCall ?? true,
      triggerWhatsapp: automationForm.reminderChannels?.whatsapp ?? true,
      triggerEmail: automationForm.reminderChannels?.email ?? true,
      customAgentId: (chosen as any).agentId && (chosen as any).agentId !== "default"
        ? (chosen as any).agentId
        : (automationForm.reminderAgentId || "default"),
      delaySeconds: 15,
      customVoiceScript: interpolatePreview(chosen.voiceScript),
      customWhatsappMessage: interpolatePreview(chosen.whatsappMessage),
    });
    setReminderDialogOpen(true);
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
        <div className="flex items-center gap-2 flex-wrap">
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
            variant={activeSubTab === "automation" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveSubTab("automation")}
            className={`h-8 text-xs font-semibold gap-1.5 ${
              activeSubTab === "automation"
                ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                : "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5 hover:bg-amber-500/15"
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-500" />
            ⏰ Auto-Reminder & Recovery Rules
            {automationForm.autoReminderEnabled && (
              <Badge className="ml-1 bg-emerald-500 text-white border-none text-[9px] px-1.5 py-0 font-bold">
                Auto ON
              </Badge>
            )}
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
          {/* Clean Search Bar + Secondary Quick Filters (No duplicate stat buttons) */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-muted/25 p-2.5 rounded-lg border">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search patient/client name, phone, doctor/staff, or service..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-xs bg-background"
              />
            </div>

            {/* Compact Secondary Filters (Needs Staff, Cancelled, Active Filter Reset) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground mr-1 hidden md:inline">
                Click any top card to filter, or:
              </span>

              {/* Needs Staff Filter */}
              <Button
                variant={statusFilter === "unassigned" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === "unassigned" ? "all" : "unassigned")}
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

              {/* Cancelled */}
              <Button
                variant={statusFilter === "cancelled" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled")}
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

              {/* Reset to All when filtered */}
              {statusFilter !== "all" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStatusFilter("all")}
                  className="h-7 text-xs px-2.5 gap-1 font-medium"
                >
                  <X className="w-3 h-3" />
                  Show All ({visitsList.length})
                </Button>
              )}
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
                            <div className="flex items-center gap-2">
                              <span className="text-amber-600 dark:text-amber-400 font-medium text-xs">
                                No staff assigned yet
                              </span>
                              <Button
                                size="sm"
                                onClick={() => openAppointModal(visit)}
                                className="h-6 text-[11px] px-2 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                              >
                                + Appoint Staff
                              </Button>
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

                      {/* Bottom Action Controls Toolbar (Clean 3-4 Primary Buttons + More Actions Menu) */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t">
                        {/* Left Actions: Core Primary Actions Only */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 1. Confirm Button (for New/Scheduled) */}
                          {!confirmed && !completed && !cancelled && (
                            <Button
                              size="sm"
                              onClick={() => confirmAppointmentMutation.mutate(visit.id)}
                              disabled={confirmAppointmentMutation.isPending}
                              className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirm Appointment
                            </Button>
                          )}

                          {/* 2. Mark Attended / Completed Button */}
                          {!completed && !cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openCompleteModal(visit)}
                              className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                            >
                              <CalendarCheck className="w-3.5 h-3.5 text-purple-600" />
                              Mark Attended
                            </Button>
                          )}

                          {/* 3. Send Reminder Button */}
                          {!completed && !cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendReminderMutation.isPending}
                              onClick={() => openReminderModal(visit)}
                              className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              title="Send or test customized AI Voice Reminder Call, WhatsApp & Email reminder"
                            >
                              <Bell className="w-3.5 h-3.5 text-amber-600" />
                              Send Reminder
                            </Button>
                          )}

                          {/* 4. Reschedule Button */}
                          {!completed && !cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRescheduleModal(visit)}
                              className="h-7 text-xs gap-1.5 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                            >
                              <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
                              Reschedule
                            </Button>
                          )}

                          {/* Reopen Button for Cancelled */}
                          {cancelled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRescheduleModal(visit)}
                              className="h-7 text-xs gap-1.5 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                              Reopen & Reschedule
                            </Button>
                          )}
                        </div>

                        {/* Right Actions: Clean Dropdown Menu for All Secondary Actions */}
                        <div className="flex items-center gap-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
                              >
                                <MoreHorizontal className="w-3.5 h-3.5" />
                                More Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {/* Notify Client via WhatsApp */}
                              <DropdownMenuItem
                                onClick={() => sendClientWhatsApp(visit)}
                                className="text-xs gap-2 cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5 text-blue-500" />
                                <span>Notify Client (WhatsApp)</span>
                              </DropdownMenuItem>

                              {/* Notify Staff via WhatsApp */}
                              <DropdownMenuItem
                                onClick={() => sendStaffWhatsApp(visit)}
                                disabled={unassigned}
                                className="text-xs gap-2 cursor-pointer"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Notify Staff (WhatsApp)</span>
                              </DropdownMenuItem>

                              {/* Google Calendar Sync or Open */}
                              {visit.googleCalendarEventId ? (
                                <DropdownMenuItem
                                  onClick={() => window.open(getGoogleCalendarUrl(visit), "_blank", "noopener,noreferrer")}
                                  className="text-xs gap-2 cursor-pointer"
                                >
                                  <CalendarDays className="w-3.5 h-3.5 text-indigo-500" />
                                  <span>View in Google Calendar</span>
                                </DropdownMenuItem>
                              ) : gcalStatus?.connected ? (
                                <DropdownMenuItem
                                  onClick={() => pushToCalendarMutation.mutate(visit.id)}
                                  disabled={pushToCalendarMutation.isPending}
                                  className="text-xs gap-2 cursor-pointer"
                                >
                                  <CalendarDays className="w-3.5 h-3.5 text-indigo-500" />
                                  <span>Sync to Google Calendar</span>
                                </DropdownMenuItem>
                              ) : null}

                              <div className="h-px bg-border my-1" />

                              {/* Mark No-Show (AI Recovery) */}
                              {!completed && !cancelled && visit.status !== "no_show" && (
                                <DropdownMenuItem
                                  disabled={noShowRecoveryMutation.isPending}
                                  onClick={() => {
                                    if (confirm(`Mark ${visit.contactName} as No-Show and trigger AI Recovery Call + WhatsApp reschedule message?`)) {
                                      noShowRecoveryMutation.mutate({ visitId: visit.id });
                                    }
                                  }}
                                  className="text-xs gap-2 cursor-pointer text-orange-600 dark:text-orange-400"
                                >
                                  <UserX className="w-3.5 h-3.5 text-orange-500" />
                                  <span>No-Show (AI Recovery Call)</span>
                                </DropdownMenuItem>
                              )}

                              {/* Cancel Appointment */}
                              {!cancelled && !completed && (
                                <DropdownMenuItem
                                  onClick={() => openCancelModal(visit)}
                                  className="text-xs gap-2 cursor-pointer text-red-600 dark:text-red-400"
                                >
                                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                                  <span>Cancel Appointment</span>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* ── TAB 4: DYNAMIC AUTO-REMINDER & NO-SHOW RECOVERY CONTROLLER ── */}
      {activeSubTab === "automation" && (
        <div className="space-y-6">
          {/* Top Controller Banner */}
          <div className="p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Bell className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-foreground">
                  Automatic Appointment Reminder & No-Show Recovery Controller
                </h3>
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px]">
                  100% Automatic Background Engine
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-3xl">
                Set your timing, channels, and booking-type templates <strong>just once</strong>. Whenever a customer books an appointment, the system automatically matches their booking type (e.g., Doctor Consultation, Real Estate Site Visit, General) and sends the exact Voice Call, WhatsApp & Email at your scheduled time — with zero manual clicking required!
              </p>
            </div>
            <Button
              onClick={() => saveAutomationMutation.mutate(automationForm)}
              disabled={saveAutomationMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5 shadow-sm shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              {saveAutomationMutation.isPending ? "Saving Rules..." : "Save Automation Rules"}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT COLUMN (7 cols): PRE-APPOINTMENT REMINDER CONTROLLER & BOOKING TYPE TEMPLATES */}
            <div className="lg:col-span-7 space-y-6">
              <Card className="border-amber-500/30">
                <CardHeader className="pb-3 border-b bg-amber-500/[0.03]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Bell className="w-4 h-4 text-amber-500" />
                        1. Automatic Pre-Appointment Reminder Schedule
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Configure when reminders should automatically fire before an appointment starts.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {automationForm.autoReminderEnabled ? "Auto-Reminders ON" : "Paused"}
                      </span>
                      <Switch
                        checked={automationForm.autoReminderEnabled}
                        onCheckedChange={(checked) =>
                          setAutomationForm((prev) => ({ ...prev, autoReminderEnabled: checked }))
                        }
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-5 text-xs">
                  {/* Primary Reminder 1 Timing */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        Primary Reminder Timing (Before Appointment Time)
                      </Label>
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                        Currently: {automationForm.reminder1OffsetMinutes >= 1440 && automationForm.reminder1OffsetMinutes % 1440 === 0
                          ? `${automationForm.reminder1OffsetMinutes / 1440} Day(s) before`
                          : automationForm.reminder1OffsetMinutes >= 60 && automationForm.reminder1OffsetMinutes % 60 === 0
                          ? `${automationForm.reminder1OffsetMinutes / 60} Hour(s) before`
                          : `${automationForm.reminder1OffsetMinutes} Mins before`}
                      </Badge>
                    </div>

                    {/* Quick Presets */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "15 Mins", mins: 15 },
                        { label: "30 Mins", mins: 30 },
                        { label: "1 Hour", mins: 60 },
                        { label: "2 Hours", mins: 120 },
                        { label: "6 Hours", mins: 360 },
                        { label: "12 Hours", mins: 720 },
                        { label: "24 Hours (1 Day)", mins: 1440 },
                        { label: "48 Hours (2 Days)", mins: 2880 },
                      ].map((preset) => (
                        <Button
                          key={preset.mins}
                          type="button"
                          size="sm"
                          variant={automationForm.reminder1OffsetMinutes === preset.mins ? "default" : "outline"}
                          onClick={() => {
                            setAutomationForm((prev) => ({ ...prev, reminder1OffsetMinutes: preset.mins }));
                            if (preset.mins % 1440 === 0) {
                              setCustomReminder1Unit("days");
                              setCustomReminder1Value(preset.mins / 1440);
                            } else if (preset.mins % 60 === 0) {
                              setCustomReminder1Unit("hours");
                              setCustomReminder1Value(preset.mins / 60);
                            } else {
                              setCustomReminder1Unit("minutes");
                              setCustomReminder1Value(preset.mins);
                            }
                          }}
                          className={`h-7 text-[11px] px-2.5 ${
                            automationForm.reminder1OffsetMinutes === preset.mins
                              ? "bg-amber-600 hover:bg-amber-700 text-white"
                              : ""
                          }`}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>

                    {/* Custom Time Input */}
                    <div className="flex items-center gap-2 pt-1 bg-muted/30 p-2.5 rounded-lg border">
                      <span className="text-[11px] font-medium text-muted-foreground shrink-0">
                        ✏️ Or Set Custom Time:
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        value={customReminder1Value}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1);
                          setCustomReminder1Value(val);
                          const multiplier =
                            customReminder1Unit === "days" ? 1440 : customReminder1Unit === "hours" ? 60 : 1;
                          setAutomationForm((prev) => ({
                            ...prev,
                            reminder1OffsetMinutes: val * multiplier,
                          }));
                        }}
                        className="h-7 w-20 text-xs"
                      />
                      <Select
                        value={customReminder1Unit}
                        onValueChange={(unit: "minutes" | "hours" | "days") => {
                          setCustomReminder1Unit(unit);
                          const multiplier = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
                          setAutomationForm((prev) => ({
                            ...prev,
                            reminder1OffsetMinutes: customReminder1Value * multiplier,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minutes">Minutes</SelectItem>
                          <SelectItem value="hours">Hours</SelectItem>
                          <SelectItem value="days">Days</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-[11px] text-muted-foreground">before appointment</span>
                    </div>
                  </div>

                  {/* Second Optional Reminder */}
                  <div className="space-y-2.5 pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs font-bold flex items-center gap-1.5">
                          <CalendarClock className="w-3.5 h-3.5 text-blue-500" />
                          Second Follow-Up Reminder (Optional)
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Send a second closer reminder (e.g., 1st reminder 24 hours before, 2nd reminder 1 hour before).
                        </p>
                      </div>
                      <Switch
                        checked={automationForm.reminder2Enabled}
                        onCheckedChange={(checked) =>
                          setAutomationForm((prev) => ({ ...prev, reminder2Enabled: checked }))
                        }
                      />
                    </div>

                    {automationForm.reminder2Enabled && (
                      <div className="space-y-2 pl-2 border-l-2 border-blue-500/40">
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { label: "15 Mins before", mins: 15 },
                            { label: "30 Mins before", mins: 30 },
                            { label: "1 Hour before", mins: 60 },
                            { label: "2 Hours before", mins: 120 },
                            { label: "4 Hours before", mins: 240 },
                          ].map((preset) => (
                            <Button
                              key={preset.mins}
                              type="button"
                              size="sm"
                              variant={automationForm.reminder2OffsetMinutes === preset.mins ? "default" : "outline"}
                              onClick={() => {
                                setAutomationForm((prev) => ({ ...prev, reminder2OffsetMinutes: preset.mins }));
                                if (preset.mins % 60 === 0) {
                                  setCustomReminder2Unit("hours");
                                  setCustomReminder2Value(preset.mins / 60);
                                } else {
                                  setCustomReminder2Unit("minutes");
                                  setCustomReminder2Value(preset.mins);
                                }
                              }}
                              className={`h-7 text-[11px] px-2.5 ${
                                automationForm.reminder2OffsetMinutes === preset.mins
                                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                                  : ""
                              }`}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border">
                          <span className="text-[11px] font-medium text-muted-foreground">✏️ Custom 2nd Reminder:</span>
                          <Input
                            type="number"
                            min={1}
                            max={1440}
                            value={customReminder2Value}
                            onChange={(e) => {
                              const val = Math.max(1, Number(e.target.value) || 1);
                              setCustomReminder2Value(val);
                              const mult = customReminder2Unit === "hours" ? 60 : 1;
                              setAutomationForm((prev) => ({ ...prev, reminder2OffsetMinutes: val * mult }));
                            }}
                            className="h-7 w-20 text-xs"
                          />
                          <Select
                            value={customReminder2Unit}
                            onValueChange={(u: "minutes" | "hours") => {
                              setCustomReminder2Unit(u);
                              const mult = u === "hours" ? 60 : 1;
                              setAutomationForm((prev) => ({
                                ...prev,
                                reminder2OffsetMinutes: customReminder2Value * mult,
                              }));
                            }}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="minutes">Minutes</SelectItem>
                              <SelectItem value="hours">Hours</SelectItem>
                            </SelectContent>
                          </Select>
                          <span className="text-[11px] text-muted-foreground">before appointment</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Delivery Channels & AI Agent Selection */}
                  <div className="space-y-3 pt-3 border-t">
                    <Label className="text-xs font-bold">
                      2. Automatic Reminder Channels & AI Voice Agent
                    </Label>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="p-2.5 rounded-lg border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-amber-500" />
                          <span className="font-medium">AI Voice Call</span>
                        </div>
                        <Switch
                          checked={automationForm.reminderChannels?.voiceCall ?? true}
                          onCheckedChange={(checked) =>
                            setAutomationForm((prev) => ({
                              ...prev,
                              reminderChannels: { ...(prev.reminderChannels || { whatsapp: true, email: true, voiceCall: true }), voiceCall: checked },
                            }))
                          }
                        />
                      </div>

                      <div className="p-2.5 rounded-lg border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="font-medium">WhatsApp Msg</span>
                        </div>
                        <Switch
                          checked={automationForm.reminderChannels?.whatsapp ?? true}
                          onCheckedChange={(checked) =>
                            setAutomationForm((prev) => ({
                              ...prev,
                              reminderChannels: { ...(prev.reminderChannels || { whatsapp: true, email: true, voiceCall: true }), whatsapp: checked },
                            }))
                          }
                        />
                      </div>

                      <div className="p-2.5 rounded-lg border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-purple-500" />
                          <span className="font-medium">Email Alert</span>
                        </div>
                        <Switch
                          checked={automationForm.reminderChannels?.email ?? true}
                          onCheckedChange={(checked) =>
                            setAutomationForm((prev) => ({
                              ...prev,
                              reminderChannels: { ...(prev.reminderChannels || { whatsapp: true, email: true, voiceCall: true }), email: checked },
                            }))
                          }
                        />
                      </div>
                    </div>

                    {(automationForm.reminderChannels?.voiceCall ?? true) && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-amber-600" />
                          <div>
                            <span className="font-semibold block">Select AI Voice Agent for Reminder Calls</span>
                            <span className="text-[10px] text-muted-foreground">
                              Which AI agent should call the customer to confirm their booking?
                            </span>
                          </div>
                        </div>
                        <Select
                          value={automationForm.reminderAgentId || "default"}
                          onValueChange={(val) =>
                            setAutomationForm((prev) => ({ ...prev, reminderAgentId: val }))
                          }
                        >
                          <SelectTrigger className="h-8 w-full sm:w-56 text-xs bg-background">
                            <SelectValue placeholder="Auto-select Default Agent" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">✨ Auto-Select Primary Agent</SelectItem>
                            {agentsList.map((ag) => (
                              <SelectItem key={ag.id} value={ag.id}>
                                🤖 {ag.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* BOOKING TYPE DYNAMIC MESSAGE & VOICE SCRIPT CONTROLLER */}
              <Card className="border-blue-500/30">
                <CardHeader className="pb-3 border-b bg-blue-500/[0.03]">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                        3. Booking-Type Specific Messages & Voice Call Scripts
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Customize what message & AI voice script is sent for each type of booking (Doctor, Real Estate, General, or Custom).
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const newId = `custom_${Date.now()}`;
                        const newTpl: BookingTypeTemplate = {
                          id: newId,
                          label: "✨ New Booking Type",
                          serviceKeywords: "salon, spa, interview, demo",
                          voiceScript:
                            "Namaste {customer_name} ji! {business_name} se aapki '{service_name}' booking ({date} at {time}) ke reminder ke liye call hai. Kya aap confirm karte hain?",
                          whatsappMessage:
                            "*🔔 Booking Reminder — {business_name}*\n\nNamaste *{customer_name}* ji!\nAapki *{service_name}* booking *{date}* ko *{time}* par *{staff_name}* ke saath scheduled hai.",
                        };
                        setAutomationForm((prev) => ({
                          ...prev,
                          bookingTypeTemplates: [...(prev.bookingTypeTemplates || []), newTpl],
                        }));
                        setSelectedTemplateId(newId);
                      }}
                      className="h-7 text-xs gap-1 border-blue-500/40 text-blue-600"
                    >
                      <Plus className="w-3 h-3" /> + Add Booking Type
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4 text-xs">
                  {/* Booking Type Selector Tabs */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(automationForm.bookingTypeTemplates || []).map((tpl) => (
                      <Button
                        key={tpl.id}
                        type="button"
                        size="sm"
                        variant={selectedTemplateId === tpl.id ? "default" : "outline"}
                        onClick={() => setSelectedTemplateId(tpl.id)}
                        className={`h-8 text-xs font-medium ${
                          selectedTemplateId === tpl.id
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : ""
                        }`}
                      >
                        {tpl.label}
                      </Button>
                    ))}
                  </div>

                  {/* Active Template Editor */}
                  {(() => {
                    const activeTpl =
                      (automationForm.bookingTypeTemplates || []).find((t) => t.id === selectedTemplateId) ||
                      automationForm.bookingTypeTemplates?.[0];
                    if (!activeTpl) return null;

                    const updateActiveTpl = (patch: Partial<BookingTypeTemplate>) => {
                      setAutomationForm((prev) => ({
                        ...prev,
                        bookingTypeTemplates: prev.bookingTypeTemplates.map((t) =>
                          t.id === activeTpl.id ? { ...t, ...patch } : t
                        ),
                      }));
                    };

                    return (
                      <div className="space-y-3 p-3 rounded-xl border bg-muted/20">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold">Booking Category Name</Label>
                            <Input
                              value={activeTpl.label}
                              onChange={(e) => updateActiveTpl({ label: e.target.value })}
                              className="h-8 text-xs"
                              placeholder="e.g. 🏥 Doctor Consultation"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold">
                              Auto-Match Keywords (comma separated)
                            </Label>
                            <Input
                              value={activeTpl.serviceKeywords}
                              onChange={(e) => updateActiveTpl({ serviceKeywords: e.target.value })}
                              disabled={activeTpl.id === "general" || activeTpl.id === "default"}
                              className="h-8 text-xs"
                              placeholder="e.g. doctor, clinic, dental, neurology"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              {activeTpl.id === "general" || activeTpl.id === "default"
                                ? "Default fallback template when no specific keyword matches."
                                : "Matches when Service/Purpose contains any of these words."}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold flex items-center gap-1">
                              <Bot className="w-3 h-3 text-blue-500" />
                              AI Voice Agent for this Category
                            </Label>
                            <Select
                              value={activeTpl.agentId || "default"}
                              onValueChange={(val) => updateActiveTpl({ agentId: val })}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background">
                                <SelectValue placeholder="Smart Auto-Match Agent" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">✨ Smart Auto-Match by Booking Type</SelectItem>
                                {agentsList.map((ag) => (
                                  <SelectItem key={ag.id} value={ag.id}>
                                    🤖 {ag.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground">
                              Automatically speaks the script below using this agent's voice.
                            </p>
                          </div>
                        </div>

                        {/* Dynamic Variable Pills */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            Dynamic Variables (auto-replaced per customer):
                          </span>
                          {[
                            "{customer_name}",
                            "{service_name}",
                            "{date}",
                            "{time}",
                            "{staff_name}",
                            "{business_name}",
                          ].map((v) => (
                            <Badge
                              key={v}
                              variant="secondary"
                              className="text-[10px] font-mono px-1.5 py-0 cursor-pointer hover:bg-blue-500/20"
                              onClick={() => {
                                navigator.clipboard?.writeText(v);
                                toast({ title: `Copied ${v}`, description: "Paste anywhere in the script or message below." });
                              }}
                            >
                              {v}
                            </Badge>
                          ))}
                        </div>

                        {/* AI Voice Call Script for this Booking Type */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                            <Phone className="w-3.5 h-3.5" />
                            AI Voice Call Opening Script (What AI Speaks on Reminder Call)
                          </Label>
                          <Textarea
                            rows={3}
                            value={activeTpl.voiceScript}
                            onChange={(e) => updateActiveTpl({ voiceScript: e.target.value })}
                            className="text-xs"
                            placeholder="Namaste {customer_name} ji! ..."
                          />
                        </div>

                        {/* WhatsApp & Email Message for this Booking Type */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                            <MessageSquare className="w-3.5 h-3.5" />
                            WhatsApp & Email Reminder Message Template
                          </Label>
                          <Textarea
                            rows={5}
                            value={activeTpl.whatsappMessage}
                            onChange={(e) => updateActiveTpl({ whatsappMessage: e.target.value })}
                            className="text-xs font-mono"
                            placeholder="*🔔 Appointment Reminder*..."
                          />
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* RIGHT COLUMN (5 cols): AUTOMATIC NO-SHOW DETECTION & AI RECOVERY CONTROLLER */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="border-orange-500/30">
                <CardHeader className="pb-3 border-b bg-orange-500/[0.04]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <UserX className="w-4 h-4 text-orange-500" />
                        4. Automatic No-Show Detection & AI Recovery
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        If a customer doesn't attend on time, automatically mark as No-Show & trigger an AI Reschedule Call + WhatsApp.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {automationForm.autoNoShowEnabled ? "Auto ON" : "Paused"}
                      </span>
                      <Switch
                        checked={automationForm.autoNoShowEnabled}
                        onCheckedChange={(checked) =>
                          setAutomationForm((prev) => ({ ...prev, autoNoShowEnabled: checked }))
                        }
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4 text-xs">
                  {/* When to detect No-Show */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold">
                        Trigger No-Show Recovery After Appointment Time Passes By:
                      </Label>
                      <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-600 dark:text-orange-400">
                        {automationForm.noShowAfterMinutes >= 60 && automationForm.noShowAfterMinutes % 60 === 0
                          ? `${automationForm.noShowAfterMinutes / 60} Hour(s) after`
                          : `${automationForm.noShowAfterMinutes} Mins after`}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "15 Mins after", mins: 15 },
                        { label: "30 Mins after", mins: 30 },
                        { label: "1 Hour after", mins: 60 },
                        { label: "2 Hours after", mins: 120 },
                        { label: "4 Hours after", mins: 240 },
                        { label: "24 Hours after", mins: 1440 },
                      ].map((preset) => (
                        <Button
                          key={preset.mins}
                          type="button"
                          size="sm"
                          variant={automationForm.noShowAfterMinutes === preset.mins ? "default" : "outline"}
                          onClick={() => {
                            setAutomationForm((prev) => ({ ...prev, noShowAfterMinutes: preset.mins }));
                            if (preset.mins >= 60 && preset.mins % 60 === 0) {
                              setCustomNoShowUnit("hours");
                              setCustomNoShowValue(preset.mins / 60);
                            } else {
                              setCustomNoShowUnit("minutes");
                              setCustomNoShowValue(preset.mins);
                            }
                          }}
                          className={`h-7 text-[11px] px-2.5 ${
                            automationForm.noShowAfterMinutes === preset.mins
                              ? "bg-orange-600 hover:bg-orange-700 text-white"
                              : ""
                          }`}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>

                    {/* Custom No-Show Wait Time */}
                    <div className="flex items-center gap-2 bg-muted/30 p-2.5 rounded-lg border">
                      <span className="text-[11px] font-medium text-muted-foreground">✏️ Custom Wait:</span>
                      <Input
                        type="number"
                        min={5}
                        max={2880}
                        value={customNoShowValue}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1);
                          setCustomNoShowValue(val);
                          const mult = customNoShowUnit === "hours" ? 60 : 1;
                          setAutomationForm((prev) => ({ ...prev, noShowAfterMinutes: val * mult }));
                        }}
                        className="h-7 w-20 text-xs"
                      />
                      <Select
                        value={customNoShowUnit}
                        onValueChange={(u: "minutes" | "hours") => {
                          setCustomNoShowUnit(u);
                          const mult = u === "hours" ? 60 : 1;
                          setAutomationForm((prev) => ({
                            ...prev,
                            noShowAfterMinutes: customNoShowValue * mult,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minutes">Minutes</SelectItem>
                          <SelectItem value="hours">Hours</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-[11px] text-muted-foreground">after appointment</span>
                    </div>
                  </div>

                  {/* No-Show Channels */}
                  <div className="space-y-2.5 pt-3 border-t">
                    <Label className="text-xs font-bold">No-Show Recovery Channels & AI Agent</Label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-2.5 rounded-lg border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-orange-500" />
                          <span className="font-medium">AI Recovery Call</span>
                        </div>
                        <Switch
                          checked={automationForm.noShowChannels?.voiceCall ?? true}
                          onCheckedChange={(checked) =>
                            setAutomationForm((prev) => ({
                              ...prev,
                              noShowChannels: { ...(prev.noShowChannels || { whatsapp: true, voiceCall: true }), voiceCall: checked },
                            }))
                          }
                        />
                      </div>

                      <div className="p-2.5 rounded-lg border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="font-medium">WhatsApp Msg</span>
                        </div>
                        <Switch
                          checked={automationForm.noShowChannels?.whatsapp ?? true}
                          onCheckedChange={(checked) =>
                            setAutomationForm((prev) => ({
                              ...prev,
                              noShowChannels: { ...(prev.noShowChannels || { whatsapp: true, voiceCall: true }), whatsapp: checked },
                            }))
                          }
                        />
                      </div>
                    </div>

                    {(automationForm.noShowChannels?.voiceCall ?? true) && (
                      <div className="space-y-1.5 pt-1">
                        <Label className="text-[11px] font-semibold">Select AI Agent for No-Show Reschedule Calls</Label>
                        <Select
                          value={automationForm.noShowAgentId || "default"}
                          onValueChange={(val) =>
                            setAutomationForm((prev) => ({ ...prev, noShowAgentId: val }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Auto-select Default Agent" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">✨ Auto-Select Primary Agent</SelectItem>
                            {agentsList.map((ag) => (
                              <SelectItem key={ag.id} value={ag.id}>
                                🤖 {ag.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* No-Show Scripts */}
                  <div className="space-y-3 pt-3 border-t">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        No-Show AI Voice Recovery Script
                      </Label>
                      <Textarea
                        rows={3}
                        value={automationForm.noShowVoiceScript}
                        onChange={(e) =>
                          setAutomationForm((prev) => ({ ...prev, noShowVoiceScript: e.target.value }))
                        }
                        className="text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        No-Show WhatsApp Reschedule Message
                      </Label>
                      <Textarea
                        rows={4}
                        value={automationForm.noShowWhatsappMessage}
                        onChange={(e) =>
                          setAutomationForm((prev) => ({ ...prev, noShowWhatsappMessage: e.target.value }))
                        }
                        className="text-xs font-mono"
                      />
                    </div>
                  </div>

                  <Button
                    onClick={() => saveAutomationMutation.mutate(automationForm)}
                    disabled={saveAutomationMutation.isPending}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5 shadow-sm mt-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {saveAutomationMutation.isPending ? "Saving..." : "Save All Automation Rules"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          DIALOG 0: SEND / TEST CUSTOM APPOINTMENT REMINDER MODAL
      ════════════════════════════════════════════════════════════ */}
      <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              Send / Test Appointment Reminder
            </DialogTitle>
            <DialogDescription className="text-xs">
              Automatically matched booking template for{" "}
              <strong className="text-foreground">{selectedVisitForReminder?.contactName}</strong> (
              {selectedVisitForReminder?.serviceName || "General Booking"}). You can send immediately or customize the script below.
            </DialogDescription>
          </DialogHeader>

          {selectedVisitForReminder && (
            <div className="space-y-3.5 py-1 text-xs">
              {/* Booking Type Template Switcher */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Booking Type / Template</Label>
                <Select
                  value={manualReminderForm.bookingTypeId}
                  onValueChange={(tplId) => {
                    const found = (automationForm.bookingTypeTemplates || []).find((t) => t.id === tplId);
                    if (found && selectedVisitForReminder) {
                      const replaceVars = (str: string) =>
                        str
                          .replace(/\{customer_name\}/gi, selectedVisitForReminder.contactName || "Customer")
                          .replace(/\{service_name\}/gi, selectedVisitForReminder.serviceName || "Scheduled Appointment")
                          .replace(/\{date\}/gi, selectedVisitForReminder.appointmentDate || "")
                          .replace(/\{time\}/gi, selectedVisitForReminder.appointmentTime || "")
                          .replace(/\{staff_name\}/gi, selectedVisitForReminder.assignedStaffName || "our specialist")
                          .replace(/\{business_name\}/gi, brandName);
                      setManualReminderForm((prev) => ({
                        ...prev,
                        bookingTypeId: tplId,
                        customVoiceScript: replaceVars(found.voiceScript),
                        customWhatsappMessage: replaceVars(found.whatsappMessage),
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(automationForm.bookingTypeTemplates || []).map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Channels */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-lg border flex items-center justify-between">
                  <span className="font-medium">📞 AI Call</span>
                  <Switch
                    checked={manualReminderForm.triggerVoiceCall}
                    onCheckedChange={(c) => setManualReminderForm((p) => ({ ...p, triggerVoiceCall: c }))}
                  />
                </div>
                <div className="p-2 rounded-lg border flex items-center justify-between">
                  <span className="font-medium">💬 WhatsApp</span>
                  <Switch
                    checked={manualReminderForm.triggerWhatsapp}
                    onCheckedChange={(c) => setManualReminderForm((p) => ({ ...p, triggerWhatsapp: c }))}
                  />
                </div>
                <div className="p-2 rounded-lg border flex items-center justify-between">
                  <span className="font-medium">📧 Email</span>
                  <Switch
                    checked={manualReminderForm.triggerEmail}
                    onCheckedChange={(c) => setManualReminderForm((p) => ({ ...p, triggerEmail: c }))}
                  />
                </div>
              </div>

              {manualReminderForm.triggerVoiceCall && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">AI Voice Agent</Label>
                    <Select
                      value={manualReminderForm.customAgentId}
                      onValueChange={(v) => setManualReminderForm((p) => ({ ...p, customAgentId: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">✨ Primary Agent</SelectItem>
                        {agentsList.map((ag) => (
                          <SelectItem key={ag.id} value={ag.id}>
                            🤖 {ag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Call Timing</Label>
                    <Select
                      value={String(manualReminderForm.delaySeconds)}
                      onValueChange={(v) => setManualReminderForm((p) => ({ ...p, delaySeconds: Number(v) }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">⚡ Call Now (in 15 sec)</SelectItem>
                        <SelectItem value="60">In 1 Minute</SelectItem>
                        <SelectItem value="300">In 5 Minutes</SelectItem>
                        <SelectItem value="900">In 15 Minutes</SelectItem>
                        <SelectItem value="1800">In 30 Minutes</SelectItem>
                        <SelectItem value="3600">In 1 Hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {manualReminderForm.triggerVoiceCall && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-amber-600">AI Voice Call Script</Label>
                  <Textarea
                    rows={3}
                    value={manualReminderForm.customVoiceScript}
                    onChange={(e) => setManualReminderForm((p) => ({ ...p, customVoiceScript: e.target.value }))}
                    className="text-xs"
                  />
                </div>
              )}

              {(manualReminderForm.triggerWhatsapp || manualReminderForm.triggerEmail) && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-emerald-600">WhatsApp / Email Message</Label>
                  <Textarea
                    rows={4}
                    value={manualReminderForm.customWhatsappMessage}
                    onChange={(e) => setManualReminderForm((p) => ({ ...p, customWhatsappMessage: e.target.value }))}
                    className="text-xs font-mono"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReminderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={sendReminderMutation.isPending || !selectedVisitForReminder}
              onClick={() => {
                if (!selectedVisitForReminder) return;
                sendReminderMutation.mutate({
                  visitId: selectedVisitForReminder.id,
                  triggerVoiceCall: manualReminderForm.triggerVoiceCall,
                  triggerWhatsapp: manualReminderForm.triggerWhatsapp,
                  triggerEmail: manualReminderForm.triggerEmail,
                  customAgentId: manualReminderForm.customAgentId,
                  delaySeconds: manualReminderForm.delaySeconds,
                  customVoiceScript: manualReminderForm.customVoiceScript,
                  customWhatsappMessage: manualReminderForm.customWhatsappMessage,
                });
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5"
            >
              <Bell className="w-3.5 h-3.5" />
              {sendReminderMutation.isPending ? "Sending..." : "Dispatch Reminder Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <Label className="text-xs font-semibold">Select Staff Member *</Label>
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
