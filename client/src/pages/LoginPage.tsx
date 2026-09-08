import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/components/BrandingProvider";
import { AuthStorage } from "@/lib/auth-storage";
import { AILoadingAnimation } from "@/components/landing/AILoadingAnimation";
import { Link } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import "../landing.css";

type ViewType = "login" | "register" | "register-otp" | "forgot-password" | "reset-password";

export default function LoginPage() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const initialTab = location === "/register" ? "register" : "login";

  const [activeView, setActiveView] = useState<ViewType>(initialTab);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string>("");

  // Name fields locally for the custom register structure
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [otpTimer, setOtpTimer] = useState(0);
  const [registerOtpCode, setRegisterOtpCode] = useState<string>("");
  const [canResendOtp, setCanResendOtp] = useState(false);

  const { toast } = useToast();
  const { branding, currentLogo } = useBranding();

  const loginSchema = z.object({
    email: z.string().email(t("loginPage.errors.invalidEmail")),
    password: z.string().min(1, t("loginPage.errors.passwordRequired")),
  });

  const registerSchema = z.object({
    name: z.string().min(2, t("loginPage.errors.nameLength")),
    email: z.string().email(t("loginPage.errors.invalidEmail")),
    password: z.string().min(8, t("loginPage.errors.passwordLength")),
    confirmPassword: z.string(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t("loginPage.errors.passwordsMatch"),
    path: ["confirmPassword"],
  });

  const forgotPasswordSchema = z.object({
    email: z.string().email(t("loginPage.errors.invalidEmail")),
  });

  const resetPasswordSchema = z.object({
    otp: z.string().min(6, t("loginPage.errors.otpLength")),
    newPassword: z.string().min(8, t("loginPage.errors.passwordLength")),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: t("loginPage.errors.passwordsMatch"),
    path: ["confirmPassword"],
  });

  type LoginFormData = z.infer<typeof loginSchema>;
  type RegisterFormData = z.infer<typeof registerSchema>;
  type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
  type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

  // OTP timer countdown
  useEffect(() => {
    if (otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    } else if (otpTimer === 0 && (activeView === 'register-otp' || activeView === 'reset-password')) {
      setCanResendOtp(true);
    }
  }, [otpTimer, activeView]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const forgotPasswordForm = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const resetPasswordForm = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { otp: "", newPassword: "", confirmPassword: "" },
  });

  const handleLoadingComplete = () => {
    if (pendingRedirect) {
      setLocation(pendingRedirect);
    }
  };

  const getRedirectParam = () => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("redirect");
    }
    return null;
  };

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Login failed");
      }

      AuthStorage.setAuthData(result.token, result.user, result.refreshToken, result.expiresIn);
      setUserName(result.user.name || result.user.email.split('@')[0]);

      toast({ title: t("loginPage.toasts.welcomeBack"), description: t("loginPage.toasts.loginSuccess") });

      const queryRedirect = getRedirectParam();
      const redirectPath = queryRedirect || ((result.user.role === 'admin' || result.user.role === 'super_admin') ? "/admin" : "/app");
      setPendingRedirect(redirectPath);
      setShowLoadingAnimation(true);
    } catch (error: any) {
      toast({ title: t("loginPage.errors.loginFailed"), description: error.message || t("loginPage.errors.invalidCredentials"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendRegistrationOTP = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || t("loginPage.errors.sendOtpFailed"));
      }

      toast({
        title: t("loginPage.toasts.codeSent"),
        description: t("loginPage.toasts.checkEmailAt", { email: data.email }),
      });

      setActiveView('register-otp');
      setOtpTimer(300); // 5 minutes countdown
      setCanResendOtp(false);
      setRegisterOtpCode("");
    } catch (error: any) {
      toast({
        title: t("loginPage.errors.sendOtpFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendRegistrationOTP = async () => {
    const data = registerForm.getValues();
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || t("loginPage.errors.sendOtpFailed"));
      }

      toast({
        title: t("loginPage.toasts.codeSent"),
        description: t("loginPage.toasts.otpSent"),
      });

      setOtpTimer(300);
      setCanResendOtp(false);
      setRegisterOtpCode("");
    } catch (error: any) {
      toast({
        title: t("loginPage.errors.sendOtpFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerOtpCode.length !== 6) {
      toast({ title: t("loginPage.errors.invalidCode"), description: t("loginPage.errors.otpLength"), variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const verifyResponse = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.getValues().email,
          otpCode: registerOtpCode,
        }),
      });

      const verifyResult = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(verifyResult.error || t("loginPage.errors.invalidCode"));
      }

      const registerData = registerForm.getValues();
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerData.email,
          password: registerData.password,
          name: registerData.name,
        }),
      });

      const result = await registerResponse.json();

      if (!registerResponse.ok) {
        throw new Error(result.error || t("loginPage.errors.genericError"));
      }

      AuthStorage.setAuthData(result.token, result.user, result.refreshToken, result.expiresIn);
      setUserName(result.user.name || result.user.email.split('@')[0]);

      toast({
        title: t("loginPage.toasts.registrationSuccess"),
        description: t("loginPage.toasts.welcomeUser", { name: result.user.name }),
      });

      const queryRedirect = getRedirectParam();
      const redirectPath = queryRedirect || (result.user.role === 'admin' ? "/admin" : "/app");
      setPendingRedirect(redirectPath);
      setShowLoadingAnimation(true);
    } catch (error: any) {
      toast({
        title: t("loginPage.errors.genericError"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToRegisterDetails = () => {
    setActiveView('register');
    setRegisterOtpCode("");
    setOtpTimer(0);
    setCanResendOtp(false);
  };

  const handleForgotPasswordSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const result = await response.json();

      if (response.ok) {
        setForgotPasswordEmail(data.email);
        setOtpTimer(300);
        setCanResendOtp(false);
        setActiveView("reset-password");
        toast({ title: t("loginPage.toasts.codeSent"), description: t("loginPage.rightPanel.form.checkEmail") });
      } else {
        toast({ title: t("loginPage.errors.sendOtpFailed"), description: result.error || t("loginPage.errors.genericError"), variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: t("loginPage.errors.sendOtpFailed"), description: error.message || t("loginPage.errors.genericError"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendForgotPasswordOTP = async () => {
    if (otpTimer > 0) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });
      const result = await response.json();

      if (response.ok) {
        setOtpTimer(300);
        setCanResendOtp(false);
        toast({ title: t("loginPage.toasts.codeSent"), description: t("loginPage.rightPanel.form.checkEmail") });
      } else {
        toast({ title: t("loginPage.errors.genericError"), description: result.error || t("loginPage.errors.genericError"), variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: t("loginPage.errors.genericError"), description: error.message || t("loginPage.errors.genericError"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (data: ResetPasswordFormData) => {
    setIsLoading(true);
    try {
      const verifyResponse = await fetch("/api/auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotPasswordEmail, otpCode: data.otp }),
      });
      const verifyResult = await verifyResponse.json();

      if (!verifyResponse.ok) {
        toast({ title: t("loginPage.errors.invalidCode"), description: verifyResult.error || t("loginPage.errors.checkCode"), variant: "destructive" });
        setIsLoading(false);
        return;
      }

      const resetResponse = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotPasswordEmail,
          newPassword: data.newPassword
        }),
      });
      const resetResult = await resetResponse.json();

      if (resetResponse.ok) {
        toast({ title: t("loginPage.toasts.passwordReset"), description: t("loginPage.toasts.loginWithNew") });
        resetPasswordForm.reset();
        forgotPasswordForm.reset();
        setActiveView("login");
      } else {
        toast({ title: t("loginPage.errors.resetPasswordFailed"), description: resetResult.error || t("loginPage.errors.genericError"), variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: t("loginPage.errors.resetPasswordFailed"), description: error.message || t("loginPage.errors.genericError"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmitWrapper = (e: React.FormEvent) => {
    e.preventDefault();
    registerForm.setValue("name", `${firstName} ${lastName}`.trim());
    registerForm.setValue("confirmPassword", registerForm.getValues().password);
    registerForm.handleSubmit(handleSendRegistrationOTP)(e);
  };

  const handleGoogleAuth = () => {
    toast({
      title: "Google Authentication",
      description: "Google OAuth is not configured for this project workspace.",
    });
  };

  return (
    <>
      <AILoadingAnimation
        isVisible={showLoadingAnimation}
        onComplete={handleLoadingComplete}
        userName={userName}
      />

      <div className="calliqo-landing">
        <div className="auth-page">
          <div className="auth-grid"></div>
          <div className="auth-glow"></div>

          <header className="auth-header">
            <Link href="/" className="brand" aria-label="CALLIQO AI home">
              <img
                src={currentLogo || "/images/dark_logo.svg"}
                alt={branding.app_name || "CALLIQO AI"}
                style={{ height: "32px", width: "auto", objectFit: "contain" }}
              />
            </Link>
            <Link href="/" className="back-link">← Back to website</Link>
          </header>

          <main className="auth-main">
            <section className="auth-message">
              <span className="kicker">AI VOICE CALLING + LEAD INTELLIGENCE</span>
              <h1>Turn every call into<br /><span>your next opportunity.</span></h1>
              <p>Build intelligent voice agents, qualify leads in real time, and move every conversation forward.</p>

              <div className="auth-points">
                <div>
                  <i>✓</i>
                  <span>
                    <strong>Launch in minutes</strong>
                    <small>Configure your first agent with no code.</small>
                  </span>
                </div>
                <div>
                  <i>✓</i>
                  <span>
                    <strong>Know every lead</strong>
                    <small>Capture intent, context, and next steps.</small>
                  </span>
                </div>
                <div>
                  <i>✓</i>
                  <span>
                    <strong>Stay connected</strong>
                    <small>Sync your CRM, calendar, and workflows.</small>
                  </span>
                </div>
              </div>

              {/* <div className="auth-wave" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </div> */}
            </section>

            <section className="auth-card">
              <div className="auth-tabs" role="tablist">
                <button
                  className={activeView === "login" || activeView === "forgot-password" || activeView === "reset-password" ? "active" : ""}
                  role="tab"
                  aria-selected={activeView === "login"}
                  onClick={() => {
                    setActiveView("login");
                    loginForm.reset();
                  }}
                >
                  Sign in
                </button>
                <button
                  className={activeView === "register" || activeView === "register-otp" ? "active" : ""}
                  role="tab"
                  aria-selected={activeView === "register"}
                  onClick={() => {
                    setActiveView("register");
                    registerForm.reset();
                  }}
                >
                  Create account
                </button>
              </div>

              {/* LOGIN PANEL */}
              {(activeView === "login") && (
                <div className="auth-panel active">
                  <div className="auth-title">
                    {/* <span className="status-dot"></span> */}
                    <div>
                      <h2>Welcome back</h2>
                      <p>Sign in to continue to CALLIQO AI.</p>
                    </div>
                  </div>
                  {/* <button className="social-auth" type="button" onClick={handleGoogleAuth}>
                    <span>G</span> Continue with Google
                  </button> */}
                  {/* <div className="auth-divider"><span>or continue with email</span></div> */}

                  <form onSubmit={loginForm.handleSubmit(handleLogin)}>
                    <label>
                      Email address
                      <input
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        required
                        {...loginForm.register("email")}
                      />
                    </label>
                    <label>
                      Password
                      <div className="password-field">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter your password"
                          autoComplete="current-password"
                          required
                          {...loginForm.register("password")}
                        />
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label="Toggle password visibility"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </label>
                    <div className="form-meta">
                      <label className="remember">
                        <input type="checkbox" /> Remember me
                      </label>
                      <button
                        type="button"
                        className="bg-transparent border-0 p-0 text-lime text-xs cursor-pointer"
                        style={{ color: 'var(--lime)', background: 'none', border: 'none', outline: 'none' }}
                        onClick={() => setActiveView("forgot-password")}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <button className="auth-submit" type="submit" disabled={isLoading}>
                      {isLoading ? "Signing in..." : "Sign in"}
                      {/* <span>→</span> */}
                    </button>
                  </form>

                  <p className="auth-switch">
                    New to CALLIQO AI? <button type="button" onClick={() => setActiveView("register")}>Create an account</button>
                  </p>
                </div>
              )}

              {/* REGISTER PANEL */}
              {(activeView === "register") && (
                <div className="auth-panel active">
                  <div className="auth-title">
                    {/* <span className="status-dot"></span> */}
                    <div>
                      <h2>Create your account</h2>
                      <p>Start building your first AI voice agent.</p>
                    </div>
                  </div>
                  {/* <button className="social-auth" type="button" onClick={handleGoogleAuth}>
                    <span>G</span> Sign up with Google
                  </button> */}
                  {/* <div className="auth-divider"><span>or sign up with email</span></div> */}

                  <form onSubmit={handleRegisterSubmitWrapper}>
                    <div className="field-row">
                      <label>
                        First name
                        <input
                          type="text"
                          placeholder="First name"
                          autoComplete="given-name"
                          required
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                        />
                      </label>
                      <label>
                        Last name
                        <input
                          type="text"
                          placeholder="Last name"
                          autoComplete="family-name"
                          required
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      Work email
                      <input
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        required
                        {...registerForm.register("email")}
                      />
                    </label>
                    <label>
                      Create password
                      <div className="password-field">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="8+ characters"
                          autoComplete="new-password"
                          minLength={8}
                          required
                          {...registerForm.register("password")}
                        />
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label="Toggle password visibility"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </label>
                    <label className="terms">
                      <input type="checkbox" required /> I agree to the <Link href="/terms" className="text-lime">Terms</Link> and <Link href="/privacy" className="text-lime">Privacy Policy</Link>.
                    </label>
                    <button className="auth-submit" type="submit" disabled={isLoading}>
                      {isLoading ? "Sending OTP..." : "Create Account"}
                      {/* <span>→</span> */}
                    </button>
                  </form>

                  <p className="auth-switch">
                    Already have an account? <button type="button" onClick={() => setActiveView("login")}>Sign in</button>
                  </p>
                </div>
              )}

              {/* REGISTER OTP PANEL */}
              {(activeView === "register-otp") && (
                <div className="auth-panel active">
                  <div className="auth-title">
                    <span className="status-dot"></span>
                    <div>
                      <h2>Verify your email</h2>
                      <p>Enter the 6-digit code sent to {registerForm.getValues().email}.</p>
                    </div>
                  </div>
                  <form onSubmit={handleVerifyAndRegister}>
                    <label>
                      Verification Code
                      <input
                        type="text"
                        placeholder="Enter 6-digit code"
                        maxLength={6}
                        value={registerOtpCode}
                        onChange={(e) => setRegisterOtpCode(e.target.value)}
                        required
                      />
                    </label>
                    {otpTimer > 0 ? (
                      <p className="text-[10px] text-gray-500 font-mono mt-1">Resend code in {otpTimer}s</p>
                    ) : (
                      <button
                        type="button"
                        className="text-[10px] text-lime cursor-pointer bg-transparent border-0 p-0 font-mono mt-1"
                        onClick={handleResendRegistrationOTP}
                      >
                        Resend verification code
                      </button>
                    )}
                    <button className="auth-submit" type="submit" disabled={isLoading}>
                      {isLoading ? "Verifying..." : "Verify and Register"} <span>→</span>
                    </button>
                  </form>
                  <p className="auth-switch">
                    Incorrect email? <button type="button" onClick={handleBackToRegisterDetails}>Go back</button>
                  </p>
                </div>
              )}

              {/* FORGOT PASSWORD PANEL */}
              {(activeView === "forgot-password") && (
                <div className="auth-panel active">
                  <div className="auth-title">
                    <span className="status-dot"></span>
                    <div>
                      <h2>Reset Password</h2>
                      <p>Enter your email to receive a password reset verification code.</p>
                    </div>
                  </div>
                  <form onSubmit={forgotPasswordForm.handleSubmit(handleForgotPasswordSubmit)}>
                    <label>
                      Email address
                      <input
                        type="email"
                        placeholder="you@company.com"
                        required
                        {...forgotPasswordForm.register("email")}
                      />
                    </label>
                    <button className="auth-submit" type="submit" disabled={isLoading}>
                      {isLoading ? "Sending code..." : "Send Reset Code"} <span>→</span>
                    </button>
                  </form>
                  <p className="auth-switch">
                    Remember password? <button type="button" onClick={() => setActiveView("login")}>Sign in</button>
                  </p>
                </div>
              )}

              {/* RESET PASSWORD PANEL */}
              {(activeView === "reset-password") && (
                <div className="auth-panel active">
                  <div className="auth-title">
                    <span className="status-dot"></span>
                    <div>
                      <h2>New Password</h2>
                      <p>Enter the code sent to your email and set your new password.</p>
                    </div>
                  </div>
                  <form onSubmit={resetPasswordForm.handleSubmit(handleResetPassword)}>
                    <label>
                      Verification Code
                      <input
                        type="text"
                        placeholder="6-digit code"
                        required
                        {...resetPasswordForm.register("otp")}
                      />
                    </label>
                    <label>
                      New Password
                      <input
                        type="password"
                        placeholder="8+ characters"
                        required
                        {...resetPasswordForm.register("newPassword")}
                      />
                    </label>
                    <label>
                      Confirm Password
                      <input
                        type="password"
                        placeholder="Confirm new password"
                        required
                        {...resetPasswordForm.register("confirmPassword")}
                      />
                    </label>
                    <button className="auth-submit" type="submit" disabled={isLoading}>
                      {isLoading ? "Resetting..." : "Reset Password"} <span>→</span>
                    </button>
                  </form>
                  <p className="auth-switch">
                    Back to sign in? <button type="button" onClick={() => setActiveView("login")}>Sign in</button>
                  </p>
                </div>
              )}

              {/* <div className="secure-note">
                ◈ Secure authentication · Your data stays protected</div> */}
            </section>
          </main>
        </div>
      </div>
    </>
  );
}