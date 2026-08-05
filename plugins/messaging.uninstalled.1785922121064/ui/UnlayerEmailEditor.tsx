import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";

const UNLAYER_SCRIPT_URL = "https://editor.unlayer.com/embed.js?2";

const SYSTEM_MERGE_TAGS: Record<string, { name: string; value: string }> = {
  app_name: { name: "App Name", value: "{{app_name}}" },
  logo_url: { name: "Logo URL", value: "{{logo_url}}" },
  current_date: { name: "Current Date", value: "{{current_date}}" },
  current_year: { name: "Current Year", value: "{{current_year}}" },
};

const DYNAMIC_MERGE_TAGS: Record<string, { name: string; value: string }> = {
  contact_name: { name: "Contact Name", value: "{{contact_name}}" },
  phone_number: { name: "Phone Number", value: "{{phone_number}}" },
  recipient_email: { name: "Recipient Email", value: "{{recipient_email}}" },
  appointment_date: { name: "Appointment Date", value: "{{appointment_date}}" },
  appointment_time: { name: "Appointment Time", value: "{{appointment_time}}" },
  agent_name: { name: "Agent Name", value: "{{agent_name}}" },
};

let unlayerScriptLoaded = false;
let unlayerScriptLoading: Promise<void> | null = null;

function loadUnlayerScript(): Promise<void> {
  if (unlayerScriptLoaded && (window as any).unlayer) {
    return Promise.resolve();
  }
  if (unlayerScriptLoading) return unlayerScriptLoading;

  unlayerScriptLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src*="editor.unlayer.com"]`);
    if (existing) {
      if ((window as any).unlayer) {
        unlayerScriptLoaded = true;
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        unlayerScriptLoaded = true;
        resolve();
      });
      return;
    }
    const script = document.createElement("script");
    script.src = UNLAYER_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      unlayerScriptLoaded = true;
      resolve();
    };
    script.onerror = () => {
      unlayerScriptLoading = null;
      reject(new Error("Failed to load Unlayer editor"));
    };
    document.head.appendChild(script);
  });

  return unlayerScriptLoading;
}

export interface UnlayerEditorHandle {
  exportHtml: () => Promise<{ html: string; design: any }>;
  getDesign: () => Promise<any>;
}

interface UnlayerEmailEditorProps {
  initialHtml?: string;
  initialDesign?: any;
  variables?: string[];
  onReady?: () => void;
}

const UnlayerEmailEditor = forwardRef<UnlayerEditorHandle, UnlayerEmailEditorProps>(
  ({ initialHtml, initialDesign, variables = [], onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [htmlOnlyWarning, setHtmlOnlyWarning] = useState(false);
    const editorIdRef = useRef(`unlayer-editor-${Math.random().toString(36).slice(2, 10)}`);
    const readyRef = useRef(false);

    const buildMergeTags = useCallback(() => {
      const tags: Record<string, any> = {};

      tags["System"] = {
        name: "System",
        mergeTags: { ...SYSTEM_MERGE_TAGS },
      };

      tags["Dynamic"] = {
        name: "Dynamic (from AI)",
        mergeTags: { ...DYNAMIC_MERGE_TAGS },
      };

      const customVars = variables.filter(
        (v) => !SYSTEM_MERGE_TAGS[v] && !DYNAMIC_MERGE_TAGS[v]
      );
      if (customVars.length > 0) {
        const customTags: Record<string, { name: string; value: string }> = {};
        customVars.forEach((v) => {
          customTags[v] = {
            name: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            value: `{{${v}}}`,
          };
        });
        tags["Custom"] = {
          name: "Custom Variables",
          mergeTags: customTags,
        };
      }

      return tags;
    }, [variables]);

    useImperativeHandle(ref, () => ({
      exportHtml: () => {
        return new Promise((resolve, reject) => {
          if (!editorRef.current || !readyRef.current) {
            reject(new Error("Editor not ready"));
            return;
          }
          editorRef.current.exportHtml((data: any) => {
            resolve({ html: data.html, design: data.design });
          });
        });
      },
      getDesign: () => {
        return new Promise((resolve, reject) => {
          if (!editorRef.current || !readyRef.current) {
            reject(new Error("Editor not ready"));
            return;
          }
          editorRef.current.saveDesign((design: any) => {
            resolve(design);
          });
        });
      },
    }));

    useEffect(() => {
      let mounted = true;

      (async () => {
        try {
          await loadUnlayerScript();
          if (!mounted || !containerRef.current) return;

          await new Promise((r) => setTimeout(r, 150));
          if (!mounted || !containerRef.current) return;

          const unlayer = (window as any).unlayer;
          if (!unlayer) {
            setError("Unlayer library not available");
            setLoading(false);
            return;
          }

          const isDark = document.documentElement.classList.contains("dark");

          unlayer.init({
            id: editorIdRef.current,
            displayMode: "email",
            appearance: {
              theme: isDark ? "dark" : "light",
              panels: {
                tools: {
                  dock: "left",
                  collapsible: true,
                },
              },
            },
            features: {
              textEditor: {
                spellChecker: false,
              },
            },
            mergeTags: buildMergeTags(),
          });

          editorRef.current = unlayer;

          unlayer.addEventListener("editor:ready", () => {
            if (!mounted) return;
            readyRef.current = true;
            setLoading(false);

            if (initialDesign && typeof initialDesign === "object" && Object.keys(initialDesign).length > 0) {
              unlayer.loadDesign(initialDesign);
            } else if (initialHtml && initialHtml.trim()) {
              setHtmlOnlyWarning(true);
            }

            onReady?.();
          });
        } catch (err: any) {
          if (mounted) {
            setError(err.message || "Failed to load editor");
            setLoading(false);
          }
        }
      })();

      return () => {
        mounted = false;
        readyRef.current = false;
        if (editorRef.current) {
          try {
            const frame = containerRef.current?.querySelector("iframe");
            if (frame) frame.remove();
          } catch {}
          editorRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (editorRef.current && readyRef.current) {
        try {
          editorRef.current.setMergeTags(buildMergeTags());
        } catch {}
      }
    }, [variables, buildMergeTags]);

    if (error) {
      return (
        <div className="border rounded-md p-8 text-center" data-testid="unlayer-error">
          <p className="text-sm text-destructive mb-2">Failed to load email editor</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      );
    }

    return (
      <div className="space-y-2" data-testid="unlayer-email-editor">
        {htmlOnlyWarning && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground bg-muted rounded-md" data-testid="text-html-only-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>This template was created before the visual editor. The editor starts fresh — your saved HTML will still be used when sending emails. Design a new version here to enable full visual editing.</span>
          </div>
        )}
        <div className="border rounded-md overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Loading email editor...</span>
              </div>
            </div>
          )}
          <div
            id={editorIdRef.current}
            ref={containerRef}
            style={{ height: "60vh", minHeight: "400px" }}
            data-testid="unlayer-container"
          />
        </div>
      </div>
    );
  }
);

UnlayerEmailEditor.displayName = "UnlayerEmailEditor";
export default UnlayerEmailEditor;
