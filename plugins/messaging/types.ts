export interface UserEmailTemplate {
  id: string;
  userId: string;
  name: string;
  subject: string;
  htmlBody: string;
  designJson?: any;
  variables: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatswaySettings {
  id: string;
  userId: string;
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  channelId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessagingLog {
  id: string;
  userId: string;
  callId: string | null;
  agentId: string | null;
  channel: 'email' | 'whatsapp';
  recipientPhone: string | null;
  recipientEmail: string | null;
  templateName: string;
  status: 'sent' | 'failed' | 'pending';
  responseData: any;
  errorMessage: string | null;
  messageContent: string | null;
  messageType: string | null;
  createdAt: Date;
}

export interface WhatswayTemplate {
  name: string;
  status: string;
  language: string;
}

export interface WhatswayAccountInfo {
  channelId: string;
  name: string;
  phone: string;
}

export interface MetaWhatsAppSettings {
  id: string;
  userId: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  businessName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetaWhatsAppTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

export interface SendEmailPayload {
  templateId: string;
  recipientEmail: string;
  variables?: Record<string, string>;
  callId?: string;
  agentId?: string;
}

export interface SendWhatsAppPayload {
  to: string;
  templateName: string;
  language: string;
  components?: any[];
  callId?: string;
  agentId?: string;
}

export interface MessagingLogFilter {
  channel?: 'email' | 'whatsapp';
  status?: 'sent' | 'failed' | 'pending';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export type ConversationStatus = 'active' | 'closed' | 'archived';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderType = 'customer' | 'user' | 'agent';
export type WhatsAppMessageType = 'text' | 'template' | 'image' | 'document' | 'audio' | 'video' | 'reaction' | 'button' | 'interactive' | 'sticker' | 'location' | 'contacts' | 'unknown';
export type WhatsAppMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppProviderMode = 'whatsway_only' | 'meta_only' | 'both' | 'disabled';

export interface WhatsAppConversation {
  id: string;
  userId: string;
  contactPhone: string;
  contactName: string;
  contactWaId: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  autoReplyEnabled: boolean;
  windowExpiresAt: Date | null;
  unreadCount: number;
  lastMessageAt: Date;
  lastMessagePreview: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  userId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  messageType: WhatsAppMessageType;
  content: string;
  metaMessageId: string | null;
  templateName: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  status: WhatsAppMessageStatus;
  errorMessage: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface MetaWhatsAppAdminConfig {
  id: string;
  whatsappProviderMode: WhatsAppProviderMode;
  metaAppId: string;
  metaAppSecret: string;
  metaConfigId: string;
  embeddedSignupEnabled: boolean;
  coexistenceEnabled: boolean;
  webhookVerifyToken: string;
  createdAt: Date;
  updatedAt: Date;
}
