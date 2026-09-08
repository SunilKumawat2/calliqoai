import { useState } from "react";
import { Link } from "wouter";
import { SEOHead } from "@/components/landing/SEOHead";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";
import "../landing.css";

export default function LandingPage() {
  const { branding, currentLogo } = useBranding();
  const { data: seoSettings } = useSeoSettings();
  const [isAnnual, setIsAnnual] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const defaultKeywords = [
    "AI voice agents",
    "automated calling",
    "lead qualification",
    "AI phone agents",
    "call automation",
    "voice AI",
    "outbound calling",
    "customer service AI",
    "ElevenLabs",
    "Twilio integration"
  ];

  const seoTitle = seoSettings?.defaultTitle || "CALLIQO AI";
  const seoDescription = seoSettings?.defaultDescription || branding.app_tagline || "The Intelligence Behind Every Conversation.";
  const seoKeywords = (seoSettings?.defaultKeywords && seoSettings.defaultKeywords.length > 0)
    ? seoSettings.defaultKeywords
    : defaultKeywords;
  const seoOgImage = seoSettings?.defaultOgImage || undefined;
  const seoCanonicalUrl = seoSettings?.canonicalBaseUrl || undefined;

  return (
    <div className="calliqo-landing">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={seoCanonicalUrl}
        ogImage={seoOgImage}
        ogSiteName={branding.app_name}
        keywords={seoKeywords}
        twitterSite={seoSettings?.twitterHandle || undefined}
        twitterCreator={seoSettings?.twitterHandle || undefined}
        googleVerification={seoSettings?.googleVerification || undefined}
        bingVerification={seoSettings?.bingVerification || undefined}
        facebookAppId={seoSettings?.facebookAppId || undefined}
        structuredDataOrg={seoSettings?.structuredDataOrg}
        structuredDataFaq={seoSettings?.structuredDataFaq}
        structuredDataProduct={seoSettings?.structuredDataProduct}
      />

      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <header className="nav-wrap">
        <nav className="nav container" aria-label="Main navigation">
          <Link href="/" className="brand" aria-label="CALLIQO AI home">
            <img
              src="/images/dark_logo.svg"
              alt={branding.app_name || "CALLIQO AI"}
              style={{ height: "32px", width: "auto", objectFit: "contain" }}
            />
          </Link>
          <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
            <a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a>
            <a href="#solutions" onClick={() => setMenuOpen(false)}>Solutions</a>
            <a href="#integrations" onClick={() => setMenuOpen(false)}>Integrations</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          </div>
          <Link href="/login" className="button button-small">
            Sign In / Sign Up <span>↗</span>
          </Link>
          <button
            className={`menu ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="eyebrow reveal">
            CALLIQO AI is now live
          </div>
          <h1 className="reveal">
            The intelligence<br />
            behind<br />
            <span>every<br />conversation.</span>
          </h1>
          <p className="hero-copy reveal">
            AI voice agents that call, listen, qualify, and act—so your team enters every conversation with context and leaves with the next step.
          </p>
          <div className="hero-actions reveal">
            <Link href="/login" className="button">
              Get Started <span>↗</span>
            </Link>
            <Link href="/login" className="text-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ marginRight: '6px', flexShrink: 0 }}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
              Explore The Platform
            </Link>
          </div>

          <div className="signal-stage reveal" aria-label="CALLIQO AI live call intelligence interface">
            <div className="stage-glow"></div>
            <div className="call-card glass">
              <div className="card-head">
                <span className="live"><i></i> LIVE CALL</span>
                <span className="mono">04:38</span>
              </div>
              <div className="caller">
                <div className="avatar">AM</div>
                <div>
                  <strong>Alex Morgan</strong>
                  <small>Director of Operations · Acme</small>
                </div>
                <div className="call-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c100a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </div>
              </div>
              <div className="wave" aria-hidden="true"></div>
              <div className="transcript">
                <span>AI AGENT</span>
                <p>Based on your current volume, it sounds like lead response time is the biggest gap. Is that right?</p>
              </div>
              <div className="listening">
                <span></span> Listening & Analyzing Intent
              </div>
            </div>

            <div className="intel-card glass">
              <div className="card-head">
                <span>CONVERSATION INTELLIGENCE</span>
                <span className="spark">✦</span>
              </div>
              <div className="score">
                <div>
                  <small>LEAD SCORE</small>
                  <strong>87</strong>
                  <span>/100</span>
                </div>
                <div className="score-ring">
                  <b>HOT</b>
                </div>
              </div>
              <div className="intent">
                <small>DETECTED INTENT</small>
                <div>
                  <span>High buying intent</span>
                  <b>96%</b>
                </div>
                <div>
                  <span>Needs CRM integration</span>
                  <b>89%</b>
                </div>
                <div>
                  <span>Decision maker</span>
                  <b>82%</b>
                </div>
              </div>
              <div className="next">
                <span>✦</span>
                <div>
                  <small>RECOMMENDED NEXT STEP</small>
                  <strong>Book technical discovery call</strong>
                </div>
                <b>→</b>
              </div>
            </div>

            <div className="outcome glass">
              <span>✓</span>
              <div>
                <small>Outcome Captured</small>
                <strong>Meeting booked · CRM updated</strong>
              </div>
            </div>
          </div>

          <div className="trust-line">
            <span>BUILT FOR MODERN REVENUE TEAMS</span>
            <div>
              <div className="trust-item">
                <span>Sales</span>
                <small>Team</small>
              </div>
              <div className="trust-item">
                <span>Customer</span>
                <small>Service</small>
              </div>
              <div className="trust-item">
                <span>Marketing</span>
                <small>Team</small>
              </div>
              <div className="trust-item">
                <span>Survey & Feedback</span>
                <small>Collection</small>
              </div>
              <div className="trust-item">
                <span>Appointment-Based</span>
                <small>Businesses</small>
              </div>
              <div className="trust-item">
                <span>Lead</span>
                <small>Generation</small>
              </div>
            </div>
          </div>
        </section>

        <section className="section container" id="platform">
          <div className="section-head">
            <div>
              <span className="kicker">01 / THE PLATFORM</span>
              <h2>More than a voice agent.<br /><span>A system that understands.</span></h2>
            </div>
            <p>CALLIQO AI combines natural voice automation with real-time intelligence—turning conversations into structured, actionable data.</p>
          </div>
          <div className="cap-grid">
            <article className="feature feature-large">
              <span className="feature-no">01</span>
              <div className="orbit">
                <div className="orb-center">
                  <span className="brand-mark">
                    <i></i><i></i><i></i><i></i><i></i>
                  </span>
                </div>
                <span className="orbit-tag tag-one">Intent</span>
                <span className="orbit-tag tag-two">Context</span>
                <span className="orbit-tag tag-three">Action</span>
              </div>
              <div className="feature-footer">
                <div className="feature-icon-badge">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1CD152" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M19 8a3 3 0 0 1 0 6"></path>
                    <path d="M22 6a7 7 0 0 1 0 10"></path>
                  </svg>
                </div>
                <div className="feature-body">
                  <h3>Human-like voice agents</h3>
                  <p>Build agents that handle natural, goal-driven conversations across inbound and outbound calls—without sounding scripted.</p>
                </div>
              </div>
            </article>

            <article className="feature">
              <span className="feature-no">02</span>
              <div className="mini-bars">
                <img
                  src="/images/calliqologo.png"
                  alt="Calliqo Logo"
                  style={{ height: "64px", width: "auto", objectFit: "contain" }}
                />
              </div>
              <div className="feature-footer">
                <div className="feature-icon-badge">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1CD152" stroke="#1CD152" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                </div>
                <div className="feature-body">
                  <h3>Real-time intelligence</h3>
                  <p>Detect intent, sentiment, objections, and buying signals as every conversation unfolds.</p>
                </div>
              </div>
            </article>

            <article className="feature">
              <span className="feature-no">03</span>
              <div className="flow-mini">
                <span>CALL</span><b>→</b><span>QUALIFY</span><b>→</b><span>ACT</span>
              </div>
              <div className="feature-footer">
                <div className="feature-icon-badge">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1CD152" stroke="#1CD152" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                </div>
                <div className="feature-body">
                  <h3>Automated next steps</h3>
                  <p>Book meetings, update records, send follow-ups, and route qualified opportunities automatically.</p>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="section process-section" id="solutions">
          <div className="container">
            <div className="section-head">
              <div>
                <span className="kicker">02 / HOW IT WORKS</span>
                <h2>From first hello<br /><span>to the right next step.</span></h2>
              </div>
              <p>Launch an intelligent calling workflow in three focused steps—designed around your goals, data, and customer journey.</p>
            </div>
            <div className="steps">
              <article>
                <span>01</span>
                <div className="step-icon">⌁</div>
                <h3>Define the outcome</h3>
                <p>Give your agent a goal, a knowledge base, and the guardrails for a great conversation.</p>
              </article>
              <article>
                <span>02</span>
                <div className="step-icon">◉</div>
                <h3>Start conversations</h3>
                <p>Handle inbound demand or launch targeted outbound campaigns with natural voice agents.</p>
              </article>
              <article>
                <span>03</span>
                <div className="step-icon">✦</div>
                <h3>Turn signal into action</h3>
                <p>Qualify the lead, capture context, trigger workflows, and surface the conversations that matter.</p>
              </article>
            </div>
            <div className="use-row">
              <article>
                <span>OUTBOUND</span>
                <h3>Reach every lead while intent is fresh.</h3>
                <p>Lead qualification · Follow-up · Reactivation</p>
              </article>
              <article>
                <span>INBOUND</span>
                <h3>Answer, understand, and resolve—24/7.</h3>
                <p>Front desk · Support triage · Booking</p>
              </article>
              <article>
                <span>OPERATIONS</span>
                <h3>Move high-volume workflows forward.</h3>
                <p>Screening · Reminders · Confirmations</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section container intelligence" id="intelligence">
          <div className="intel-copy">
            <span className="kicker">03 / LEAD INTELLIGENCE</span>
            <h2>Your calls are full of signal.<br /><span>We make it visible.</span></h2>
            <p>See beyond transcripts. CALLIQO AI turns every call into a structured record of what happened, why it matters, and what should happen next.</p>
            <ul>
              <li>
                <span>01</span>
                <div>
                  <strong>Know who is ready</strong>
                  <small>Score conversations using real intent, fit, and engagement signals.</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Understand the why</strong>
                  <small>Surface needs, objections, urgency, and sentiment—not just keywords.</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Never lose the next step</strong>
                  <small>Sync summaries and actions into the systems your team already uses.</small>
                </div>
              </li>
            </ul>
          </div>

          <div className="dashboard glass">
            <div className="dash-top">
              <div>
                <span className="brand-mark small">
                  <i></i><i></i><i></i><i></i><i></i>
                </span>
                <b>Intelligence</b>
              </div>
              <span>Last 7 days⌄</span>
            </div>
            <div className="metrics">
              <div>
                <small>CONVERSATIONS</small>
                <strong>248</strong>
                <span>↗ 18%</span>
              </div>
              <div>
                <small>QUALIFIED</small>
                <strong>62</strong>
                <span>↗ 24%</span>
              </div>
              <div>
                <small>MEETINGS</small>
                <strong>31</strong>
                <span>↗ 12%</span>
              </div>
            </div>
            <div className="dash-main">
              <div className="chart">
                <div className="chart-head">
                  <b>Intent trend</b>
                  <span>● High intent &nbsp; ● Engaged</span>
                </div>
                <svg viewBox="0 0 540 180" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#b9ff66" stopOpacity=".25" />
                      <stop offset="1" stopColor="#b9ff66" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="area" d="M0 145 C70 135,90 100,150 120 S235 70,295 92 S380 38,430 56 S490 25,540 18 L540 180 L0 180Z" />
                  <path className="line" d="M0 145 C70 135,90 100,150 120 S235 70,295 92 S380 38,430 56 S490 25,540 18" />
                </svg>
              </div>
              <div className="topics">
                <b>Top signals</b>
                <div>
                  <span>Pricing</span>
                  <i style={{ '--w': '88%' } as React.CSSProperties}></i>
                  <small>88%</small>
                </div>
                <div>
                  <span>Integration</span>
                  <i style={{ '--w': '72%' } as React.CSSProperties}></i>
                  <small>72%</small>
                </div>
                <div>
                  <span>Timeline</span>
                  <i style={{ '--w': '64%' } as React.CSSProperties}></i>
                  <small>64%</small>
                </div>
              </div>
            </div>
            <div className="call-row">
              <div>
                <span className="avatar small-av">JR</span>
                <b>Jordan Reed<small>Qualified · Decision maker</small></b>
              </div>
              <span className="hot">HOT · 91</span>
              <span>Meeting booked</span>
              <b>→</b>
            </div>
          </div>
        </section>

        <section className="section workflow" id="integrations">
          <div className="container">
            <div className="integration-header-figma">
              <span className="kicker-green">04 / INTEGRATIONS</span>
              <h2 className="title-white">Your tools, connected.</h2>
              <h2 className="title-grey">Your workflow, uninterrupted.</h2>
              <p className="subtitle-text">
                Move conversation intelligence into the systems your team already uses. Connect CRM, calendars, communications, and automations in one workflow.
              </p>
            </div>

            <div className="integration-canvas">
              <svg className="connector-lines" viewBox="0 0 1000 380" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 0 240 C 200 240, 300 100, 500 190 S 800 100, 1000 160" />
                <path d="M 0 280 C 250 280, 350 220, 500 190 S 750 280, 1000 200" />
              </svg>

              {/* Left Side Nodes */}
              <div className="integration-node node-zapier">
                <div className="node-icon-box">
                  <img src="/images/thesvg-color_zapier.png" alt="Zapier" />
                </div>
                <span>Zapier</span>
              </div>

              <div className="integration-node node-openai">
                <div className="node-icon-box">
                  <img src="/images/thesvg-color_openai-chatgpt.png" alt="Open ai" />
                  {/* <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10A37F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2Z" />
                      <path d="M12 6A6 6 0 0 0 6 12A6 6 0 0 0 12 18A6 6 0 0 0 18 12A6 6 0 0 0 12 6Z" />
                    </svg> */}
                </div>
                <span>Open AI</span>
              </div>

              <div className="integration-node node-twilio">
                <div className="node-icon-box">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#F22F46">
                    <circle cx="7" cy="7" r="3.5" />
                    <circle cx="17" cy="7" r="3.5" />
                    <circle cx="7" cy="17" r="3.5" />
                    <circle cx="17" cy="17" r="3.5" />
                  </svg>
                </div>
                <span>Twilio</span>
              </div>

              <div className="integration-node node-restapi">
                <div className="node-icon-box">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </div>
                <span>Rest API</span>
              </div>

              <div className="integration-node node-plivo">
                <div className="node-icon-box">
                  <img src="/images/plivo.png" alt="Plivo" />
                  {/* <svg width="22" height="22" viewBox="0 0 24 24" fill="#FF5000">
                    <path d="M12 2C6.48 2 2 6.48 2 12c0 2.17.69 4.19 1.87 5.84L2.5 21.5l3.87-1.31C8.01 21.36 9.95 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
                  </svg> */}
                </div>
                <span>Plivo</span>
              </div>

              {/* Center Core */}
              <div className="integration-core-figma">
                <div className="core-glow-ring"></div>
                <div className="core-inner">
                  <img className="core-inner-images" src="/images/new_dark_logo.svg" alt="Plivo" />
                </div>
              </div>

              {/* Right Side Nodes */}
              <div className="integration-node node-slack">
                <div className="node-icon-box">
                  <img src="/images/logos_slack-icon.png" alt="Slack" />
                  {/* <svg width="22" height="22" viewBox="0 0 24 24">
                    <path fill="#E01E5A" d="M6 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0-6a2.5 2.5 0 1 0 0 5h2.5V9H6z" />
                    <path fill="#36C5F0" d="M9 6a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0zm6 0a2.5 2.5 0 1 0-5 0v2.5H15V6z" />
                    <path fill="#2EB67D" d="M18 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 6a2.5 2.5 0 1 0 0-5h-2.5v2.5H18z" />
                    <path fill="#ECB22E" d="M15 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0 5 0zm-6 0a2.5 2.5 0 1 0 5 0v-2.5H9V18z" />
                  </svg> */}
                </div>
                <span>Slack</span>
              </div>

              <div className="integration-node node-webhooks">
                <div className="node-icon-box">
                  <img src="/images/ic_round-webhook.png" alt="Plivo" />
                  {/* <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                    <path d="M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                    <path d="M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                    <path d="M8.59 13.51l6.83 3.98" />
                    <path d="M15.41 6.51l-6.82 3.98" />
                  </svg> */}
                </div>
                <span>Webhooks</span>
              </div>

              <div className="integration-node node-hubspot">
                <div className="node-icon-box">
                  <img src="/images/⌘.png" alt="hotspot" />
                  {/* <svg width="22" height="22" viewBox="0 0 24 24" fill="#FF5C35">
                    <path d="M18.8 8.4l-4.5 2.6V8.1A3.1 3.1 0 1 0 12 5v6.1L7.5 8.4a3.1 3.1 0 1 0-1.6 2.7l4.5 2.6v5.2a3.1 3.1 0 1 0 3.1 0v-5.2l4.5-2.6a3.1 3.1 0 1 0 .8-2.7z" />
                  </svg> */}
                </div>
                <span>Hubspot</span>
              </div>

              <div className="integration-node node-salesforce">
                <div className="node-icon-box">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#00A1E0">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                  </svg>
                </div>
                <span>Sales force</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section pricing container" id="pricing">
          <div className="pricing-head">
            <div>
              <span className="kicker">05 / LAUNCH PRICING</span>
              <h2>Start focused.<br /><span>Scale when it works.</span></h2>
            </div>
            <div>
              <p>Simple monthly plans for your launch phase. Call usage is billed separately based on destination and voice configuration.</p>
              <div className="billing">
                <span>Monthly</span>
                <button
                  type="button"
                  onClick={() => setIsAnnual(!isAnnual)}
                  className={isAnnual ? 'annual' : ''}
                  aria-label="Monthly billing"
                >
                  <i></i>
                </button>
                <strong>Annual · save 20%</strong>
              </div>
            </div>
          </div>

          <div className="price-grid">
            <article>
              <div className="plan-top">
                <span>LAUNCH</span>
                <h3>For your first AI voice workflow.</h3>
                <div className="price">
                  <strong>{isAnnual ? "$79" : "$99"}</strong>
                  <small>/ month</small>
                </div>
                <p>Billed monthly, plus usage.</p>
              </div>
              <ul>
                <li>1 AI voice agent</li>
                <li>Inbound or outbound calling</li>
                <li>Call transcripts and summaries</li>
                <li>Lead qualification</li>
                <li>Calendar integration</li>
              </ul>
              <Link href="/login" className="price-button">
                Create account <span>↗</span>
              </Link>
            </article>

            <article className="featured-plan">
              <div className="popular">MOST POPULAR</div>
              <div className="plan-top">
                <span>GROWTH</span>
                <h3>For teams ready to automate more.</h3>
                <div className="price">
                  <strong>{isAnnual ? "$239" : "$299"}</strong>
                  <small>/ month</small>
                </div>
                <p>Billed monthly, plus usage.</p>
              </div>
              <ul>
                <li>Up to 5 AI voice agents</li>
                <li>Inbound and outbound calling</li>
                <li>Lead intelligence and scoring</li>
                <li>CRM and calendar integrations</li>
                <li>Workflow automations</li>
                <li>Priority launch support</li>
              </ul>
              <Link href="/login" className="price-button primary">
                Choose Growth <span>↗</span>
              </Link>
            </article>

            <article>
              <div className="plan-top">
                <span>SCALE</span>
                <h3>For high-volume, complex operations.</h3>
                <div className="price">
                  <strong>Custom</strong>
                </div>
                <p>Designed around your workflow.</p>
              </div>
              <ul>
                <li>Custom agent capacity</li>
                <li>Advanced integrations and API</li>
                <li>Custom routing and guardrails</li>
                <li>Dedicated onboarding</li>
                <li>Volume-based usage pricing</li>
                <li>Priority support</li>
              </ul>
              <a className="price-button" href="mailto:hello@calliqoai.com?subject=CALLIQO%20Scale%20Plan">
                Talk to sales <span>↗</span>
              </a>
            </article>
          </div>
          <p className="pricing-note">Choose a plan and start building today. Final telecom usage varies by country, carrier, and selected voice.</p>
        </section>

        <section className="section container security" id="trust">
          <div className="security-copy">
            <span className="kicker-green">06 / BUILT FOR TRUST</span>
            <h2 className="security-title">Control by design.</h2>
            <p className="security-subtitle">Configure how agents behave, what they can access, and when a human should take over. Your agent setup stays accountable from first call to follow-up.</p>
          </div>
          <div className="security-grid">
            <article className="security-card">
              <div className="security-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1CD152" stroke="#1CD152" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <h3>Permissioned actions</h3>
              <p>Set clear boundaries for data access and automated tasks.</p>
            </article>

            <article className="security-card">
              <div className="security-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1CD152" stroke="#1CD152" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <h3>Human handoff</h3>
              <p>Route sensitive or complex conversations to the right person.</p>
            </article>

            <article className="security-card">
              <div className="security-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1CD152" stroke="#1CD152" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <h3>Full visibility</h3>
              <p>Review transcripts, summaries, outcomes, and agent activity.</p>
            </article>
          </div>
        </section>

        <section className="section faq container" id="faq">
          <div className="faq-layout">
            <div className="faq-head-col">
              <span className="kicker-green">07 / FAQ</span>
              <h2 className="title-white">Questions,</h2>
              <h2 className="title-grey">answered.</h2>
            </div>
            <div className="accordion">
              <details open>
                <summary>
                  <span>What is CALLIQO AI?</span>
                  <span className="faq-toggle">−</span>
                </summary>
                <p>CALLIQO AI is a voice calling and lead intelligence platform. It helps teams automate inbound and outbound calls, understand each conversation, and trigger the right next action.</p>
              </details>

              <details>
                <summary>
                  <span>Can CALLIQO AI handle inbound and outbound calls?</span>
                  <span className="faq-toggle">+</span>
                </summary>
                <p>Yes. Agents can respond to inbound callers or run targeted outbound workflows for qualification, follow-up, booking, and more.</p>
              </details>

              <details>
                <summary>
                  <span>How does lead intelligence work?</span>
                  <span className="faq-toggle">+</span>
                </summary>
                <p>CALLIQO AI analyzes conversation context to capture intent, needs, objections, sentiment, and agreed next steps, then packages those signals into useful records.</p>
              </details>

              <details>
                <summary>
                  <span>Can it connect to our existing tools?</span>
                  <span className="faq-toggle">+</span>
                </summary>
                <p>CALLIQO AI is designed to connect to CRMs, calendars, automations, and internal systems using integrations, webhooks, and APIs.</p>
              </details>

              <details>
                <summary>
                  <span>How does pricing work?</span>
                  <span className="faq-toggle">+</span>
                </summary>
                <p>Choose Launch or Growth to create an account immediately. Scale pricing is tailored to higher call volume, workflow complexity, and integration needs.</p>
              </details>
            </div>
          </div>
        </section>

      </main>
      <section className="section cta" id="get-started">
        <div className="cta-content">
          <span className="kicker">START TODAY</span>
          <h2>Make every<br />conversation<br />count.</h2>
          <p>Create your account and build your first intelligent voice workflow with CALLIQO AI.</p>
          <Link href="/login" className="button light">
            Sign Up <span>↗</span>
          </Link>
        </div>
        <div className="cta-orb">
          <div className="cta-logo-mark">
            <img src="/images/Italic Text.png" />
            {/* <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M50 20C44 15.5 36.5 14.8 30 17.8C23.5 20.8 18.8 27.2 18 34.2C17.2 41.2 20.2 48.2 25.8 52.8C31.4 57.4 39.2 58.8 46 56.5C52.8 54.2 58 48.5 59.2 41.5" stroke="#0B0F0E" strokeWidth="6" strokeLinecap="round" />
              <rect x="32" y="30" width="4" height="12" rx="2" fill="#0B0F0E" />
              <rect x="39" y="24" width="4" height="24" rx="2" fill="#0B0F0E" />
              <rect x="46" y="30" width="4" height="12" rx="2" fill="#0B0F0E" />
            </svg> */}
          </div>
          {/* <i className="ring r1"></i>
          <i className="ring r2"></i>
          <i className="ring r3"></i>
          <i className="ring r4"></i> */}
        </div>
      </section>

      <footer>
        <div className="container footer-top">
          <div className="footer-brand-col">
            <Link href="/" className="brand">
              <img
                src="/images/dark_logo.svg"
                alt={branding.app_name || "CALLIQO AI"}
                style={{ height: "30px", width: "auto", objectFit: "contain" }}
              />

            </Link>
          </div>

          <div className="footer-tagline-col">
            <p>The intelligence behind every conversation.</p>
          </div>

          <div className="footer-nav-grid">
            <div className="footer-nav-col">
              <a href="#platform">Platform</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="footer-nav-col">
              <a href="#integrations">Integrations</a>
              <a href="#faq">FAQ</a>
            </div>
          </div>
        </div>

        <div className="container footer-bottom">
          <span className="copyright">© 2026 CALLIQO AI. All rights reserved.</span>
          <div className="footer-legal-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
      </footer>

      <div className="mobile-action" aria-label="Mobile account actions">
        <Link href="/login">Login</Link>
        <Link href="/login">Start calling <span>↗</span></Link>
      </div>
    </div>
  );
}
