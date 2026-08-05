const DEFAULT_ROLE_PERMISSIONS = {
  owner: {
    "*": true
  },
  admin: {
    "campaigns.*": true,
    "agents.*": true,
    "crm.*": true,
    "calls.*": true,
    "messaging.*": true,
    "knowledge_base.*": true,
    "phone_numbers.*": true,
    "analytics.*": true,
    "settings.view_settings": true,
    "settings.edit_settings": true,
    "settings.manage_integrations": true,
    "team.*": true
  },
  manager: {
    "campaigns.*": true,
    "agents.view_agents": true,
    "agents.create_agents": true,
    "agents.edit_agents": true,
    "agents.flow_builder": true,
    "crm.*": true,
    "calls.*": true,
    "messaging.view_conversations": true,
    "messaging.send_messages": true,
    "knowledge_base.view_knowledge": true,
    "knowledge_base.create_knowledge": true,
    "analytics.view_analytics": true,
    "team.view_team": true
  },
  viewer: {
    "campaigns.view_campaigns": true,
    "agents.view_agents": true,
    "crm.view_leads": true,
    "calls.view_calls": true,
    "calls.view_transcripts": true,
    "messaging.view_conversations": true,
    "knowledge_base.view_knowledge": true,
    "analytics.view_analytics": true,
    "team.view_team": true
  }
};
const PERMISSION_SECTIONS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "Home",
    subsections: [
      { id: "view_dashboard", label: "View Dashboard" },
      { id: "view_stats", label: "View Statistics" }
    ]
  },
  {
    id: "campaigns",
    label: "Campaigns",
    icon: "Megaphone",
    subsections: [
      { id: "view_campaigns", label: "View Campaigns" },
      { id: "create_campaigns", label: "Create Campaigns" },
      { id: "edit_campaigns", label: "Edit Campaigns" },
      { id: "delete_campaigns", label: "Delete Campaigns" },
      { id: "manage_contacts", label: "Manage Contacts" },
      { id: "execute_campaigns", label: "Execute Campaigns" }
    ]
  },
  {
    id: "agents",
    label: "Agents",
    icon: "Bot",
    subsections: [
      { id: "view_agents", label: "View Agents" },
      { id: "create_agents", label: "Create Agents" },
      { id: "edit_agents", label: "Edit Agents" },
      { id: "delete_agents", label: "Delete Agents" },
      { id: "flow_builder", label: "Flow Builder" }
    ]
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: "Contact",
    subsections: [
      { id: "view_contacts", label: "View Contacts" },
      { id: "create_contacts", label: "Create Contacts" },
      { id: "edit_contacts", label: "Edit Contacts" },
      { id: "delete_contacts", label: "Delete Contacts" },
      { id: "import_contacts", label: "Import Contacts" },
      { id: "export_contacts", label: "Export Contacts" }
    ]
  },
  {
    id: "crm",
    label: "CRM",
    icon: "Users",
    subsections: [
      { id: "view_leads", label: "View Leads" },
      { id: "edit_leads", label: "Edit Leads" },
      { id: "delete_leads", label: "Delete Leads" },
      { id: "manage_pipelines", label: "Manage Pipelines" }
    ]
  },
  {
    id: "calls",
    label: "Calls & Conversations",
    icon: "Phone",
    subsections: [
      { id: "view_calls", label: "View Calls" },
      { id: "view_recordings", label: "View Recordings" },
      { id: "view_transcripts", label: "View Transcripts" }
    ]
  },
  {
    id: "messaging",
    label: "Messaging & Conversations",
    icon: "MessageSquare",
    subsections: [
      { id: "view_conversations", label: "View Conversations" },
      { id: "send_messages", label: "Send Messages" },
      { id: "manage_conversations", label: "Manage Conversations" }
    ]
  },
  {
    id: "knowledge_base",
    label: "Knowledge Base",
    icon: "BookOpen",
    subsections: [
      { id: "view_knowledge", label: "View Knowledge Base" },
      { id: "create_knowledge", label: "Add Documents" },
      { id: "edit_knowledge", label: "Edit Documents" },
      { id: "delete_knowledge", label: "Delete Documents" }
    ]
  },
  {
    id: "templates",
    label: "Templates",
    icon: "FileText",
    subsections: [
      { id: "view_templates", label: "View Templates" },
      { id: "create_templates", label: "Create Templates" },
      { id: "edit_templates", label: "Edit Templates" },
      { id: "delete_templates", label: "Delete Templates" }
    ]
  },
  {
    id: "website_widget",
    label: "Website Widget",
    icon: "Globe",
    subsections: [
      { id: "view_widget", label: "View Widget" },
      { id: "create_widget", label: "Create Widget" },
      { id: "edit_widget", label: "Edit Widget" },
      { id: "delete_widget", label: "Delete Widget" },
      { id: "embed_code", label: "View Embed Code" }
    ]
  },
  {
    id: "webhooks",
    label: "Webhooks",
    icon: "Webhook",
    subsections: [
      { id: "view_webhooks", label: "View Webhooks" },
      { id: "create_webhooks", label: "Create Webhooks" },
      { id: "edit_webhooks", label: "Edit Webhooks" },
      { id: "delete_webhooks", label: "Delete Webhooks" }
    ]
  },
  {
    id: "phone_numbers",
    label: "Phone Numbers",
    icon: "PhoneCall",
    subsections: [
      { id: "view_numbers", label: "View Numbers" },
      { id: "purchase_numbers", label: "Purchase Numbers" },
      { id: "manage_numbers", label: "Manage Numbers" }
    ]
  },
  {
    id: "billing",
    label: "Billing & Credits",
    icon: "CreditCard",
    subsections: [
      { id: "view_billing", label: "View Billing" },
      { id: "manage_billing", label: "Manage Billing" },
      { id: "purchase_credits", label: "Purchase Credits" }
    ]
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "BarChart3",
    subsections: [
      { id: "view_analytics", label: "View Analytics" },
      { id: "export_analytics", label: "Export Reports" }
    ]
  },
  {
    id: "api_keys",
    label: "API Keys",
    icon: "Key",
    subsections: [
      { id: "view_api_keys", label: "View API Keys" },
      { id: "create_api_keys", label: "Create API Keys" },
      { id: "delete_api_keys", label: "Delete API Keys" }
    ]
  },
  {
    id: "settings",
    label: "Settings",
    icon: "Settings",
    subsections: [
      { id: "view_settings", label: "View Settings" },
      { id: "edit_settings", label: "Edit Settings" },
      { id: "manage_integrations", label: "Manage Integrations" }
    ]
  },
  {
    id: "team",
    label: "Team Management",
    icon: "UserCog",
    subsections: [
      { id: "view_team", label: "View Team" },
      { id: "invite_members", label: "Invite Members" },
      { id: "manage_members", label: "Manage Members" },
      { id: "manage_roles", label: "Manage Roles" }
    ]
  }
];
const ADMIN_PERMISSION_SECTIONS = [
  {
    id: "users",
    label: "Users",
    icon: "Users",
    subsections: [
      { id: "view_users", label: "View Users" },
      { id: "edit_users", label: "Edit Users" },
      { id: "suspend_users", label: "Suspend Users" },
      { id: "delete_users", label: "Delete Users" },
      { id: "manage_credits", label: "Manage Credits" },
      { id: "manage_plans", label: "Manage User Plans" }
    ]
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: "Contact",
    subsections: [
      { id: "view_contacts", label: "View Contacts" },
      { id: "edit_contacts", label: "Edit Contacts" },
      { id: "delete_contacts", label: "Delete Contacts" },
      { id: "export_contacts", label: "Export Contacts" }
    ]
  },
  {
    id: "billing",
    label: "Billing",
    icon: "CreditCard",
    subsections: [
      { id: "plans", label: "Plans" },
      { id: "credits", label: "Credits" },
      { id: "transactions", label: "Transactions" },
      { id: "payments", label: "Payments" }
    ]
  },
  {
    id: "phones",
    label: "Phones",
    icon: "Phone",
    subsections: [
      { id: "phone_numbers", label: "Phone Numbers" }
    ]
  },
  {
    id: "batch_jobs",
    label: "Batch Jobs",
    icon: "ListChecks",
    subsections: [
      { id: "view_batch_jobs", label: "View Batch Jobs" },
      { id: "manage_batch_jobs", label: "Manage Batch Jobs" },
      { id: "cancel_batch_jobs", label: "Cancel Batch Jobs" }
    ]
  },
  {
    id: "call_monitoring",
    label: "Call Monitoring",
    icon: "PhoneCall",
    subsections: [
      { id: "all_calls", label: "All Calls" },
      { id: "banned_words", label: "Banned Words" }
    ]
  },
  {
    id: "communications",
    label: "Communications",
    icon: "MessageSquare",
    subsections: [
      { id: "email_settings", label: "Email Settings" },
      { id: "notifications", label: "In-App Notifications" }
    ]
  },
  {
    id: "voice_ai",
    label: "Voice AI",
    icon: "Mic",
    subsections: [
      { id: "twilio_openai_engine", label: "Twilio + OpenAI Engine" },
      { id: "plivo_openai_engine", label: "Plivo + OpenAI Engine" },
      { id: "openai_pool", label: "OpenAI Pool" },
      { id: "plivo_settings", label: "Plivo Settings" }
    ]
  },
  {
    id: "settings",
    label: "Settings",
    icon: "Settings",
    subsections: [
      { id: "master_settings", label: "Master Settings" },
      { id: "elevenlabs_settings", label: "ElevenLabs Settings" },
      { id: "seo_settings", label: "SEO Module" },
      { id: "analytics_settings", label: "Analytics" },
      { id: "languages_settings", label: "Languages" },
      { id: "system_settings", label: "System Settings" }
    ]
  }
];
export {
  ADMIN_PERMISSION_SECTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_SECTIONS
};
