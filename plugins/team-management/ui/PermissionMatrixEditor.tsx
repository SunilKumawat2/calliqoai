import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Megaphone,
  Bot,
  Users,
  Phone,
  BookOpen,
  PhoneCall,
  CreditCard,
  BarChart3,
  Settings,
  UserCog,
  Key,
  Building2,
  Puzzle,
  LucideIcon,
} from "lucide-react";

interface PermissionSubsection {
  id: string;
  label: string;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

interface PermissionSection {
  id: string;
  label: string;
  icon: string;
  subsections: PermissionSubsection[];
}

interface PermissionMatrix {
  roleId: string;
  sections: PermissionSection[];
}

interface PermissionMatrixEditorProps {
  matrix: PermissionMatrix | null;
  isLoading?: boolean;
  readOnly?: boolean;
  onSave?: (permissions: Array<{
    section: string;
    subsection: string;
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }>) => void;
  isSaving?: boolean;
}

const iconMap: Record<string, LucideIcon> = {
  Megaphone,
  Bot,
  Users,
  Phone,
  BookOpen,
  PhoneCall,
  CreditCard,
  BarChart3,
  Settings,
  UserCog,
  Key,
  Building2,
  Puzzle,
};

function PermissionMatrixEditor({
  matrix,
  isLoading = false,
  readOnly = false,
  onSave,
  isSaving = false,
}: PermissionMatrixEditorProps) {
  const [localMatrix, setLocalMatrix] = useState<PermissionMatrix | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (matrix) {
      setLocalMatrix(JSON.parse(JSON.stringify(matrix)));
      setHasChanges(false);
    }
  }, [matrix]);

  const handlePermissionChange = (
    sectionId: string,
    subsectionId: string,
    permission: "canCreate" | "canRead" | "canUpdate" | "canDelete",
    value: boolean
  ) => {
    if (!localMatrix || readOnly) return;

    const updatedMatrix = { ...localMatrix };
    const section = updatedMatrix.sections.find((s) => s.id === sectionId);
    if (!section) return;

    const subsection = section.subsections.find((s) => s.id === subsectionId);
    if (!subsection) return;

    subsection[permission] = value;
    setLocalMatrix(updatedMatrix);
    setHasChanges(true);
  };

  const handleToggleAllSection = (sectionId: string, enabled: boolean) => {
    if (!localMatrix || readOnly) return;

    const updatedMatrix = { ...localMatrix };
    const section = updatedMatrix.sections.find((s) => s.id === sectionId);
    if (!section) return;

    section.subsections.forEach((sub) => {
      sub.canCreate = enabled;
      sub.canRead = enabled;
      sub.canUpdate = enabled;
      sub.canDelete = enabled;
    });

    setLocalMatrix(updatedMatrix);
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!localMatrix || !onSave) return;

    const permissions: Array<{
      section: string;
      subsection: string;
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }> = [];

    localMatrix.sections.forEach((section) => {
      section.subsections.forEach((sub) => {
        permissions.push({
          section: section.id,
          subsection: sub.id,
          canCreate: sub.canCreate,
          canRead: sub.canRead,
          canUpdate: sub.canUpdate,
          canDelete: sub.canDelete,
        });
      });
    });

    onSave(permissions);
    setHasChanges(false);
  };

  const getSectionPermissionCount = (section: PermissionSection) => {
    let granted = 0;
    let total = 0;

    section.subsections.forEach((sub) => {
      if (sub.canCreate) granted++;
      if (sub.canRead) granted++;
      if (sub.canUpdate) granted++;
      if (sub.canDelete) granted++;
      total += 4;
    });

    return { granted, total };
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!localMatrix) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Select a role to view and edit permissions
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Permission Matrix</CardTitle>
          <CardDescription>
            Configure what actions this role can perform
          </CardDescription>
        </div>
        {!readOnly && onSave && (
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            data-testid="button-save-permissions"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <Accordion type="multiple" className="w-full">
            {localMatrix.sections.map((section) => {
              const IconComponent = iconMap[section.icon] || Settings;
              const { granted, total } = getSectionPermissionCount(section);
              const allGranted = granted === total;

              return (
                <AccordionItem key={section.id} value={section.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <IconComponent className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium">{section.label}</span>
                      <Badge
                        variant={allGranted ? "default" : "secondary"}
                        className="ml-auto mr-2"
                      >
                        {granted}/{total}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pl-8 space-y-4">
                      {!readOnly && (
                        <div className="flex gap-2 mb-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleAllSection(section.id, true)}
                            data-testid={`button-grant-all-${section.id}`}
                          >
                            Grant All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleAllSection(section.id, false)}
                            data-testid={`button-revoke-all-${section.id}`}
                          >
                            Revoke All
                          </Button>
                        </div>
                      )}

                      <div className="grid gap-3">
                        <div className="grid grid-cols-5 gap-2 text-sm font-medium text-muted-foreground pb-2 border-b">
                          <div>Permission</div>
                          <div className="text-center">Create</div>
                          <div className="text-center">Read</div>
                          <div className="text-center">Update</div>
                          <div className="text-center">Delete</div>
                        </div>

                        {section.subsections.map((sub) => (
                          <div
                            key={sub.id}
                            className="grid grid-cols-5 gap-2 items-center py-1"
                            data-testid={`permission-row-${section.id}-${sub.id}`}
                          >
                            <div className="text-sm">{sub.label}</div>
                            <div className="flex justify-center">
                              <Checkbox
                                checked={sub.canCreate}
                                disabled={readOnly}
                                onCheckedChange={(checked) =>
                                  handlePermissionChange(
                                    section.id,
                                    sub.id,
                                    "canCreate",
                                    checked as boolean
                                  )
                                }
                                data-testid={`checkbox-create-${section.id}-${sub.id}`}
                              />
                            </div>
                            <div className="flex justify-center">
                              <Checkbox
                                checked={sub.canRead}
                                disabled={readOnly}
                                onCheckedChange={(checked) =>
                                  handlePermissionChange(
                                    section.id,
                                    sub.id,
                                    "canRead",
                                    checked as boolean
                                  )
                                }
                                data-testid={`checkbox-read-${section.id}-${sub.id}`}
                              />
                            </div>
                            <div className="flex justify-center">
                              <Checkbox
                                checked={sub.canUpdate}
                                disabled={readOnly}
                                onCheckedChange={(checked) =>
                                  handlePermissionChange(
                                    section.id,
                                    sub.id,
                                    "canUpdate",
                                    checked as boolean
                                  )
                                }
                                data-testid={`checkbox-update-${section.id}-${sub.id}`}
                              />
                            </div>
                            <div className="flex justify-center">
                              <Checkbox
                                checked={sub.canDelete}
                                disabled={readOnly}
                                onCheckedChange={(checked) =>
                                  handlePermissionChange(
                                    section.id,
                                    sub.id,
                                    "canDelete",
                                    checked as boolean
                                  )
                                }
                                data-testid={`checkbox-delete-${section.id}-${sub.id}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default PermissionMatrixEditor;
