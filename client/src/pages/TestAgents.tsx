import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
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
  Trash2,
  Search,
  Bot,
  ExternalLink,
  Layers,
  Loader2,
  Play,
  Volume2,
  Sliders,
  Edit,
  Pencil,
  ChevronDown,
  ChevronUp,
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
import { queryClient, apiRequest } from '@/lib/queryClient';
import { SUPPORTED_LANGUAGES, getLanguageLabel, isProviderSupported } from "@/lib/languages";
import { LanguageOptionLabel } from "@/components/LanguageProviderBadges";
import VoiceSearchPicker from '@/components/VoiceSearchPicker';
import VoicePreviewButton from '@/components/VoicePreviewButton';
import OpenAIVoicePreviewButton from '@/components/OpenAIVoicePreviewButton';
import './TestAgents.css';

type CallDirection = 'inbound' | 'outbound';
type NumberType = 'international' | 'indian';
export type TelephonyProviderKey =
  | 'twilio'
  | 'twilio_openai'
  | 'plivo_elevenlabs'
  | 'plivo'
  | 'custom-voice-engine';

export interface TelephonyProviderOption {
  id: TelephonyProviderKey;
  title: string;
  badge?: string;
  description: string;
  credits: string;
  tooltip: string;
}

export const INTERNATIONAL_TELEPHONY_OPTIONS: TelephonyProviderOption[] = [
  {
    id: 'twilio',
    title: 'Premium Calling',
    credits: '10 Credits/min',
    tooltip:
      'Highest-quality, natural-sounding conversations with advanced voices and faster responses. Best for sales, demos, and high-value customer calls.',
  },
  {
    id: 'twilio_openai',
    title: 'Standard Calling',
    credits: '6 Credits/min',
    tooltip:
      'Balanced conversational AI voice performance, fast latency and optimized per-minute cost.',
  },
];

export const INDIAN_TELEPHONY_OPTIONS: TelephonyProviderOption[] = [
  {
    id: 'plivo_elevenlabs',
    title: 'Premium Calling',
    credits: '10 Credits/min',
    tooltip:
      'Highest-quality, natural-sounding conversations with advanced voices and faster responses. Best for sales, demos, and high-value customer calls.',
  },
  {
    id: 'plivo',
    title: 'Standard Calling',
    credits: '6 Credits/min',
    tooltip:
      'Balanced conversational AI voice performance, fast latency and optimized per-minute cost.',
  },
  {
    id: 'custom-voice-engine',
    title: 'Essential Calling',
    credits: '4 Credits/min',
    tooltip:
      'High efficiency multi-lingual regional voice models for volume calling.',
  },
];

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

const VOICE_OPTIONS = [
  { id: 'roger', name: 'Roger - Laid-Back, Casual, Resonant' },
  { id: 'coral', name: 'Ananya - Natural, Warm, Female Executive' },
  { id: 'sarah', name: 'Sarah - Clear, Professional, Confident' },
  { id: 'jessica', name: 'Jessica - Expressive, Friendly' },
  { id: 'shimmer', name: 'Priya - Polite, Fluent Hindi/Hinglish' },
  { id: 'echo', name: 'David - Deep, Authoritative' },
];

const OPENAI_VOICES = [
  { value: 'alloy', label: 'Alloy', description: 'Neutral, balanced voice' },
  { value: 'echo', label: 'Echo', description: 'Warm, conversational voice' },
  { value: 'shimmer', label: 'Shimmer', description: 'Clear, expressive voice' },
  { value: 'ash', label: 'Ash', description: 'Soft, gentle voice' },
  { value: 'ballad', label: 'Ballad', description: 'Melodic, storytelling voice' },
  { value: 'coral', label: 'Coral', description: 'Bright, energetic voice' },
  { value: 'sage', label: 'Sage', description: 'Authoritative, professional voice' },
  { value: 'verse', label: 'Verse', description: 'Dynamic, rhythmic voice' },
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
  const [, setLocation] = useLocation();
  const [isCreating, setIsCreating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [callDirection, setCallDirection] = useState<CallDirection>('inbound');
  const [selectedUseCase, setSelectedUseCase] = useState<string>(ALL_SYSTEM_TEMPLATES[0].id);
  const [templatePage, setTemplatePage] = useState(1);

  // Agent List View States (Step 0)
  const [agentSearch, setAgentSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [agentListPage, setAgentListPage] = useState(1);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<any | null>(null);

  // Auto-reset page to 1 when search query or category filter changes
  useEffect(() => {
    setAgentListPage(1);
  }, [agentSearch, agentFilter]);

  // Step 3 Form States
  const [agentName, setAgentName] = useState('');
  const [numberType, setNumberType] = useState<NumberType>('international');
  const [telephonyProvider, setTelephonyProvider] = useState<TelephonyProviderKey>('twilio');
  const [language, setLanguage] = useState('en');
  const [voice, setVoice] = useState('21m00Tcm4TlvDq8ikWAM');
  const [voiceTone, setVoiceTone] = useState('Confident');
  const [personality, setPersonality] = useState('Professional');
  const [responseDelay, setResponseDelay] = useState<number>(1.5);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

  // Auto-validate language and voice support when telephony provider changes
  useEffect(() => {
    const isEleven = telephonyProvider === 'twilio' || telephonyProvider === 'plivo_elevenlabs';
    const pType = isEleven ? 'elevenlabs' : 'openai';
    const isSupported = telephonyProvider === 'custom-voice-engine'
      ? ['en', 'es', 'de', 'fr', 'nl', 'it', 'ja'].includes(language)
      : isProviderSupported(language, pType);
    if (!isSupported) {
      setLanguage('en');
    }

    if (telephonyProvider === 'twilio_openai' || telephonyProvider === 'plivo') {
      const isOpenAiVoice = OPENAI_VOICES.some((v) => v.value === voice);
      if (!isOpenAiVoice) {
        setVoice('shimmer');
      }
    } else if (isEleven) {
      const isOpenAiVoice = OPENAI_VOICES.some((v) => v.value === voice);
      if (isOpenAiVoice) {
        setVoice('21m00Tcm4TlvDq8ikWAM');
      }
    }
  }, [telephonyProvider]);

  const { data: elevenLabsVoices = [] } = useQuery<any[]>({
    queryKey: ['/api/elevenlabs/voices'],
    staleTime: 60000,
  });

  const activeTelephonyOptions = useMemo(() => {
    return numberType === 'international'
      ? INTERNATIONAL_TELEPHONY_OPTIONS
      : INDIAN_TELEPHONY_OPTIONS;
  }, [numberType]);

  const activeTelephonyOption = useMemo(() => {
    return (
      activeTelephonyOptions.find((o) => o.id === telephonyProvider) ||
      activeTelephonyOptions[0]
    );
  }, [activeTelephonyOptions, telephonyProvider]);

  const selectedVoiceName = useMemo(() => {
    if (telephonyProvider === 'twilio_openai' || telephonyProvider === 'plivo') {
      const found = OPENAI_VOICES.find((v) => v.value === voice);
      return found ? found.label : voice;
    }
    const foundEl = elevenLabsVoices.find((v: any) => v.voice_id === voice);
    if (foundEl) return foundEl.name;
    const foundLegacy = VOICE_OPTIONS.find((v) => v.id === voice);
    if (foundLegacy) return foundLegacy.name.split(' - ')[0];
    return voice || 'Default Voice';
  }, [telephonyProvider, voice, elevenLabsVoices]);

  // Step 4 Form States (Configure Prompts)
  const [systemPrompt, setSystemPrompt] = useState(ALL_SYSTEM_TEMPLATES[0].systemPrompt);
  const [firstMessage, setFirstMessage] = useState(ALL_SYSTEM_TEMPLATES[0].firstMessage);
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<string[]>(['kb-1']);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [expandedSystemPrompt, setExpandedSystemPrompt] = useState(false);
  const [expandedFirstMessage, setExpandedFirstMessage] = useState(false);

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

  // Fetch all created agents across standard and custom voice engine
  const { data: standardAgents = [], isLoading: standardLoading } = useQuery<any[]>({
    queryKey: ['/api/agents'],
  });

  const { data: cveAgents = [], isLoading: cveLoading } = useQuery<any[]>({
    queryKey: ['/api/voice-engine/agents'],
    queryFn: async () => {
      try {
        const headers: Record<string, string> = {};
        const authHeader = AuthStorage.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;
        const res = await fetch('/api/voice-engine/agents', { headers });
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
  });

  const allUserAgents = useMemo(() => {
    const list: any[] = [];
    if (Array.isArray(standardAgents)) {
      list.push(...standardAgents.map((a: any) => ({ ...a, source: 'standard' })));
    }
    if (Array.isArray(cveAgents)) {
      list.push(...cveAgents.map((a: any) => ({ ...a, source: 'cve' })));
    }
    return list;
  }, [standardAgents, cveAgents]);

  const filteredAgents = useMemo(() => {
    return allUserAgents.filter((agent) => {
      const q = agentSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        (agent.name || '').toLowerCase().includes(q) ||
        (agent.systemPrompt || '').toLowerCase().includes(q) ||
        (agent.language || '').toLowerCase().includes(q) ||
        (agent.telephonyProvider || '').toLowerCase().includes(q);

      if (!matchSearch) return false;

      if (agentFilter === 'inbound') {
        return agent.type === 'incoming' || !agent.type;
      }
      if (agentFilter === 'outbound') {
        return agent.type === 'flow' || agent.type === 'outbound';
      }
      return true;
    });
  }, [allUserAgents, agentSearch, agentFilter]);

  const AGENTS_PER_PAGE = 9;
  const totalAgentPages = Math.max(1, Math.ceil(filteredAgents.length / AGENTS_PER_PAGE));

  const paginatedAgents = useMemo(() => {
    const start = (agentListPage - 1) * AGENTS_PER_PAGE;
    return filteredAgents.slice(start, start + AGENTS_PER_PAGE);
  }, [filteredAgents, agentListPage]);

  const handleDeleteAgent = async (agent: any) => {
    if (!window.confirm(`Are you sure you want to delete "${agent.name}"?`)) return;
    try {
      setDeletingAgentId(agent.id);
      const endpoint =
        agent.source === 'cve'
          ? `/api/voice-engine/agents/${agent.id}`
          : `/api/agents/${agent.id}`;
      await apiRequest('DELETE', endpoint);
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/voice-engine/agents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents/metrics'] });
      toast({
        title: 'Agent deleted',
        description: `"${agent.name}" was removed successfully.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error deleting agent',
        description: err.message || 'Failed to delete agent',
        variant: 'destructive',
      });
    } finally {
      setDeletingAgentId(null);
    }
  };

  const handleEditAgent = (agent: any) => {
    setEditingAgent(agent);
    setAgentName(agent.name || '');
    setCallDirection(agent.type === 'flow' || agent.type === 'outbound' ? 'outbound' : 'inbound');

    const prov = (agent.telephonyProvider || (agent.source === 'cve' ? 'custom-voice-engine' : 'twilio')) as TelephonyProviderKey;
    setTelephonyProvider(prov);
    setNumberType(
      prov === 'plivo' || prov === 'plivo_elevenlabs' || prov === 'custom-voice-engine'
        ? 'indian'
        : 'international'
    );
    setLanguage(agent.language || 'en');
    setVoice(agent.openaiVoice || agent.ttsVoice || agent.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM');
    setVoiceTone(agent.voiceTone || 'Confident');
    setPersonality(agent.personality || 'Professional');
    setResponseDelay(agent.turnTimeout || 1.5);
    setSystemPrompt(agent.systemPrompt || '');
    setFirstMessage(agent.firstMessage || '');
    setSelectedKnowledgeBases(agent.knowledgeBaseIds || ['kb-1']);

    const tools: string[] = [];
    if (agent.transferEnabled) tools.push('call_transfer');
    if (agent.appointmentBookingEnabled) tools.push('appointment_booking');
    if (agent.endConversationEnabled) tools.push('end_conversation');
    if (agent.messagingEmailEnabled) tools.push('email_sending');
    if (agent.messagingWhatsappEnabled) tools.push('whatsapp_messaging');
    setSelectedTools(tools.length > 0 ? tools : ['call_transfer', 'end_conversation']);

    setCurrentStep(3);
    setIsCreating(true);
  };

  const getAgentProviderInfo = (agent: any) => {
    if (agent.source === 'cve' || agent.telephonyProvider === 'custom-voice-engine') {
      return {
        tier: 'Essential Calling',
        engine: 'Custom Voice Engine',
        badgeColor: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.12)',
        border: 'rgba(56, 189, 248, 0.3)',
      };
    }
    if (agent.telephonyProvider === 'twilio_openai') {
      return {
        tier: 'Standard Calling',
        engine: 'Twilio + OpenAI Realtime',
        badgeColor: '#a78bfa',
        bg: 'rgba(167, 139, 250, 0.12)',
        border: 'rgba(167, 139, 250, 0.3)',
      };
    }
    if (agent.telephonyProvider === 'plivo_elevenlabs') {
      return {
        tier: 'Premium Calling',
        engine: 'Plivo + ElevenLabs',
        badgeColor: '#00E575',
        bg: 'rgba(0, 229, 117, 0.12)',
        border: 'rgba(0, 229, 117, 0.3)',
      };
    }
    if (agent.telephonyProvider === 'plivo') {
      return {
        tier: 'Standard Calling',
        engine: 'Plivo + OpenAI',
        badgeColor: '#fb923c',
        bg: 'rgba(251, 146, 60, 0.12)',
        border: 'rgba(251, 146, 60, 0.3)',
      };
    }
    return {
      tier: 'Premium Calling',
      engine: 'Twilio + ElevenLabs',
      badgeColor: '#00E575',
      bg: 'rgba(0, 229, 117, 0.12)',
      border: 'rgba(0, 229, 117, 0.3)',
    };
  };

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
      const name = (apiTmpl.name || '').trim().toLowerCase();
      const exists = merged.find((t) => t.name.toLowerCase() === name || t.id === apiTmpl.id);
      if (!exists) {
        const sysPrompt = apiTmpl.systemPrompt || apiTmpl.system_prompt || apiTmpl.prompt || '';
        const firstMsg = apiTmpl.firstMessage || apiTmpl.first_message || '';
        let vars: string[] = [];
        if (Array.isArray(apiTmpl.variables)) {
          vars = apiTmpl.variables;
        } else if (typeof apiTmpl.variables === 'string') {
          try {
            vars = JSON.parse(apiTmpl.variables);
          } catch {
            vars = [];
          }
        }
        merged.push({
          id: apiTmpl.id || `custom-${apiTmpl.name}`,
          name: apiTmpl.name,
          title: apiTmpl.name,
          category: apiTmpl.category || 'Custom',
          description: apiTmpl.description || 'Custom prompt template for conversational AI agent.',
          icon: GitFork,
          systemPrompt: sysPrompt,
          firstMessage: firstMsg,
          variables: vars.length > 0 ? vars : ['company_name', 'agent_name'],
          suggestedVoiceTone: apiTmpl.suggestedVoiceTone || 'Confident',
          suggestedPersonality: apiTmpl.suggestedPersonality || 'Professional',
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
    const raw = ((tmpl.systemPrompt || '') + ' ' + (tmpl.firstMessage || '')).match(/\{\{([a-zA-Z0-9_-]+)\}\}/g) || [];
    const extracted = raw.map((m) => m.replace(/[{}]/g, ''));
    const declared = Array.isArray(tmpl.variables) ? tmpl.variables : [];
    const combined = Array.from(new Set([...declared, ...extracted]));
    if (combined.length > 0) return combined;
    return ['company_name', 'agent_name'];
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
      const finalAgentName = agentName.trim() || `${selectedTemplateObj.title} Agent`;
      const isCve = telephonyProvider === 'custom-voice-engine';
      const isOpenAI = telephonyProvider === 'twilio_openai' || telephonyProvider === 'plivo';
      const isElevenLabs = telephonyProvider === 'twilio' || telephonyProvider === 'plivo_elevenlabs';

      const transferPhone = (numberType === 'international' ? liveInternationalNumber : liveIndianNumber) || '+15678901234';

      let payload: any;
      let endpoint = '';
      let method = 'POST';

      if (isCve) {
        payload = {
          name: finalAgentName,
          description: selectedTemplateObj.description || '',
          systemPrompt: systemPrompt,
          firstMessage: firstMessage || 'Hello! How can I help you today?',
          language: language || 'en',
          llmModel: 'openai/gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 500,
          ttsVoice: voice || 'aura-asteria-en',
          ttsProvider: 'deepgram',
          sttProvider: 'deepgram',
          interruptible: true,
          silenceTimeoutMs: 5000,
          maxDurationSeconds: 600,
          type: 'incoming',
          knowledgeBaseIds: selectedKnowledgeBases || [],
          transferEnabled: selectedTools.includes('call_transfer'),
          transferPhoneNumber: selectedTools.includes('call_transfer') ? transferPhone : '',
          appointmentBookingEnabled: selectedTools.includes('appointment_booking'),
          endConversationEnabled: selectedTools.includes('end_conversation'),
          messagingEmailEnabled: selectedTools.includes('email_sending'),
          messagingWhatsappEnabled: selectedTools.includes('whatsapp_messaging'),
        };
      } else {
        payload = {
          type: 'incoming',
          name: finalAgentName,
          voiceTone: voiceTone || 'Confident',
          personality: personality || 'Professional',
          systemPrompt: systemPrompt,
          firstMessage: firstMessage || 'Hello! How can I help you today?',
          language: language || 'en',
          llmModel: 'gpt-4o-mini',
          temperature: 0.7,
          voiceStability: 0.5,
          voiceSimilarityBoost: 0.85,
          voiceSpeed: 1.0,
          turnTimeout: responseDelay || 1.5,
          telephonyProvider: telephonyProvider,
          elevenLabsVoiceId: isElevenLabs ? (voice || '21m00Tcm4TlvDq8ikWAM') : undefined,
          openaiVoice: isOpenAI ? (voice || 'shimmer') : undefined,
          openaiModel: isOpenAI ? 'gpt-realtime-1.5' : undefined,
          knowledgeBaseIds: selectedKnowledgeBases || [],
          transferEnabled: selectedTools.includes('call_transfer'),
          transferPhoneNumber: selectedTools.includes('call_transfer') ? transferPhone : '',
          endConversationEnabled: selectedTools.includes('end_conversation'),
          appointmentBookingEnabled: selectedTools.includes('appointment_booking'),
          messagingEmailEnabled: selectedTools.includes('email_sending'),
          messagingWhatsappEnabled: selectedTools.includes('whatsapp_messaging'),
          detectLanguageEnabled: false,
        };
      }

      if (editingAgent) {
        if (isCve || editingAgent.source === 'cve') {
          endpoint = `/api/voice-engine/agents/${editingAgent.id}`;
          method = 'PUT';
        } else {
          endpoint = `/api/agents/${editingAgent.id}`;
          method = 'PATCH';
        }
      } else {
        endpoint = isCve ? '/api/voice-engine/agents' : '/api/agents';
        method = 'POST';
      }

      const res = await apiRequest(method, endpoint, payload);
      await res.json();

      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents/metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/voice-engine/agents'] });

      toast({
        title: editingAgent ? 'Agent Updated Successfully! ✨' : 'Agent Created Successfully! 🎉',
        description: editingAgent
          ? `Your agent "${finalAgentName}" has been updated.`
          : `Your agent "${finalAgentName}" is now active and ready for campaigns and calls.`,
      });

      setTimeout(() => {
        setIsCreating(false);
        setEditingAgent(null);
        setCurrentStep(1);
        setIsSubmitting(false);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to save agent:', err);
      toast({
        title: editingAgent ? 'Error updating agent' : 'Error creating agent',
        description: err.message || 'Something went wrong while saving the agent. Please try again.',
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  // Handle click on "+ Create Agents"
  const handleStartCreate = () => {
    setEditingAgent(null);
    setAgentName('');
    setSystemPrompt(ALL_SYSTEM_TEMPLATES[0].systemPrompt);
    setFirstMessage(ALL_SYSTEM_TEMPLATES[0].firstMessage);
    setSelectedTools(['call_transfer', 'end_conversation']);
    setSelectedKnowledgeBases(['kb-1']);
    setIsCreating(true);
    setCurrentStep(1);
  };

  // Handle Back button in wizard
  const handleBack = () => {
    if (currentStep === 1 || (editingAgent && currentStep === 3)) {
      setIsCreating(false);
      setEditingAgent(null);
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button className="create-agent-btn" onClick={handleStartCreate}>
                <Plus style={{ width: '1rem', height: '1rem', strokeWidth: 3 }} />
                <span>Create Agents</span>
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="agent-filter-toolbar">
            <div className="agent-search-box">
              <Search className="search-icon" style={{ width: '1rem', height: '1rem', color: '#94a3b8' }} />
              <input
                type="text"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Search agents by name, prompt, or language..."
                className="agent-search-input"
              />
              {agentSearch && (
                <button
                  type="button"
                  onClick={() => setAgentSearch('')}
                  className="search-clear-btn"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="agent-filter-pills">
              <button
                type="button"
                onClick={() => setAgentFilter('all')}
                className={`filter-pill-btn ${agentFilter === 'all' ? 'active' : ''}`}
              >
                All Agents ({allUserAgents.length})
              </button>
              <button
                type="button"
                onClick={() => setAgentFilter('inbound')}
                className={`filter-pill-btn ${agentFilter === 'inbound' ? 'active' : ''}`}
              >
                Inbound ({allUserAgents.filter((a) => a.type === 'incoming' || !a.type).length})
              </button>
              <button
                type="button"
                onClick={() => setAgentFilter('outbound')}
                className={`filter-pill-btn ${agentFilter === 'outbound' ? 'active' : ''}`}
              >
                Outbound ({allUserAgents.filter((a) => a.type === 'flow' || a.type === 'outbound').length})
              </button>
            </div>
          </div>

          {/* Loading State */}
          {(standardLoading || cveLoading) && (
            <div className="agent-loading-grid">
              {[1, 2, 3].map((n) => (
                <div key={n} className="agent-skeleton-card">
                  <div className="skeleton-line title" />
                  <div className="skeleton-line subtitle" />
                  <div className="skeleton-box" />
                </div>
              ))}
            </div>
          )}

          {/* Empty State: When no agents exist at all */}
          {!(standardLoading || cveLoading) && allUserAgents.length === 0 && (
            <div className="empty-state-box">
              <div className="empty-state-icon">
                <Bot style={{ width: '2.25rem', height: '2.25rem', color: '#00E575' }} />
              </div>
              <h3 className="empty-state-title">No AI Agents created yet</h3>
              <p className="empty-state-desc">
                Get started by launching our multi-step creation wizard to build your first intelligent conversational AI agent.
              </p>
              <button className="create-agent-btn" onClick={handleStartCreate}>
                <Plus style={{ width: '1rem', height: '1rem', strokeWidth: 3 }} />
                <span>+ Create Your First Agent</span>
              </button>
            </div>
          )}

          {/* Filter Empty State: When search returns 0 results */}
          {!(standardLoading || cveLoading) && allUserAgents.length > 0 && filteredAgents.length === 0 && (
            <div className="empty-state-box">
              <div className="empty-state-icon">
                <Search style={{ width: '2rem', height: '2rem', color: '#94a3b8' }} />
              </div>
              <h3 className="empty-state-title">No agents match your filter</h3>
              <p className="empty-state-desc">
                No agents found matching &quot;{agentSearch}&quot;. Try adjusting your search query or filter tab.
              </p>
              <button
                type="button"
                className="btn-clear-search"
                onClick={() => {
                  setAgentSearch('');
                  setAgentFilter('all');
                }}
              >
                Clear Search & Filters
              </button>
            </div>
          )}

          {/* Real Created Agents Grid */}
          {!(standardLoading || cveLoading) && filteredAgents.length > 0 && (
            <>
              <div className="created-agents-grid">
                {paginatedAgents.map((agent: any) => {
                  const prov = getAgentProviderInfo(agent);
                  const isInbound = agent.type === 'incoming' || !agent.type;
                  const isDeleting = deletingAgentId === agent.id;

                  const activeTools = [
                    agent.transferEnabled && 'Call Transfer',
                    agent.appointmentBookingEnabled && 'Booking',
                    agent.endConversationEnabled && 'End Call',
                    agent.messagingEmailEnabled && 'Email',
                    agent.messagingWhatsappEnabled && 'WhatsApp',
                    agent.detectLanguageEnabled && 'Auto-Language',
                  ].filter(Boolean) as string[];

                  return (
                    <div key={agent.id} className="created-agent-card">
                      {/* Card Top Row */}
                      <div className="agent-card-header">
                        <div className="agent-card-title-group">
                          <div className="agent-avatar-icon">
                            <Bot style={{ width: '1.25rem', height: '1.25rem', color: '#00E575' }} />
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <h3 className="agent-card-name">{agent.name}</h3>
                              <span className={`direction-badge ${isInbound ? 'inbound' : 'outbound'}`}>
                                {isInbound ? 'Inbound' : 'Outbound'}
                              </span>
                            </div>
                            <span className="agent-created-date">
                              {agent.createdAt ? new Date(agent.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Ready'}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditAgent(agent);
                            }}
                            title="Edit Agent"
                            className="agent-edit-btn"
                          >
                            <Pencil style={{ width: '0.85rem', height: '0.85rem' }} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAgent(agent);
                            }}
                            disabled={isDeleting}
                            title="Delete Agent"
                            className="agent-delete-btn"
                          >
                            {isDeleting ? (
                              <Loader2 style={{ width: '1rem', height: '1rem', animation: 'spin 1s linear infinite' }} />
                            ) : (
                              <Trash2 style={{ width: '1rem', height: '1rem' }} />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Metadata & Engine Badges */}
                      <div className="agent-meta-pills">
                        <div
                          className="meta-pill provider-pill"
                          style={{
                            background: prov.bg,
                            borderColor: prov.border,
                            color: prov.badgeColor,
                          }}
                        >
                          <Sparkles style={{ width: '0.75rem', height: '0.75rem' }} />
                          <span>{prov.tier} ({prov.engine})</span>
                        </div>

                        <div className="meta-pill lang-pill">
                          <Globe style={{ width: '0.75rem', height: '0.75rem', color: '#60a5fa' }} />
                          <span>{getLanguageLabel(agent.language || 'en')}</span>
                        </div>

                        {(agent.openaiVoice || agent.ttsVoice || agent.elevenLabsVoiceId) && (
                          <div className="meta-pill voice-pill">
                            <Volume2 style={{ width: '0.75rem', height: '0.75rem', color: '#34d399' }} />
                            <span className="truncate-text" style={{ maxWidth: '120px' }}>
                              {agent.openaiVoice || agent.ttsVoice || (agent.elevenLabsVoiceId ? 'ElevenLabs' : 'Voice')}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* System Prompt / First Message Preview */}
                      <div className="agent-prompt-preview">
                        <div className="prompt-preview-header">
                          <MessageSquare style={{ width: '0.8rem', height: '0.8rem', color: '#10b981' }} />
                          <span>Prompt Preview</span>
                        </div>
                        <p className="prompt-preview-text">
                          {agent.firstMessage || agent.systemPrompt || 'No initial prompt configured.'}
                        </p>
                      </div>

                      {/* Active Tools Tags */}
                      {activeTools.length > 0 && (
                        <div className="agent-tools-row">
                          {activeTools.map((toolName) => (
                            <span key={toolName} className="agent-tool-tag">
                              <span className="tool-dot" />
                              {toolName}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Card Footer Actions */}
                      <div className="agent-card-footer">
                        <div className="agent-model-info">
                          <Cpu style={{ width: '0.8rem', height: '0.8rem', color: '#94a3b8' }} />
                          <span>{agent.llmModel || 'gpt-4o-mini'}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setLocation('/app/campaigns')}
                          className="btn-use-campaign"
                        >
                          <span>Use in Campaign</span>
                          <ArrowRight style={{ width: '0.85rem', height: '0.85rem' }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Agent List Pagination Controls (9 items per page) */}
              {filteredAgents.length > AGENTS_PER_PAGE && (
                <div className="template-pagination-bar" style={{ marginTop: '2rem' }}>
                  <div className="pagination-info">
                    Showing {(agentListPage - 1) * AGENTS_PER_PAGE + 1}–{Math.min(agentListPage * AGENTS_PER_PAGE, filteredAgents.length)} of {filteredAgents.length} agents
                  </div>

                  <div className="pagination-controls">
                    <button
                      type="button"
                      onClick={() => {
                        setAgentListPage((p) => Math.max(p - 1, 1));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={agentListPage === 1}
                      className="pagination-nav-btn"
                    >
                      <ChevronLeft style={{ width: '0.9rem', height: '0.9rem' }} />
                      <span>Previous</span>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      {Array.from({ length: totalAgentPages }, (_, i) => i + 1).map((pageNum) => (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => {
                            setAgentListPage(pageNum);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={`pagination-page-btn ${agentListPage === pageNum ? 'active' : ''}`}
                        >
                          {pageNum}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAgentListPage((p) => Math.min(p + 1, totalAgentPages));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={agentListPage === totalAgentPages}
                      className="pagination-nav-btn"
                    >
                      <span>Next</span>
                      <ChevronRight style={{ width: '0.9rem', height: '0.9rem' }} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
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
                      if (telephonyProvider !== 'twilio' && telephonyProvider !== 'twilio_openai') {
                        setTelephonyProvider('twilio');
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
                  </div>

                  {/* Indian Number */}
                  <div
                    onClick={() => {
                      setNumberType('indian');
                      if (
                        telephonyProvider !== 'plivo_elevenlabs' &&
                        telephonyProvider !== 'plivo' &&
                        telephonyProvider !== 'custom-voice-engine'
                      ) {
                        setTelephonyProvider('plivo_elevenlabs');
                      }
                    }}
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
                  </div>
                </div>

                {/* 3. Calling Tiers */}
                <div className={numberType === 'international' ? 'two-col-grid' : 'three-col-grid'}>
                  {activeTelephonyOptions.map((opt) => {
                    const isSelected = telephonyProvider === opt.id;

                    return (
                      <div
                        key={opt.id}
                        onClick={() => setTelephonyProvider(opt.id)}
                        className={`tier-card ${isSelected ? 'selected' : ''}`}
                      >
                        <div>
                          <h4 className="tier-title">{opt.title}</h4>
                          <p className="tier-credits">{opt.credits}</p>
                        </div>

                        <div
                          className="info-tooltip-btn"
                          onMouseEnter={() => setHoveredTooltip(opt.id)}
                          onMouseLeave={() => setHoveredTooltip(null)}
                        >
                          <Info style={{ width: '0.85rem', height: '0.85rem' }} />

                          {hoveredTooltip === opt.id && (
                            <div className="tier-popup-tooltip">{opt.tooltip}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4. Language & Voice Dropdowns */}
                <div className="two-col-grid">
                  <div className="form-group">
                    <label className="form-label">
                      <span>Language</span>
                      <span className="form-label-required">*</span>
                    </label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                        <SelectValue placeholder="Select Language">
                          {SUPPORTED_LANGUAGES.find((l) => l.value === language) ? (
                            <LanguageOptionLabel
                              label={SUPPORTED_LANGUAGES.find((l) => l.value === language)!.label}
                              providers={telephonyProvider === 'custom-voice-engine' ? [] : SUPPORTED_LANGUAGES.find((l) => l.value === language)!.providers}
                              compact
                            />
                          ) : (
                            getLanguageLabel(language)
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff', maxHeight: '280px', overflowY: 'auto' }}>
                        {SUPPORTED_LANGUAGES
                          .filter((lang) => {
                            if (telephonyProvider === 'custom-voice-engine') {
                              const deepgramTtsLangs = ['en', 'es', 'de', 'fr', 'nl', 'it', 'ja'];
                              return deepgramTtsLangs.includes(lang.value);
                            }
                            const isElevenLabs = telephonyProvider === 'twilio' || telephonyProvider === 'plivo_elevenlabs';
                            const providerType = isElevenLabs ? 'elevenlabs' : 'openai';
                            return isProviderSupported(lang.value, providerType);
                          })
                          .map((lang) => (
                            <SelectItem key={lang.value} value={lang.value}>
                              <LanguageOptionLabel
                                label={lang.label}
                                providers={telephonyProvider === 'custom-voice-engine' ? [] : lang.providers}
                                compact
                              />
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.375rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                      <Info style={{ width: '0.875rem', height: '0.875rem', color: '#3b82f6', flexShrink: 0, marginTop: '2px' }} />
                      <span>Provide the system prompt and first message in the selected language for better performance and higher accuracy.</span>
                    </p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      <span>Voice</span>
                      <span className="form-label-required">*</span>
                    </label>
                    {telephonyProvider === 'twilio_openai' || telephonyProvider === 'plivo' ? (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Select value={voice} onValueChange={setVoice}>
                            <SelectTrigger className="form-input" style={{ height: '3rem' }}>
                              <SelectValue placeholder="Select Voice" />
                            </SelectTrigger>
                            <SelectContent style={{ backgroundColor: '#141822', borderColor: '#222836', color: '#ffffff' }}>
                              {OPENAI_VOICES.map((v) => (
                                <SelectItem key={v.value} value={v.value}>
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontWeight: 500 }}>{v.label}</span>
                                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{v.description}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <OpenAIVoicePreviewButton
                          voiceId={voice}
                          voiceName={OPENAI_VOICES.find((v) => v.value === voice)?.label}
                          speed={1.0}
                          language={language || 'en'}
                          previewText={firstMessage || 'Hello! Thank you for calling. How can I help you today?'}
                          className="h-12 w-12 border-[#222836] bg-[#141822] text-white hover:bg-[#1a202c] hover:text-white rounded-lg"
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <VoiceSearchPicker
                            value={voice}
                            onChange={(voiceId) => setVoice(voiceId)}
                            placeholder="Select a voice..."
                            className="h-12 bg-[#141822] border-[#222836] text-white hover:bg-[#1a202c] hover:text-white rounded-lg"
                          />
                        </div>
                        <VoicePreviewButton
                          voiceId={voice}
                          previewText={firstMessage || 'Hello! Thank you for calling. How can I help you today?'}
                          language={language || 'en'}
                          compact
                        />
                      </div>
                    )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="step-header" style={{ marginBottom: '0.5rem' }}>
                <h1 className="step-title">Configure Prompts</h1>
                <p className="step-subtitle">
                  Customize what your agent says and how it behaves
                </p>
              </div>

              {/* 1. System Prompt Card */}
              <div className="form-card-container">
                <div className="prompt-split-grid">
                  {/* Left Column: Textarea & Header */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                          System Prompt
                        </h3>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                          Define your agent's role, responsibilities, tone and behavior.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTemplateModal(true)}
                        className="template-btn"
                      >
                        <LayoutTemplate style={{ width: '0.95rem', height: '0.95rem' }} />
                        <span>Use Template</span>
                      </button>
                    </div>

                    <div style={{ marginTop: '0.35rem' }}>
                      <textarea
                        rows={7}
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="Write the system prompt here..."
                        className="form-textarea"
                        maxLength={4000}
                      />
                      <div className="char-counter">
                        {systemPrompt.length}/4000
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Tips Box */}
                  <div className="tips-container-box">
                    <div className="tips-title">
                      <Sparkles style={{ width: '1.05rem', height: '1.05rem' }} />
                      <span>Tips for a great system prompt</span>
                    </div>
                    <ul className="tips-list">
                      <li className="tips-item">
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#00E575', flexShrink: 0, marginTop: '1px' }} />
                        <span>Clearly define the agent's role</span>
                      </li>
                      <li className="tips-item">
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#00E575', flexShrink: 0, marginTop: '1px' }} />
                        <span>Include key responsibilities</span>
                      </li>
                      <li className="tips-item">
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#00E575', flexShrink: 0, marginTop: '1px' }} />
                        <span>Mention tone and communication style</span>
                      </li>
                      <li className="tips-item">
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#00E575', flexShrink: 0, marginTop: '1px' }} />
                        <span>Add do's and don'ts</span>
                      </li>
                      <li className="tips-item">
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#00E575', flexShrink: 0, marginTop: '1px' }} />
                        <span>Use dynamic variable where needed</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* 2. First Message Card */}
              <div className="form-card-container">
                <div className="prompt-split-grid">
                  {/* Left Column: First Message Textarea & Header */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                        First Message
                      </h3>
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        This is the first message your agent will say to start the conversion
                      </p>
                    </div>

                    <div style={{ marginTop: '0.35rem' }}>
                      <textarea
                        rows={4}
                        value={firstMessage}
                        onChange={(e) => setFirstMessage(e.target.value)}
                        placeholder="Write the first message here..."
                        className="form-textarea"
                        maxLength={500}
                      />
                      <div className="char-counter">
                        {firstMessage.length}/500
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Example Box */}
                  <div className="example-container-box">
                    <div className="tips-title" style={{ color: '#00E575' }}>
                      <MessageSquare style={{ width: '1rem', height: '1rem' }} />
                      <span>Tips for a great system prompt</span>
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
              <div className="form-card-container">
                <div className="prompt-split-grid">
                  {/* Left Column: Variables Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                        Available Dynamic Variables
                      </h3>
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                        Click to insert variables. They will be replaced with actual data during conversations.
                      </p>
                    </div>

                    <div className="variables-wrap-row">
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

                  {/* Right Column: Info Box */}
                  <div className="tips-container-box" style={{ background: 'rgba(7, 28, 18, 0.4)' }}>
                    <div className="tips-title">
                      <Sparkles style={{ width: '1rem', height: '1rem' }} />
                      <span>What are the dynamic</span>
                    </div>
                    <p style={{ fontSize: '0.775rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                      These placeholders automatically pull contact data from your campaign CSV and personalize the conversation.
                    </p>
                  </div>
                </div>
              </div>

              {/* 4. Knowledge Base (Optional) Card */}
              <div className="form-card-container">
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                    Knowledge Base (Optional)
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                    Select the knowledge base document(s) to train this agent.
                  </p>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '1rem',
                    marginTop: '0.5rem',
                  }}
                >
                  {MOCK_KNOWLEDGE_BASES.map((kb) => {
                    const isChecked = selectedKnowledgeBases.includes(kb.id);

                    return (
                      <div
                        key={kb.id}
                        onClick={() => toggleKnowledgeBase(kb.id)}
                        className={`kb-card ${isChecked ? 'selected' : ''}`}
                      >
                        <div className="kb-checkbox-box">
                          {isChecked && (
                            <Check style={{ width: '0.75rem', height: '0.75rem', strokeWidth: 3 }} />
                          )}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.825rem',
                              fontWeight: 600,
                              color: '#ffffff',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {kb.title}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                            {kb.type}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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

              <div className="tools-grid-container">
                {AGENT_TOOL_CATEGORIES.map((cat) => (
                  <div key={cat.category}>
                    <h3 className="tools-category-header">{cat.category}</h3>
                    <div className="tool-group-card">
                      {cat.items.map((tool) => {
                        const isSelected = selectedTools.includes(tool.id);

                        return (
                          <div
                            key={tool.id}
                            onClick={() => toggleTool(tool.id)}
                            className={`tool-item-row ${isSelected ? 'selected' : ''}`}
                          >
                            <div className="tool-checkbox-box">
                              {isSelected && (
                                <Check style={{ width: '0.75rem', height: '0.75rem', color: '#000000', strokeWidth: 4 }} />
                              )}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h4 className="tool-title">
                                {tool.title}
                              </h4>
                              <p className="tool-desc">
                                {tool.description}
                              </p>
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
                <h1 className="step-title">Review Your Agent</h1>
                <p className="step-subtitle">
                  Everything looks good! Review and create your agent.
                </p>
              </div>

              <div className="review-card-container">
                {/* 4-Column Metadata Grid */}
                <div className="review-grid-4col">
                  <div className="review-meta-group">
                    <span className="review-meta-label">Use Case</span>
                    <span className="review-meta-value">
                      {selectedTemplateObj?.title || 'Survey & Feedback'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Name</span>
                    <span className="review-meta-value">
                      {agentName || (selectedTemplateObj?.title ? selectedTemplateObj.title + ' Agent' : 'John Doe')}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Telephony Provider</span>
                    <span className="review-meta-value">
                      {numberType === 'international' ? 'International Number' : 'Indian Number'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">{activeTelephonyOption?.title || 'Premium Calling'}</span>
                    <span className="review-meta-value">
                      {activeTelephonyOption?.credits || '10 Credits/min'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Voice</span>
                    <span className="review-meta-value">
                      {selectedVoiceName || voice}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Language</span>
                    <span className="review-meta-value">
                      {getLanguageLabel(language) || 'English'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Voice Tone</span>
                    <span className="review-meta-value">
                      {voiceTone || 'Confident'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Personality</span>
                    <span className="review-meta-value">
                      {personality || 'Professional'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Voice Speed</span>
                    <span className="review-meta-value">
                      1.00x
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Knowledge Base</span>
                    <span className="review-meta-value">
                      {selectedKnowledgeBases.length > 0
                        ? selectedKnowledgeBases
                            .map((kbId) => MOCK_KNOWLEDGE_BASES.find((k) => k.id === kbId)?.title || kbId)
                            .join(', ')
                        : 'None'}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Enable Call Transfer</span>
                    <span className="review-meta-value">
                      {selectedTools.includes('call_transfer')
                        ? (liveInternationalNumber || liveIndianNumber || '+1 (567) 890-1234')
                        : (selectedTools.length > 0 ? selectedTools.map(t => t.replace(/_/g, ' ')).join(', ') : '+1 (567) 890-1234')}
                    </span>
                  </div>

                  <div className="review-meta-group">
                    <span className="review-meta-label">Response Delay</span>
                    <span className="review-meta-value">
                      {responseDelay.toFixed(2)}s
                    </span>
                  </div>
                </div>

                {/* System Prompt Section */}
                <div className="review-text-section">
                  <div className="review-text-header">
                    <span className="review-meta-label">System Prompt</span>
                    {systemPrompt && systemPrompt.length > 200 && (
                      <button
                        type="button"
                        onClick={() => setExpandedSystemPrompt((prev) => !prev)}
                        className="btn-toggle-prompt"
                      >
                        <span>{expandedSystemPrompt ? 'View Less' : 'View More'}</span>
                        {expandedSystemPrompt ? (
                          <ChevronUp style={{ width: '0.85rem', height: '0.85rem' }} />
                        ) : (
                          <ChevronDown style={{ width: '0.85rem', height: '0.85rem' }} />
                        )}
                      </button>
                    )}
                  </div>
                  <div className={`review-text-box ${expandedSystemPrompt ? 'expanded' : 'collapsed'}`}>
                    <p className="review-text-content">
                      {systemPrompt || 'No system prompt configured.'}
                    </p>
                    {!expandedSystemPrompt && systemPrompt && systemPrompt.length > 200 && (
                      <div className="review-text-gradient-overlay" />
                    )}
                  </div>
                </div>

                {/* First Message Section */}
                <div className="review-text-section">
                  <div className="review-text-header">
                    <span className="review-meta-label">First Message</span>
                    {firstMessage && firstMessage.length > 200 && (
                      <button
                        type="button"
                        onClick={() => setExpandedFirstMessage((prev) => !prev)}
                        className="btn-toggle-prompt"
                      >
                        <span>{expandedFirstMessage ? 'View Less' : 'View More'}</span>
                        {expandedFirstMessage ? (
                          <ChevronUp style={{ width: '0.85rem', height: '0.85rem' }} />
                        ) : (
                          <ChevronDown style={{ width: '0.85rem', height: '0.85rem' }} />
                        )}
                      </button>
                    )}
                  </div>
                  <div className={`review-text-box ${expandedFirstMessage ? 'expanded' : 'collapsed'}`}>
                    <p className="review-text-content">
                      {firstMessage || 'No initial message configured.'}
                    </p>
                    {!expandedFirstMessage && firstMessage && firstMessage.length > 200 && (
                      <div className="review-text-gradient-overlay" />
                    )}
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
                <span>{isSubmitting ? (editingAgent ? 'Updating Agent...' : 'Creating Agent...') : (editingAgent ? 'Update Agent' : 'Create Agent')}</span>
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
