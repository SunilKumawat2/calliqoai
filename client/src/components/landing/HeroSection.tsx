import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AuthStorage } from "@/lib/auth-storage";
import { useTranslation } from "react-i18next";
import robotHeroImg from "../../assets/images/robot-hero.png";
import greenWaveImg from "../../assets/images/green-wave.png";

export function HeroSection() {
  const { t } = useTranslation();
  const isAuthenticated = AuthStorage.isAuthenticated();
  const isAdmin = AuthStorage.isAdmin();

  const getDashboardLink = () => {
    if (isAuthenticated) {
      return isAdmin ? "/admin" : "/app";
    }
    return "/login";
  };

  return (
    <section
      className="relative flex flex-col items-center justify-center overflow-hidden bg-[#02040a] min-h-[600px] md:min-h-[700px] pt-32 pb-16 md:pt-40 md:pb-24"
      data-testid="hero-section"
    >
      {/* Background Green Wave Image (Figma asset) */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-40 mix-blend-screen pointer-events-none"
        style={{
          backgroundImage: `url(${greenWaveImg})`,
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        {/* Main Hero Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center text-left">

          {/* Left Column: Heading and Text */}
          <motion.div
            className="lg:col-span-7 space-y-6"
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <h1
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] text-white"
              data-testid="hero-headline"
            >
              AI VOICE AGENTS <br />
              FOR <span className="text-[#1CD152] drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">APPOINTMENT</span>
            </h1>

            <p
              className="text-base sm:text-lg md:text-xl text-gray-300 max-w-xl leading-relaxed"
              data-testid="hero-subheadline"
            >
              Create Human-like AI voice agents to handle outbound and inbound calls, book meetings, and take actions 24/7.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-4">
              <Link href={getDashboardLink()}>
                <Button
                  size="lg"
                  className="rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 h-12 transition-all duration-300 hover:shadow-[0_0_20px_rgba(37,99,235,0.4)] flex items-center gap-2 border-0"
                  data-testid="button-hero-get-started"
                >
                  <span>Get Started Free</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right Column: Robot Head Image */}
          <motion.div
            className="lg:col-span-5 flex justify-center relative"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.25, 0.4, 0.25, 1], delay: 0.15 }}
          >
            <div className="relative w-full max-w-[480px] aspect-square flex items-center justify-center">
              {/* Radial glow background for the robot */}
              <div className="absolute inset-0 bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none" />
              {/* The Robot Hero Image */}
              <img
                src={robotHeroImg}
                alt="AI Voice Agent Robot"
                className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_0_20px_rgba(16,185,129,0.25)]"
              />
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}

export default HeroSection;
