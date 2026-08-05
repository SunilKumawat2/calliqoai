import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Users, MoreVertical, KeyRound, Trash2, UserPlus, Shield, Loader2, Edit, Copy, Link as LinkIcon, Check, History, Search } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import PermissionMatrixEditor from "./PermissionMatrixEditor";

interface TeamMember {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  roleId: string;
  roleName?: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string;
}

interface TeamRole {
  id: string;
  name: string;
  description?: string;
  is_system_role: boolean;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  settings: {
    maxMembers: number;
    allowCustomRoles: boolean;
  };
  memberCount?: number;
  createdAt: string;
}

interface MembersResponse {
  members: TeamMember[];
}

interface RolesResponse {
  roles: TeamRole[];
}

interface PermissionMatrix {
  roleId: string;
  sections: Array<{
    id: string;
    label: string;
    icon: string;
    subsections: Array<{
      id: string;
      label: string;
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }>;
  }>;
}

interface ActivityLog {
  id: string;
  teamId: string;
  memberId?: string;
  memberEmail?: string;
  memberName: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
}

interface ActivityResponse {
  activities: ActivityLog[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

const createMemberSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleId: z.string().min(1, "Please select a role"),
});

const createRoleSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  displayName: z.string().min(1, "Display name is required"),
  description: z.string().optional(),
  copyFromRoleId: z.string().optional(),
});

type CreateMemberForm = z.infer<typeof createMemberSchema>;
type CreateRoleForm = z.infer<typeof createRoleSchema>;

export default function UserTeamManagement() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("members");
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetPasswordMemberId, setResetPasswordMemberId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showDeleteMemberDialog, setShowDeleteMemberDialog] = useState(false);
  const [deleteMemberId, setDeleteMemberId] = useState<string | null>(null);
  const [deleteMemberName, setDeleteMemberName] = useState("");
  const [showDeleteRoleDialog, setShowDeleteRoleDialog] = useState(false);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);
  const [deleteRoleName, setDeleteRoleName] = useState("");
  const [loginUrlCopied, setLoginUrlCopied] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");
  const [activitySearchQuery, setActivitySearchQuery] = useState("");
  const [showEditMemberDialog, setShowEditMemberDialog] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editMemberRoleId, setEditMemberRoleId] = useState<string>("");

  const loginUrl = `${window.location.origin}/team/login`;

  const copyLoginUrl = () => {
    navigator.clipboard.writeText(loginUrl);
    setLoginUrlCopied(true);
    toast({ title: "Copied!", description: "Login URL copied to clipboard" });
    setTimeout(() => setLoginUrlCopied(false), 2000);
  };

  const memberForm = useForm<CreateMemberForm>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      roleId: "",
    },
  });

  const roleForm = useForm<CreateRoleForm>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: "",
      displayName: "",
      description: "",
      copyFromRoleId: "none",
    },
  });

  const { data: team, isLoading: teamLoading } = useQuery<Team>({
    queryKey: ["/api/team"],
  });

  const { data: membersResponse, isLoading: membersLoading, refetch: refetchMembers } = useQuery<MembersResponse>({
    queryKey: ["/api/team/members"],
    enabled: !!team,
  });

  const members = membersResponse?.members || [];

  const { data: rolesResponse, isLoading: rolesLoading, refetch: refetchRoles } = useQuery<RolesResponse>({
    queryKey: ["/api/team/roles"],
    enabled: !!team,
  });

  const roles = rolesResponse?.roles || [];

  const { data: permissionMatrix, isLoading: matrixLoading, refetch: refetchMatrix } = useQuery<PermissionMatrix>({
    queryKey: ["/api/team/permissions/matrix", selectedRoleId],
    enabled: !!selectedRoleId,
  });

  const activityQueryUrl = activitySearchQuery 
    ? `/api/team/activity?search=${encodeURIComponent(activitySearchQuery)}`
    : '/api/team/activity';

  const { data: activityResponse, isLoading: activityLoading } = useQuery<ActivityResponse>({
    queryKey: [activityQueryUrl],
    enabled: !!team && activeTab === "activity",
  });

  const activities = activityResponse?.activities || [];

  const handleActivitySearch = () => {
    setActivitySearchQuery(activitySearch);
  };

  const createTeamMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/team", { name: "My Team" });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Team Created", description: "Your team has been created successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create team", variant: "destructive" });
    },
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: CreateMemberForm) => {
      const response = await apiRequest("POST", "/api/team/members", {
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        roleId: data.roleId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Member Added", description: "Team member has been added successfully." });
      setShowAddMemberDialog(false);
      memberForm.reset();
      refetchMembers();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add member", variant: "destructive" });
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const response = await apiRequest("DELETE", `/api/team/members/${memberId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Member Removed", description: "Team member has been removed." });
      refetchMembers();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove member", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ memberId, newPassword }: { memberId: string; newPassword: string }) => {
      const response = await apiRequest("POST", `/api/team/members/${memberId}/reset-password`, { newPassword });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Password Reset", description: "Password has been reset successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reset password", variant: "destructive" });
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: async (data: CreateRoleForm) => {
      const payload = {
        ...data,
        copyFromRoleId: data.copyFromRoleId === "none" ? undefined : data.copyFromRoleId,
      };
      const response = await apiRequest("POST", "/api/team/roles", payload);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Role Created", description: "Custom role has been created successfully." });
      setShowAddRoleDialog(false);
      roleForm.reset();
      refetchRoles();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create role", variant: "destructive" });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await apiRequest("DELETE", `/api/team/roles/${roleId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Role Deleted", description: "Role has been deleted." });
      setSelectedRoleId(null);
      refetchRoles();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete role", variant: "destructive" });
    },
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async (permissions: Array<{
      section: string;
      subsection: string;
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }>) => {
      if (!selectedRoleId) throw new Error("No role selected");
      const response = await apiRequest("PATCH", `/api/team/permissions/${selectedRoleId}`, { permissions });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Permissions Updated", description: "Role permissions have been saved." });
      refetchMatrix();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update permissions", variant: "destructive" });
    },
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: async ({ memberId, roleId }: { memberId: string; roleId: string }) => {
      const response = await apiRequest("PATCH", `/api/team/members/${memberId}`, { roleId });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Role Updated", description: "Member's role has been updated successfully." });
      setShowEditMemberDialog(false);
      setEditMember(null);
      refetchMembers();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update member role", variant: "destructive" });
    },
  });

  const handleEditMember = (member: TeamMember) => {
    setEditMember(member);
    setEditMemberRoleId(member.roleId);
    setShowEditMemberDialog(true);
  };

  const submitEditMember = () => {
    if (!editMember || !editMemberRoleId) return;
    if (editMemberRoleId === editMember.roleId) {
      setShowEditMemberDialog(false);
      setEditMember(null);
      return;
    }
    updateMemberRoleMutation.mutate({ memberId: editMember.id, roleId: editMemberRoleId });
  };

  const handleResetPassword = (memberId: string) => {
    setResetPasswordMemberId(memberId);
    setNewPassword("");
    setShowResetPasswordDialog(true);
  };

  const submitResetPassword = () => {
    if (!resetPasswordMemberId) return;
    if (newPassword.length < 8) {
      toast({ title: "Invalid Password", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    resetPasswordMutation.mutate({ memberId: resetPasswordMemberId, newPassword }, {
      onSuccess: () => {
        setShowResetPasswordDialog(false);
        setResetPasswordMemberId(null);
        setNewPassword("");
      }
    });
  };

  const handleDeleteMember = (member: TeamMember) => {
    setDeleteMemberId(member.id);
    setDeleteMemberName(member.name || member.email);
    setShowDeleteMemberDialog(true);
  };

  const confirmDeleteMember = () => {
    if (deleteMemberId) {
      deleteMemberMutation.mutate(deleteMemberId, {
        onSuccess: () => {
          setShowDeleteMemberDialog(false);
          setDeleteMemberId(null);
          setDeleteMemberName("");
        }
      });
    }
  };

  const handleDeleteRole = (role: TeamRole) => {
    setDeleteRoleId(role.id);
    setDeleteRoleName(role.name);
    setShowDeleteRoleDialog(true);
  };

  const confirmDeleteRole = () => {
    if (deleteRoleId) {
      deleteRoleMutation.mutate(deleteRoleId, {
        onSuccess: () => {
          setShowDeleteRoleDialog(false);
          setDeleteRoleId(null);
          setDeleteRoleName("");
        }
      });
    }
  };

  if (teamLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!team) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team Management</CardTitle>
          <CardDescription>Create a team to add members with their own login credentials</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-8">
          <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-4">You haven't created a team yet</p>
          <Button
            onClick={() => createTeamMutation.mutate()}
            disabled={createTeamMutation.isPending}
            data-testid="button-create-team"
          >
            {createTeamMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
            ) : (
              <><Plus className="h-4 w-4 mr-2" /> Create Team</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Team Login URL</CardTitle>
          </div>
          <CardDescription>
            Share this URL with your team members so they can log in
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input 
              value={loginUrl}
              readOnly
              className="bg-background font-mono text-sm"
              data-testid="input-team-login-url"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={copyLoginUrl}
              data-testid="button-copy-login-url"
            >
              {loginUrlCopied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Management</CardTitle>
              <CardDescription>
                Manage team members and roles with custom permissions
              </CardDescription>
            </div>
            <Badge variant="secondary">
              {members.length} / {team.settings?.maxMembers || 10} members
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="members" data-testid="tab-members">
                <Users className="h-4 w-4 mr-2" />
                Members
              </TabsTrigger>
              <TabsTrigger value="roles" data-testid="tab-roles">
                <Shield className="h-4 w-4 mr-2" />
                Roles & Permissions
              </TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity">
                <History className="h-4 w-4 mr-2" />
                Activity Logs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="members">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-muted-foreground">
                  Team members can log in with their own credentials
                </p>
                <Button
                  onClick={() => setShowAddMemberDialog(true)}
                  disabled={members.length >= (team.settings?.maxMembers || 10)}
                  data-testid="button-add-member"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Member
                </Button>
              </div>

              {membersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserPlus className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No team members yet. Add your first member above.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead className="w-[70px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id} data-testid={`row-member-${member.id}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{member.name}</div>
                            <div className="text-xs text-muted-foreground">{member.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{member.roleName || "Unknown"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.status === "active" ? "default" : "secondary"}>
                            {member.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {member.lastLoginAt
                            ? new Date(member.lastLoginAt).toLocaleDateString()
                            : "Never"}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-member-actions-${member.id}`}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditMember(member)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Edit Role
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleResetPassword(member.id)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteMember(member)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove Member
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="roles">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-medium">Available Roles</h3>
                    {team.settings?.allowCustomRoles && (
                      <Button
                        size="sm"
                        onClick={() => setShowAddRoleDialog(true)}
                        data-testid="button-add-role"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Role
                      </Button>
                    )}
                  </div>

                  {rolesLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {roles.map((role) => (
                        <Card
                          key={role.id}
                          className={`cursor-pointer transition-colors ${
                            selectedRoleId === role.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedRoleId(role.id)}
                          data-testid={`role-card-${role.id}`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{role.name}</span>
                                  {role.is_system_role && (
                                    <Badge variant="secondary" className="text-xs">
                                      System
                                    </Badge>
                                  )}
                                </div>
                                {role.description && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {role.description}
                                  </p>
                                )}
                              </div>
                              {!role.is_system_role && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        roleForm.setValue("copyFromRoleId", role.id);
                                        setShowAddRoleDialog(true);
                                      }}
                                    >
                                      <Copy className="h-4 w-4 mr-2" />
                                      Clone Role
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteRole(role);
                                      }}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete Role
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <PermissionMatrixEditor
                    matrix={permissionMatrix || null}
                    isLoading={matrixLoading && !!selectedRoleId}
                    readOnly={roles.find((r) => r.id === selectedRoleId)?.is_system_role}
                    onSave={(permissions) => updatePermissionsMutation.mutate(permissions)}
                    isSaving={updatePermissionsMutation.isPending}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="activity">
              <div className="mb-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by member, action, or target type..."
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleActivitySearch()}
                      className="pl-9"
                      data-testid="input-activity-search"
                    />
                  </div>
                  <Button onClick={handleActivitySearch} data-testid="button-activity-search">
                    Search
                  </Button>
                </div>
              </div>

              {activityLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : activities.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>{activitySearchQuery ? 'No activity logs match your search.' : 'No activity logs yet.'}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activities.map((activity) => (
                      <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                        <TableCell>
                          <div className="font-medium">{activity.memberName}</div>
                          {activity.memberEmail && (
                            <div className="text-xs text-muted-foreground">{activity.memberEmail}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{activity.action}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{activity.targetType}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {activity.ipAddress || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(activity.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {activityResponse?.pagination && activityResponse.pagination.totalPages > 1 && (
                <div className="mt-4 text-center text-sm text-muted-foreground">
                  Showing {activities.length} of {activityResponse.pagination.total} activity logs
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Create a new team member with their own login credentials
            </DialogDescription>
          </DialogHeader>
          <Form {...memberForm}>
            <form onSubmit={memberForm.handleSubmit((data) => createMemberMutation.mutate(data))} className="space-y-4">
              <FormField
                control={memberForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="member@example.com" {...field} data-testid="input-member-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={memberForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} data-testid="input-member-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={memberForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} data-testid="input-member-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={memberForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Minimum 8 characters" {...field} data-testid="input-member-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={memberForm.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-member-role">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddMemberDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMemberMutation.isPending} data-testid="button-submit-member">
                  {createMemberMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding...</>
                  ) : (
                    "Add Member"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom Role</DialogTitle>
            <DialogDescription>
              Create a new role with custom permissions for your team
            </DialogDescription>
          </DialogHeader>
          <Form {...roleForm}>
            <form onSubmit={roleForm.handleSubmit((data) => createRoleMutation.mutate(data))} className="space-y-4">
              <FormField
                control={roleForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Campaign Manager"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          roleForm.setValue("name", e.target.value.toLowerCase().replace(/\s+/g, "_"));
                        }}
                        data-testid="input-role-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={roleForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe what this role can do..."
                        {...field}
                        data-testid="input-role-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={roleForm.control}
                name="copyFromRoleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Copy Permissions From (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-copy-role">
                          <SelectValue placeholder="Start from scratch" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Start from scratch</SelectItem>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            Copy from {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddRoleDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createRoleMutation.isPending} data-testid="button-submit-role">
                  {createRoleMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                  ) : (
                    "Create Role"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Enter a new password for this team member</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <Input
                type="password"
                placeholder="Enter new password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
              {newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-sm text-destructive">Password must be at least 8 characters</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowResetPasswordDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitResetPassword}
              disabled={newPassword.length < 8 || resetPasswordMutation.isPending}
              data-testid="button-submit-reset-password"
            >
              {resetPasswordMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resetting...</>
              ) : (
                "Reset Password"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteMemberDialog} onOpenChange={setShowDeleteMemberDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deleteMemberName}</strong> from the team? 
              This action cannot be undone and they will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-member">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMemberMutation.isPending}
              data-testid="button-confirm-delete-member"
            >
              {deleteMemberMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removing...</>
              ) : (
                "Remove Member"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteRoleDialog} onOpenChange={setShowDeleteRoleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the role <strong>{deleteRoleName}</strong>? 
              Members using this role must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-role">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteRole}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteRoleMutation.isPending}
              data-testid="button-confirm-delete-role"
            >
              {deleteRoleMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                "Delete Role"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showEditMemberDialog} onOpenChange={setShowEditMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>Update the role for {editMember?.name || editMember?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Email</label>
              <Input value={editMember?.email || ''} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={editMemberRoleId} onValueChange={setEditMemberRoleId}>
                <SelectTrigger data-testid="select-edit-user-member-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowEditMemberDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitEditMember}
              disabled={!editMemberRoleId || updateMemberRoleMutation.isPending}
              data-testid="button-submit-edit-user-member"
            >
              {updateMemberRoleMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Updating...</>
              ) : (
                "Update Role"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
