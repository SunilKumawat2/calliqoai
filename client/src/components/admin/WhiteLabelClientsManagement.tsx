import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Building2,
  Plus,
  Search,
  Globe,
  Coins,
  ShieldCheck,
  Stethoscope,
  GraduationCap,
  Car,
  Briefcase,
  ExternalLink,
  RefreshCw,
  Edit2,
  CheckCircle2,
  Sparkles,
  Sliders,
  Calendar,
  Layers,
} from "lucide-react";

interface WhiteLabelClient {
  id: string;
  name: string;
  email: string;
  role: string;
  credits: number;
  isActive: boolean;
  planType: string;
  createdAt: string;
  branding: {
    id: string;
    businessName: string;
    industry: string;
    subIndustry: string;
    tagline?: string;
    appointmentTerm: string;
    leadTerm: string;
    primaryColor: string;
    logoUrl?: string | null;
    customDomain?: string | null;
    updatedAt: string;
  };
}

const INDUSTRY_OPTIONS = [
  { id: "healthcare", name: "Healthcare & Clinics", icon: Stethoscope, color: "#0284c7", apptTerm: "Doctor Consultation", leadTerm: "Patient" },
  { id: "real_estate", name: "Real Estate & Housing", icon: Building2, color: "#059669", apptTerm: "Property Site Visit", leadTerm: "Buyer" },
  { id: "education", name: "Education & Coaching", icon: GraduationCap, color: "#4f46e5", apptTerm: "Counseling Session", leadTerm: "Student" },
  { id: "automobile", name: "Automobile Dealerships", icon: Car, color: "#ea580c", apptTerm: "Test Drive & Service", leadTerm: "Lead" },
  { id: "general", name: "General Business / B2B", icon: Briefcase, color: "#7c3aed", apptTerm: "Client Consultation", leadTerm: "Prospect" },
];

export function WhiteLabelClientsManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  
  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<WhiteLabelClient | null>(null);
  const [creditAdjustment, setCreditAdjustment] = useState<number>(1000);

  // New Client Form State
  const [newClient, setNewClient] = useState({
    businessName: "",
    email: "",
    password: "",
    industry: "healthcare",
    subIndustry: "Dermatology & Skin Clinic",
    customDomain: "",
    credits: 5000,
  });

  // Query Clients List
  const { data, isLoading, refetch } = useQuery<{ success: boolean; clients: WhiteLabelClient[]; total: number }>({
    queryKey: ["/api/admin/whitelabel/clients"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/whitelabel/clients");
      return res.json();
    },
  });

  const clients = data?.clients || [];

  // Create Client Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: typeof newClient) => {
      const res = await apiRequest("POST", "/api/admin/whitelabel/clients", payload);
      return res.json();
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelabel/clients"] });
      setCreateDialogOpen(false);
      setNewClient({
        businessName: "",
        email: "",
        password: "",
        industry: "healthcare",
        subIndustry: "Dermatology & Skin Clinic",
        customDomain: "",
        credits: 5000,
      });
      toast({
        title: "Client Workspace Created! 🎉",
        description: res.message || "New white-label client is ready.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Creation Failed",
        description: err.message || "Failed to create white-label client",
        variant: "destructive",
      });
    },
  });

  // Toggle Active Status Mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/whitelabel/clients/${userId}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelabel/clients"] });
      toast({ title: "Status Updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
    },
  });

  // Credit Adjustment Mutation
  const creditsMutation = useMutation({
    mutationFn: async ({ userId, amount }: { userId: string; amount: number }) => {
      const res = await apiRequest("POST", `/api/admin/whitelabel/clients/${userId}/credits`, { amount });
      return res.json();
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelabel/clients"] });
      setCreditsDialogOpen(false);
      toast({
        title: "Credits Updated! 💰",
        description: res.message,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to adjust credits",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.branding?.customDomain && c.branding.customDomain.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.branding?.businessName && c.branding.businessName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesIndustry = industryFilter === "all" || c.branding?.industry === industryFilter;
    return matchesSearch && matchesIndustry;
  });

  // Stats
  const totalClients = clients.length;
  const activeDomains = clients.filter((c) => !!c.branding?.customDomain).length;
  const totalCreditsAllocated = clients.reduce((acc, c) => acc + (c.credits || 0), 0);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/10 border border-purple-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Super Admin Agency & Reseller Hub
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            White-Label Clients & Workspace Management
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Deploy independent, white-labeled client workspaces with dedicated custom domains, industry terminology, and pre-allocated calling credits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white gap-2 font-semibold shadow-md"
          >
            <Plus className="w-4 h-4" /> Add New Client Workspace
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total White-Label Clients</p>
              <h3 className="text-2xl font-bold text-foreground">{totalClients}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Active Custom Domains</p>
              <h3 className="text-2xl font-bold text-foreground">{activeDomains}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Client Credits</p>
              <h3 className="text-2xl font-bold text-foreground">{totalCreditsAllocated.toLocaleString()}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border bg-card">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by clinic/business name, email, or domain..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={industryFilter} onValueChange={setIndustryFilter}>
            <SelectTrigger className="w-48 h-9 text-xs bg-background">
              <SelectValue placeholder="All Industries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Industries</SelectItem>
              {INDUSTRY_OPTIONS.map((ind) => (
                <SelectItem key={ind.id} value={ind.id}>
                  {ind.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Clients Table */}
      <Card className="border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>White-Label Client Accounts ({filteredClients.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Client / Business</TableHead>
                  <TableHead className="text-xs font-semibold">Industry Vertical</TableHead>
                  <TableHead className="text-xs font-semibold">Custom Domain / Portal</TableHead>
                  <TableHead className="text-xs font-semibold">Login Email</TableHead>
                  <TableHead className="text-xs font-semibold">Calling Balance</TableHead>
                  <TableHead className="text-xs font-semibold">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                      <p className="text-sm font-medium">No white-label clients found.</p>
                      <p className="text-xs mt-1">Click "+ Add New Client Workspace" to provision your first branded business.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredClients.map((client) => {
                    const preset = INDUSTRY_OPTIONS.find((p) => p.id === client.branding?.industry) || INDUSTRY_OPTIONS[0];
                    const Icon = preset.icon;

                    return (
                      <TableRow key={client.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white shadow-xs shrink-0 overflow-hidden"
                              style={{ backgroundColor: client.branding?.primaryColor || preset.color }}
                            >
                              {client.branding?.logoUrl ? (
                                <img
                                  src={client.branding.logoUrl}
                                  alt={client.branding.businessName}
                                  className="w-full h-full object-contain p-0.5"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <Icon className="w-4 h-4" />
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-xs text-foreground">
                                {client.branding?.businessName || client.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {client.branding?.subIndustry || "Standard Workspace"}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge
                            className="text-[10px] font-medium border-0"
                            style={{
                              backgroundColor: `${preset.color}15`,
                              color: preset.color,
                            }}
                          >
                            <Icon className="w-3 h-3 mr-1" />
                            {preset.name}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          {client.branding?.customDomain ? (
                            <a
                              href={`https://${client.branding.customDomain}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                            >
                              <Globe className="w-3 h-3" />
                              {client.branding.customDomain}
                              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              Default Portal
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {client.email}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-foreground">
                              {(client.credits || 0).toLocaleString()}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                              title="Recharge Credits"
                              onClick={() => {
                                setSelectedClient(client);
                                setCreditAdjustment(1000);
                                setCreditsDialogOpen(true);
                              }}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={client.isActive}
                              onCheckedChange={(checked) =>
                                toggleStatusMutation.mutate({ userId: client.id, isActive: checked })
                              }
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {client.isActive ? "Active" : "Paused"}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              setSelectedClient(client);
                              setCreditAdjustment(1000);
                              setCreditsDialogOpen(true);
                            }}
                          >
                            <Coins className="w-3 h-3 text-purple-500" />
                            Manage Credits
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal: + Add New Client Workspace */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-xl sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Provision New White-Label Client
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a dedicated workspace for a clinic, broker, dealership, or business with custom branding and calling quota.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Business / Clinic Name</Label>
              <Input
                placeholder="e.g. Dr. Verma Dental & Skin Clinic"
                value={newClient.businessName}
                onChange={(e) => setNewClient({ ...newClient, businessName: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Client Admin Email</Label>
                <Input
                  type="email"
                  placeholder="admin@vermaclinic.com"
                  value={newClient.email}
                  onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Initial Password</Label>
                <Input
                  type="text"
                  placeholder="ClinicSecure@2026"
                  value={newClient.password}
                  onChange={(e) => setNewClient({ ...newClient, password: e.target.value })}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Industry Vertical</Label>
                <Select
                  value={newClient.industry}
                  onValueChange={(val) => {
                    const preset = INDUSTRY_OPTIONS.find((p) => p.id === val);
                    setNewClient({
                      ...newClient,
                      industry: val,
                      subIndustry: preset?.name || "General",
                    });
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select Industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Custom Domain (Optional)</Label>
                <Input
                  placeholder="crm.vermaclinic.com"
                  value={newClient.customDomain}
                  onChange={(e) => setNewClient({ ...newClient, customDomain: e.target.value })}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-semibold flex items-center justify-between">
                <span>Initial Calling Credits Allocation</span>
                <span className="font-mono text-purple-600 font-bold">{newClient.credits.toLocaleString()} Credits</span>
              </Label>
              <Input
                type="number"
                min={0}
                step={500}
                value={newClient.credits}
                onChange={(e) => setNewClient({ ...newClient, credits: parseInt(e.target.value, 10) || 0 })}
                className="h-9 text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Client can use these credits immediately for AI voice calls, lead dialing, and SMS.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate(newClient)}
              disabled={createMutation.isPending || !newClient.businessName || !newClient.email || !newClient.password}
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
            >
              {createMutation.isPending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> Provisioning...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Provision Client Workspace
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Recharge / Adjust Client Credits */}
      <Dialog open={creditsDialogOpen} onOpenChange={setCreditsDialogOpen}>
        <DialogContent className="max-w-md sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Coins className="w-5 h-5 text-purple-600" />
              Adjust Calling Credits
            </DialogTitle>
            <DialogDescription className="text-xs">
              Recharge or adjust credits for <strong>{selectedClient?.branding?.businessName || selectedClient?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="flex justify-between p-3 rounded-lg bg-muted/40 border">
              <span className="text-muted-foreground">Current Credit Balance:</span>
              <span className="font-bold text-foreground font-mono">
                {(selectedClient?.credits || 0).toLocaleString()} Credits
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Credit Amount to Add (or Subtract)</Label>
              <Input
                type="number"
                step={500}
                value={creditAdjustment}
                onChange={(e) => setCreditAdjustment(parseInt(e.target.value, 10) || 0)}
                className="h-9 text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Enter positive value (e.g. 5000) to add, or negative (e.g. -1000) to deduct.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setCreditsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (selectedClient) {
                  creditsMutation.mutate({ userId: selectedClient.id, amount: creditAdjustment });
                }
              }}
              disabled={creditsMutation.isPending || creditAdjustment === 0}
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
            >
              {creditsMutation.isPending ? "Updating..." : "Update Credit Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

