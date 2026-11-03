import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";
import {
  Building2,
  Stethoscope,
  GraduationCap,
  Car,
  Briefcase,
  Check,
  Sparkles,
  Palette,
  ExternalLink,
  Calendar,
  Users,
  ShieldCheck,
  Eye,
  RefreshCw,
  PhoneCall,
  CheckCircle2,
  Share2,
  Upload,
  Image as ImageIcon,
  Trash2,
  Link as LinkIcon,
} from "lucide-react";

export interface WhiteLabelConfig {
  id?: string;
  userId?: string;
  industry: string;
  subIndustry: string;
  businessName: string;
  tagline: string;
  appointmentTerm: string;
  leadTerm: string;
  primaryColor: string;
  logoUrl?: string | null;
  customDomain?: string | null;
}

const INDUSTRY_PRESETS = [
  {
    id: "healthcare",
    name: "Healthcare & Clinics",
    badge: "Most Popular",
    icon: Stethoscope,
    color: "#0284c7",
    defaultSub: "Dermatology & Skin Clinic",
    subIndustries: [
      "Dermatology & Skin Clinic",
      "Dental Care & Orthodontics",
      "Eye Care & Ophthalmology",
      "Multi-Speciality Hospital",
      "Ayurveda & Homeopathy",
      "Physiotherapy & Wellness",
    ],
    defaultBusinessName: "City Care Skin & Dental Clinic",
    defaultTagline: "Smart AI Patient Care & Doctor Appointments",
    defaultLeadTerm: "Patient",
    defaultApptTerm: "Doctor Consultation",
    sampleFollowUp: "Doctor consultation reminder",
  },
  {
    id: "real_estate",
    name: "Real Estate & Housing",
    badge: "High Conversion",
    icon: Building2,
    color: "#10b981",
    defaultSub: "Residential Apartments",
    subIndustries: [
      "Residential Apartments & Flats",
      "Luxury Villas & Townhouses",
      "Commercial Offices & Retail",
      "Land & Residential Plots",
      "Real Estate Advisory & Brokerage",
    ],
    defaultBusinessName: "Apex Realty & Living",
    defaultTagline: "Premium Residential & Commercial Properties",
    defaultLeadTerm: "Buyer / Investor",
    defaultApptTerm: "Property Site Visit",
    sampleFollowUp: "Site visit confirmation",
  },
  {
    id: "education",
    name: "Education & Coaching",
    badge: "Fast Growth",
    icon: GraduationCap,
    color: "#8b5cf6",
    defaultSub: "Test Prep & Competitive Exams",
    subIndustries: [
      "Test Prep (JEE / NEET / UPSC)",
      "K-12 School & After-School Tuitions",
      "Study Abroad & IELTS",
      "Coding & Tech Bootcamps",
      "Skill Development & Vocational",
    ],
    defaultBusinessName: "Apex Scholars Academy",
    defaultTagline: "Personalized AI Learning & Batch Enrollment",
    defaultLeadTerm: "Student / Parent",
    defaultApptTerm: "Free Trial / Demo Class",
    sampleFollowUp: "Trial class scheduling",
  },
  {
    id: "automobile",
    name: "Automobile & Dealerships",
    badge: "B2C Sales",
    icon: Car,
    color: "#f59e0b",
    defaultSub: "New Passenger Vehicles",
    subIndustries: [
      "New Car Showroom & Sales",
      "Certified Pre-Owned & Used Cars",
      "Two-Wheeler & EV Dealerships",
      "Authorized Service & Maintenance",
    ],
    defaultBusinessName: "Speedway Motors",
    defaultTagline: "Authorized Automobile Sales & Service",
    defaultLeadTerm: "Buyer",
    defaultApptTerm: "Car Test Drive",
    sampleFollowUp: "Test drive booking",
  },
  {
    id: "general",
    name: "General Sales & Consulting",
    badge: "Universal",
    icon: Briefcase,
    color: "#6366f1",
    defaultSub: "B2B Professional Services",
    subIndustries: [
      "IT & Software Development",
      "Digital Marketing & Media Agency",
      "Financial Advisory & Loans",
      "Legal & Business Consulting",
      "Architecture & Interior Design",
    ],
    defaultBusinessName: "Acme Advisory Group",
    defaultTagline: "Strategic Consulting & Growth Solutions",
    defaultLeadTerm: "Client / Prospect",
    defaultApptTerm: "Consultation Call",
    sampleFollowUp: "Discovery session booking",
  },
];

const PRESET_COLORS = [
  { name: "Medical Blue", hex: "#0284c7" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Royal Purple", hex: "#8b5cf6" },
  { name: "Luxury Amber", hex: "#f59e0b" },
  { name: "Ruby Red", hex: "#e11d48" },
  { name: "Modern Slate", hex: "#475569" },
];

function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function CRMWhiteLabelSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch current whitelabel config
  const { data: config, isLoading } = useQuery<WhiteLabelConfig>({
    queryKey: ["/api/crm/whitelabel"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/crm/whitelabel");
      return res.json();
    },
  });

  // Local form state
  const [industry, setIndustry] = useState<string>("healthcare");
  const [subIndustry, setSubIndustry] = useState<string>("Dermatology & Skin Clinic");
  const [businessName, setBusinessName] = useState<string>("City Care Skin & Dental Clinic");
  const [tagline, setTagline] = useState<string>("Smart AI Patient Care & Doctor Appointments");
  const [appointmentTerm, setAppointmentTerm] = useState<string>("Doctor Consultation");
  const [leadTerm, setLeadTerm] = useState<string>("Patient");
  const [primaryColor, setPrimaryColor] = useState<string>("#0284c7");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [customDomain, setCustomDomain] = useState<string>("");
  const [logoSourceMode, setLogoSourceMode] = useState<"upload" | "url">("upload");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Logo file size must be less than 5MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);

      const uploadHeaders: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        uploadHeaders["Authorization"] = authHeader;
      }

      const res = await fetch("/api/crm/whitelabel/upload-logo", {
        method: "POST",
        headers: uploadHeaders,
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload logo");
      }

      const data = await res.json();
      setLogoUrl(data.url);
      toast({
        title: "Logo Uploaded! 🎉",
        description: "Logo image uploaded successfully. Click 'Save White-Label Setup' to apply.",
      });
    } catch (err: any) {
      toast({
        title: "Upload Failed",
        description: err.message || "Could not upload the logo image.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Sync state when config loads
  useEffect(() => {
    if (config) {
      if (config.industry) setIndustry(config.industry);
      if (config.subIndustry) setSubIndustry(config.subIndustry);
      if (config.businessName) setBusinessName(config.businessName);
      if (config.tagline) setTagline(config.tagline);
      if (config.appointmentTerm) setAppointmentTerm(config.appointmentTerm);
      if (config.leadTerm) setLeadTerm(config.leadTerm);
      if (config.primaryColor) setPrimaryColor(config.primaryColor);
      if (config.logoUrl) setLogoUrl(config.logoUrl);
      if (config.customDomain) setCustomDomain(config.customDomain);
    }
  }, [config]);

  // Apply brand theme color in real-time across CRM
  useEffect(() => {
    if (primaryColor) {
      const hsl = hexToHsl(primaryColor);
      if (hsl) {
        document.documentElement.style.setProperty('--primary', hsl);
        document.documentElement.style.setProperty('--primary-foreground', '0 0% 100%');
        document.documentElement.style.setProperty('--ring', hsl);
        document.documentElement.style.setProperty('--brand', hsl);
        document.documentElement.style.setProperty('--brand-foreground', '0 0% 100%');
      }
    }
  }, [primaryColor]);

  // Handle changing industry preset
  const handleSelectIndustry = (presetId: string) => {
    const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setIndustry(preset.id);
    setSubIndustry(preset.defaultSub);
    setBusinessName(preset.defaultBusinessName);
    setTagline(preset.defaultTagline);
    setAppointmentTerm(preset.defaultApptTerm);
    setLeadTerm(preset.defaultLeadTerm);
    setPrimaryColor(preset.color);

    toast({
      title: `${preset.name} Preset Applied`,
      description: `Default labels set to "${preset.defaultLeadTerm}" and "${preset.defaultApptTerm}".`,
    });
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<WhiteLabelConfig>) => {
      const res = await apiRequest("POST", "/api/crm/whitelabel", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/whitelabel"] });
      toast({
        title: "White-Label Settings Saved! 🎉",
        description: "Your CRM terminology, brand theme, and business identity have been updated successfully.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Save Failed",
        description: err.message || "Failed to update white-label settings",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      industry,
      subIndustry,
      businessName,
      tagline,
      appointmentTerm,
      leadTerm,
      primaryColor,
      logoUrl: logoUrl.trim() || null,
      customDomain: customDomain.trim() || null,
    });
  };

  const currentPreset = INDUSTRY_PRESETS.find((p) => p.id === industry) || INDUSTRY_PRESETS[0];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-r from-card/80 via-card to-card/60 p-6 md:p-8 backdrop-blur-xl shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0 font-medium px-2.5 py-0.5 text-xs shadow-sm">
                <Sparkles className="w-3 h-3 mr-1" /> Multi-Industry White-Label Suite
              </Badge>
              <Badge variant="outline" className="text-xs font-mono">
                Active: {currentPreset.name}
              </Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Industry & White-Label Customization
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Transform this CRM into a dedicated, branded workspace for{" "}
              <strong className="text-foreground">Clinics, Real Estate Developers, Coaching Academies, or Dealerships</strong>.
              All appointments, labels, notifications, and client portals adapt automatically.
            </p>
          </div>

          <Button
            size="lg"
            onClick={handleSave}
            disabled={saveMutation.isPending || isLoading}
            className="shrink-0 gap-2 font-semibold shadow-md text-white hover:text-white"
            style={{ backgroundColor: primaryColor }}
          >
            {saveMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Save White-Label Setup
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Grid: Left Column (Controls), Right Column (Live Client Preview) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Setup Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Industry Preset Selector */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                1. Select Industry Preset
              </CardTitle>
              <CardDescription className="text-xs">
                Pick the vertical this workspace operates in. This sets smart defaults for appointment titles and contact terms.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {INDUSTRY_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const isSelected = industry === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectIndustry(preset.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all relative flex flex-col justify-between gap-3 ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                          : "border-border/60 hover:border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                          style={{ backgroundColor: preset.color }}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        {isSelected ? (
                          <Badge 
                            className="text-white text-[10px] px-2 py-0 border-0 shadow-xs"
                            style={{ backgroundColor: preset.color }}
                          >
                            Active
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground font-medium">
                            {preset.badge}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-foreground">{preset.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {preset.defaultApptTerm}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Sub-Industry Selection */}
              <div className="pt-2">
                <Label className="text-xs font-semibold text-foreground">Sub-Speciality / Category</Label>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {currentPreset.subIndustries.map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setSubIndustry(sub)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        subIndustry === sub
                          ? "bg-foreground text-background font-medium border-foreground"
                          : "bg-muted/40 text-muted-foreground border-border/60 hover:border-border hover:text-foreground"
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Business & Brand Identity */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" />
                2. Brand Identity & Clinic Profile
              </CardTitle>
              <CardDescription className="text-xs">
                Customize how your clinic or company name appears to your patients, clients, and team.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Business / Clinic Name</Label>
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Dr. Sharma Skin & Dermatology Clinic"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tagline / Mission</Label>
                <Input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="e.g. Advanced AI Care, Dermatology & Consultations"
                  className="h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Lead / Client Term</Label>
                  <Input
                    value={leadTerm}
                    onChange={(e) => setLeadTerm(e.target.value)}
                    placeholder="e.g. Patient, Buyer, Student"
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">What do you call an incoming lead?</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Appointment / Booking Term</Label>
                  <Input
                    value={appointmentTerm}
                    onChange={(e) => setAppointmentTerm(e.target.value)}
                    placeholder="e.g. Doctor Consultation, Site Visit"
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">What is the scheduled meeting called?</p>
                </div>
              </div>

              {/* Theme Color Picker */}
              <div className="space-y-2 pt-1">
                <Label className="text-xs font-medium flex items-center justify-between">
                  <span>Brand Theme Color</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{primaryColor}</span>
                </Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => setPrimaryColor(col.hex)}
                      className="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                      style={{
                        borderColor: primaryColor === col.hex ? col.hex : "transparent",
                        backgroundColor: primaryColor === col.hex ? `${col.hex}15` : "transparent",
                      }}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shadow-sm"
                        style={{ backgroundColor: col.hex }}
                      />
                      <span className={primaryColor === col.hex ? "text-foreground font-semibold" : "text-muted-foreground"}>
                        {col.name}
                      </span>
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-7 h-7 rounded border cursor-pointer bg-transparent"
                      title="Custom color"
                    />
                  </div>
                </div>
              </div>

              {/* Clinic / Company Logo (Upload File or Enter URL) */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Clinic / Company Logo</Label>
                  <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border text-xs">
                    <button
                      type="button"
                      onClick={() => setLogoSourceMode("upload")}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                        logoSourceMode === "upload"
                          ? "bg-background text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Upload className="w-3 h-3" /> Upload File
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogoSourceMode("url")}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                        logoSourceMode === "url"
                          ? "bg-background text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <LinkIcon className="w-3 h-3" /> Image URL
                    </button>
                  </div>
                </div>

                {logoSourceMode === "upload" ? (
                  <div className="space-y-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                      className="hidden"
                      id="crm-logo-file-input"
                    />
                    <div
                      onClick={() => !isUploadingLogo && fileInputRef.current?.click()}
                      className="border-2 border-dashed border-border/80 hover:border-primary/50 transition-colors rounded-xl p-4 text-center cursor-pointer bg-muted/20 hover:bg-muted/40 flex flex-col items-center justify-center gap-2 group"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        {isUploadingLogo ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          {isUploadingLogo ? "Uploading logo..." : "Click to browse or drop clinic/company logo"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          PNG, JPG, SVG, WebP (Max 5MB) — Transparent PNG recommended
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Input
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="https://example.com/clinic-logo.png"
                      className="h-9 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Paste any direct image URL to use as your clinic or company brand logo.
                    </p>
                  </div>
                )}

                {/* Active Logo Preview Banner */}
                {logoUrl && (
                  <div className="flex items-center justify-between p-2.5 rounded-xl border bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-card border flex items-center justify-center p-1 overflow-hidden shadow-xs shrink-0">
                        <img
                          src={logoUrl}
                          alt="Brand Logo"
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Active Brand Logo
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                          {logoUrl}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogoUrl("")}
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Live Client & Staff Preview */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-border/60 shadow-md sticky top-6 overflow-hidden">
            <CardHeader className="bg-muted/30 pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">Live White-Label Preview</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  Real-time
                </Badge>
              </div>
              <CardDescription className="text-xs">
                This is how your customized CRM, appointments, and notifications will look to staff and patients.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 space-y-5">
              {/* Mock Branded Header */}
              <div className="rounded-xl border p-4 bg-background shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {businessName ? businessName.charAt(0) : "C"}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-foreground">{businessName || "Your Clinic Name"}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{tagline}</div>
                    </div>
                  </div>
                  <Badge className="text-[10px] text-white border-0 shadow-sm" style={{ backgroundColor: primaryColor }}>
                    {subIndustry || "Clinic"}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                  <div className="bg-muted/40 p-2 rounded-lg">
                    <div className="text-[10px] text-muted-foreground font-medium">Total {leadTerm}s</div>
                    <div className="text-base font-bold text-foreground">148</div>
                  </div>
                  <div className="bg-muted/40 p-2 rounded-lg">
                    <div className="text-[10px] text-muted-foreground font-medium">{appointmentTerm}s</div>
                    <div className="text-base font-bold" style={{ color: primaryColor }}>12</div>
                  </div>
                  <div className="bg-muted/40 p-2 rounded-lg">
                    <div className="text-[10px] text-muted-foreground font-medium">AI Calls</div>
                    <div className="text-base font-bold text-foreground">98.4%</div>
                  </div>
                </div>
              </div>

              {/* Mock Live Appointment Alert */}
              <div
                className="rounded-xl p-3.5 border flex items-start gap-3"
                style={{
                  backgroundColor: `${primaryColor}10`,
                  borderColor: `${primaryColor}35`,
                }}
              >
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0 mt-0.5"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Calendar className="w-3.5 h-3.5" />
                </div>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <span>New {appointmentTerm} Booked!</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-background/80">
                      Confirmed
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {leadTerm}: <strong>Arjun Sharma</strong> for <strong>General Consultation</strong> with Dr. Verma on <strong>Nov 08 at 04:00 PM</strong>.
                  </p>
                </div>
              </div>

              {/* Mock WhatsApp / Email Notification */}
              <div className="rounded-xl border bg-card p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Automated Confirmation Message
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">SMS / Email</span>
                </div>
                <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1 font-mono">
                  <p className="text-foreground font-medium">
                    "Namaste Arjun ji, your <strong>{appointmentTerm}</strong> with <strong>{businessName}</strong> has been confirmed."
                  </p>
                  <p className="text-[11px]">
                    📅 Date: 08 Nov 2026 | ⏰ Time: 04:00 PM
                  </p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans">
                    ✓ Sent automatically by {businessName} AI Assistant
                  </p>
                </div>
              </div>

              {/* Save Call to Action */}
              <div className="pt-2">
                <Button
                  className="w-full gap-2 font-semibold shadow-md text-white hover:text-white"
                  size="lg"
                  onClick={handleSave}
                  disabled={saveMutation.isPending || isLoading}
                  style={{ backgroundColor: primaryColor }}
                >
                  {saveMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Saving Configuration...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" /> Apply White-Label to CRM
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

