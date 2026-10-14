import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Zap,
  Check,
  Copy,
  BookOpen,
  Plus,
  Volume2,
  CheckCircle2,
  ShieldAlert,
  Mic,
  FileText,
} from "lucide-react";

export const HUMAN_VOICE_DIRECTIVES_BLOCK = `### 🎙️ Human Voice & Punctuation Guidelines (Strictly Follow on Every Response):
1. **Breathing & Natural Pauses (,):** Use commas for natural short breaths and micro-pauses (e.g., "Okay, got it.").
2. **Natural Pitch Drop (.):** End statements with a full stop so your pitch falls naturally (e.g., "That's a strong one.").
3. **Curious Upward Inflection (?):** Use question marks to raise your voice pitch naturally when asking (e.g., "What happened next?").
4. **Thinking Hesitations (...):** Use ellipsis when pausing to think or bridging thoughts (e.g., "Hmm... let me check that for you.").
5. **Real Excitement (!):** Use exclamation marks sparingly for genuine warmth or enthusiasm (e.g., "Oh, I love that!"). Never overuse them.
6. **Write Numbers as Words:** Always spell out numbers into words instead of digits (e.g., write "ninety nine" not "99", "five hundred" not "500").
7. **Never Read Symbols:** Never output symbols like -, *, #, /, (, ), :, emojis, or bullet points in your speech. Speak in fluid conversational sentences.
8. **Spell Out Units & Currencies:** Always spell out abbreviations into spoken words (e.g., write "rupees" not "₹", "percent" not "%", "five thousand" not "5k", "twice" not "2x").
9. **Strict Language Matching:** Always reply in the exact language and dialect the caller is speaking in.
10. **Background Noise Resistance:** Ignore ambient chatter and background noise; stay solely focused on the primary caller.`;

export const COMPLETE_HUMAN_AGENT_STARTER_TEMPLATE = `You are a warm, attentive, and highly conversational AI executive assistant.

### 🏛️ The Four Pillars of Human Voice:
- **Pillar 1: Acoustic Naturalism** — Speak like a real human with natural breaths, pauses, and cadence.
- **Pillar 2: Adaptive Language** — Automatically mirror the caller's language and tone.
- **Pillar 3: Proactive Guidance** — If the caller hesitates or has no specific request, suggest helpful ideas.
- **Pillar 4: Noise Resistance** — Filter out background chatter and stay locked onto the caller's voice.

### 🎙️ Punctuation & Pronunciation Rules:
- Comma (,): Short breath and conversational pause ("Okay, got it.").
- Period (.): Full stop with a natural pitch drop ("That's a strong one.").
- Question mark (?): Inquisitive upward voice inflection ("What happened next?").
- Ellipsis (...): Thoughtful pause or hesitation ("Hmm... and the number?").
- Exclamation (!): Real, genuine excitement — use rarely ("Oh, I love that!").
- Numbers: Write all numbers as spoken words (write "ninety nine" not "99").
- Symbols: Never read aloud symbols like -, *, #, /, (, ), : or markdown formatting.
- Units: Spell out currencies and units (say "rupees" for ₹, "percent" for %, "five thousand" for 5k).`;

interface VoicePunctuationCheatSheetProps {
  currentPrompt: string;
  onApplyPrompt: (newPrompt: string) => void;
  triggerButtonVariant?: "default" | "outline" | "secondary" | "ghost";
  triggerButtonSize?: "default" | "sm" | "lg" | "icon";
  triggerClassName?: string;
  compact?: boolean;
}

export const VoicePunctuationCheatSheet: React.FC<VoicePunctuationCheatSheetProps> = ({
  currentPrompt,
  onApplyPrompt,
  triggerButtonVariant = "outline",
  triggerButtonSize = "sm",
  triggerClassName = "",
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const isAlreadyActive =
    Boolean(currentPrompt) &&
    (currentPrompt.includes("Human Voice & Punctuation Guidelines") ||
      currentPrompt.includes("The punctuation cheat sheet") ||
      currentPrompt.includes("Write Numbers as Words"));

  const handleAppendDirectives = () => {
    let updated = "";
    if (!currentPrompt || !currentPrompt.trim()) {
      updated = HUMAN_VOICE_DIRECTIVES_BLOCK;
    } else if (isAlreadyActive) {
      toast({
        title: "Directives Already Present",
        description: "Your system prompt already contains the human voice guidelines.",
      });
      setIsOpen(false);
      return;
    } else {
      updated = `${currentPrompt.trim()}\n\n${HUMAN_VOICE_DIRECTIVES_BLOCK}`;
    }

    onApplyPrompt(updated);
    toast({
      title: "Human Voice Directives Added! 🎙️",
      description: "Punctuation and speech cadence rules added to system prompt.",
    });
    setIsOpen(false);
  };

  const handleReplaceWithFullTemplate = () => {
    onApplyPrompt(COMPLETE_HUMAN_AGENT_STARTER_TEMPLATE);
    toast({
      title: "Complete Human Voice Template Applied! ✨",
      description: "System prompt updated with the complete 4-pillar voice template.",
    });
    setIsOpen(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(HUMAN_VOICE_DIRECTIVES_BLOCK);
    setCopied(true);
    toast({
      title: "Copied to Clipboard! 📋",
      description: "Voice punctuation directives copied.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant={triggerButtonVariant}
          size={triggerButtonSize}
          onClick={() => setIsOpen(true)}
          className={`h-7 px-2.5 text-xs font-medium gap-1.5 border-lime-500/40 bg-lime-500/10 hover:bg-lime-500/20 text-lime-700 dark:text-lime-300 transition-all ${triggerClassName}`}
          data-testid="btn-open-punctuation-cheat-sheet"
        >
          <Sparkles className="w-3.5 h-3.5 text-lime-600 dark:text-lime-400" />
          <span>{compact ? "Voice Style" : "⚡ Human Voice Cheat Sheet"}</span>
          {isAlreadyActive && (
            <Badge
              variant="secondary"
              className="ml-1 h-4 px-1 text-[10px] bg-lime-600 text-white hover:bg-lime-600"
            >
              ✓ Active
            </Badge>
          )}
        </Button>

        {!isAlreadyActive && (
          <Button
            type="button"
            variant="ghost"
            size={triggerButtonSize}
            onClick={handleAppendDirectives}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            title="One-click append Human Voice rules"
            data-testid="btn-quick-add-human-voice"
          >
            <Plus className="w-3 h-3 text-lime-600 dark:text-lime-400" />
            <span>Add Rules</span>
          </Button>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden flex flex-col bg-card border-border shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-border bg-gradient-to-r from-lime-500/10 via-background to-emerald-500/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-lime-500/20 border border-lime-500/30 flex items-center justify-center text-lime-600 dark:text-lime-400 shadow-sm">
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    <span>The Punctuation Cheat Sheet</span>
                    <Badge variant="outline" className="text-xs border-lime-500 text-lime-600 dark:text-lime-400">
                      ElevenLabs Voice Tuning
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    This is what each punctuation mark does to her voice. Built directly into the prompt so the AI speaks with natural human breaths and intonations.
                  </DialogDescription>
                </div>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 p-6 overflow-y-auto">
            {/* 8 Cards Grid (Replicating exact user screenshot) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
              {/* Card 1: Comma */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-lg mb-2.5">
                    ,
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Short breath</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"Okay, got it."</p>
              </div>

              {/* Card 2: Period */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-lg mb-2.5">
                    .
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Full stop, voice falls</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"That's a strong one."</p>
              </div>

              {/* Card 3: Question Mark */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-lg mb-2.5">
                    ?
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Voice rises</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"What happened next?"</p>
              </div>

              {/* Card 4: Ellipsis */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-lg mb-2.5">
                    ...
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Thinking pause</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"Hmm... and the number?"</p>
              </div>

              {/* Card 5: Exclamation */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-lg mb-2.5">
                    !
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Real excitement, rarely</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"Oh, I love that!"</p>
              </div>

              {/* Card 6: Numbers */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-lime-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-lime-400/25 dark:bg-lime-500/20 text-lime-900 dark:text-lime-300 font-mono font-bold text-sm mb-2.5">
                    99
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Write numbers as words</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-3">"ninety nine percentile"</p>
              </div>

              {/* Card 7: Never Symbols */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-rose-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono font-semibold text-xs mb-2.5">
                    - * # / ( ) :
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Never</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-2">
                  Read aloud as symbols or break the flow
                </p>
              </div>

              {/* Card 8: Never Units */}
              <div className="p-4 rounded-xl border border-border/80 bg-background/80 hover:border-rose-500/50 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono font-semibold text-xs mb-2.5">
                    ₹ % 5k 2x
                  </div>
                  <h4 className="font-semibold text-sm text-foreground">Never</h4>
                </div>
                <p className="text-xs text-muted-foreground italic mt-2">
                  Say "rupees", "percent", "five thousand", "twice"
                </p>
              </div>
            </div>

            {/* The 4 Pillars Information Box */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border mb-6">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-lime-600 dark:text-lime-400" />
                The Four Pillars of Human Sounding AI:
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Punctuation & Cadence:</strong> Short breath commas, pitch drop full stops, thinking ellipses.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Strict Language Matching:</strong> Replies naturally in the exact language & tone of the caller.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Conversational Suggestion:</strong> Proactively offers ideas when caller is quiet or unsure.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Background Noise Resistance:</strong> Ignores room chatter or TV noise; stays focused on caller.
                  </div>
                </div>
              </div>
            </div>

            {/* Prompt Directives Code Block Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Prompt Directives Preview
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy Text</span>
                    </>
                  )}
                </Button>
              </div>
              <pre className="p-3.5 rounded-lg bg-muted text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap text-foreground/90 border border-border">
                {HUMAN_VOICE_DIRECTIVES_BLOCK}
              </pre>
            </div>
          </ScrollArea>

          <DialogFooter className="p-4 border-t border-border bg-background/50 flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isAlreadyActive ? (
                <span className="flex items-center gap-1.5 text-lime-600 dark:text-lime-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Directives are already present in your prompt
                </span>
              ) : (
                <span>Clicking Insert will append these 10 rules to your existing prompt.</span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReplaceWithFullTemplate}
                className="text-xs"
                title="Replace everything with the complete 4-pillar agent prompt"
              >
                Insert Complete Starter
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleAppendDirectives}
                className="bg-lime-600 hover:bg-lime-700 text-white font-medium text-xs gap-1.5 shadow-sm"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{isAlreadyActive ? "Re-insert Directives" : "Append to System Prompt"}</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
