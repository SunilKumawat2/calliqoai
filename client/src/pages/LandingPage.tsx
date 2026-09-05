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
            {currentLogo ? (
              <img
                src={currentLogo}
                alt={branding.app_name || "CALLIQO AI"}
                style={{ height: "32px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              <>
                <span className="brand-mark">
                  <i></i><i></i><i></i><i></i><i></i>
                </span>
                <span>CALLIQO</span>
                <em>AI</em>
              </>
            )}
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
          {/* <div className="eyebrow reveal">
            <span className="status-dot"></span>
            CALLIQO AI is now live
          </div> */}
          <h1 className="reveal">
            The intelligence behind<br /><span>every conversation.</span>
          </h1>
          <p className="hero-copy reveal">
            AI voice agents that call, listen, qualify, and act—so your team enters every conversation with context and leaves with the next step.
          </p>
          <div className="hero-actions reveal">
            <Link href="/login" className="button">
              Get Started <span>↗</span>
            </Link>
            <Link href="/login" className="text-link">
              <i>▶</i> Explore The Platform
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
                <div className="call-icon">⌕</div>
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
            <span className="kicker">04 / INTEGRATIONS</span>
            <h2>Your tools, connected.<br /><span>Your workflow, uninterrupted.</span></h2>
            <p>Move conversation intelligence into the systems your team already uses. Connect CRM, calendars, communications, and automations in one workflow.</p>

            <div className="integration-canvas">
              <svg className="connector-lines" viewBox="0 0 1180 330" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 230 C170 220 240 90 430 145 S690 175 820 110 S1050 25 1180 90" />
                <path d="M0 275 C210 265 330 210 480 175 S700 255 880 205 S1080 115 1180 150" />
              </svg>
              <div className="integration-node n1"><b className="logo-salesforce">☁</b><span>Salesforce</span></div>
              <div className="integration-node n2"><b className="logo-slack">✣</b><span>Slack</span></div>
              <div className="integration-node n3"><b className="logo-zapier">_</b><span>Zapier</span></div>
              <div className="integration-node n4"><b className="logo-notion">N</b><span>Notion</span></div>
              <div className="integration-node n5"><b className="logo-openai">✺</b><span>OpenAI</span></div>
              <div className="integration-node n6"><b className="logo-calendar">▣</b><span>Calendar</span></div>
              <div className="integration-node n7"><b className="logo-hubspot">⌘</b><span>HubSpot</span></div>
              <div className="integration-node n8"><b className="logo-twilio">⠿</b><span>Twilio</span></div>
              <div className="integration-core">
                <span className="brand-mark">
                  <i></i><i></i><i></i><i></i><i></i>
                </span>
                <strong>CALLIQO</strong>
                <small>AI</small>
              </div>
            </div>

            <div className="integration-foot">
              <span>CRM sync</span>
              <span>Calendar booking</span>
              <span>Real-time webhooks</span>
              <span>Custom API</span>
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

        <section className="section container security">
          <div className="security-copy">
            <span className="kicker">05 / BUILT FOR TRUST</span>
            <h2>Control by design.</h2>
            <p>Configure how agents behave, what they can access, and when a human should take over. Your agent setup stays accountable from first call to follow-up.</p>
          </div>
          <div className="security-grid">
            <article>
              <span>⌾</span>
              <h3>Permissioned actions</h3>
              <p>Set clear boundaries for data access and automated tasks.</p>
            </article>
            <article>
              <span>◎</span>
              <h3>Human handoff</h3>
              <p>Route sensitive or complex conversations to the right person.</p>
            </article>
            <article>
              <span>◈</span>
              <h3>Full visibility</h3>
              <p>Review transcripts, summaries, outcomes, and agent activity.</p>
            </article>
          </div>
        </section>

        <section className="section faq container" id="faq">
          <span className="kicker">06 / FAQ</span>
          <div className="faq-layout">
            <h2>Questions,<br /><span>answered.</span></h2>
            <div className="accordion">
              <details open>
                <summary>What is CALLIQO AI?<i>−</i></summary>
                <p>CALLIQO AI is a voice calling and lead intelligence platform. It helps teams automate inbound and outbound calls, understand each conversation, and trigger the right next action.</p>
              </details>
              <details>
                <summary>Can CALLIQO AI handle inbound and outbound calls?<i>+</i></summary>
                <p>Yes. Agents can respond to inbound callers or run targeted outbound workflows for qualification, follow-up, booking, and more.</p>
              </details>
              <details>
                <summary>How does lead intelligence work?<i>+</i></summary>
                <p>CALLIQO AI analyzes conversation context to capture intent, needs, objections, sentiment, and agreed next steps, then packages those signals into useful records.</p>
              </details>
              <details>
                <summary>Can it connect to our existing tools?<i>+</i></summary>
                <p>CALLIQO AI is designed to connect to CRMs, calendars, automations, and internal systems using integrations, webhooks, and APIs.</p>
              </details>
              <details>
                <summary>How does pricing work?<i>+</i></summary>
                <p>Choose Launch or Growth to create an account immediately. Scale pricing is tailored to higher call volume, workflow complexity, and integration needs.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="section cta container" id="get-started">
          <div>
            <span className="kicker">START TODAY</span>
            <h2>Make every<br />conversation count.</h2>
            <p>Create your account and build your first intelligent voice workflow with CALLIQO AI.</p>
            <Link href="/login" className="button light">
              Create account <span>↗</span>
            </Link>
          </div>
          <div className="cta-orb">
            <span className="brand-mark">
              <i></i><i></i><i></i><i></i><i></i>
            </span>
            <i className="ring r1"></i>
            <i className="ring r2"></i>
            <i className="ring r3"></i>
          </div>
        </section>
      </main>

      <footer>
        <div className="container footer-top">
          <Link href="/" className="brand">
            {currentLogo ? (
              <img
                src={currentLogo}
                alt={branding.app_name || "CALLIQO AI"}
                style={{ height: "32px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              <>
                <span className="brand-mark">
                  <i></i><i></i><i></i><i></i><i></i>
                </span>
                <span>CALLIQO</span>
                <em>AI</em>
              </>
            )}
          </Link>
          <p>The intelligence behind every conversation.</p>
          <div>
            <a href="#platform">Platform</a>
            <a href="#integrations">Integrations</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 CALLIQO AI. All rights reserved.</span>
          <div>
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
