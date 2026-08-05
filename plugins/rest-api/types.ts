/**
 * ============================================================
 * REST API Plugin - Type Definitions
 * ============================================================
 */

import type { Request } from 'express';
import type { ApiScope } from '@shared/schema.js';

// API Version
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// API Key format: agl_sk_<random>
export const API_KEY_PREFIX = 'agl_sk_';

// Authentication
export interface ApiAuthContext {
  userId: string;
  apiKeyId: string;
  keyPrefix: string;
  scopes: ApiScope[];
  rateLimit: number;
  rateLimitWindow: number;
}

export interface AuthenticatedApiRequest extends Request {
  apiAuth: ApiAuthContext;
  requestId: string;
  requestStartTime: number;
}

// Standard API Response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Pagination Request
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Error Codes
export const API_ERROR_CODES = {
  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  EXPIRED_API_KEY: 'EXPIRED_API_KEY',
  INSUFFICIENT_SCOPES: 'INSUFFICIENT_SCOPES',
  IP_NOT_WHITELISTED: 'IP_NOT_WHITELISTED',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Business Logic
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  AGENT_NOT_ACTIVE: 'AGENT_NOT_ACTIVE',
  CAMPAIGN_NOT_ACTIVE: 'CAMPAIGN_NOT_ACTIVE',
  PHONE_NUMBER_NOT_AVAILABLE: 'PHONE_NUMBER_NOT_AVAILABLE',
  
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

// Call Trigger Request/Response
export interface TriggerCallRequest {
  agentId: string;
  toNumber: string;
  fromNumber?: string; // Optional, will use default if not provided
  engine?: 'elevenlabs' | 'plivo' | 'twilio-openai';
  metadata?: Record<string, string>;
  scheduledAt?: string; // ISO date string for scheduled calls
}

export interface TriggerCallResponse {
  callId: string;
  status: string;
  agentId: string;
  toNumber: string;
  fromNumber: string;
  engine: string;
  createdAt: string;
}

// Campaign API
export interface CreateCampaignRequest {
  name: string;
  agentId: string;
  phoneNumberId?: string;
  engine?: 'elevenlabs' | 'plivo' | 'twilio-openai';
  scheduledStartTime?: string;
  timezone?: string;
  callWindowStart?: string;
  callWindowEnd?: string;
  maxConcurrentCalls?: number;
  retryAttempts?: number;
  retryDelayMinutes?: number;
}

export interface AddCampaignContactsRequest {
  contacts: Array<{
    phoneNumber: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    customFields?: Record<string, string>;
  }>;
}

// Agent API
export interface CreateAgentRequest {
  name: string;
  type: 'incoming' | 'flow';
  telephonyProvider?: 'twilio' | 'plivo' | 'twilio-openai';
  systemPrompt: string;
  firstMessage?: string;
  language?: string;
  llmModel?: string;
  temperature?: number;
  voiceId?: string;
  transferEnabled?: boolean;
  transferPhoneNumber?: string;
}

// Contact API
export interface CreateContactRequest {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tags?: string[];
  customFields?: Record<string, string>;
}

export interface BulkImportContactsRequest {
  contacts: CreateContactRequest[];
  skipDuplicates?: boolean;
}

export interface BulkImportContactsResponse {
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    phoneNumber: string;
    error: string;
  }>;
}

// Webhook Subscription
export interface CreateWebhookRequest {
  url: string;
  events: string[];
  secret?: string; // Auto-generated if not provided
  description?: string;
}

export interface WebhookResponse {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: string;
}

// Analytics
export interface CallAnalytics {
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  totalDurationMinutes: number;
  averageDurationSeconds: number;
  creditsUsed: number;
  period: {
    start: string;
    end: string;
  };
}

export interface CampaignAnalytics {
  campaignId: string;
  name: string;
  status: string;
  totalContacts: number;
  called: number;
  connected: number;
  completed: number;
  failed: number;
  pending: number;
  successRate: number;
}

// Credits
export interface CreditsBalance {
  available: number;
  reserved: number;
  total: number;
  currency: string;
}

export interface CreditsUsage {
  period: {
    start: string;
    end: string;
  };
  usage: Array<{
    date: string;
    calls: number;
    minutes: number;
    credits: number;
  }>;
  total: {
    calls: number;
    minutes: number;
    credits: number;
  };
}

// Flow Export/Import
export interface FlowExport {
  version: string;
  agentId: string;
  agentName: string;
  exportedAt: string;
  flow: {
    nodes: unknown[];
    edges: unknown[];
    variables?: Record<string, unknown>;
  };
}
