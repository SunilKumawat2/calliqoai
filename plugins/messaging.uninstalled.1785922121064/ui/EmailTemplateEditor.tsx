import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Type,
  Heading1,
  Image,
  MousePointerClick,
  Minus,
  Space,
  Columns2,
  Code,
  Eye,
  Paintbrush,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Plus,
  Variable,
  LayoutTemplate,
  Copy,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Clipboard,
  Info,
} from "lucide-react";

type BlockType = "heading" | "text" | "image" | "button" | "divider" | "spacer" | "two-column";

interface EmailBlock {
  id: string;
  type: BlockType;
  content: string;
  settings: Record<string, any>;
}

interface EmailTemplateEditorProps {
  value: string;
  onChange: (html: string) => void;
  variables?: string[];
}

const BLOCK_COLORS: Record<BlockType, { bg: string; darkBg: string; text: string; darkText: string; border: string; darkBorder: string }> = {
  heading: { bg: "bg-blue-50", darkBg: "dark:bg-blue-950/40", text: "text-blue-600", darkText: "dark:text-blue-400", border: "border-blue-300", darkBorder: "dark:border-blue-700" },
  text: { bg: "bg-emerald-50", darkBg: "dark:bg-emerald-950/40", text: "text-emerald-600", darkText: "dark:text-emerald-400", border: "border-emerald-300", darkBorder: "dark:border-emerald-700" },
  image: { bg: "bg-purple-50", darkBg: "dark:bg-purple-950/40", text: "text-purple-600", darkText: "dark:text-purple-400", border: "border-purple-300", darkBorder: "dark:border-purple-700" },
  button: { bg: "bg-indigo-50", darkBg: "dark:bg-indigo-950/40", text: "text-indigo-600", darkText: "dark:text-indigo-400", border: "border-indigo-300", darkBorder: "dark:border-indigo-700" },
  divider: { bg: "bg-gray-50", darkBg: "dark:bg-gray-800/40", text: "text-gray-500", darkText: "dark:text-gray-400", border: "border-gray-300", darkBorder: "dark:border-gray-600" },
  spacer: { bg: "bg-amber-50", darkBg: "dark:bg-amber-950/40", text: "text-amber-600", darkText: "dark:text-amber-400", border: "border-amber-300", darkBorder: "dark:border-amber-700" },
  "two-column": { bg: "bg-teal-50", darkBg: "dark:bg-teal-950/40", text: "text-teal-600", darkText: "dark:text-teal-400", border: "border-teal-300", darkBorder: "dark:border-teal-700" },
};

const BLOCK_PALETTE: { type: BlockType; label: string; icon: any; description: string }[] = [
  { type: "heading", label: "Heading", icon: Heading1, description: "Title or section header" },
  { type: "text", label: "Text", icon: Type, description: "Paragraph of text" },
  { type: "image", label: "Image", icon: Image, description: "Image with optional link" },
  { type: "button", label: "Button", icon: MousePointerClick, description: "Call-to-action button" },
  { type: "divider", label: "Divider", icon: Minus, description: "Horizontal separator" },
  { type: "spacer", label: "Spacer", icon: Space, description: "Vertical spacing" },
  { type: "two-column", label: "Two Columns", icon: Columns2, description: "Side-by-side layout" },
];

const DEFAULT_SETTINGS: Record<BlockType, Record<string, any>> = {
  heading: { text: "Your Heading", level: "h1", align: "center", color: "#333333", fontSize: "28" },
  text: { text: "Enter your text here. Use {{variable_name}} for dynamic content.", align: "left", color: "#555555", fontSize: "16" },
  image: { src: "", alt: "Image", width: "100", align: "center", link: "" },
  button: { text: "Click Here", link: "#", bgColor: "#4F46E5", textColor: "#FFFFFF", align: "center", borderRadius: "6", fontSize: "16" },
  divider: { color: "#E5E7EB", thickness: "1", width: "100" },
  spacer: { height: "20" },
  "two-column": { leftContent: "Left column content", rightContent: "Right column content", leftWidth: "50", color: "#555555", fontSize: "16" },
};

const SYSTEM_VARIABLES = [
  { name: "app_name", description: "Platform name" },
  { name: "logo_url", description: "Platform logo URL" },
  { name: "current_date", description: "Today's date" },
  { name: "current_year", description: "Current year" },
];

const DYNAMIC_VARIABLES = [
  { name: "contact_name", description: "Contact's name" },
  { name: "phone_number", description: "Contact's phone" },
  { name: "recipient_email", description: "Recipient email" },
  { name: "appointment_date", description: "Appointment date" },
  { name: "appointment_time", description: "Appointment time" },
  { name: "agent_name", description: "AI agent name" },
];

function generateId() {
  return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blockToHtml(block: EmailBlock): string {
  const s = block.settings;
  switch (block.type) {
    case "heading": {
      const tag = s.level || "h1";
      return `<${tag} style="margin:0;padding:10px 0;text-align:${s.align || "center"};color:${s.color || "#333333"};font-size:${s.fontSize || "28"}px;font-family:Arial,sans-serif;">${s.text || ""}</${tag}>`;
    }
    case "text":
      return `<p style="margin:0;padding:8px 0;text-align:${s.align || "left"};color:${s.color || "#555555"};font-size:${s.fontSize || "16"}px;line-height:1.6;font-family:Arial,sans-serif;">${s.text || ""}</p>`;
    case "image": {
      const img = `<img src="${s.src || "https://placehold.co/600x200/e2e8f0/64748b?text=Your+Image"}" alt="${s.alt || ""}" style="max-width:${s.width || "100"}%;height:auto;display:block;margin:0 auto;" />`;
      const content = s.link ? `<a href="${s.link}" target="_blank" style="display:block;text-decoration:none;">${img}</a>` : img;
      return `<div style="text-align:${s.align || "center"};padding:4px 0;">${content}</div>`;
    }
    case "button":
      return `<div style="text-align:${s.align || "center"};padding:12px 0;">
        <a href="${s.link || "#"}" target="_blank" style="display:inline-block;padding:12px 28px;background-color:${s.bgColor || "#4F46E5"};color:${s.textColor || "#FFFFFF"};text-decoration:none;border-radius:${s.borderRadius || "6"}px;font-size:${s.fontSize || "16"}px;font-weight:600;font-family:Arial,sans-serif;">${s.text || "Click Here"}</a>
      </div>`;
    case "divider":
      return `<hr style="border:none;border-top:${s.thickness || "1"}px solid ${s.color || "#E5E7EB"};margin:16px auto;width:${s.width || "100"}%;" />`;
    case "spacer":
      return `<div style="height:${s.height || "20"}px;"></div>`;
    case "two-column":
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="${s.leftWidth || "50"}%" style="padding:8px;vertical-align:top;color:${s.color || "#555555"};font-size:${s.fontSize || "16"}px;font-family:Arial,sans-serif;">${s.leftContent || ""}</td>
          <td width="${100 - parseInt(s.leftWidth || "50")}%" style="padding:8px;vertical-align:top;color:${s.color || "#555555"};font-size:${s.fontSize || "16"}px;font-family:Arial,sans-serif;">${s.rightContent || ""}</td>
        </tr>
      </table>`;
    default:
      return "";
  }
}

function assembleHtml(blocks: EmailBlock[]): string {
  const inner = blocks.map(blockToHtml).join("\n");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding:24px 32px;">
${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function BlockConfigPanel({ block, onChange, variables }: { block: EmailBlock; onChange: (settings: Record<string, any>) => void; variables?: string[] }) {
  const s = block.settings;
  const update = (key: string, value: any) => onChange({ ...s, [key]: value });

  const AlignButtons = ({ value, onChangeVal }: { value: string; onChangeVal: (v: string) => void }) => (
    <div className="flex gap-1">
      {[
        { val: "left", Icon: AlignLeft },
        { val: "center", Icon: AlignCenter },
        { val: "right", Icon: AlignRight },
      ].map(({ val, Icon }) => (
        <Button
          key={val}
          size="icon"
          variant={value === val ? "default" : "outline"}
          className="h-8 w-8"
          onClick={() => onChangeVal(val)}
          data-testid={`button-align-${val}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      ))}
    </div>
  );

  const VariableInsertButton = ({ onInsert }: { onInsert: (v: string) => void }) => {
    if (!variables || variables.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 pt-1">
        <span className="text-xs text-muted-foreground mr-1 self-center">Insert:</span>
        {variables.map((v) => (
          <Button key={v} variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => onInsert(v)} data-testid={`button-insert-var-${v}`}>
            <Variable className="w-3 h-3 mr-1" />{`{{${v}}}`}
          </Button>
        ))}
      </div>
    );
  };

  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Text</Label>
            <Input value={s.text} onChange={(e) => update("text", e.target.value)} data-testid="input-block-heading-text" />
            <VariableInsertButton onInsert={(v) => update("text", s.text + `{{${v}}}`)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Level</Label>
              <Select value={s.level} onValueChange={(v) => update("level", v)}>
                <SelectTrigger data-testid="select-heading-level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="h1">H1</SelectItem>
                  <SelectItem value="h2">H2</SelectItem>
                  <SelectItem value="h3">H3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Size (px)</Label>
              <Input type="number" value={s.fontSize} onChange={(e) => update("fontSize", e.target.value)} data-testid="input-heading-font-size" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1">
                <input type="color" value={s.color} onChange={(e) => update("color", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-heading-color" />
                <Input value={s.color} onChange={(e) => update("color", e.target.value)} className="flex-1 text-xs font-mono" />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alignment</Label>
            <AlignButtons value={s.align} onChangeVal={(v) => update("align", v)} />
          </div>
        </div>
      );
    case "text":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Content</Label>
            <Textarea value={s.text} onChange={(e) => update("text", e.target.value)} className="min-h-[80px] text-sm" data-testid="input-block-text-content" />
            <VariableInsertButton onInsert={(v) => update("text", s.text + `{{${v}}}`)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Size (px)</Label>
              <Input type="number" value={s.fontSize} onChange={(e) => update("fontSize", e.target.value)} data-testid="input-text-font-size" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1">
                <input type="color" value={s.color} onChange={(e) => update("color", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-text-color" />
                <Input value={s.color} onChange={(e) => update("color", e.target.value)} className="flex-1 text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alignment</Label>
              <AlignButtons value={s.align} onChangeVal={(v) => update("align", v)} />
            </div>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Image URL</Label>
            <Input value={s.src} onChange={(e) => update("src", e.target.value)} placeholder="https://example.com/image.png" data-testid="input-block-image-src" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Alt Text</Label>
              <Input value={s.alt} onChange={(e) => update("alt", e.target.value)} data-testid="input-image-alt" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Width (%)</Label>
              <Input type="number" min="10" max="100" value={s.width} onChange={(e) => update("width", e.target.value)} data-testid="input-image-width" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Link URL (optional)</Label>
            <Input value={s.link} onChange={(e) => update("link", e.target.value)} placeholder="https://example.com" data-testid="input-image-link" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alignment</Label>
            <AlignButtons value={s.align} onChangeVal={(v) => update("align", v)} />
          </div>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Button Text</Label>
              <Input value={s.text} onChange={(e) => update("text", e.target.value)} data-testid="input-block-button-text" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link URL</Label>
              <Input value={s.link} onChange={(e) => update("link", e.target.value)} placeholder="https://..." data-testid="input-button-link" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Background</Label>
              <div className="flex gap-1">
                <input type="color" value={s.bgColor} onChange={(e) => update("bgColor", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-button-bg-color" />
                <Input value={s.bgColor} onChange={(e) => update("bgColor", e.target.value)} className="flex-1 text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Text Color</Label>
              <div className="flex gap-1">
                <input type="color" value={s.textColor} onChange={(e) => update("textColor", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-button-text-color" />
                <Input value={s.textColor} onChange={(e) => update("textColor", e.target.value)} className="flex-1 text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Radius (px)</Label>
              <Input type="number" value={s.borderRadius} onChange={(e) => update("borderRadius", e.target.value)} data-testid="input-button-radius" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alignment</Label>
            <AlignButtons value={s.align} onChangeVal={(v) => update("align", v)} />
          </div>
        </div>
      );
    case "divider":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1">
                <input type="color" value={s.color} onChange={(e) => update("color", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-divider-color" />
                <Input value={s.color} onChange={(e) => update("color", e.target.value)} className="flex-1 text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Thickness</Label>
              <Input type="number" min="1" max="10" value={s.thickness} onChange={(e) => update("thickness", e.target.value)} data-testid="input-divider-thickness" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Width (%)</Label>
              <Input type="number" min="10" max="100" value={s.width} onChange={(e) => update("width", e.target.value)} data-testid="input-divider-width" />
            </div>
          </div>
        </div>
      );
    case "spacer":
      return (
        <div className="space-y-1">
          <Label className="text-xs">Height (px)</Label>
          <Input type="number" min="4" max="200" value={s.height} onChange={(e) => update("height", e.target.value)} data-testid="input-spacer-height" />
        </div>
      );
    case "two-column":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Left Column</Label>
            <Textarea value={s.leftContent} onChange={(e) => update("leftContent", e.target.value)} className="min-h-[60px] text-sm" data-testid="input-block-left-col" />
            <VariableInsertButton onInsert={(v) => update("leftContent", s.leftContent + `{{${v}}}`)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Right Column</Label>
            <Textarea value={s.rightContent} onChange={(e) => update("rightContent", e.target.value)} className="min-h-[60px] text-sm" data-testid="input-block-right-col" />
            <VariableInsertButton onInsert={(v) => update("rightContent", s.rightContent + `{{${v}}}`)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Left Width (%)</Label>
              <Input type="number" min="20" max="80" value={s.leftWidth} onChange={(e) => update("leftWidth", e.target.value)} data-testid="input-left-width" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Font Size</Label>
              <Input type="number" value={s.fontSize} onChange={(e) => update("fontSize", e.target.value)} data-testid="input-twocol-font-size" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1">
                <input type="color" value={s.color} onChange={(e) => update("color", e.target.value)} className="w-8 h-9 rounded border cursor-pointer" data-testid="input-twocol-color" />
              </div>
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function BlockPreview({ block }: { block: EmailBlock }) {
  const s = block.settings;
  switch (block.type) {
    case "heading":
      return <div style={{ textAlign: s.align as any, color: s.color, fontSize: `${Math.min(parseInt(s.fontSize) || 28, 32)}px`, fontWeight: 700, padding: "4px 0" }}>{s.text || "Heading"}</div>;
    case "text":
      return <div style={{ textAlign: s.align as any, color: s.color, fontSize: `${s.fontSize || 16}px`, lineHeight: 1.5, padding: "4px 0" }}>{s.text || "Text content"}</div>;
    case "image":
      return (
        <div style={{ textAlign: s.align as any, padding: "4px 0" }}>
          <img src={s.src || "https://placehold.co/400x120/e2e8f0/64748b?text=Image"} alt={s.alt} style={{ maxWidth: `${s.width || 100}%`, height: "auto", borderRadius: "4px" }} />
        </div>
      );
    case "button":
      return (
        <div style={{ textAlign: s.align as any, padding: "8px 0" }}>
          <span style={{ display: "inline-block", padding: "10px 24px", backgroundColor: s.bgColor, color: s.textColor, borderRadius: `${s.borderRadius}px`, fontSize: `${s.fontSize}px`, fontWeight: 600 }}>
            {s.text || "Button"}
          </span>
        </div>
      );
    case "divider":
      return <hr style={{ border: "none", borderTop: `${s.thickness}px solid ${s.color}`, margin: "8px auto", width: `${s.width}%` }} />;
    case "spacer":
      return <div style={{ height: `${s.height}px`, background: "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.03) 5px, rgba(0,0,0,0.03) 10px)", borderRadius: "4px" }} />;
    case "two-column":
      return (
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: `0 0 ${s.leftWidth}%`, padding: "8px", background: "rgba(0,0,0,0.02)", borderRadius: "4px", fontSize: `${s.fontSize}px`, color: s.color }}>{s.leftContent || "Left"}</div>
          <div style={{ flex: 1, padding: "8px", background: "rgba(0,0,0,0.02)", borderRadius: "4px", fontSize: `${s.fontSize}px`, color: s.color }}>{s.rightContent || "Right"}</div>
        </div>
      );
    default:
      return null;
  }
}

function VariableReferencePanel({ variables = [], onCopy }: { variables?: string[]; onCopy: (name: string) => void }) {
  const [showVars, setShowVars] = useState(true);
  const allCustom = variables.filter(v =>
    !SYSTEM_VARIABLES.some(sv => sv.name === v) && !DYNAMIC_VARIABLES.some(dv => dv.name === v)
  );

  const VariableChip = ({ name, desc }: { name: string; desc: string }) => (
    <button
      onClick={() => onCopy(name)}
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-background hover-elevate active-elevate-2 cursor-pointer text-left w-full"
      title={`Click to copy {{${name}}}`}
      data-testid={`var-chip-${name}`}
    >
      <Clipboard className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
      <span className="font-mono truncate">{`{{${name}}}`}</span>
    </button>
  );

  return (
    <div className="mt-4 pt-3 border-t">
      <button
        onClick={() => setShowVars(!showVars)}
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 cursor-pointer w-full"
        data-testid="button-toggle-variables"
      >
        <Variable className="w-3 h-3" />
        Variables
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showVars ? "rotate-180" : ""}`} />
      </button>
      {showVars && (
        <div className="space-y-2.5">
          <div>
            <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
              <Info className="w-2.5 h-2.5" /> System
            </div>
            <div className="space-y-0.5">
              {SYSTEM_VARIABLES.map(v => <VariableChip key={v.name} name={v.name} desc={v.description} />)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
              <Info className="w-2.5 h-2.5" /> Dynamic (from AI)
            </div>
            <div className="space-y-0.5">
              {DYNAMIC_VARIABLES.map(v => <VariableChip key={v.name} name={v.name} desc={v.description} />)}
            </div>
          </div>
          {allCustom.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
                <Info className="w-2.5 h-2.5" /> Custom
              </div>
              <div className="space-y-0.5">
                {allCustom.map(v => <VariableChip key={v} name={v} desc="Custom variable" />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EmailTemplateEditor({ value, onChange, variables = [] }: EmailTemplateEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"visual" | "code" | "preview">("visual");
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [htmlCode, setHtmlCode] = useState(value || "");
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragType, setDragType] = useState<"palette" | "reorder" | null>(null);
  const [dragPaletteType, setDragPaletteType] = useState<BlockType | null>(null);
  const [dragReorderId, setDragReorderId] = useState<string | null>(null);
  const [htmlModified, setHtmlModified] = useState(false);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value && blocks.length === 0 && !htmlModified) {
      setHtmlCode(value);
    }
  }, [value]);

  const updateBlocks = useCallback((newBlocks: EmailBlock[]) => {
    setBlocks(newBlocks);
    const html = assembleHtml(newBlocks);
    setHtmlCode(html);
    onChange(html);
  }, [onChange]);

  const addBlock = useCallback((type: BlockType, atIndex?: number) => {
    const newBlock: EmailBlock = {
      id: generateId(),
      type,
      content: "",
      settings: { ...DEFAULT_SETTINGS[type] },
    };
    const newBlocks = [...blocks];
    if (atIndex !== undefined) {
      newBlocks.splice(atIndex, 0, newBlock);
    } else {
      newBlocks.push(newBlock);
    }
    updateBlocks(newBlocks);
    setSelectedBlockId(newBlock.id);
  }, [blocks, updateBlocks]);

  const removeBlock = useCallback((id: string) => {
    const newBlocks = blocks.filter((b) => b.id !== id);
    updateBlocks(newBlocks);
    if (selectedBlockId === id) setSelectedBlockId(null);
  }, [blocks, selectedBlockId, updateBlocks]);

  const duplicateBlock = useCallback((id: string) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const src = blocks[idx];
    const dup: EmailBlock = { ...src, id: generateId(), settings: { ...src.settings } };
    const newBlocks = [...blocks];
    newBlocks.splice(idx + 1, 0, dup);
    updateBlocks(newBlocks);
    setSelectedBlockId(dup.id);
  }, [blocks, updateBlocks]);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    const newBlocks = [...blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateBlockSettings = useCallback((id: string, settings: Record<string, any>) => {
    const newBlocks = blocks.map((b) => (b.id === id ? { ...b, settings } : b));
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const handlePaletteDragStart = (e: React.DragEvent, type: BlockType) => {
    setDragType("palette");
    setDragPaletteType(type);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", type);
  };

  const handleBlockDragStart = (e: React.DragEvent, blockId: string) => {
    setDragType("reorder");
    setDragReorderId(blockId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", blockId);
  };

  const handleCanvasDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragType === "palette" ? "copy" : "move";
    setDragOverIndex(index);
  };

  const handleCanvasDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (dragType === "palette" && dragPaletteType) {
      addBlock(dragPaletteType, index);
    } else if (dragType === "reorder" && dragReorderId) {
      const fromIdx = blocks.findIndex((b) => b.id === dragReorderId);
      if (fromIdx !== -1 && fromIdx !== index) {
        const newBlocks = [...blocks];
        const [moved] = newBlocks.splice(fromIdx, 1);
        const insertAt = fromIdx < index ? index - 1 : index;
        newBlocks.splice(insertAt, 0, moved);
        updateBlocks(newBlocks);
      }
    }
    setDragType(null);
    setDragPaletteType(null);
    setDragReorderId(null);
  };

  const handleCanvasDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleModeChange = (newMode: string) => {
    if (newMode === "visual" && mode === "code" && htmlModified) {
      setHtmlModified(false);
    }
    if (newMode === "code" && mode === "visual") {
      const html = assembleHtml(blocks);
      setHtmlCode(html);
      setHtmlModified(false);
    }
    setMode(newMode as any);
  };

  const handleCodeChange = (code: string) => {
    setHtmlCode(code);
    setHtmlModified(true);
    onChange(code);
  };

  const insertVariableInCode = (varName: string) => {
    setHtmlCode((prev) => prev + `{{${varName}}}`);
    setHtmlModified(true);
    onChange(htmlCode + `{{${varName}}}`);
  };

  const handleCopyVariable = (name: string) => {
    const text = `{{${name}}}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedVar(name);
    setTimeout(() => setCopiedVar(null), 1500);
  };

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);

  return (
    <div className="border rounded-md overflow-hidden flex flex-col" data-testid="email-template-editor">
      <Tabs value={mode} onValueChange={handleModeChange} className="flex flex-col flex-1">
        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 flex-wrap gap-1">
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs gap-1.5 px-3" data-testid="tab-visual-builder">
              <Paintbrush className="w-3.5 h-3.5" />
              Visual Builder
            </TabsTrigger>
            <TabsTrigger value="code" className="text-xs gap-1.5 px-3" data-testid="tab-html-code">
              <Code className="w-3.5 h-3.5" />
              HTML Code
            </TabsTrigger>
            <TabsTrigger value="preview" className="text-xs gap-1.5 px-3" data-testid="tab-preview">
              <Eye className="w-3.5 h-3.5" />
              Preview
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {copiedVar && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 animate-in fade-in">{`{{${copiedVar}}} copied`}</span>
            )}
            {mode === "visual" && (
              <Badge variant="secondary" className="text-xs">
                <LayoutTemplate className="w-3 h-3 mr-1" />
                {blocks.length} block{blocks.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>

        <TabsContent value="visual" className="m-0 flex-1">
          <div className="flex h-[55vh] max-h-[55vh] overflow-hidden">
            <div className="w-48 border-r bg-muted/20 p-3 flex-shrink-0 overflow-y-auto">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Blocks</div>
              <div className="space-y-1.5">
                {BLOCK_PALETTE.map((item) => {
                  const Icon = item.icon;
                  const colors = BLOCK_COLORS[item.type];
                  return (
                    <div
                      key={item.type}
                      draggable
                      onDragStart={(e) => handlePaletteDragStart(e, item.type)}
                      className={`flex items-center gap-2 p-2 rounded-md border bg-background cursor-grab hover-elevate active-elevate-2 select-none`}
                      data-testid={`palette-block-${item.type}`}
                    >
                      <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${colors.bg} ${colors.darkBg}`}>
                        <Icon className={`w-3.5 h-3.5 ${colors.text} ${colors.darkText}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{item.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{item.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Add</div>
                <div className="grid grid-cols-2 gap-1">
                  {BLOCK_PALETTE.map((item) => {
                    const Icon = item.icon;
                    const colors = BLOCK_COLORS[item.type];
                    return (
                      <Button
                        key={item.type}
                        variant="outline"
                        size="sm"
                        className={`h-8 text-xs justify-start gap-1 px-2 ${colors.bg} ${colors.darkBg} border-0`}
                        onClick={() => addBlock(item.type)}
                        data-testid={`button-quick-add-${item.type}`}
                      >
                        <Icon className={`w-3 h-3 ${colors.text} ${colors.darkText}`} />
                        <span className="truncate">{item.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              <VariableReferencePanel variables={variables} onCopy={handleCopyVariable} />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div
                ref={canvasRef}
                className="flex-1 overflow-y-auto p-4 bg-muted/10"
                onDragOver={(e) => { e.preventDefault(); if (blocks.length === 0) setDragOverIndex(0); }}
                onDrop={(e) => { if (blocks.length === 0) handleCanvasDrop(e, 0); }}
                onDragLeave={handleCanvasDragLeave}
                onClick={(e) => { if (e.target === canvasRef.current) setSelectedBlockId(null); }}
                data-testid="canvas-drop-area"
              >
                {blocks.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center h-full min-h-[200px] border-2 border-dashed rounded-lg transition-colors ${dragOverIndex !== null ? "border-primary bg-primary/5" : "border-muted-foreground/20"}`}>
                    <LayoutTemplate className="w-10 h-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground">Drag blocks here or use Quick Add</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Build your email template visually</p>
                  </div>
                ) : (
                  <div className="max-w-[600px] mx-auto bg-background rounded-lg border shadow-sm overflow-visible">
                    <div className="p-4 space-y-0">
                      {blocks.map((block, idx) => {
                        const colors = BLOCK_COLORS[block.type];
                        return (
                          <div key={block.id}>
                            <div
                              className={`h-1 rounded transition-all ${dragOverIndex === idx ? "bg-primary h-1.5" : "bg-transparent"}`}
                              onDragOver={(e) => handleCanvasDragOver(e, idx)}
                              onDrop={(e) => handleCanvasDrop(e, idx)}
                            />
                            <div
                              draggable
                              onDragStart={(e) => handleBlockDragStart(e, block.id)}
                              onClick={() => setSelectedBlockId(block.id === selectedBlockId ? null : block.id)}
                              className={`group relative rounded-md transition-all cursor-pointer border-l-[3px] ${selectedBlockId === block.id ? `ring-2 ring-primary ring-offset-1 ${colors.border} ${colors.darkBorder}` : `${colors.border} ${colors.darkBorder} opacity-80 hover:opacity-100 hover:ring-1 hover:ring-muted-foreground/20`}`}
                              data-testid={`canvas-block-${block.id}`}
                            >
                              <div className="absolute -left-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" style={{ visibility: "visible" }}>
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div className="absolute -right-1 top-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10" style={{ visibility: "visible" }}>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, -1); }} disabled={idx === 0} data-testid={`button-move-up-${block.id}`}>
                                  <ChevronUp className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 1); }} disabled={idx === blocks.length - 1} data-testid={`button-move-down-${block.id}`}>
                                  <ChevronDown className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); duplicateBlock(block.id); }} data-testid={`button-duplicate-${block.id}`}>
                                  <Copy className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }} data-testid={`button-delete-${block.id}`}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                              <div className="px-2 py-1">
                                <BlockPreview block={block} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        className={`h-1 rounded transition-all ${dragOverIndex === blocks.length ? "bg-primary h-1.5" : "bg-transparent"}`}
                        onDragOver={(e) => handleCanvasDragOver(e, blocks.length)}
                        onDrop={(e) => handleCanvasDrop(e, blocks.length)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {selectedBlock && (
                <div className="border-t bg-muted/20 p-4 max-h-[180px] overflow-y-auto">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const colors = BLOCK_COLORS[selectedBlock.type];
                        return (
                          <Badge variant="secondary" className={`text-xs capitalize ${colors.bg} ${colors.darkBg} ${colors.text} ${colors.darkText}`}>
                            {selectedBlock.type.replace("-", " ")}
                          </Badge>
                        );
                      })()}
                      <span className="text-xs text-muted-foreground">Block Settings</span>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSelectedBlockId(null)} data-testid="button-close-settings">
                      Done
                    </Button>
                  </div>
                  <BlockConfigPanel block={selectedBlock} onChange={(s) => updateBlockSettings(selectedBlock.id, s)} variables={variables} />
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="code" className="m-0">
          <div className="flex flex-col h-[50vh]">
            {variables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/20">
                <span className="text-xs text-muted-foreground mr-1">Insert variable:</span>
                {variables.map((v) => (
                  <Button key={v} variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => insertVariableInCode(v)} data-testid={`button-code-insert-var-${v}`}>
                    <Variable className="w-3 h-3 mr-1" />{`{{${v}}}`}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              value={htmlCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="flex-1 font-mono text-sm rounded-none border-0 resize-none focus-visible:ring-0"
              placeholder="Paste or write your HTML email code here..."
              spellCheck={false}
              data-testid="textarea-html-code"
            />
          </div>
        </TabsContent>

        <TabsContent value="preview" className="m-0">
          <div className="bg-muted/30 p-4 h-[50vh] overflow-y-auto">
            <div className="max-w-[640px] mx-auto">
              <iframe
                srcDoc={htmlCode || "<p style='text-align:center;color:#999;padding:40px;font-family:Arial;'>No content yet. Add blocks in the Visual Builder or paste HTML in the Code tab.</p>"}
                title="Email Preview"
                className="w-full bg-white rounded-lg border shadow-sm"
                style={{ height: "100%", minHeight: "380px", border: "none" }}
                sandbox="allow-same-origin"
                data-testid="iframe-email-preview"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
