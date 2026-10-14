import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Volume2, Square, VolumeX } from "lucide-react";
import { ambientSoundPlayer } from "@/utils/ambientSoundPlayer";

interface AmbientSoundPreviewButtonProps {
  soundKey: string;
  className?: string;
}

export const AmbientSoundPreviewButton: React.FC<AmbientSoundPreviewButtonProps> = ({ soundKey, className }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Stop playing if soundKey changed
    if (isPlaying) {
      if (soundKey && soundKey !== "none") {
        ambientSoundPlayer.play(soundKey);
      } else {
        ambientSoundPlayer.stop();
        setIsPlaying(false);
      }
    }
  }, [soundKey]);

  useEffect(() => {
    return () => {
      ambientSoundPlayer.stop();
    };
  }, []);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isPlaying) {
      ambientSoundPlayer.stop();
      setIsPlaying(false);
    } else {
      if (!soundKey || soundKey === "none") return;
      const success = ambientSoundPlayer.play(soundKey);
      if (success) {
        setIsPlaying(true);
      }
    }
  };

  const isEnabled = Boolean(soundKey && soundKey !== "none");

  return (
    <div className={`flex items-center gap-2 mt-1.5 ${className || ""}`}>
      <Button
        type="button"
        size="sm"
        variant={isPlaying ? "default" : "outline"}
        onClick={handleToggle}
        disabled={!isEnabled}
        className={`h-8 text-xs font-medium transition-all ${
          isPlaying
            ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-400/40"
            : isEnabled
            ? "border-emerald-500/40 hover:bg-emerald-500/10 hover:border-emerald-500 text-emerald-700 dark:text-emerald-300"
            : "opacity-60 cursor-not-allowed"
        }`}
        data-testid="button-ambient-sound-preview"
      >
        {isPlaying ? (
          <>
            <Square className="h-3.5 w-3.5 mr-1.5 fill-current animate-pulse text-white" />
            <span>Stop Preview</span>
            <span className="flex h-2 w-2 relative ml-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
          </>
        ) : isEnabled ? (
          <>
            <Volume2 className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" />
            <span>🔊 Listen Preview</span>
          </>
        ) : (
          <>
            <VolumeX className="h-3.5 w-3.5 mr-1.5 opacity-60" />
            <span>Select sound to preview</span>
          </>
        )}
      </Button>

      {isPlaying && (
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">
          Playing realistic {soundKey} ambience preview...
        </span>
      )}
    </div>
  );
};

export default AmbientSoundPreviewButton;
