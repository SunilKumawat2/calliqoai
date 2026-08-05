import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageCircle,
  Send,
  Search,
  Settings,
  Loader2,
  Check,
  CheckCheck,
  Bot,
  User,
  Clock,
  X,
  MessageSquarePlus,
  Image,
  FileText,
  Mic,
  Video,
  MapPin,
  Sticker,
  Users,
  ArrowUp,
  Inbox,
  Phone,
  Lock,
  AlertTriangle,
  Camera,
  File,
  PlayCircle,
  Contact,
  SmilePlus,
  MousePointerClick,
  Paperclip,
  Upload,
  Download,
  ExternalLink,
} from "lucide-react";
const apiRequest = (typeof window !== 'undefined' && (window as any).apiRequest)
  ? (window as any).apiRequest
  : (async (method: string, url: string, data?: any) => {
    const res = await fetch(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res;
  });


function useGlobalToast() {
  return {
    toast: (props: any) => {
      const globalToast = typeof window !== 'undefined' ? (window as any).__AGENTLABS_TOAST__ : null;
      if (globalToast) return globalToast(props);
    },
  };
}

interface Conversation {
  id: string;
  contactPhone: string;
  contactName: string;
  status: string;
  autoReplyEnabled: boolean;
  assignedAgentId: string | null;
  windowExpiresAt: string | null;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
}

interface Message {
  id: string;
  direction: string;
  senderType: string;
  messageType: string;
  content: string;
  templateName: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  metadata: Record<string, any>;
  status: string;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
}

interface MetaTemplate {
  name: string;
  language: string;
  category: string;
  components: any[];
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  "bg-orange-500", "bg-pink-500",
];

function getAvatarColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function windowTimeRemaining(expiresAt: string | null): { open: boolean; label: string } {
  if (!expiresAt) return { open: false, label: "Window closed" };
  const expires = new Date(expiresAt);
  const now = new Date();
  if (expires <= now) return { open: false, label: "Window closed" };
  const diffMs = expires.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return { open: true, label: `${hours}h ${mins}m` };
}

function useWindowTimer(expiresAt: string | null) {
  const [state, setState] = useState(() => windowTimeRemaining(expiresAt));

  useEffect(() => {
    setState(windowTimeRemaining(expiresAt));
    const interval = setInterval(() => {
      setState(windowTimeRemaining(expiresAt));
    }, 30000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return state;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'sent') return <Check className="w-3 h-3" />;
  if (status === 'delivered') return <CheckCheck className="w-3 h-3" />;
  if (status === 'read') return <CheckCheck className="w-3 h-3 text-blue-400" />;
  if (status === 'failed') return <X className="w-3 h-3 text-red-400" />;
  if (status === 'pending') return <Clock className="w-3 h-3" />;
  return null;
}

function ContactAvatar({ name, phone, size = "default" }: { name: string; phone: string; size?: "default" | "lg" }) {
  const initials = getInitials(name, phone);
  const color = getAvatarColor(name || phone);
  const sizeClass = size === "lg" ? "h-10 w-10" : "h-9 w-9";
  const textSize = size === "lg" ? "text-sm" : "text-xs";

  return (
    <Avatar className={`${sizeClass} shrink-0`}>
      <AvatarFallback className={`${color} text-white ${textSize} font-medium`}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function getMediaProxyUrl(msg: Message): string | null {
  const mediaId = msg.metadata?.mediaId;
  if (mediaId) return `/api/messaging/media/${mediaId}`;
  if (msg.mediaUrl) {
    if (msg.mediaUrl.startsWith('/')) return msg.mediaUrl;
    if (/^\d+$/.test(msg.mediaUrl)) return `/api/messaging/media/${msg.mediaUrl}`;
  }
  return null;
}

function useAuthenticatedMedia(url: string | null): { blobUrl: string | null; loading: boolean; error: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    setBlobUrl(null);

    const headers: Record<string, string> = {};
    const authHeader = (window as any).getAuthHeader?.();
    if (authHeader) headers['Authorization'] = authHeader;

    fetch(url, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        const objUrl = URL.createObjectURL(blob);
        blobRef.current = objUrl;
        setBlobUrl(objUrl);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [url]);

  return { blobUrl, loading, error };
}

function AuthImage({ url, alt, className, testId, linkable }: { url: string; alt: string; className: string; testId: string; linkable?: boolean }) {
  const { blobUrl, loading, error } = useAuthenticatedMedia(url);
  if (loading) return <div className={`${className} bg-muted animate-pulse rounded-md`} style={{ minHeight: '80px', minWidth: '80px' }} />;
  if (error || !blobUrl) return null;
  const img = <img src={blobUrl} alt={alt} className={`${className}${linkable ? ' cursor-pointer' : ''}`} loading="lazy" data-testid={testId} />;
  if (linkable) return <a href={blobUrl} target="_blank" rel="noopener noreferrer">{img}</a>;
  return img;
}

function AuthVideo({ url, className, mimeType, testId }: { url: string; className: string; mimeType?: string; testId: string }) {
  const { blobUrl, loading, error } = useAuthenticatedMedia(url);
  if (loading) return <div className={`${className} bg-muted animate-pulse rounded-md`} style={{ minHeight: '80px', minWidth: '120px' }} />;
  if (error || !blobUrl) return null;
  return (
    <video controls preload="metadata" className={className} data-testid={testId}>
      <source src={blobUrl} type={mimeType || "video/mp4"} />
    </video>
  );
}

function AuthAudio({ url, className, mimeType, testId }: { url: string; className: string; mimeType?: string; testId: string }) {
  const { blobUrl, loading, error } = useAuthenticatedMedia(url);
  if (loading) return <div className={`${className} bg-muted animate-pulse rounded-md`} style={{ height: '40px', minWidth: '200px' }} />;
  if (error || !blobUrl) return null;
  return (
    <audio controls preload="metadata" className={className} data-testid={testId}>
      <source src={blobUrl} type={mimeType || "audio/ogg"} />
    </audio>
  );
}

function AuthDocLink({ url, children, className, testId }: { url: string; children: any; className: string; testId: string }) {
  const { blobUrl, loading } = useAuthenticatedMedia(url);
  return (
    <a
      href={blobUrl || '#'}
      target={blobUrl ? "_blank" : undefined}
      rel="noopener noreferrer"
      className={`${className}${loading ? ' opacity-60' : ''}`}
      data-testid={testId}
      onClick={(e) => {
        if (!blobUrl) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

function MessageContent({ msg }: { msg: Message }) {
  const isInbound = msg.direction === 'inbound';
  const iconColor = isInbound ? "text-muted-foreground" : "text-green-800 dark:text-green-200";
  const mediaUrl = getMediaProxyUrl(msg);
  const caption = msg.content && !['[Image]', '[Video]', '[Audio]', '[Document]', '[Sticker]'].includes(msg.content) ? msg.content : null;

  switch (msg.messageType) {
    case 'image':
      return (
        <div className="space-y-1" data-testid={`text-msg-content-${msg.id}`}>
          {mediaUrl ? (
            <AuthImage
              url={mediaUrl}
              alt={caption || "Photo"}
              className="rounded-md max-w-[200px] max-h-[200px] object-contain"
              testId={`img-media-${msg.id}`}
              linkable
            />
          ) : (
            <div className={`flex items-center gap-1.5 ${iconColor}`}>
              <Camera className="w-4 h-4" />
              <span className="text-xs font-medium">Photo</span>
            </div>
          )}
          {caption && (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{caption}</p>
          )}
        </div>
      );

    case 'video':
      return (
        <div className="space-y-1" data-testid={`text-msg-content-${msg.id}`}>
          {mediaUrl ? (
            <AuthVideo
              url={mediaUrl}
              className="rounded-md max-w-[200px] max-h-[200px]"
              mimeType={msg.mediaMimeType || undefined}
              testId={`video-media-${msg.id}`}
            />
          ) : (
            <div className={`flex items-center gap-1.5 ${iconColor}`}>
              <PlayCircle className="w-4 h-4" />
              <span className="text-xs font-medium">Video</span>
            </div>
          )}
          {caption && (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{caption}</p>
          )}
        </div>
      );

    case 'audio':
      return (
        <div className="space-y-1" data-testid={`text-msg-content-${msg.id}`}>
          {mediaUrl ? (
            <AuthAudio
              url={mediaUrl}
              className="max-w-[200px]"
              mimeType={msg.mediaMimeType || undefined}
              testId={`audio-media-${msg.id}`}
            />
          ) : (
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isInbound ? 'bg-muted' : 'bg-green-700/30'}`}>
                <Mic className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`h-1 rounded-full ${isInbound ? 'bg-muted-foreground/30' : 'bg-white/30'}`} />
                <span className="text-xs opacity-70 mt-0.5 block">Audio message</span>
              </div>
            </div>
          )}
        </div>
      );

    case 'document': {
      const filename = msg.metadata?.filename || msg.content || 'Document';
      const ext = msg.mediaMimeType?.split('/').pop()?.toUpperCase() || '';
      return (
        <div data-testid={`text-msg-content-${msg.id}`}>
          {mediaUrl ? (
            <AuthDocLink
              url={mediaUrl}
              className={`flex items-center gap-2 rounded-md p-2 max-w-[200px] ${isInbound ? 'bg-muted/50' : 'bg-green-700/10'}`}
              testId={`link-document-${msg.id}`}
            >
              <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${isInbound ? 'bg-muted' : 'bg-green-700/30'}`}>
                <File className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{filename}</p>
                {ext && <span className="text-xs opacity-60">{ext}</span>}
              </div>
              <Download className="w-4 h-4 opacity-60 shrink-0" />
            </AuthDocLink>
          ) : (
            <div className={`flex items-center gap-2 ${iconColor}`}>
              <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${isInbound ? 'bg-muted' : 'bg-green-700/30'}`}>
                <File className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{filename}</p>
                {ext && <span className="text-xs opacity-60">{ext}</span>}
              </div>
            </div>
          )}
          {caption && caption !== filename && (
            <p className="whitespace-pre-wrap break-words leading-relaxed mt-1">{caption}</p>
          )}
        </div>
      );
    }

    case 'location': {
      const lat = msg.metadata?.latitude;
      const lng = msg.metadata?.longitude;
      const locName = msg.metadata?.name;
      const locAddr = msg.metadata?.address;
      const mapsUrl = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;
      return (
        <div className="space-y-1" data-testid={`text-msg-content-${msg.id}`}>
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`block rounded-md overflow-hidden ${isInbound ? 'bg-muted/50' : 'bg-green-700/10'}`}
              data-testid={`link-location-${msg.id}`}
            >
              <img
                src={`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=280x150&markers=color:red%7C${lat},${lng}&key=`}
                alt="Map"
                className="w-full h-[100px] object-cover bg-muted"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="p-2">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-sm font-medium truncate">{locName || `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`}</span>
                  <ExternalLink className="w-3 h-3 opacity-50 shrink-0 ml-auto" />
                </div>
                {locAddr && <p className="text-xs opacity-60 mt-0.5 truncate">{locAddr}</p>}
              </div>
            </a>
          ) : (
            <>
              <div className={`flex items-center gap-1.5 rounded-md p-2 ${isInbound ? 'bg-muted' : 'bg-green-700/20'}`}>
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="text-xs">Shared location</span>
              </div>
              {msg.content && <p className="text-xs opacity-70">{msg.content}</p>}
            </>
          )}
        </div>
      );
    }

    case 'sticker':
      return (
        <div data-testid={`text-msg-content-${msg.id}`}>
          {mediaUrl ? (
            <AuthImage
              url={mediaUrl}
              alt="Sticker"
              className="max-w-[120px] max-h-[120px]"
              testId={`img-sticker-${msg.id}`}
            />
          ) : (
            <div className={`flex items-center gap-1.5 ${iconColor}`}>
              <Sticker className="w-5 h-5" />
              <span className="text-xs">Sticker</span>
            </div>
          )}
        </div>
      );

    case 'contacts':
      return (
        <div className={`flex items-center gap-2 ${iconColor}`} data-testid={`text-msg-content-${msg.id}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isInbound ? 'bg-muted' : 'bg-green-700/30'}`}>
            <User className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{msg.content || 'Contact'}</p>
            <span className="text-xs opacity-60">Contact card</span>
          </div>
        </div>
      );

    case 'reaction':
      return (
        <div className={`flex items-center gap-1.5 ${iconColor}`} data-testid={`text-msg-content-${msg.id}`}>
          <SmilePlus className="w-4 h-4" />
          <span className="text-sm">Reacted: {msg.content}</span>
        </div>
      );

    case 'template': {
      const isMarkerText = msg.content && /^\[?Template:\s*/i.test(msg.content.trim());
      const templateBody = isMarkerText ? null : msg.content;
      return (
        <div className="space-y-1.5" data-testid={`text-msg-content-${msg.id}`}>
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
            <FileText className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Template</span>
          </div>
          {templateBody ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{templateBody}</p>
          ) : (
            <p className="whitespace-pre-wrap break-words leading-relaxed text-sm opacity-80">
              {msg.templateName ? msg.templateName.replace(/_/g, ' ') : 'Template message sent'}
            </p>
          )}
        </div>
      );
    }

    case 'button':
    case 'interactive':
      return (
        <div className="space-y-1" data-testid={`text-msg-content-${msg.id}`}>
          <div className={`flex items-center gap-1.5 ${iconColor}`}>
            <MousePointerClick className="w-3.5 h-3.5" />
            <span className="text-xs opacity-70">Quick reply</span>
          </div>
          <p className="whitespace-pre-wrap break-words leading-relaxed font-medium">{msg.content}</p>
        </div>
      );

    default:
      return (
        <p className="whitespace-pre-wrap break-words leading-relaxed" data-testid={`text-msg-content-${msg.id}`}>
          {msg.content}
        </p>
      );
  }
}

export default function WhatsAppConversationsPage() {
  const { t } = useTranslation();
  const { toast } = useGlobalToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [templateLanguage, setTemplateLanguage] = useState("");
  const [attachmentPopoverOpen, setAttachmentPopoverOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; type: string; preview?: string } | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [uploadProgress, setUploadProgress] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationForm, setLocationForm] = useState({ latitude: "", longitude: "", name: "", address: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastPollRef = useRef<string>(new Date().toISOString());

  const { data: conversationsData, isLoading: convsLoading, refetch: refetchConvs } = useQuery<{ conversations: Conversation[]; total: number }>({
    queryKey: ["/api/messaging/conversations", statusFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("limit", "100");
      const res = await apiRequest("GET", `/api/messaging/conversations?${params.toString()}`);
      return res.json();
    },
    select: (res: any) => ({
      conversations: res?.data?.conversations || res?.conversations || [],
      total: res?.data?.total || res?.total || 0,
    }),
    refetchInterval: 10000,
  });

  useQuery({
    queryKey: ["/api/messaging/conversations/updates"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/messaging/conversations/updates?since=${encodeURIComponent(lastPollRef.current)}`);
      lastPollRef.current = new Date().toISOString();
      return res.json();
    },
    select: (res: any) => res?.data || [],
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const conversations = conversationsData?.conversations || [];
  const selected = conversations.find((c) => c.id === selectedId) || null;

  const windowState = useWindowTimer(selected?.windowExpiresAt || null);

  const { data: messages = [], isLoading: msgsLoading, refetch: refetchMsgs } = useQuery<Message[]>({
    queryKey: ["/api/messaging/conversations", selectedId, "messages"],
    queryFn: async () => {
      if (!selectedId) return [];
      const res = await apiRequest("GET", `/api/messaging/conversations/${selectedId}/messages?limit=50`);
      return res.json();
    },
    select: (res: any) => {
      const msgs = res?.data || res?.messages || res || [];
      return Array.isArray(msgs) ? msgs : [];
    },
    enabled: !!selectedId,
    refetchInterval: 5000,
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    select: (res: any) => {
      const list = res?.data || res || [];
      return Array.isArray(list) ? list.map((a: any) => ({ id: a.id, name: a.name })) : [];
    },
  });

  const { data: activeProvider } = useQuery<string | null>({
    queryKey: ["/api/messaging/active-provider"],
    queryFn: async () => {
      const [metaRes, whatswayRes] = await Promise.all([
        apiRequest("GET", "/api/messaging/meta-whatsapp/settings").then((r: any) => r.json()).catch(() => null),
        apiRequest("GET", "/api/messaging/whatsway/settings").then((r: any) => r.json()).catch(() => null),
      ]);
      const metaSettings = metaRes?.data || metaRes;
      const whatswaySettings = whatswayRes?.data || whatswayRes;
      if (metaSettings?.isActive) return 'meta';
      if (whatswaySettings?.isActive) return 'whatsway';
      return null;
    },
    staleTime: 60000,
  });

  const { data: metaTemplates = [] } = useQuery<MetaTemplate[]>({
    queryKey: ["/api/messaging/templates", activeProvider],
    queryFn: async () => {
      const endpoint = activeProvider === 'whatsway'
        ? "/api/messaging/whatsway/templates"
        : "/api/messaging/meta-whatsapp/templates";
      const res = await apiRequest("GET", endpoint);
      return res.json();
    },
    select: (res: any) => {
      const list = res?.data || res || [];
      return Array.isArray(list) ? list : [];
    },
    enabled: !!activeProvider,
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { type: string; content?: string; templateName?: string; language?: string; components?: any[] }) => {
      const res = await apiRequest("POST", `/api/messaging/conversations/${selectedId}/messages`, data);
      return res.json();
    },
    onSuccess: () => {
      setMessageInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations", selectedId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send message", description: err.message, variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (convId: string) => {
      await apiRequest("POST", `/api/messaging/conversations/${convId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
    },
  });

  const updateConvMutation = useMutation({
    mutationFn: async (data: { status?: string; autoReplyEnabled?: boolean; assignedAgentId?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/messaging/conversations/${selectedId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Conversation updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedId(conv.id);
    if (conv.unreadCount > 0) {
      markReadMutation.mutate(conv.id);
    }
  };

  const handleSendText = () => {
    if (!messageInput.trim() || !selectedId) return;
    sendMessageMutation.mutate({ type: "text", content: messageInput.trim() });
  };

  const detectMediaType = (mimeType: string): string => {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "document";
  };

  const handleFileSelect = (accept: string) => {
    setAttachmentPopoverOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = detectMediaType(file.type);
    let preview: string | undefined;
    if (type === "image") {
      preview = URL.createObjectURL(file);
    }
    setPendingAttachment({ file, type, preview });
    setAttachmentCaption("");
    e.target.value = "";
  };

  const handleSendAttachment = async () => {
    if (!pendingAttachment || !selectedId) return;
    setUploadProgress(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingAttachment.file);
      const headers: Record<string, string> = {};
      const getAuthHeader = (window as any).getAuthHeader;
      const authHeader = getAuthHeader ? getAuthHeader() : null;
      if (authHeader) headers["Authorization"] = authHeader;
      const uploadRes = await fetch(`/api/messaging/conversations/${selectedId}/upload`, {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Upload failed");
      const { mediaId, mimeType } = uploadJson.data;

      sendMessageMutation.mutate({
        type: pendingAttachment.type,
        mediaId,
        caption: attachmentCaption || undefined,
        filename: pendingAttachment.file.name,
        mimeType,
      } as any);
      setPendingAttachment(null);
      setAttachmentCaption("");
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadProgress(false);
    }
  };

  const handleSendLocation = () => {
    if (!selectedId || !locationForm.latitude || !locationForm.longitude) return;
    sendMessageMutation.mutate({
      type: "location",
      latitude: locationForm.latitude,
      longitude: locationForm.longitude,
      locationName: locationForm.name || undefined,
      address: locationForm.address || undefined,
    } as any);
    setLocationDialogOpen(false);
    setLocationForm({ latitude: "", longitude: "", name: "", address: "" });
  };

  const handleSendTemplate = () => {
    if (!selectedTemplate || !selectedId) return;
    const bodyComponent = selectedTemplate.components?.find((c: any) => c.type === 'BODY');
    const varMatches = bodyComponent?.text?.match(/\{\{(\d+)\}\}/g) || [];
    const parameters = varMatches.map((_: string, i: number) => ({
      type: 'text',
      text: templateVars[`var_${i}`] || ' ',
    }));
    const components = parameters.length > 0 ? [{ type: 'body', parameters }] : [];

    sendMessageMutation.mutate({
      type: "template",
      templateName: selectedTemplate.name,
      language: templateLanguage || selectedTemplate.language || "en_US",
      components,
    });
    setTemplateDialogOpen(false);
    setSelectedTemplate(null);
    setTemplateVars({});
  };

  return (
    <div className="flex h-full overflow-hidden" data-testid="conversations-page">
      {/* ── Sidebar: Conversations List ── */}
      <div className="w-80 border-r flex flex-col shrink-0 bg-background">
        <div className="px-3 pt-3 pb-2.5 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              <h3 className="font-semibold text-sm">Conversations</h3>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-24" data-testid="select-conv-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-conv-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <Inbox className="w-7 h-7 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1" data-testid="text-empty-conversations-title">No conversations yet</p>
              <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-empty-conversations-desc">
                Conversations will appear here when customers message your WhatsApp Business number.
              </p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = selectedId === conv.id;
              const hasUnread = conv.unreadCount > 0;

              return (
                <div
                  key={conv.id}
                  className={`flex items-start gap-3 px-3 py-3 cursor-pointer transition-colors border-b border-border/50 ${
                    isSelected
                      ? "bg-accent"
                      : "hover-elevate"
                  }`}
                  onClick={() => handleSelectConversation(conv)}
                  data-testid={`conv-item-${conv.id}`}
                >
                  <div className="relative">
                    <ContactAvatar name={conv.contactName} phone={conv.contactPhone} />
                    {conv.status === 'active' && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" aria-label="Online" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className={`text-sm truncate ${hasUnread ? 'font-semibold' : 'font-medium'}`} data-testid={`text-conv-name-${conv.id}`}>
                        {conv.contactName || conv.contactPhone}
                      </span>
                      <span className={`text-xs shrink-0 ${hasUnread ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`} data-testid={`text-conv-time-${conv.id}`}>
                        {relativeTime(conv.lastMessageAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-xs truncate ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`} data-testid={`text-conv-preview-${conv.id}`}>
                        {conv.lastMessagePreview || "No messages"}
                      </p>
                      {hasUnread && (
                        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-xs font-medium flex items-center justify-center" data-testid={`badge-conv-unread-${conv.id}`}>
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center bg-[#efeae2] dark:bg-[#0b141a]">
            <div className="text-center max-w-xs">
              <div className="w-20 h-20 rounded-full bg-white/60 dark:bg-white/10 mx-auto mb-5 flex items-center justify-center">
                <MessageCircle className="w-10 h-10 text-[#54656f] dark:text-[#8696a0]" />
              </div>
              <h3 className="text-lg font-light text-[#41525d] dark:text-[#e9edef] mb-2" data-testid="text-empty-chat-title">Your Messages</h3>
              <p className="text-sm text-[#667781] dark:text-[#8696a0] leading-relaxed" data-testid="text-empty-chat-desc">
                Select a conversation from the sidebar to view messages and reply to your customers.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Chat Header ── */}
            <div className="border-b bg-[#f0f2f5] dark:bg-[#202c33] px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative">
                  <ContactAvatar name={selected.contactName} phone={selected.contactPhone} size="lg" />
                  {selected.status === 'active' && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#f0f2f5] dark:border-[#202c33]" aria-label="Online" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="font-medium text-sm truncate text-[#111b21] dark:text-[#e9edef]" data-testid="text-chat-contact-name">
                    {selected.contactName || selected.contactPhone}
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selected.contactName && (
                      <span className="text-xs text-[#667781] dark:text-[#8696a0] flex items-center gap-1" data-testid="text-chat-contact-phone">
                        {selected.contactPhone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant="outline"
                  className={`text-xs ${windowState.open
                    ? "border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
                    : "border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                  }`}
                  data-testid="badge-chat-window"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  {windowState.open ? windowState.label : "Closed"}
                </Badge>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid="button-conv-settings">
                      <Settings className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 space-y-3">
                    <div>
                      {selected.status === 'active' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => updateConvMutation.mutate({ status: 'closed' })}
                          data-testid="button-close-conv"
                        >
                          Close Conversation
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => updateConvMutation.mutate({ status: 'active' })}
                          data-testid="button-reopen-conv"
                        >
                          Reopen Conversation
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* ── Messages Area — WhatsApp style background ── */}
            <div
              className="flex-1 overflow-y-auto px-6 py-4"
              style={{
                backgroundColor: 'var(--wa-chat-bg, #efeae2)',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}
              data-testid="messages-area"
            >
              <style>{`
                .dark [data-testid="messages-area"] {
                  --wa-chat-bg: #0b141a;
                  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
                }
              `}</style>
              {msgsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-[#667781]" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <div className="bg-white/80 dark:bg-[#1f2c34]/80 backdrop-blur-sm rounded-lg px-6 py-4 text-center shadow-sm">
                    <p className="text-sm text-[#667781] dark:text-[#8696a0]" data-testid="text-empty-messages-title">No messages yet</p>
                    <p className="text-xs text-[#667781]/70 dark:text-[#8696a0]/70 mt-1" data-testid="text-empty-messages-desc">Send a template message to start the conversation.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {messages.map((msg, idx) => {
                    const isInbound = msg.direction === 'inbound';
                    const isAgent = msg.senderType === 'agent';

                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const sameSender = prevMsg && prevMsg.direction === msg.direction;
                    const showDateSep = !prevMsg || new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                    return (
                      <div key={msg.id} data-testid={`msg-${msg.id}`}>
                        {showDateSep && (
                          <div className="flex items-center justify-center my-3" data-testid={`date-separator-${msg.id}`}>
                            <span className="text-xs text-[#54656f] dark:text-[#8696a0] bg-white dark:bg-[#1f2c34] px-3 py-1 rounded-lg shadow-sm">
                              {new Date(msg.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} ${sameSender && !showDateSep ? 'mt-0.5' : 'mt-2'}`}>
                          <div
                            className={`relative max-w-[70%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${
                              isInbound
                                ? 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-none'
                                : 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-none'
                            }`}
                          >
                            {isAgent && !isInbound && (
                              <div className="flex items-center gap-1 mb-0.5" data-testid={`badge-ai-agent-${msg.id}`}>
                                <Bot className="w-3 h-3 text-[#06cf9c]" />
                                <span className="text-xs text-[#06cf9c] font-medium">AI Agent</span>
                              </div>
                            )}
                            <MessageContent msg={msg} />

                            <div className={`flex items-center gap-1 mt-0.5 ${isInbound ? 'justify-end' : 'justify-end'}`}>
                              <span className={`text-[11px] ${isInbound ? 'text-[#667781] dark:text-[#8696a0]' : 'text-[#1e7e5a] dark:text-[#99cebe]'}`} data-testid={`text-msg-time-${msg.id}`}>
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {!isInbound && (
                                <span className="text-[#53bdeb]" data-testid={`status-msg-${msg.id}`}>
                                  <StatusIcon status={msg.status} />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* ── Message Input Area — WhatsApp style ── */}
            <div className="bg-[#f0f2f5] dark:bg-[#202c33] px-4 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-file-hidden"
              />
              {!windowState.open && (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30">
                  <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    24-hour messaging window has closed. Send a template to re-engage — the customer must reply to reopen the window.
                  </p>
                </div>
              )}
              {pendingAttachment && (
                <div className="mb-2 rounded-lg bg-white dark:bg-[#2a3942] p-3 relative">
                  <button
                    onClick={() => { setPendingAttachment(null); setAttachmentCaption(""); }}
                    data-testid="button-cancel-attachment"
                    className="absolute top-2 right-2 rounded-full p-1 bg-muted/80 hover-elevate"
                    style={{ zIndex: 2 }}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <div className="flex items-start gap-3 pr-6">
                    {pendingAttachment.preview ? (
                      <img src={pendingAttachment.preview} alt="Preview" className="w-20 h-20 object-cover rounded-md" data-testid="img-attachment-preview" />
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                        {pendingAttachment.type === "video" && <Video className="w-6 h-6 text-muted-foreground" />}
                        {pendingAttachment.type === "audio" && <Mic className="w-6 h-6 text-muted-foreground" />}
                        {pendingAttachment.type === "document" && <FileText className="w-6 h-6 text-muted-foreground" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid="text-attachment-name">{pendingAttachment.file.name}</p>
                      <p className="text-xs text-muted-foreground">{(pendingAttachment.file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {["image", "video", "document"].includes(pendingAttachment.type) && (
                      <Input
                        className="flex-1 text-sm"
                        placeholder="Add a caption..."
                        value={attachmentCaption}
                        onChange={(e) => setAttachmentCaption(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSendAttachment();
                          }
                        }}
                        data-testid="input-attachment-caption"
                      />
                    )}
                    {!["image", "video", "document"].includes(pendingAttachment.type) && <div className="flex-1" />}
                    <button
                      onClick={handleSendAttachment}
                      disabled={!!(uploadProgress || sendMessageMutation.isPending)}
                      data-testid="button-send-attachment"
                      className="rounded-full flex items-center justify-center shrink-0 disabled:opacity-50"
                      style={{ width: 36, height: 36, backgroundColor: "#00a884", color: "white" }}
                    >
                      {uploadProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2">
                <Popover open={attachmentPopoverOpen} onOpenChange={setAttachmentPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!windowState.open}
                      className="text-[#54656f] dark:text-[#8696a0] shrink-0"
                      data-testid="button-attachment"
                    >
                      <Paperclip className="w-5 h-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start" side="top">
                    <div className="flex flex-col">
                      <button
                        className="flex items-center gap-3 px-3 py-2 text-sm rounded-md hover-elevate"
                        onClick={() => handleFileSelect("image/*")}
                        data-testid="button-attach-image"
                      >
                        <Image className="w-4 h-4 text-blue-500" />
                        Image
                      </button>
                      <button
                        className="flex items-center gap-3 px-3 py-2 text-sm rounded-md hover-elevate"
                        onClick={() => handleFileSelect("video/*")}
                        data-testid="button-attach-video"
                      >
                        <Video className="w-4 h-4 text-purple-500" />
                        Video
                      </button>
                      <button
                        className="flex items-center gap-3 px-3 py-2 text-sm rounded-md hover-elevate"
                        onClick={() => handleFileSelect("audio/*")}
                        data-testid="button-attach-audio"
                      >
                        <Mic className="w-4 h-4 text-orange-500" />
                        Audio
                      </button>
                      <button
                        className="flex items-center gap-3 px-3 py-2 text-sm rounded-md hover-elevate"
                        onClick={() => handleFileSelect("*/*")}
                        data-testid="button-attach-document"
                      >
                        <FileText className="w-4 h-4 text-green-500" />
                        Document
                      </button>
                      <button
                        className="flex items-center gap-3 px-3 py-2 text-sm rounded-md hover-elevate"
                        onClick={() => { setAttachmentPopoverOpen(false); setLocationDialogOpen(true); }}
                        data-testid="button-attach-location"
                      >
                        <MapPin className="w-4 h-4 text-red-500" />
                        Location
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setTemplateDialogOpen(true)}
                  className="text-[#54656f] dark:text-[#8696a0] shrink-0"
                  data-testid="button-send-template"
                >
                  <MessageSquarePlus className="w-5 h-5" />
                </Button>
                <Textarea
                  className="resize-none text-sm min-h-[40px] max-h-[100px] flex-1 rounded-lg bg-white dark:bg-[#2a3942] border-0 focus-visible:ring-1"
                  placeholder={windowState.open ? "Type a message" : "Window closed \u2014 use template"}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  disabled={!windowState.open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendText();
                    }
                  }}
                  rows={1}
                  data-testid="input-message"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleSendText}
                  disabled={!messageInput.trim() || sendMessageMutation.isPending || !windowState.open}
                  className="text-[#54656f] dark:text-[#8696a0] shrink-0"
                  data-testid="button-send-message"
                >
                  {sendMessageMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Template Dialog ── */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Template Message</DialogTitle>
            <DialogDescription>
              {windowState.open
                ? "Select an approved template and fill in any variables to send a message."
                : "The 24-hour window is closed. Send a template to re-engage \u2014 the customer must reply to reopen the conversation window."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Template</Label>
              <Select
                value={selectedTemplate?.name || ""}
                onValueChange={(name) => {
                  const tmpl = metaTemplates.find((t) => t.name === name);
                  setSelectedTemplate(tmpl || null);
                  setTemplateLanguage(tmpl?.language || "en_US");
                  setTemplateVars({});
                }}
              >
                <SelectTrigger data-testid="select-template">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {metaTemplates.map((tmpl) => (
                    <SelectItem key={`${tmpl.name}-${tmpl.language}`} value={tmpl.name}>
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{tmpl.name}</span>
                        <Badge variant="secondary" className="text-xs ml-1">{tmpl.language}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedTemplate && (() => {
              const bodyComp = selectedTemplate.components?.find((c: any) => c.type === 'BODY');
              const bodyText = bodyComp?.text || '';
              const varMatches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
              return (
                <>
                  <div className="rounded-md border bg-muted/50 p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Badge variant="secondary" className="text-xs">{selectedTemplate.category}</Badge>
                      <Badge variant="outline" className="text-xs">{templateLanguage || selectedTemplate.language}</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{bodyText}</p>
                  </div>
                  {varMatches.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Variables</Label>
                      {varMatches.map((_: string, i: number) => (
                        <div key={`var_${i}`} className="space-y-1">
                          <Label className="text-xs text-muted-foreground">{`{{${i + 1}}}`}</Label>
                          <Input
                            placeholder={`Enter value for {{${i + 1}}}...`}
                            value={templateVars[`var_${i}`] || ""}
                            onChange={(e) => setTemplateVars({ ...templateVars, [`var_${i}`]: e.target.value })}
                            data-testid={`input-template-var-${i}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendTemplate}
              disabled={!selectedTemplate || sendMessageMutation.isPending}
              data-testid="button-confirm-send-template"
            >
              {sendMessageMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Location Dialog ── */}
      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Location</DialogTitle>
            <DialogDescription>Enter the coordinates and optional details for the location.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-sm">Latitude</Label>
                <Input
                  type="number"
                  step="any"
                  placeholder="e.g. 28.6139"
                  value={locationForm.latitude}
                  onChange={(e) => setLocationForm({ ...locationForm, latitude: e.target.value })}
                  data-testid="input-location-lat"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Longitude</Label>
                <Input
                  type="number"
                  step="any"
                  placeholder="e.g. 77.2090"
                  value={locationForm.longitude}
                  onChange={(e) => setLocationForm({ ...locationForm, longitude: e.target.value })}
                  data-testid="input-location-lng"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Name (optional)</Label>
              <Input
                placeholder="e.g. India Gate"
                value={locationForm.name}
                onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                data-testid="input-location-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Address (optional)</Label>
              <Input
                placeholder="e.g. Rajpath, New Delhi"
                value={locationForm.address}
                onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                data-testid="input-location-address"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLocationDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSendLocation}
              disabled={!locationForm.latitude || !locationForm.longitude || sendMessageMutation.isPending}
              data-testid="button-send-location"
            >
              {sendMessageMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
