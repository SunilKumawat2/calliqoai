import React, { useState, useMemo } from 'react';
import {
  Plus,
  ArrowLeft,
  ArrowRight,
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
  Wand2,
  Tag,
  ChevronLeft,
  ChevronRight,
  Cpu,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { AuthStorage } from '@/lib/auth-storage';
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

interface LiveAgentTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  icon: React.ElementType;
  systemPrompt: string;
  firstMessage: string;
  variables: string[];
  suggestedVoiceTone?: string;
  suggestedPersonality?: string;
  toneNote?: string;
  usageCount?: number;
}

const ALL_SYSTEM_TEMPLATES: LiveAgentTemplate[] = [
  {
    id: 'upsell-existing-customer',
    name: 'Upsell - Existing Customer',
    title: 'Upsell - Existing Customer',
    category: 'Sales',
    description: 'Script for upselling additional products or upgraded plans to existing satisfied customers.',
    icon: Sparkles,
    systemPrompt: `You are reaching out to {{contact_name}}, an existing customer of {{company_name}} who has been using {{current_product}}.\n\nYour goal is to:\n- Thank them for being a valued customer\n- Check on their satisfaction with current services\n- Introduce {{upgrade_product}} and explain how it could benefit them\n- Handle any questions about pricing or transition smoothly\n- Be consultative and helpful`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} from {{company_name}}. I wanted to personally check in and see how everything is going with your account. We truly value your business!',
    variables: ['contact_name', 'company_name', 'current_product', 'upgrade_product'],
    suggestedVoiceTone: 'Confident',
    suggestedPersonality: 'Energetic',
    toneNote: 'Appreciative, helpful, consultative',
    usageCount: 0,
  },
  {
    id: 'complaint-handling',
    name: 'Complaint Handling',
    title: 'Complaint Handling',
    category: 'Support',
    description: 'Specialized script for handling customer complaints with empathy and focus on resolution.',
    icon: MessageSquare,
    systemPrompt: `You are a customer relations specialist for {{company_name}}, trained to handle complaints and turn negative experiences into positive outcomes.\n\nKey behaviors:\n- Listen fully without interrupting\n- Acknowledge their feelings and apologize sincerely\n- Propose a fair resolution and confirm customer satisfaction\n- Never be defensive or make excuses`,
    firstMessage: 'Hello, this is {{agent_name}} from {{company_name}} customer care team. I understand you had a concern, and I want you to know that I am here to help make this right. Please tell me what happened.',
    variables: ['company_name', 'agent_name'],
    suggestedVoiceTone: 'Empathetic',
    suggestedPersonality: 'Patient',
    toneNote: 'Sincere, empathetic, solution-focused',
    usageCount: 0,
  },
  {
    id: 'customer-service-general',
    name: 'Customer Service - General',
    title: 'Customer Service - General',
    category: 'Support',
    description: 'General customer service script for handling various inquiries, complaints, and requests.',
    icon: Headphones,
    systemPrompt: `You are a customer service representative for {{company_name}}. Your role is to help customers with their inquiries, resolve issues, and ensure satisfaction.\n\nKey behaviors:\n- Always be empathetic, polite, and patient\n- Provide clear, helpful solutions\n- If you cannot resolve immediately, explain next steps clearly`,
    firstMessage: 'Thank you for calling {{company_name}}. My name is {{agent_name}}, and I am here to help. How may I assist you today?',
    variables: ['company_name', 'agent_name'],
    suggestedVoiceTone: 'Empathetic',
    suggestedPersonality: 'Helpful',
    toneNote: 'Calm, empathetic, professional',
    usageCount: 0,
  },
  {
    id: 'tech-support',
    name: 'Technical Support - Troubleshooting',
    title: 'Technical Support - Troubleshooting',
    category: 'Support',
    description: 'Technical support script for guiding customers through troubleshooting steps for common issues.',
    icon: HelpCircle,
    systemPrompt: `You are a technical support specialist for {{company_name}}. Your role is to help customers resolve technical issues with {{product_name}}.\n\nApproach:\n- Understand the issue clearly and ask what happened\n- Verify basic setup and requirements\n- Guide through troubleshooting steps one at a time\n- Confirm resolution before ending the call`,
    firstMessage: 'Hi, you have reached {{company_name}} technical support. I am {{agent_name}}, and I am here to help resolve any technical issues you are experiencing. Can you tell me what is happening?',
    variables: ['company_name', 'product_name'],
    suggestedVoiceTone: 'Professional',
    suggestedPersonality: 'Helpful',
    toneNote: 'Calm, patient, reassuring',
    usageCount: 0,
  },
  {
    id: 'market-research-survey',
    name: 'Market Research Survey',
    title: 'Market Research Survey',
    category: 'Survey',
    description: 'Market research survey for collecting opinions on products, services, or industry trends.',
    icon: Lightbulb,
    systemPrompt: `You are conducting market research on behalf of {{company_name}}. Your goal is to collect honest opinions about {{research_topic}}.\n\nApproach:\n- Introduce yourself and state this is research, not a sales call\n- Ask questions in a neutral, unbiased way\n- Thank them for their valuable time`,
    firstMessage: 'Hello {{contact_name}}, I am {{agent_name}} calling on behalf of {{company_name}}. We are conducting research about {{research_topic}} and your opinion would be extremely valuable. Do you have about 3 minutes to share your thoughts?',
    variables: ['contact_name', 'company_name', 'research_topic'],
    suggestedVoiceTone: 'Professional',
    suggestedPersonality: 'Direct',
    toneNote: 'Professional, curious, neutral',
    usageCount: 0,
  },
  {
    id: 'nps-survey',
    name: 'NPS Survey - Customer Satisfaction',
    title: 'NPS Survey - Customer Satisfaction',
    category: 'Survey',
    description: 'Net Promoter Score survey to measure customer loyalty and satisfaction.',
    icon: FileSpreadsheet,
    systemPrompt: `You are conducting a brief customer satisfaction survey for {{company_name}}. Your goal is to collect honest feedback through the NPS methodology.\n\nQuestions:\n- Ask for an NPS rating from 0-10\n- Ask what is the primary reason for their score\n- Thank them warmly for their feedback`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} from {{company_name}}. We value your opinion and would love to get your quick feedback. This will only take about 2 minutes. Do you have a moment?',
    variables: ['contact_name', 'company_name', 'agent_name'],
    suggestedVoiceTone: 'Friendly',
    suggestedPersonality: 'Professional',
    toneNote: 'Friendly, neutral, appreciative',
    usageCount: 0,
  },
  {
    id: 'cold-outreach',
    name: 'Cold Outreach - Product Introduction',
    title: 'Cold Outreach - Product Introduction',
    category: 'Sales',
    description: 'Professional cold calling script for introducing your product or service to new prospects.',
    icon: BadgePercent,
    systemPrompt: `You are a professional sales representative for {{company_name}}. Your goal is to introduce {{product_name}} to potential customers in a friendly, consultative manner.\n\nKey behaviors:\n- Quickly establish credibility and value\n- Focus on benefits rather than features\n- Qualify the prospect and schedule a follow-up call or demo`,
    firstMessage: "Hi, this is {{agent_name}} from {{company_name}}. I hope I'm not catching you at a bad time. I'm reaching out because we help companies like yours {{value_proposition}}. Do you have a quick moment to chat?",
    variables: ['company_name', 'product_name', 'agent_name', 'value_proposition'],
    suggestedVoiceTone: 'Confident',
    suggestedPersonality: 'Professional',
    toneNote: 'Warm, persuasive, consultative',
    usageCount: 0,
  },
  {
    id: 'follow-up-post-demo',
    name: 'Follow-Up Call - Post Demo',
    title: 'Follow-Up Call - Post Demo',
    category: 'Sales',
    description: 'Follow-up script for prospects who attended a product demo. Addresses questions and moves toward closing.',
    icon: Target,
    systemPrompt: `You are following up with {{contact_name}} who recently attended a demo of {{product_name}} from {{company_name}}.\n\nKey objectives:\n- Thank them for attending the demo\n- Answer any questions that came up\n- Discuss next steps and timeline`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} from {{company_name}}. I wanted to follow up on the demo you attended last week. I hope you found it helpful! Do you have a few minutes to discuss any questions?',
    variables: ['contact_name', 'product_name', 'company_name', 'agent_name'],
    suggestedVoiceTone: 'Friendly',
    suggestedPersonality: 'Helpful',
    toneNote: 'Proactive, clear, encouraging',
    usageCount: 0,
  },
  {
    id: 'appointment-booking',
    name: 'Appointment Booking',
    title: 'Appointment Booking',
    category: 'Appointment',
    description: 'Script for scheduling appointments, checking availability, and confirming details.',
    icon: CalendarCheck,
    systemPrompt: `You are an appointment coordinator for {{company_name}}. Your role is to schedule appointments efficiently while being friendly and helpful.\n\nProcess:\n- Understand what type of appointment they need\n- Collect preferred dates and times\n- Confirm contact information and appointment details`,
    firstMessage: 'Thank you for calling {{company_name}}. I am {{agent_name}}, and I can help you schedule an appointment. What type of appointment are you looking to book today?',
    variables: ['company_name', 'agent_name'],
    suggestedVoiceTone: 'Friendly',
    suggestedPersonality: 'Helpful',
    toneNote: 'Organized, pleasant, efficient',
    usageCount: 0,
  },
  {
    id: 'appointment-reminder',
    name: 'Appointment Reminder & Confirmation',
    title: 'Appointment Reminder & Confirmation',
    category: 'Appointment',
    description: 'Automated reminder call script for upcoming appointments with confirmation and rescheduling options.',
    icon: CalendarClock,
    systemPrompt: `You are calling to remind {{contact_name}} about their upcoming appointment at {{company_name}}.\n\nObjectives:\n- Remind them of appointment date and time\n- Confirm attendance or offer easy rescheduling\n- Remind them of any required preparation`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} calling from {{company_name}}. I am just calling to remind you about your appointment scheduled for {{appointment_date}} at {{appointment_time}}. Will you be able to make it?',
    variables: ['contact_name', 'company_name', 'appointment_date', 'appointment_time'],
    suggestedVoiceTone: 'Friendly',
    suggestedPersonality: 'Direct',
    toneNote: 'Clear, courteous, prompt',
    usageCount: 0,
  },
  {
    id: 'appointment-healthcare',
    name: 'Appointment Confirmation - Healthcare',
    title: 'Appointment Confirmation - Healthcare',
    category: 'Appointment',
    description: 'Healthcare-specific appointment confirmation with insurance and preparation information.',
    icon: UserPlus,
    systemPrompt: `You are an appointment coordinator for {{clinic_name}}. You are confirming a healthcare appointment and ensuring the patient has all necessary information.\n\nObjectives:\n- Confirm appointment date, time, and provider\n- Verify insurance and patient details\n- Share arrival recommendations and preparation instructions`,
    firstMessage: 'Hello {{patient_name}}, this is {{agent_name}} calling from {{clinic_name}}. I am calling to confirm your upcoming appointment with {{provider_name}} on {{appointment_date}}. Do you have a moment?',
    variables: ['patient_name', 'clinic_name', 'provider_name', 'appointment_date'],
    suggestedVoiceTone: 'Empathetic',
    suggestedPersonality: 'Patient',
    toneNote: 'Reassuring, gentle, professional',
    usageCount: 0,
  },
  {
    id: 'debt-collection',
    name: 'Debt Collection & Payment Reminder',
    title: 'Debt Collection & Payment Reminder',
    category: 'Finance',
    description: 'Courteous payment reminder script for upcoming or overdue invoices.',
    icon: CreditCard,
    systemPrompt: `You are calling on behalf of {{company_name}} accounts team regarding an outstanding balance of {{amount_due}} for invoice {{invoice_number}}.\n\nBehaviors:\n- Maintain a polite, respectful, and professional tone\n- Offer payment assistance options and record their feedback`,
    firstMessage: 'Hello {{contact_name}}, this is {{agent_name}} from the accounts team at {{company_name}}. I am giving a polite courtesy call regarding an upcoming invoice. Do you have a quick minute?',
    variables: ['contact_name', 'company_name', 'amount_due', 'invoice_number'],
    suggestedVoiceTone: 'Professional',
    suggestedPersonality: 'Patient',
    toneNote: 'Respectful, firm, polite',
    usageCount: 0,
  },
  {
    id: 'post-service-feedback',
    name: 'Customer Follow-Up & Review',
    title: 'Customer Follow-Up & Review',
    category: 'Survey',
    description: 'Survey script for collecting feedback immediately after a service interaction.',
    icon: History,
    systemPrompt: `You are following up on a recent service interaction with {{company_name}}. Your goal is to understand the customer's experience and collect actionable feedback.\n\nQuestions:\n- How would they rate their experience (1-5)?\n- Was their issue resolved to their satisfaction?`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} from {{company_name}}. I am following up on your recent interaction with our team on {{service_date}}. I would love to hear about your experience - do you have 2 minutes?',
    variables: ['contact_name', 'company_name', 'service_date'],
    suggestedVoiceTone: 'Empathetic',
    suggestedPersonality: 'Helpful',
    toneNote: 'Attentive, grateful, caring',
    usageCount: 0,
  },
  {
    id: 'virtual-receptionist',
    name: 'AI Receptionist & Call Routing',
    title: 'AI Receptionist & Call Routing',
    category: 'General',
    description: 'General-purpose virtual receptionist for handling incoming calls, routing, and taking messages.',
    icon: UserCheck,
    systemPrompt: `You are the virtual receptionist for {{company_name}}. Your role is to professionally handle all incoming calls.\n\nResponsibilities:\n- Greet callers warmly\n- Route to the appropriate department\n- Take messages with contact info when needed`,
    firstMessage: 'Thank you for calling {{company_name}}. This is {{agent_name}}. How may I direct your call today?',
    variables: ['company_name', 'agent_name', 'business_hours'],
    suggestedVoiceTone: 'Professional',
    suggestedPersonality: 'Helpful',
    toneNote: 'Welcoming, articulate, organized',
    usageCount: 0,
  },
  {
    id: 'information-hotline',
    name: 'Information Hotline & FAQs',
    title: 'Information Hotline & FAQs',
    category: 'General',
    description: 'Script for providing information about products, services, hours, locations, and FAQs.',
    icon: Info,
    systemPrompt: `You are an information specialist for {{company_name}}. Provide accurate and concise answers regarding business hours, location, policies, and frequently asked questions.`,
    firstMessage: 'Hello, you have reached the {{company_name}} information line. I am {{agent_name}}, and I am happy to answer any questions you have. What would you like to know?',
    variables: ['company_name', 'agent_name'],
    suggestedVoiceTone: 'Professional',
    suggestedPersonality: 'Helpful',
    toneNote: 'Knowledgeable, patient, clear',
    usageCount: 0,
  },
  {
    id: 'event-registration',
    name: 'Event Registration & Check-In',
    title: 'Event Registration & Check-In',
    category: 'General',
    description: 'Script for handling event registrations, providing event details, and collecting attendee information.',
    icon: ShoppingBag,
    systemPrompt: `You are handling registrations for {{event_name}} organized by {{company_name}}.\n\nProcess:\n- Provide event details (date, time, venue)\n- Collect attendee information and process registration\n- Answer attendee questions enthusiastically`,
    firstMessage: 'Hello! Thank you for your interest in {{event_name}}. I am {{agent_name}}, and I can help you register today. Have you attended our events before?',
    variables: ['event_name', 'company_name', 'agent_name'],
    suggestedVoiceTone: 'Friendly',
    suggestedPersonality: 'Energetic',
    toneNote: 'Enthusiastic, welcoming, engaging',
    usageCount: 0,
  },
  {
    id: 'real-estate-buyer',
    name: 'Real Estate Buyer Qualification',
    title: 'Real Estate Buyer Qualification',
    category: 'Real Estate',
    description: 'Qualify prospective property buyers by understanding budget, location preference, and timeline.',
    icon: Target,
    systemPrompt: `You are a real estate assistant for {{company_name}}. Inquire about the buyer's desired property type, location, price range, and pre-approval status to connect them with the right agent.`,
    firstMessage: 'Hi {{contact_name}}, this is {{agent_name}} from {{company_name}}. I noticed your interest in properties in {{city}}. Are you looking to buy in the near future?',
    variables: ['contact_name', 'company_name', 'city', 'agent_name'],
    suggestedVoiceTone: 'Confident',
    suggestedPersonality: 'Professional',
    toneNote: 'Consultative, knowledgeable, polished',
    usageCount: 0,
  },
  {
    id: 'custom-use-case',
    name: 'Custom AI Voice Agent',
    title: 'Custom AI Voice Agent',
    category: 'Custom',
    description: 'Create an agent for your own custom calling workflows and instructions.',
    icon: GitFork,
    systemPrompt: `You are a versatile AI Voice Agent for {{company_name}}. Reach out to contacts professionally and conduct conversations based on your custom business instructions.`,
    firstMessage: 'Hello! Thank you for connecting with {{company_name}}. How may I assist you today?',
    variables: ['company_name', 'agent_name'],
    suggestedVoiceTone: 'Confident',
    suggestedPersonality: 'Professional',
    toneNote: 'Customizable, adaptable, versatile',
    usageCount: 0,
  },
];

const TIER_DETAILS = {
  premium: {
    title: 'Premium Calling',
    credits: '10 Credits/min',
    tooltip:
      'Highest-quality, natural-sounding conversations with advanced voices and faster responses. Best for sales, demos, and high-value customer calls.',
  },
  standard: {
    title: 'Standard Calling',
    credits: '6 Credits/min',
    tooltip:
      'Balanced conversational AI voice performance, fast latency and optimized per-minute cost.',
  },
  essential: {
    title: 'Essential Calling',
    credits: '4 Credits/min',
    tooltip:
      'High efficiency Indian & multi-lingual regional voice models for volume calling.',
  },
};

const VOICE_OPTIONS = [
  { id: 'roger', name: 'Roger - Laid-Back, Casual, Resonant' },
  { id: 'coral', name: 'Ananya - Natural, Warm, Female Executive' },
  { id: 'sarah', name: 'Sarah - Clear, Professional, Confident' },
  { id: 'jessica', name: 'Jessica - Expressive, Friendly' },
  { id: 'shimmer', name: 'Priya - Polite, Fluent Hindi/Hinglish' },
  { id: 'echo', name: 'David - Deep, Authoritative' },
];

const DYNAMIC_VARIABLES = [
  '{{first_name}}',
  '{{last_name}}',
  '{{contact_name}}',
  '{{email}}',
  '{{phone}}',
  '{{city}}',
  '{{company_name}}',
];

const MOCK_KNOWLEDGE_BASES = [
  { id: 'kb-1', title: 'https://mieride.ca/', type: 'Website', icon: Globe },
  { id: 'kb-2', title: 'https://mieride.ca/', type: 'Website', icon: Globe },
  { id: 'kb-3', title: 'Mieride Research', type: 'Text', icon: FileText },
  { id: 'kb-4', title: 'Index.pdf', type: 'File', icon: FileText },
  { id: 'kb-5', title: 'How to work Calliqo', type: 'FAQs', icon: HelpCircle },
  { id: 'kb-6', title: 'Index.pdf', type: 'File', icon: FileText },
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

const PAGE_SIZE = 6;

export default function TestAgents() {
  const [isCreating, setIsCreating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [callDirection, setCallDirection] = useState<CallDirection>('inbound');
  const [selectedUseCase, setSelectedUseCase] = useState<string>(ALL_SYSTEM_TEMPLATES[0].id);
  const [templatePage, setTemplatePage] = useState(1);

  // Step 3 Form States
  const [agentName, setAgentName] = useState('');
  const [numberType, setNumberType] = useState<NumberType>('international');
  const [callingTier, setCallingTier] = useState<CallingTier>('premium');
  const [language, setLanguage] = useState('English');
  const [voice, setVoice] = useState('roger');
  const [voiceTone, setVoiceTone] = useState('Confident');
  const [personality, setPersonality] = useState('Professional');
  const [responseDelay, setResponseDelay] = useState<number>(1.5);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

  // Step 4 Form States (Configure Prompts)
  const [systemPrompt, setSystemPrompt] = useState(ALL_SYSTEM_TEMPLATES[0].systemPrompt);
  const [firstMessage, setFirstMessage] = useState(ALL_SYSTEM_TEMPLATES[0].firstMessage);
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<string[]>(['kb-1']);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Step 5 Form States (Agent Tools)
  const [selectedTools, setSelectedTools] = useState<string[]>([
    'call_transfer',
    'end_conversation',
  ]);

  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch any live custom prompt templates from DB/API
  const { data: apiTemplates = [] } = useQuery<any[]>({
    queryKey: ['/api/prompt-templates'],
    queryFn: async () => {
      try {
        const headers: Record<string, string> = {};
        const authHeader = AuthStorage.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;
        const res = await fetch('/api/prompt-templates', { headers });
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
  });

  // Helper to format e.164 phone numbers nicely for cards (e.g., +12495010039 -> +1 (249) 501-0039)
  const formatPhoneDisplay = (num: string): string => {
    if (!num) return '';
    const clean = num.trim();
    if (/^\+1\d{10}$/.test(clean)) {
      return `+1 (${clean.slice(2, 5)}) ${clean.slice(5, 8)}-${clean.slice(8)}`;
    }
    if (/^\+91\d{10}$/.test(clean)) {
      return `+91 ${clean.slice(3, 8)}-${clean.slice(8)}`;
    }
    return clean;
  };

  // Fetch live phone numbers from project (Twilio & Plivo - user and system pools)
  const { data: twilioUserNumbers = [] } = useQuery<any[]>({
    queryKey: ['/api/phone-numbers'],
  });

  const { data: twilioAdminNumbers = [] } = useQuery<any[]>({
    queryKey: ['/api/admin/phone-numbers'],
    queryFn: async () => {
      try {
        const headers: Record<string, string> = {};
        const authHeader = AuthStorage.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;
        const res = await fetch('/api/admin/phone-numbers', { headers, credentials: 'include' });
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
  });

  const { data: plivoUserNumbers = [] } = useQuery<any[]>({
    queryKey: ['/api/plivo/phone-numbers'],
  });

  const { data: plivoAdminNumbers = [] } = useQuery<any[]>({
    queryKey: ['/api/plivo/admin/phone-numbers'],
    queryFn: async () => {
      try {
        const headers: Record<string, string> = {};
        const authHeader = AuthStorage.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;
        const res = await fetch('/api/plivo/admin/phone-numbers', { headers, credentials: 'include' });
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
  });

  const liveInternationalNumber = useMemo(() => {
    const allTwilio = [
      ...(Array.isArray(twilioUserNumbers) ? twilioUserNumbers : []),
      ...(Array.isArray(twilioAdminNumbers) ? twilioAdminNumbers : []),
    ];

    const activeIntl = allTwilio.find(
      (n: any) => n.phoneNumber && (n.country === 'US' || n.country === 'CA' || n.country === 'GB' || n.phoneNumber.startsWith('+1'))
    ) || allTwilio.find((n: any) => n.phoneNumber && n.country !== 'IN');

    if (activeIntl?.phoneNumber) {
      return formatPhoneDisplay(activeIntl.phoneNumber);
    }
    return '+1 (249) 501-0039';
  }, [twilioUserNumbers, twilioAdminNumbers]);

  const liveIndianNumber = useMemo(() => {
    const allPlivo = [
      ...(Array.isArray(plivoUserNumbers) ? plivoUserNumbers : []),
      ...(Array.isArray(plivoAdminNumbers) ? plivoAdminNumbers : []),
    ];
    const allTwilio = [
      ...(Array.isArray(twilioUserNumbers) ? twilioUserNumbers : []),
      ...(Array.isArray(twilioAdminNumbers) ? twilioAdminNumbers : []),
    ];

    const activePlivo = allPlivo.find(
      (n: any) => n.phoneNumber && (n.country === 'IN' || n.phoneNumber.startsWith('+91'))
    ) || allPlivo[0];

    if (activePlivo?.phoneNumber) {
      return formatPhoneDisplay(activePlivo.phoneNumber);
    }

    const activeTwilioIn = allTwilio.find(
      (n: any) => n.phoneNumber && (n.country === 'IN' || n.phoneNumber.startsWith('+91'))
    );
    if (activeTwilioIn?.phoneNumber) {
      return formatPhoneDisplay(activeTwilioIn.phoneNumber);
    }

    return '+91 78901-23456';
  }, [plivoUserNumbers, plivoAdminNumbers, twilioUserNumbers, twilioAdminNumbers]);

  const allTemplates = useMemo(() => {
    if (!apiTemplates || apiTemplates.length === 0) {
      return ALL_SYSTEM_TEMPLATES;
    }
    const merged: LiveAgentTemplate[] = [...ALL_SYSTEM_TEMPLATES];
    for (const apiTmpl of apiTemplates) {
      const exists = merged.find((t) => t.name.toLowerCase() === (apiTmpl.name || '').toLowerCase());
      if (!exists) {
        merged.push({
          id: apiTmpl.id || `custom-${apiTmpl.name}`,
          name: apiTmpl.name,
          title: apiTmpl.name,
          category: apiTmpl.category || 'Custom',
          description: apiTmpl.description || 'Custom prompt template for conversational AI agent.',
          icon: GitFork,
          systemPrompt: apiTmpl.systemPrompt || apiTmpl.prompt || '',
          firstMessage: apiTmpl.firstMessage || '',
          variables: apiTmpl.variables || ['company_name', 'agent_name'],
          suggestedVoiceTone: apiTmpl.suggestedVoiceTone,
          suggestedPersonality: apiTmpl.suggestedPersonality,
          toneNote: 'Custom configured workflow',
          usageCount: 0,
        });
      }
    }
    return merged;
  }, [apiTemplates]);

  const totalPages = Math.ceil(allTemplates.length / PAGE_SIZE);

  const paginatedTemplates = useMemo(() => {
    const start = (templatePage - 1) * PAGE_SIZE;
    return allTemplates.slice(start, start + PAGE_SIZE);
  }, [allTemplates, templatePage]);

  const selectedTemplateObj = useMemo(() => {
    return allTemplates.find((u) => u.id === selectedUseCase) || allTemplates[0];
  }, [allTemplates, selectedUseCase]);

  const [showVariableModal, setShowVariableModal] = useState(false);
  const [activeTemplateForVars, setActiveTemplateForVars] = useState<LiveAgentTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const getTemplateVariables = (tmpl: LiveAgentTemplate): string[] => {
    const raw = (tmpl.systemPrompt + ' ' + tmpl.firstMessage).match(/\{\{([a-zA-Z0-9_-]+)\}\}/g) || [];
    const extracted = Array.from(new Set(raw.map((m) => m.replace(/[{}]/g, ''))));
    if (extracted.length > 0) return extracted;
    return tmpl.variables || [];
  };

  const handleOpenVariableModal = (tmpl: LiveAgentTemplate) => {
    const vars = getTemplateVariables(tmpl);
    if (vars.length > 0) {
      setActiveTemplateForVars(tmpl);
      const initialValues: Record<string, string> = {};
      vars.forEach((v) => {
        initialValues[v] = '';
      });
      setVariableValues(initialValues);
      setShowVariableModal(true);
    } else {
      applyTemplateDirectly(tmpl, {});
    }
  };

  const applyTemplateDirectly = (tmpl: LiveAgentTemplate, values: Record<string, string>) => {
    let finalPrompt = tmpl.systemPrompt;
    let finalFirstMsg = tmpl.firstMessage;

    Object.entries(values).forEach(([key, val]) => {
      if (val && val.trim()) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        finalPrompt = finalPrompt.replace(regex, val.trim());
        finalFirstMsg = finalFirstMsg.replace(regex, val.trim());
      }
    });

    setSelectedUseCase(tmpl.id);
    setSystemPrompt(finalPrompt);
    setFirstMessage(finalFirstMsg);
    if (tmpl.suggestedVoiceTone) setVoiceTone(tmpl.suggestedVoiceTone);
    if (tmpl.suggestedPersonality) setPersonality(tmpl.suggestedPersonality);
    if (values['agent_name']?.trim()) {
      setAgentName(values['agent_name'].trim());
    } else {
      setAgentName(tmpl.title || tmpl.name);
    }
    setShowVariableModal(false);
    setShowTemplateModal(false);

    toast({
      title: 'Template Applied! ✨',
      description: `Applied "${tmpl.title || tmpl.name}" prompt and configuration.`,
    });
  };

  const handleSelectTemplate = (tmpl: LiveAgentTemplate) => {
    handleOpenVariableModal(tmpl);
  };

  // Handle final Create Agent submission
  const handleCreateAgent = async () => {
    setIsSubmitting(true);
    try {
      toast({
        title: 'Agent Created Successfully! 🎉',
        description: `Your agent "${agentName || selectedTemplateObj.title + ' Agent'}" is now configured and ready to handle calls.`,
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
      setCurrentStep(2);
    } else if (currentStep === 2) {
      const matched = allTemplates.find((u) => u.id === selectedUseCase) || allTemplates[0];
      if (!agentName && matched) {
        setAgentName(matched.title || matched.name);
      }
      if (matched && matched.systemPrompt) {
        setSystemPrompt(matched.systemPrompt);
        setFirstMessage(matched.firstMessage);
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
                    className={`progress-node ${
                      isCompleted ? 'completed' : isCurrent ? 'active' : 'pending'
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
                      className={`progress-line ${
                        step < currentStep || currentStep === 6
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
                  Choose the direction of calls your agent will manage.
                </p>
              </div>

              <div className="direction-grid">
                {/* Inbound Card */}
                <div
                  onClick={() => setCallDirection('inbound')}
                  className={`direction-card ${callDirection === 'inbound' ? 'selected' : ''}`}
                >
                  <div className="card-icon-box">
                    <img src="/images/Frame 1010111447.png" alt="Inbound Call" />
                  </div>
                  <div>
                    <h3 className="card-title">Inbound Support</h3>
                    <p className="card-desc">
                      Answer incoming calls, resolve customer queries, and route conversations.
                    </p>
                  </div>
                </div>

                {/* Outbound Card */}
                <div
                  onClick={() => setCallDirection('outbound')}
                  className={`direction-card ${callDirection === 'outbound' ? 'selected' : ''}`}
                >
                  <div className="card-icon-box">
                    <img src="/images/Frame 1010111447 (1).png" alt="Outbound Call" />
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

          {/* ================= STEP 2: CHOOSE LIVE TEMPLATE (WITH 6-SET PAGINATION) ================= */}
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

              {/* 6-Card Set Grid */}
              <div className="usecase-grid">
                {paginatedTemplates.map((tmpl) => {
                  const IconComp = tmpl.icon || Headphones;
                  const isSelected = selectedUseCase === tmpl.id;

                  return (
                    <div
                      key={tmpl.id}
                      onClick={() => handleSelectTemplate(tmpl)}
                      className={`usecase-card ${isSelected ? 'selected' : ''}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: '135px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', width: '100%' }}>
                        <div className="usecase-icon-box">
                          <IconComp style={{ width: '1.25rem', height: '1.25rem' }} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                            {tmpl.title || tmpl.name}
                          </h3>
                          <p className="card-desc" style={{ fontSize: '0.78rem' }}>
                            {tmpl.description}
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectTemplate(tmpl);
                          }}
                          className={`btn-use-template ${isSelected ? 'active' : ''}`}
                        >
                          <Check style={{ width: '0.75rem', height: '0.75rem', strokeWidth: 3 }} />
                          <span>{isSelected ? 'Selected' : 'Use'}</span>
                        </button>
                      </div>

                      {isSelected && <div className="active-dot-indicator" />}
                    </div>
                  );
                })}
              </div>

              {/* Bottom Pagination Controls Bar */}
              <div className="template-pagination-bar">
                <div className="pagination-info">
                  Showing {(templatePage - 1) * PAGE_SIZE + 1}–{Math.min(templatePage * PAGE_SIZE, allTemplates.length)} of {allTemplates.length} templates
                </div>

                <div className="pagination-controls">
                  <button
                    type="button"
                    onClick={() => setTemplatePage((p) => Math.max(p - 1, 1))}
                    disabled={templatePage === 1}
                    className="pagination-nav-btn"
                  >
                    <ChevronLeft style={{ width: '0.9rem', height: '0.9rem' }} />
                    <span>Previous</span>
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setTemplatePage(pageNum)}
                      className={`pagination-page-btn ${templatePage === pageNum ? 'active' : ''}`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setTemplatePage((p) => Math.min(p + 1, totalPages))}
                    disabled={templatePage === totalPages}
                    className="pagination-nav-btn"
                  >
                    <span>Next</span>
                    <ChevronRight style={{ width: '0.9rem', height: '0.9rem' }} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 3: CONNECT YOUR AGENT ================= */}
          {currentStep === 3 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">
                  Connect Your Agent ({selectedTemplateObj?.title || 'Custom Use Case'})
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
                    onClick={() => {
                      setNumberType('international');
                      if (callingTier === 'essential') {
                        setCallingTier('premium');
                      }
                    }}
                    className={`number-card ${numberType === 'international' ? 'selected' : ''}`}
                  >
                    <div className="card-icon-box" style={{ width: '2.75rem', height: '2.75rem', margin: 0 }}>
                      <img src="/images/Frame 1010111447.png" alt="International Number" />
                    </div>
                    <div>
                      <h4 className="card-title" style={{ fontSize: '0.95rem', margin: 0 }}>
                        International Number
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        {liveInternationalNumber}
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
                      <img src="/images/Frame 1010111447 (1).png" alt="Indian Number" />
                    </div>
                    <div>
                      <h4 className="card-title" style={{ fontSize: '0.95rem', margin: 0 }}>
                        Indian Number
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        {liveIndianNumber}
                      </p>
                    </div>

                    {numberType === 'indian' && (
                      <div className="number-tooltip">
                        Optimized for domestic calls in India with ultra-low latency telecom routing.
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Calling Tiers */}
                <div className={numberType === 'international' ? 'two-col-grid' : 'three-col-grid'}>
                  {(
                    (numberType === 'international'
                      ? ['premium', 'standard']
                      : ['premium', 'standard', 'essential']
                    ) as CallingTier[]
                  ).map((tierKey) => {
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
                    className="slider-accent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 4: PROMPTS & KNOWLEDGE BASE ================= */}
          {currentStep === 4 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">Configure Prompts & Knowledge</h1>
                <p className="step-subtitle">
                  Define how your agent talks, its behavior rules, and what data it references.
                </p>
              </div>

              <div className="form-card-container">
                {/* System Prompt Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    System Prompt *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTemplateModal(true)}
                    className="btn-link-preset"
                  >
                    <LayoutTemplate style={{ width: '0.9rem', height: '0.9rem' }} />
                    <span>Use Template</span>
                  </button>
                </div>

                {/* System Prompt Textarea */}
                <textarea
                  rows={8}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are an AI assistant who..."
                  className="form-textarea"
                />

                {/* Dynamic Variables Chips */}
                <div>
                  <span className="field-hint" style={{ display: 'block', marginBottom: '0.5rem' }}>
                    Click to insert dynamic variable:
                  </span>
                  <div className="chips-container">
                    {DYNAMIC_VARIABLES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleInsertVariable(v)}
                        className="var-chip-btn"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* First Message */}
                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label className="form-label">First Message (Greeting)</label>
                  <input
                    type="text"
                    value={firstMessage}
                    onChange={(e) => setFirstMessage(e.target.value)}
                    placeholder="Hello! How can I help you today?"
                    className="form-input"
                  />
                  <span className="field-hint">
                    The initial greeting sentence the agent speaks when the call connects.
                  </span>
                </div>

                {/* Knowledge Base Checkboxes */}
                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label className="form-label">Attach Knowledge Base</label>
                  <div className="kb-items-grid">
                    {MOCK_KNOWLEDGE_BASES.map((kb) => {
                      const IconComp = kb.icon;
                      const isChecked = selectedKnowledgeBases.includes(kb.id);

                      return (
                        <div
                          key={kb.id}
                          onClick={() => toggleKnowledgeBase(kb.id)}
                          className={`kb-checkbox-card ${isChecked ? 'selected' : ''}`}
                        >
                          <div
                            style={{
                              width: '1rem',
                              height: '1rem',
                              borderRadius: '4px',
                              border: isChecked ? '1px solid #00E575' : '1px solid #475569',
                              backgroundColor: isChecked ? '#00E575' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {isChecked && <Check style={{ width: '0.75rem', height: '0.75rem', color: '#000000', strokeWidth: 4 }} />}
                          </div>

                          <IconComp style={{ width: '1.1rem', height: '1.1rem', color: isChecked ? '#00E575' : '#94a3b8', flexShrink: 0 }} />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {kb.title}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                              {kb.type}
                            </div>
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
                <h1 className="step-title">Agent Tools & Integrations</h1>
                <p className="step-subtitle">
                  Empower your agent with tools to take real-time actions during conversations.
                </p>
              </div>

              <div className="tools-categories-list">
                {AGENT_TOOL_CATEGORIES.map((cat) => (
                  <div key={cat.category} className="tool-category-card">
                    <h3 className="category-title">{cat.category}</h3>
                    <div className="tools-card-grid">
                      {cat.items.map((tool) => {
                        const isSelected = selectedTools.includes(tool.id);

                        return (
                          <div
                            key={tool.id}
                            onClick={() => toggleTool(tool.id)}
                            className={`tool-option-card ${isSelected ? 'selected' : ''}`}
                          >
                            <div className="tool-card-content">
                              <div
                                style={{
                                  width: '1.1rem',
                                  height: '1.1rem',
                                  borderRadius: '4px',
                                  border: isSelected ? '1px solid #00E575' : '1px solid #475569',
                                  backgroundColor: isSelected ? '#00E575' : 'transparent',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  marginTop: '2px',
                                }}
                              >
                                {isSelected && (
                                  <Check style={{ width: '0.8rem', height: '0.8rem', color: '#000000', strokeWidth: 4 }} />
                                )}
                              </div>

                              <div>
                                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff', margin: '0 0 0.25rem 0' }}>
                                  {tool.title}
                                </h4>
                                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                                  {tool.description}
                                </p>
                              </div>
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

          {/* ================= STEP 6: REVIEW & LAUNCH ================= */}
          {currentStep === 6 && (
            <div>
              <div className="step-header">
                <h1 className="step-title">Review & Deploy Agent</h1>
                <p className="step-subtitle">
                  Verify your configuration before launching your AI agent.
                </p>
              </div>

              <div className="review-box">
                <h3 className="review-section-title">
                  Agent Summary
                </h3>

                {/* 2-Column Specs Grid */}
                <div className="review-grid">
                  <div>
                    <span className="review-meta-label">Agent Name</span>
                    <span className="review-meta-value">{agentName || selectedTemplateObj.title + ' Agent'}</span>
                  </div>

                  <div>
                    <span className="review-meta-label">Direction & Use Case</span>
                    <span className="review-meta-value" style={{ textTransform: 'capitalize' }}>
                      {callDirection} • {selectedTemplateObj.title}
                    </span>
                  </div>

                  <div>
                    <span className="review-meta-label">Voice & Accent</span>
                    <span className="review-meta-value">
                      {VOICE_OPTIONS.find((v) => v.id === voice)?.name.split(' - ')[0] || voice} ({language})
                    </span>
                  </div>

                  <div>
                    <span className="review-meta-label">Voice Tone & Personality</span>
                    <span className="review-meta-value">{voiceTone} • {personality}</span>
                  </div>

                  <div>
                    <span className="review-meta-label">Phone Number</span>
                    <span className="review-meta-value">
                      {numberType === 'international' ? `International (${liveInternationalNumber})` : `Indian (${liveIndianNumber})`} • {TIER_DETAILS[callingTier]?.title || callingTier}
                    </span>
                  </div>

                  <div>
                    <span className="review-meta-label">Response Delay</span>
                    <span className="review-meta-value">{responseDelay} seconds</span>
                  </div>
                </div>

                {/* Section: Attached Knowledge Base */}
                <div style={{ marginTop: '0.5rem' }}>
                  <span className="review-meta-label">Knowledge Bases Attached</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                    {selectedKnowledgeBases.length > 0 ? (
                      selectedKnowledgeBases.map((kbId) => {
                        const kb = MOCK_KNOWLEDGE_BASES.find((k) => k.id === kbId);
                        return (
                          <span key={kbId} className="review-tag">
                            {kb?.title || kbId}
                          </span>
                        );
                      })
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>None attached</span>
                    )}
                  </div>
                </div>

                {/* Section: Active Agent Tools */}
                <div>
                  <span className="review-meta-label">Active Tools & Capabilities</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                    {selectedTools.length > 0 ? (
                      selectedTools.map((tId) => (
                        <span key={tId} className="review-tag active">
                          ✓ {tId.replace(/_/g, ' ')}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>No tools selected</span>
                    )}
                  </div>
                </div>

                {/* Section: System Prompt Preview */}
                <div>
                  <span className="review-meta-label">System Prompt Preview</span>
                  <div className="review-preview-box">
                    {systemPrompt || 'No prompt configured.'}
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

          {/* Fill in Variables Modal Popup */}
          {showVariableModal && activeTemplateForVars && (
            <div className="modal-backdrop">
              <div className="var-modal-dialog">
                <div className="var-modal-header">
                  <div className="var-modal-title-row">
                    <h3 className="var-modal-title">
                      <Sparkles style={{ width: '1.15rem', height: '1.15rem', color: '#00E575' }} />
                      Fill in Variables
                    </h3>
                    <button
                      onClick={() => setShowVariableModal(false)}
                      className="modal-close-btn"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="var-modal-subtitle">
                    This template uses variables. Fill in the values below to customize the prompt.
                  </p>
                </div>

                <div className="var-modal-body">
                  {getTemplateVariables(activeTemplateForVars).map((varKey) => (
                    <div key={varKey} className="var-input-group">
                      <label className="var-input-label">
                        {`{{${varKey}}}`}
                      </label>
                      <input
                        type="text"
                        value={variableValues[varKey] || ''}
                        onChange={(e) =>
                          setVariableValues((prev) => ({
                            ...prev,
                            [varKey]: e.target.value,
                          }))
                        }
                        placeholder={`Enter ${varKey}...`}
                        className="var-input-field"
                      />
                    </div>
                  ))}
                </div>

                <div className="var-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowVariableModal(false)}
                    className="var-btn-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplateDirectly(activeTemplateForVars, variableValues)}
                    className="var-btn-apply"
                  >
                    Apply Template
                  </button>
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
                  {allTemplates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      onClick={() => {
                        setSystemPrompt(tmpl.systemPrompt);
                        setFirstMessage(tmpl.firstMessage);
                        setSelectedUseCase(tmpl.id);
                        if (tmpl.suggestedVoiceTone) setVoiceTone(tmpl.suggestedVoiceTone);
                        if (tmpl.suggestedPersonality) setPersonality(tmpl.suggestedPersonality);
                        setShowTemplateModal(false);
                      }}
                      className="template-pick-card"
                    >
                      <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 4px 0' }}>
                        <span>{tmpl.name}</span>
                        <span style={{ fontSize: '0.7rem', color: '#00E575', background: 'rgba(0, 229, 117, 0.1)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>{tmpl.category}</span>
                      </h4>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.45, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                        {tmpl.systemPrompt || tmpl.description}
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
