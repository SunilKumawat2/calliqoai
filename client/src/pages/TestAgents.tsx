import React, { useState } from 'react';
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  PhoneIncoming,
  Radio,
  Check,
  Headphones,
  UserCheck,
  CalendarCheck,
  BadgePercent,
  UserPlus,
  ShoppingBag,
  HelpCircle,
  Clock,
  GitFork,
  Target,
  FileSpreadsheet,
  CreditCard,
  History,
  CalendarClock,
  Phone,
  Info,
  Sparkles,
  MessageSquare,
  Lightbulb,
  FileText,
  Globe,
  LayoutTemplate,
  Wand2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import './TestAgents.css';

type CallDirection = 'inbound' | 'outbound';
type NumberType = 'international' | 'indian';
type CallingTier = 'premium' | 'standard' | 'essential';

interface UseCaseOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const INBOUND_USE_CASES: UseCaseOption[] = [
  {
    id: 'customer-support',
    title: 'Customer Support',
    description: 'Help customers with questions, common issues, and support requests.',
    icon: Headphones,
  },
  {
    id: 'ai-receptionist',
    title: 'AI Receptionist',
    description: 'Welcome callers, understand their needs, and direct them appropriately.',
    icon: UserCheck,
  },
  {
    id: 'appointment-booking',
    title: 'Appointment Booking',
    description: 'Let callers book, reschedule, or cancel appointments.',
    icon: CalendarCheck,
  },
  {
    id: 'sales-inquiries',
    title: 'Sales Inquiries',
    description: 'Handle questions about your products or services and engage potential customers.',
    icon: BadgePercent,
  },
  {
    id: 'lead-qualification',
    title: 'Lead Qualification',
    description: 'Collect caller information and identify qualified opportunities.',
    icon: UserPlus,
  },
  {
    id: 'orders-bookings',
    title: 'Orders & Bookings',
    description: 'Assist with new or existing orders, reservations, and bookings.',
    icon: ShoppingBag,
  },
  {
    id: 'faqs-info',
    title: 'FAQs & Information',
    description: 'Give callers quick answers to frequently asked questions.',
    icon: HelpCircle,
  },
  {
    id: 'after-hours',
    title: 'After-Hours Support',
    description: "Take care of incoming calls when your team isn't available.",
    icon: Clock,
  },
  {
    id: 'custom-use-case',
    title: 'Custom Use Case',
    description: 'Configure the agent for your own inbound calling workflow.',
    icon: GitFork,
  },
];

const OUTBOUND_USE_CASES: UseCaseOption[] = [
  {
    id: 'lead-qualification',
    title: 'Lead Qualification',
    description: 'Identify, qualify, and engage potential customers.',
    icon: Target,
  },
  {
    id: 'sales-outreach',
    title: 'Sales & Outreach',
    description: 'Reach prospects, introduce your offer, and generate interest.',
    icon: BadgePercent,
  },
  {
    id: 'surveys-feedback',
    title: 'Surveys & Feedback',
    description: 'Collect customer feedback, opinions, and responses.',
    icon: FileSpreadsheet,
  },
  {
    id: 'customer-service',
    title: 'Customer Service',
    description: 'Proactively assist customers and follow up on their needs.',
    icon: Headphones,
  },
  {
    id: 'appointment-booking',
    title: 'Appointment Booking',
    description: 'Schedule appointments, demos, consultations, or meetings.',
    icon: CalendarCheck,
  },
  {
    id: 'payment-reminders',
    title: 'Payment Reminders',
    description: 'Follow up on upcoming or overdue payments.',
    icon: CreditCard,
  },
  {
    id: 'customer-followup',
    title: 'Customer Follow-Up',
    description: 'Reconnect with customers after purchases, inquiries, or interactions.',
    icon: History,
  },
  {
    id: 'event-reminder',
    title: 'Event & Appointment Remind.',
    description: 'Send timely reminders and confirm attendance.',
    icon: CalendarClock,
  },
  {
    id: 'custom-use-case',
    title: 'Custom Use Case',
    description: 'Create an agent for your own outbound calling workflow.',
    icon: GitFork,
  },
];

const TIER_DETAILS = {
  premium: {
    title: 'Premium Calling',
    credits: '10 Credits/min',
    tooltip: 'Highest-quality, natural-sounding conversations with advanced voices and faster responses. Best for sales, demos, and high-value customer calls.'
  },
  standard: {
    title: 'Standard Calling',
    credits: '6 Credits/min',
    tooltip: 'Balanced conversational AI voice performance, fast latency and optimized per-minute cost.'
  },
  essential: {
    title: 'Essential Calling',
    credits: '4 Credits/min',
    tooltip: 'High efficiency Indian & multi-lingual regional voice models for volume calling.'
  }
};

const VOICE_OPTIONS = [
  { id: 'roger', name: 'Roger - Laid-Back, Casual, Resonant' },
  { id: 'coral', name: 'Ananya - Natural, Warm, Female Executive' },
  { id: 'sarah', name: 'Sarah - Clear, Professional, Confident' },
  { id: 'jessica', name: 'Jessica - Expressive, Friendly' },
  { id: 'shimmer', name: 'Priya - Polite, Fluent Hindi/Hinglish' },
  { id: 'echo', name: 'David - Deep, Authoritative' }
];

const DYNAMIC_VARIABLES = [
  '{{first_name}}',
  '{{last_name}}',
  '{{contact_name}}',
  '{{email}}',
  '{{phone}}',
  '{{city}}',
  '{{company}}',
];

const MOCK_KNOWLEDGE_BASES = [
  { id: 'kb-1', title: 'https://mieride.ca/', type: 'Website', icon: Globe },
  { id: 'kb-2', title: 'https://mieride.ca/', type: 'Website', icon: Globe },
  { id: 'kb-3', title: 'Mieride Research', type: 'Text', icon: FileText },
  { id: 'kb-4', title: 'Index.pdf', type: 'File', icon: FileText },
  { id: 'kb-5', title: 'How to work Calliqo', type: 'FAQs', icon: HelpCircle },
  { id: 'kb-6', title: 'Index.pdf', type: 'File', icon: FileText },
];

const PROMPT_TEMPLATES = [
  {
    name: 'Customer Support Agent',
    prompt: `You are a polite and empathetic Customer Support Agent. Greet the customer, listen carefully to their concern, troubleshoot known issues using the provided knowledge base, and escalate to a human agent when necessary. Always maintain a professional and reassuring tone.`,
    firstMessage: `Hello {{first_name}}, thank you for contacting support! How can I help you today?`
  },
  {
    name: 'Sales & Outreach Specialist',
    prompt: `You are an energetic and persuasive Sales Representative. Introduce our key service highlights, ask qualification questions regarding their needs and timeline, handle common objections gracefully, and propose scheduling a demo with our team.`,
    firstMessage: `Hi {{first_name}}, this is Alex from {{company}}. I'm following up on your recent inquiry about our AI services. Do you have 2 minutes to chat?`
  },
  {
    name: 'Appointment Booking Assistant',
    prompt: `You are an efficient Appointment Coordinator. Collect preferred dates and times from the caller, verify contact information (name, phone, email), and confirm their appointment details before ending the call.`,
    firstMessage: `Hi {{first_name}}! I'm here to help you schedule your upcoming appointment. What date and time works best for you?`
  },
  {
    name: 'AI Receptionist',
    prompt: `You are a friendly and professional front-desk Receptionist. Welcome callers, identify the purpose of their call, direct them to the appropriate department, or take a detailed message with contact details.`,
    firstMessage: `Thank you for calling {{company}}! My name is Sarah. How may I direct your call today?`
  }
];

interface AgentToolItem {
  id: string;
  title: string;
  description: string;
}

interface AgentToolCategory {
  category: string;
  items: AgentToolItem[];
}

const AGENT_TOOL_CATEGORIES: AgentToolCategory[] = [
  {
    category: 'Calling',
    items: [
      {
        id: 'call_transfer',
        title: 'Call Transfer',
        description: 'Allow the agent to transfer calls to a designated phone number.',
      },
      {
        id: 'voicemail',
        title: 'Voicemail',
        description: 'Detect voicemail and leave a predefined or AI-generated message.',
      },
      {
        id: 'human_handoff',
        title: 'Human Handoff',
        description: 'Transfer the caller to a team member with the conversation summary and collected details.',
      },
      {
        id: 'end_conversation',
        title: 'End Conversation',
        description: 'Allow the agent to intelligently end the conversation when appropriate.',
      },
    ],
  },
  {
    category: 'Messaging',
    items: [
      {
        id: 'sms_messaging',
        title: 'SMS Messaging',
        description: 'Send confirmations, reminders, links, and follow-up messages by SMS.',
      },
      {
        id: 'email_sending',
        title: 'Email Sending',
        description: 'Send personalized emails using approved templates.',
      },
      {
        id: 'whatsapp_messaging',
        title: 'WhatsApp Messaging',
        description: 'Send WhatsApp messages using approved business templates.',
      },
    ],
  },
  {
    category: 'Sales',
    items: [
      {
        id: 'lead_qualification',
        title: 'Lead Qualification',
        description: 'Ask qualifying questions and automatically calculate a lead score.',
      },
      {
        id: 'crm_integration',
        title: 'CRM Integration',
        description: 'Create, search, and update records in your connected CRM.',
      },
      {
        id: 'payment_links',
        title: 'Payment Links',
        description: 'Send secure payment or checkout links during or after conversations.',
      },
    ],
  },
  {
    category: 'Support',
    items: [
      {
        id: 'order_lookup',
        title: 'Order Lookup',
        description: 'Retrieve order, booking, reservation, or delivery information.',
      },
      {
        id: 'ticket_creation',
        title: 'Ticket Creation',
        description: 'Create and assign customer-support tickets.',
      },
      {
        id: 'sentiment_detection',
        title: 'Sentiment Detection',
        description: 'Detect customer sentiment and escalate frustrated callers when necessary.',
      },
    ],
  },
  {
    category: 'Scheduling',
    items: [
      {
        id: 'calendar_access',
        title: 'Calendar Access',
        description: 'Check connected calendars for real-time availability.',
      },
      {
        id: 'appointment_booking',
        title: 'Appointment Booking',
        description: 'Book, reschedule, or cancel appointments during conversations.',
      },
    ],
  },
  {
    category: 'Advanced',
    items: [
      {
        id: 'webhooks',
        title: 'Webhooks',
        description: 'Trigger external workflows when selected events occur.',
      },
      {
        id: 'custom_api_tools',
        title: 'Custom API Tools',
        description: 'Connect the agent to internal software or third-party APIs.',
      },
    ],
  },
];

export default function TestAgents() {
  const [isCreating, setIsCreating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [callDirection, setCallDirection] = useState<CallDirection>('inbound');
  const [selectedUseCase, setSelectedUseCase] = useState<string>('customer-support');

  // Step 3 Form States
  const [agentName, setAgentName] = useState('');
  const [numberType, setNumberType] = useState<NumberType>('international');
  const [callingTier, setCallingTier] = useState<CallingTier>('premium');
  const [language, setLanguage] = useState('English');
  const [voice, setVoice] = useState('roger');
  const [voiceTone, setVoiceTone] = useState('Empathetic');
  const [personality, setPersonality] = useState('Patient');
  const [responseDelay, setResponseDelay] = useState<number>(1.5);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

  // Step 4 Form States (Configure Prompts)
  const [systemPrompt, setSystemPrompt] = useState(
    `You are a friendly survey conductor for {{company_name}}. Your goals are: - Make the survey feel like a natural conversation - Ask questions clearly and wait for complete responses - Probe for details when answers are vague - Thank respondents for their time and insights - Record feedback accurately.`
  );
  const [firstMessage, setFirstMessage] = useState(
    `Hi! I'm calling from {{company_name}} to gather some quick feedback about your recent experience with us. Your insights really help us improve. Would you have about 5 minutes to share your thoughts?`
  );
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<string[]>(['kb-1']);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Step 5 Form States (Agent Tools)
  const [selectedTools, setSelectedTools] = useState<string[]>([
    'call_transfer',
    'end_conversation'
  ]);

  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle final Create Agent submission
  const handleCreateAgent = async () => {
    setIsSubmitting(true);
    try {
      toast({
        title: 'Agent Created Successfully! 🎉',
        description: `Your agent "${agentName || selectedUseCaseObj.title + ' Agent'}" is now configured and ready to handle calls.`,
      });
      setTimeout(() => {
        setIsCreating(false);
        setCurrentStep(1);
        setIsSubmitting(false);
      }, 1200);
    } catch {
      toast({
        title: 'Error creating agent',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  // Handle click on "+ Create Agents"
  const handleStartCreate = () => {
    setIsCreating(true);
    setCurrentStep(1);
  };

  // Handle Back button in wizard
  const handleBack = () => {
    if (currentStep === 1) {
      setIsCreating(false);
    } else {
      setCurrentStep((prev) => prev - 1);
    }
  };

  // Insert dynamic variable into system prompt
  const handleInsertVariable = (variable: string) => {
    setSystemPrompt((prev) => (prev ? prev + ' ' + variable : variable));
  };

  // Toggle knowledge base checkbox
  const toggleKnowledgeBase = (id: string) => {
    setSelectedKnowledgeBases((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  // Toggle agent tool checkbox
  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  // Handle Next button in wizard
  const handleNext = () => {
    if (currentStep === 1) {
      if (callDirection === 'inbound' && !INBOUND_USE_CASES.some((u) => u.id === selectedUseCase)) {
        setSelectedUseCase('customer-support');
      } else if (callDirection === 'outbound' && !OUTBOUND_USE_CASES.some((u) => u.id === selectedUseCase)) {
        setSelectedUseCase('lead-qualification');
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      const matchedUseCase = currentUseCases.find((u) => u.id === selectedUseCase);
      if (!agentName && matchedUseCase) {
        setAgentName(matchedUseCase.title + ' Agent');
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(4);
    } else if (currentStep === 4) {
      setCurrentStep(5);
    } else if (currentStep === 5) {
      setCurrentStep(6);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const currentUseCases = callDirection === 'inbound' ? INBOUND_USE_CASES : OUTBOUND_USE_CASES;
  const selectedUseCaseObj = currentUseCases.find((u) => u.id === selectedUseCase) || currentUseCases[0];

  return (
    <div className="test-agents-page">
      {!isCreating ? (
        // ------------------ MAIN LIST VIEW (Step 0) ------------------
        <div className="agent-list-view">
          <div className="agent-list-header">
            <div>
              <div className="agent-header-subtitle">AI AGENTS</div>
              <h1 className="agent-header-title">
                Create & manage your conversational AI agents.
              </h1>
            </div>

            <div>
              <button className="create-agent-btn" onClick={handleStartCreate}>
                <Plus style={{ width: '1rem', height: '1rem', strokeWidth: 3 }} />
                <span>Create Agents</span>
              </button>
            </div>
          </div>

          <div className="empty-state-box">
            <div className="empty-state-icon">
              <Plus style={{ width: '2rem', height: '2rem' }} />
            </div>
            <h3 className="empty-state-title">No custom agents in this view yet</h3>
            <p className="empty-state-desc">
              Click the button above to launch the 6-step creation wizard.
            </p>
            <button className="create-agent-btn" onClick={handleStartCreate}>
              + Create Agents
            </button>
          </div>
        </div>
      ) : (
        // ------------------ CREATE WIZARD ------------------
        <div className="wizard-container">
          {/* Top 6-Step Progress Indicator */}
          <div className="progress-bar-wrapper">
            {[1, 2, 3, 4, 5, 6].map((step, idx) => {
              const isCompleted = step < currentStep || (currentStep === 6 && step === 6);
              const isCurrent = step === currentStep && currentStep !== 6;

              return (
                <React.Fragment key={step}>
                  {/* Step Node */}
                  <div
                    className={`progress-node ${isCompleted ? 'completed' : isCurrent ? 'active' : 'pending'
                      }`}
                  >
                    {isCompleted ? (
                      <Check style={{ width: '1rem', height: '1rem', strokeWidth: 3 }} />
                    ) : isCurrent ? (
                      <div className="active-pulse-dot" />
                    ) : (
                      <span className="pending-dot" />
                    )}
                  </div>

                  {/* Connecting Line */}
                  {idx < 5 && (
                    <div
                      className={`progress-line ${step < currentStep || currentStep === 6
                        ? 'completed'
                        : step === currentStep
                          ? 'active'
                          : ''
                        }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* ================= STEP 1: CALL DIRECTION ================= */}
          {currentStep === 1 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">How will your AI agent handle calls?</h1>
                <p className="step-subtitle">
                  Choose whether your agent will receive incoming calls or make outbound calls.
                </p>
              </div>

              <div className="direction-grid">
                {/* Inbound Card */}
                <div
                  onClick={() => setCallDirection('inbound')}
                  className={`direction-card ${callDirection === 'inbound' ? 'selected' : ''}`}
                >
                  <div className="card-icon-box">
                    <img src="/images/Frame 1010111447.png" alt="Inbound Calling" />
                  </div>
                  <div>
                    <h3 className="card-title">Inbound Calling</h3>
                    <p className="card-desc">
                      Answer incoming calls and assist your customers automatically.
                    </p>
                  </div>
                </div>

                {/* Outbound Card */}
                <div
                  onClick={() => setCallDirection('outbound')}
                  className={`direction-card ${callDirection === 'outbound' ? 'selected' : ''}`}
                >
                  <div className="card-icon-box">
                    <img src="/images/Frame 1010111447 (1).png" alt="Outbound Campaign" />
                  </div>
                  <div>
                    <h3 className="card-title">Outbound Campaign</h3>
                    <p className="card-desc">
                      Make AI-powered calls to leads, customers, or contacts.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 2: CHOOSE USE CASE ================= */}
          {currentStep === 2 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">
                  {callDirection === 'inbound' ? 'What will your agent handle?' : 'What will your agent call about?'}
                </h1>
                <p className="step-subtitle">
                  Select a template to get started quickly with pre-configured workflows and prompts.
                </p>
              </div>

              <div className="usecase-grid">
                {currentUseCases.map((uc) => {
                  const IconComp = uc.icon;
                  const isSelected = selectedUseCase === uc.id;

                  return (
                    <div
                      key={uc.id}
                      onClick={() => setSelectedUseCase(uc.id)}
                      className={`usecase-card ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="usecase-icon-box">
                        <IconComp style={{ width: '1.25rem', height: '1.25rem' }} />
                      </div>

                      <div>
                        <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                          {uc.title}
                        </h3>
                        <p className="card-desc" style={{ fontSize: '0.78rem' }}>
                          {uc.description}
                        </p>
                      </div>

                      {isSelected && <div className="active-dot-indicator" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= STEP 3: CONNECT YOUR AGENT ================= */}
          {currentStep === 3 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">
                  Connect Your Agent ({selectedUseCaseObj.title})
                </h1>
                <p className="step-subtitle">
                  Choose the phone number, voice, language, and personality your AI agent will use
                </p>
              </div>

              <div className="form-card-container">
                {/* 1. Agent Name */}
                <div className="form-group">
                  <label className="form-label">
                    <span>Agent Name</span>
                    <span className="form-label-required">*</span>
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Enter Agent Name"
                    className="form-input"
                  />
                </div>

                {/* 2. Phone Number Type Selection */}
                <div className="two-col-grid">
                  {/* International Number */}
                  <div
                    onClick={() => setNumberType('international')}
                    className={`number-card ${numberType === 'international' ? 'selected' : ''}`}
                  >
                    <div className="card-icon-box" style={{ width: '2.75rem', height: '2.75rem', margin: 0 }}>
                      {/* <Phone style={{ width: '1.25rem', height: '1.25rem' }} /> */}
                      <img src="/images/Frame 1010111447.png" />
                    </div>
                    <div>
                      <h4 className="card-title" style={{ fontSize: '0.95rem', margin: 0 }}>
                        International Number
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        +1 (567) 890-1234
                      </p>
                    </div>

                    {numberType === 'international' && (
                      <div className="number-tooltip">
                        Highest-quality, natural-sounding conversations with advanced voices and faster responses. Best for sales, demos, and high-value customer calls.
                      </div>
                    )}
                  </div>

                  {/* Indian Number */}
                  <div
                    onClick={() => setNumberType('indian')}
                    className={`number-card ${numberType === 'indian' ? 'selected' : ''}`}
                  >
                    <div className="card-icon-box" style={{ width: '2.75rem', height: '2.75rem', margin: 0 }}>
                      {/* <Phone style={{ width: '1.25rem', height: '1.25rem' }} /> */}
                      <img src="/images/Frame 1010111447 (1).png" />
                    </div>
                    <div>
                      <h4 className="card-title" style={{ fontSize: '0.95rem', margin: 0 }}>
                        Indian Number
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        +91 78901-23456
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Calling Tiers */}
                <div className="three-col-grid">
                  {(['premium', 'standard', 'essential'] as CallingTier[]).map((tierKey) => {
                    const tier = TIER_DETAILS[tierKey];
                    const isSelected = callingTier === tierKey;

                    return (
                      <div
                        key={tierKey}
                        onClick={() => setCallingTier(tierKey)}
                        className={`tier-card ${isSelected ? 'selected' : ''}`}
                      >
                        <div>
                          <h4 className="tier-title">{tier.title}</h4>
                          <p className="tier-credits">{tier.credits}</p>
                        </div>

                        <div
                          className="info-tooltip-btn"
                          onMouseEnter={() => setHoveredTooltip(tierKey)}
                          onMouseLeave={() => setHoveredTooltip(null)}
                        >
                          <Info style={{ width: '0.85rem', height: '0.85rem' }} />

                          {hoveredTooltip === tierKey && (
                            <div className="tier-popup-tooltip">{tier.tooltip}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4. Language & Voice Dropdowns */}
                <div className="two-col-grid">
                  <div className="form-group">
                    <label className="form-label">Language</label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                        <SelectValue placeholder="Select Language" />
                      </SelectTrigger>
                      <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff' }}>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="Hindi">Hindi (Hinglish)</SelectItem>
                        <SelectItem value="Spanish">Spanish</SelectItem>
                        <SelectItem value="French">French</SelectItem>
                        <SelectItem value="German">German</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      <span>Voice</span>
                      <span className="form-label-required">*</span>
                    </label>
                    <Select value={voice} onValueChange={setVoice}>
                      <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                        <SelectValue placeholder="Select Voice" />
                      </SelectTrigger>
                      <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff' }}>
                        {VOICE_OPTIONS.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 5. Voice Tone & Personality Dropdowns */}
                <div className="two-col-grid">
                  <div className="form-group">
                    <label className="form-label">Voice Tone</label>
                    <Select value={voiceTone} onValueChange={setVoiceTone}>
                      <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                        <SelectValue placeholder="Select Tone" />
                      </SelectTrigger>
                      <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff' }}>
                        <SelectItem value="Empathetic">Empathetic</SelectItem>
                        <SelectItem value="Confident">Confident</SelectItem>
                        <SelectItem value="Friendly">Friendly</SelectItem>
                        <SelectItem value="Professional">Professional</SelectItem>
                        <SelectItem value="Casual">Casual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Personality</label>
                    <Select value={personality} onValueChange={setPersonality}>
                      <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                        <SelectValue placeholder="Select Personality" />
                      </SelectTrigger>
                      <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff' }}>
                        <SelectItem value="Patient">Patient</SelectItem>
                        <SelectItem value="Helpful">Helpful</SelectItem>
                        <SelectItem value="Energetic">Energetic</SelectItem>
                        <SelectItem value="Professional">Professional</SelectItem>
                        <SelectItem value="Direct">Direct & Concise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 6. Response Delay Slider */}
                <div className="form-group" style={{ paddingTop: '0.25rem' }}>
                  <div className="slider-header-row">
                    <div>
                      <h4 className="form-label" style={{ fontSize: '0.85rem' }}>
                        Response Delay
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.15rem 0 0 0' }}>
                        How long the agent waits before responding (0.5s to 5.0s)
                      </p>
                    </div>
                    <span className="slider-badge">{responseDelay.toFixed(1)}s</span>
                  </div>
                  <Slider
                    value={[responseDelay]}
                    onValueChange={(val) => setResponseDelay(val[0])}
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    style={{ padding: '0.5rem 0' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 4: CONFIGURE PROMPTS ================= */}
          {currentStep === 4 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">Configure Prompts</h1>
                <p className="step-subtitle">Customize what your agent says and how it behaves</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* 1. System Prompt Card */}
                <div className="form-card-container">
                  <div className="card-header-flex">
                    <div>
                      <h3 className="card-title">System Prompt</h3>
                      <p className="card-desc">
                        Define your agent's role, responsibilities, tone and Behavior.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateModal(true)}
                      className="template-btn"
                    >
                      <LayoutTemplate style={{ width: '1rem', height: '1rem', color: '#00E575' }} />
                      <span>Use Template</span>
                    </button>
                  </div>

                  <div className="prompt-split-grid">
                    <div>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="Write the system prompt here ..."
                        maxLength={4000}
                        rows={7}
                        className="form-textarea"
                      />
                      <div className="char-counter">{systemPrompt.length}/4000</div>
                    </div>

                    <div className="tips-container-box">
                      <div className="tips-title">
                        <Sparkles style={{ width: '1rem', height: '1rem' }} />
                        <span>Tips for a great system prompt</span>
                      </div>
                      <ul className="tips-list">
                        <li className="tips-item">
                          <Check style={{ width: '0.85rem', height: '0.85rem', color: '#00E575', strokeWidth: 3, flexShrink: 0, marginTop: '2px' }} />
                          <span>Clearly define the agent's role</span>
                        </li>
                        <li className="tips-item">
                          <Check style={{ width: '0.85rem', height: '0.85rem', color: '#00E575', strokeWidth: 3, flexShrink: 0, marginTop: '2px' }} />
                          <span>Include key responsibilities</span>
                        </li>
                        <li className="tips-item">
                          <Check style={{ width: '0.85rem', height: '0.85rem', color: '#00E575', strokeWidth: 3, flexShrink: 0, marginTop: '2px' }} />
                          <span>Mention tone and communication style</span>
                        </li>
                        <li className="tips-item">
                          <Check style={{ width: '0.85rem', height: '0.85rem', color: '#00E575', strokeWidth: 3, flexShrink: 0, marginTop: '2px' }} />
                          <span>Add do's and don'ts</span>
                        </li>
                        <li className="tips-item">
                          <Check style={{ width: '0.85rem', height: '0.85rem', color: '#00E575', strokeWidth: 3, flexShrink: 0, marginTop: '2px' }} />
                          <span>Use dynamic variable where needed</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* 2. First Message Card */}
                <div className="form-card-container">
                  <div className="prompt-split-grid">
                    <div>
                      <div>
                        <h3 className="card-title">First Message</h3>
                        <p className="card-desc">
                          This is the first message your agent will say to start the conversion
                        </p>
                      </div>
                      <textarea
                        value={firstMessage}
                        onChange={(e) => setFirstMessage(e.target.value)}
                        placeholder="Write the first message here....."
                        maxLength={500}
                        rows={4}
                        className="form-textarea"
                        style={{ marginTop: '0.75rem' }}
                      />
                      <div className="char-counter">{firstMessage.length}/500</div>
                    </div>

                    <div className="example-container-box">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 600 }}>
                        <MessageSquare style={{ width: '0.9rem', height: '0.9rem', color: '#00E575' }} />
                        <span>Tips for a great first message</span>
                      </div>
                      <div className="example-quote">
                        "Hi &#123;&#123;first_name&#125;&#125;, this is Sarah from ABC Corp. How's your day going?"
                      </div>
                      <button
                        type="button"
                        onClick={() => setFirstMessage("Hi {{first_name}}, this is Sarah from ABC Corp. How's your day going?")}
                        className="use-example-btn"
                      >
                        Use Example
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Available Dynamic Variables Card */}
                <div className="form-card-container" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    <h3 className="card-title">Available Dynamic Variables</h3>
                    <p className="card-desc">
                      Click to insert variables. They will be replaced with actual data during conversations.
                    </p>
                    <div className="variables-wrap-row" style={{ marginTop: '0.75rem' }}>
                      {DYNAMIC_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleInsertVariable(v)}
                          className="variable-badge-btn"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="variables-sidebar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#00E575', fontSize: '0.8rem', fontWeight: 600 }}>
                      <Lightbulb style={{ width: '1rem', height: '1rem' }} />
                      <span>What are the dynamic variables?</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5, marginTop: '0.4rem' }}>
                      These placeholders automatically pull contact data from your campaign CSV and personalize the conversation.
                    </p>
                  </div>
                </div>

                {/* 4. Knowledge Base (Optional) Card */}
                <div className="form-card-container">
                  <div>
                    <h3 className="card-title">Knowledge Base (Optional)</h3>
                    <p className="card-desc">Select the knowledge base document(s) to train this agent.</p>
                  </div>

                  <div className="four-col-grid">
                    {MOCK_KNOWLEDGE_BASES.map((kb) => {
                      const isSelected = selectedKnowledgeBases.includes(kb.id);
                      const IconComp = kb.icon;
                      return (
                        <div
                          key={kb.id}
                          onClick={() => toggleKnowledgeBase(kb.id)}
                          className={`kb-card ${isSelected ? 'selected' : ''}`}
                        >
                          <div className="kb-checkbox-box">
                            {isSelected && <Check style={{ width: '0.75rem', height: '0.75rem', strokeWidth: 3 }} />}
                          </div>
                          <div style={{ overflow: 'hidden' }}>
                            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                              {kb.title}
                            </p>
                            <p style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.25rem', margin: '0.2rem 0 0 0' }}>
                              <IconComp style={{ width: '0.75rem', height: '0.75rem', color: '#64748b' }} />
                              <span>{kb.type}</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 5: AGENT TOOLS ================= */}
          {currentStep === 5 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">Agent Tools</h1>
                <p className="step-subtitle">
                  Choose the actions your AI agent can perform during and after conversations. You can configure each tool after enabling it.
                </p>
              </div>

              <div className="two-col-grid">
                {AGENT_TOOL_CATEGORIES.map((catGroup) => (
                  <div key={catGroup.category}>
                    <h3 className="tools-category-header">{catGroup.category}</h3>

                    <div className="tool-group-card">
                      {catGroup.items.map((tool) => {
                        const isSelected = selectedTools.includes(tool.id);

                        return (
                          <div
                            key={tool.id}
                            onClick={() => toggleTool(tool.id)}
                            className={`tool-item-row ${isSelected ? 'selected' : ''}`}
                          >
                            <div className="tool-checkbox-box">
                              {isSelected && <Check style={{ width: '0.75rem', height: '0.75rem', strokeWidth: 3 }} />}
                            </div>

                            <div>
                              <h4 className="tool-title">{tool.title}</h4>
                              <p className="tool-desc">{tool.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= STEP 6: REVIEW YOUR AGENT ================= */}
          {currentStep === 6 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">Review Your Agent</h1>
                <p className="step-subtitle">
                  Everything looks good! Review and create your agent.
                </p>
              </div>

              <div className="form-card-container">
                {/* Row 1: Use Case, Name, Telephony Provider, Calling Tier */}
                <div className="four-col-grid">
                  <div className="review-meta-item">
                    <span className="review-meta-label">Use Case</span>
                    <span className="review-meta-value">{selectedUseCaseObj.title}</span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Name</span>
                    <span className="review-meta-value">{agentName || 'Customer Support Agent'}</span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Telephony Provider</span>
                    <span className="review-meta-value">
                      {numberType === 'international' ? 'International Number' : 'Indian Number'}
                    </span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">{TIER_DETAILS[callingTier].title}</span>
                    <span className="review-meta-value" style={{ fontFamily: 'monospace' }}>
                      {TIER_DETAILS[callingTier].credits}
                    </span>
                  </div>
                </div>

                {/* Row 2: Voice, Language, Voice Tone, Personality */}
                <div className="four-col-grid">
                  <div className="review-meta-item">
                    <span className="review-meta-label">Voice</span>
                    <span className="review-meta-value" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {VOICE_OPTIONS.find((v) => v.id === voice)?.name || 'Roger - Laid-Back, Casual, Resonant'}
                    </span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Language</span>
                    <span className="review-meta-value">{language}</span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Voice Tone</span>
                    <span className="review-meta-value">{voiceTone}</span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Personality</span>
                    <span className="review-meta-value">{personality}</span>
                  </div>
                </div>

                {/* Row 3: Voice Speed, Knowledge Base, Enable Call Transfer */}
                <div className="four-col-grid">
                  <div className="review-meta-item">
                    <span className="review-meta-label">Voice Speed</span>
                    <span className="review-meta-value" style={{ fontFamily: 'monospace' }}>1.00x</span>
                  </div>

                  <div className="review-meta-item">
                    <span className="review-meta-label">Knowledge Base</span>
                    <span className="review-meta-value" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedKnowledgeBases.length > 0
                        ? selectedKnowledgeBases
                          .map((id) => MOCK_KNOWLEDGE_BASES.find((k) => k.id === id)?.title)
                          .filter(Boolean)
                          .join(', ')
                        : 'Text - Real Estate'}
                    </span>
                  </div>

                  <div className="review-meta-item" style={{ gridColumn: 'span 2' }}>
                    <span className="review-meta-label">Enable Call Transfer</span>
                    <span className="review-meta-value" style={{ fontFamily: 'monospace' }}>
                      {selectedTools.includes('call_transfer') ? '+1 (567) 890-1234' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Section: System Prompt */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.75rem' }}>
                  <span className="review-meta-label">System Prompt</span>
                  <div className="review-preview-box">
                    {systemPrompt || 'No system prompt configured.'}
                  </div>
                </div>

                {/* Section: First Message */}
                <div>
                  <span className="review-meta-label">First Message</span>
                  <div className="review-preview-box">
                    {firstMessage || 'No initial message configured.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Template Selection Modal */}
          {showTemplateModal && (
            <div className="modal-backdrop">
              <div className="modal-dialog">
                <div className="modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <LayoutTemplate style={{ width: '1.25rem', height: '1.25rem', color: '#00E575' }} />
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                      Select Prompt Template
                    </h3>
                  </div>
                  <button onClick={() => setShowTemplateModal(false)} className="modal-close-btn">
                    ✕
                  </button>
                </div>
                <div className="template-cards-grid">
                  {PROMPT_TEMPLATES.map((tmpl, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setSystemPrompt(tmpl.prompt);
                        setFirstMessage(tmpl.firstMessage);
                        setShowTemplateModal(false);
                      }}
                      className="template-pick-card"
                    >
                      <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff', display: 'flex', justifyContent: 'space-between', margin: 0 }}>
                        <span>{tmpl.name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#00E575', fontFamily: 'monospace' }}>Use →</span>
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.45, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                        {tmpl.prompt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bottom Navigation Buttons */}
          <div className="wizard-footer-nav">
            <button onClick={handleBack} className="btn-back">
              <ArrowLeft style={{ width: '1rem', height: '1rem' }} />
              <span>Back</span>
            </button>

            {currentStep === 6 ? (
              <button
                onClick={handleCreateAgent}
                disabled={isSubmitting}
                className="btn-create-agent"
              >
                <Wand2 style={{ width: '1rem', height: '1rem', strokeWidth: 2.5 }} />
                <span>{isSubmitting ? 'Creating Agent...' : 'Create Agent'}</span>
              </button>
            ) : (
              <button onClick={handleNext} className="btn-next">
                <span>Next</span>
                <ArrowRight style={{ width: '1rem', height: '1rem', strokeWidth: 2.5 }} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
