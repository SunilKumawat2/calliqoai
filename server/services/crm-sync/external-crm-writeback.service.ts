import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { leadSourceIntegrations, type LeadSourceIntegration } from '@shared/schema';
import { logger } from '../../utils/logger';

export interface ExternalCallOutcomePayload {
  userId: string;
  phone: string;
  email?: string;
  customerName?: string;
  callStatus: string;
  duration?: number;
  aiSummary?: string;
  leadScore?: number;
  aiCategory?: string;
  leadId?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  recordingUrl?: string;
  stage?: string;
}

export interface ExternalCrmEventPayload {
  eventType: string;
  phone?: string;
  email?: string;
  customerName?: string;
  appointmentStatus?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  stage?: string;
  notes?: string;
  summary?: string;
  recordingUrl?: string;
}

interface ZohoTokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const ZOHO_DOMAIN_MAP: Record<string, { accounts: string; api: string }> = {
  in: { accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in' },
  com: { accounts: 'https://accounts.zoho.com', api: 'https://www.zohoapis.com' },
  eu: { accounts: 'https://accounts.zoho.eu', api: 'https://www.zohoapis.eu' },
  'com.au': { accounts: 'https://accounts.zoho.com.au', api: 'https://www.zohoapis.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', api: 'https://www.zohoapis.jp' },
};

export class ExternalCrmWritebackService {
  private static zohoTokenCache = new Map<string, ZohoTokenCacheEntry>();

  private static getZohoUrls(domain?: string) {
    const key = (domain || 'in').toLowerCase().trim();
    return ZOHO_DOMAIN_MAP[key] || ZOHO_DOMAIN_MAP.in;
  }

  private static normalizeLast10(phone?: string): string {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '').slice(-10);
  }

  private static mapZohoLeadStatus(status?: string, aiCategory?: string): string {
    const s = (status || '').toLowerCase();
    const cat = (aiCategory || '').toLowerCase();
    if (s.includes('won') || s.includes('converted')) return 'Qualified';
    if (s.includes('appointment') || s.includes('booked') || s.includes('confirmed') || s.includes('attended')) {
      return 'Pre-Qualified';
    }
    if (s.includes('not_interested') || s.includes('lost') || cat === 'cold') return 'Junk Lead';
    if (s.includes('no_show') || s.includes('no-answer') || s.includes('busy') || s.includes('failed')) {
      return 'Attempted to Contact';
    }
    if (cat === 'hot') return 'Pre-Qualified';
    return 'Contacted';
  }

  private static mapHubSpotLeadStatus(status?: string, aiCategory?: string): string {
    const s = (status || '').toLowerCase();
    const cat = (aiCategory || '').toLowerCase();
    if (s.includes('won') || s.includes('converted') || s.includes('appointment') || s.includes('booked') || s.includes('confirmed') || s.includes('attended')) {
      return 'OPEN_DEAL';
    }
    if (s.includes('not_interested') || s.includes('lost') || cat === 'cold') return 'UNQUALIFIED';
    if (s.includes('no_show') || s.includes('no-answer') || s.includes('busy') || s.includes('failed')) {
      return 'ATTEMPTED_TO_CONTACT';
    }
    if (cat === 'hot' || cat === 'warm') return 'IN_PROGRESS';
    return 'CONNECTED';
  }

  /**
   * Refresh and cache Zoho OAuth access token using Refresh Token
   */
  static async getZohoAccessToken(config: {
    zohoDomain?: string;
    zohoClientId?: string;
    zohoClientSecret?: string;
    zohoRefreshToken?: string;
  }): Promise<string> {
    const { zohoDomain, zohoClientId, zohoClientSecret, zohoRefreshToken } = config;
    if (!zohoClientId || !zohoClientSecret || !zohoRefreshToken) {
      throw new Error('Zoho OAuth credentials (Client ID, Client Secret, Refresh Token) are incomplete');
    }

    const cacheKey = `${zohoDomain || 'in'}:${zohoClientId}:${zohoRefreshToken.slice(-8)}`;
    const cached = this.zohoTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    const { accounts } = this.getZohoUrls(zohoDomain);
    const params = new URLSearchParams({
      refresh_token: zohoRefreshToken.trim(),
      client_id: zohoClientId.trim(),
      client_secret: zohoClientSecret.trim(),
      grant_type: 'refresh_token',
    });

    const resp = await fetch(`${accounts}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.access_token) {
      throw new Error(data?.error || `Zoho OAuth refresh failed (${resp.status})`);
    }

    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
    this.zohoTokenCache.set(cacheKey, {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresInMs,
    });

    return data.access_token;
  }

  /**
   * Test Zoho CRM OAuth + API connectivity
   */
  static async testZohoConnection(config: {
    zohoDomain?: string;
    zohoClientId?: string;
    zohoClientSecret?: string;
    zohoRefreshToken?: string;
  }): Promise<{ ok: boolean; orgName?: string; message: string }> {
    const accessToken = await this.getZohoAccessToken(config);
    const { api } = this.getZohoUrls(config.zohoDomain);

    const resp = await fetch(`${api}/crm/v2/org`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.message || data?.code || `Zoho API check failed (${resp.status})`);
    }
    const orgName = data?.org?.[0]?.company_name || data?.org?.[0]?.alias || 'Zoho CRM';
    return { ok: true, orgName, message: `Connected to ${orgName} (${config.zohoDomain || 'in'})` };
  }

  /**
   * Test HubSpot Private App Token connectivity
   */
  static async testHubSpotConnection(accessToken: string): Promise<{ ok: boolean; message: string }> {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('HubSpot Private App Access Token is required');
    }
    const resp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.message || `HubSpot API check failed (${resp.status})`);
    }
    return { ok: true, message: 'Connected to HubSpot CRM Contacts API (v3)' };
  }

  /**
   * Writeback call outcome or event to Zoho CRM via REST API v2
   */
  private static async writeToZohoCrm(
    integ: LeadSourceIntegration,
    data: {
      phone?: string;
      email?: string;
      customerName?: string;
      statusText: string;
      aiCategory?: string;
      noteTitle: string;
      noteBody: string;
    }
  ): Promise<boolean> {
    const cfg = (integ.portalConfig || {}) as Record<string, any>;
    if (!cfg.zohoClientId || !cfg.zohoClientSecret || !cfg.zohoRefreshToken) {
      return false;
    }

    const accessToken = await this.getZohoAccessToken({
      zohoDomain: cfg.zohoDomain,
      zohoClientId: cfg.zohoClientId,
      zohoClientSecret: cfg.zohoClientSecret,
      zohoRefreshToken: cfg.zohoRefreshToken,
    });
    const { api } = this.getZohoUrls(cfg.zohoDomain);
    const zohoModule = cfg.zohoModule === 'Contacts' ? 'Contacts' : 'Leads';
    const headers = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const last10 = this.normalizeLast10(data.phone);
    let recordId: string | null = null;

    // 1. Search by phone (last 10 digits or full)
    if (last10.length >= 6) {
      const searchUrl = `${api}/crm/v2/${zohoModule}/search?phone=${encodeURIComponent(last10)}`;
      const searchResp = await fetch(searchUrl, { headers });
      if (searchResp.status === 200) {
        const searchJson: any = await searchResp.json().catch(() => ({}));
        recordId = searchJson?.data?.[0]?.id || null;
      }
    }

    // 2. Fallback search by email
    if (!recordId && data.email) {
      const searchUrl = `${api}/crm/v2/${zohoModule}/search?email=${encodeURIComponent(data.email)}`;
      const searchResp = await fetch(searchUrl, { headers });
      if (searchResp.status === 200) {
        const searchJson: any = await searchResp.json().catch(() => ({}));
        recordId = searchJson?.data?.[0]?.id || null;
      }
    }

    // 3. Auto-create record if missing and allowed
    if (!recordId && cfg.zohoAutoCreate !== false && (last10 || data.email)) {
      const nameParts = (data.customerName || 'Calliqo Lead').trim().split(/\s+/);
      const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0] || 'Lead';
      const createResp = await fetch(`${api}/crm/v2/${zohoModule}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: [
            {
              ...(firstName ? { First_Name: firstName } : {}),
              Last_Name: lastName,
              ...(data.phone ? { Phone: data.phone, Mobile: data.phone } : {}),
              ...(data.email ? { Email: data.email } : {}),
              Lead_Source: 'Calliqo AI',
              Lead_Status: this.mapZohoLeadStatus(data.statusText, data.aiCategory),
              Description: data.noteBody.slice(0, 1500),
            },
          ],
        }),
      });
      const createJson: any = await createResp.json().catch(() => ({}));
      recordId = createJson?.data?.[0]?.details?.id || null;
    }

    if (!recordId) return false;

    // 4. Update Lead/Contact status & description
    const mappedStatus = this.mapZohoLeadStatus(data.statusText, data.aiCategory);
    await fetch(`${api}/crm/v2/${zohoModule}/${recordId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        data: [
          {
            ...(zohoModule === 'Leads' ? { Lead_Status: mappedStatus } : {}),
            Description: data.noteBody.slice(0, 2000),
          },
        ],
      }),
    });

    // 5. Attach structured Note to the Zoho record
    await fetch(`${api}/crm/v2/Notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: [
          {
            Note_Title: data.noteTitle.slice(0, 120),
            Note_Content: data.noteBody.slice(0, 3000),
            Parent_Id: recordId,
            se_module: zohoModule,
          },
        ],
      }),
    });

    return true;
  }

  /**
   * Writeback call outcome or event to HubSpot CRM via v3 REST API
   */
  private static async writeToHubSpotCrm(
    integ: LeadSourceIntegration,
    data: {
      phone?: string;
      email?: string;
      customerName?: string;
      statusText: string;
      aiCategory?: string;
      noteBody: string;
    }
  ): Promise<boolean> {
    const cfg = (integ.portalConfig || {}) as Record<string, any>;
    const token = cfg.hubspotAccessToken?.trim();
    if (!token) return false;

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const last10 = this.normalizeLast10(data.phone);
    let contactId: string | null = null;

    // 1. Search Contact by phone or email
    const filterGroups: any[] = [];
    if (last10.length >= 6) {
      filterGroups.push({
        filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: `*${last10}` }],
      });
    }
    if (data.email) {
      filterGroups.push({
        filters: [{ propertyName: 'email', operator: 'EQ', value: data.email }],
      });
    }

    if (filterGroups.length > 0) {
      const searchResp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups,
          properties: ['firstname', 'lastname', 'phone', 'email', 'hs_lead_status'],
          limit: 1,
        }),
      });
      if (searchResp.ok) {
        const searchJson: any = await searchResp.json().catch(() => ({}));
        contactId = searchJson?.results?.[0]?.id || null;
      }
    }

    const hsLeadStatus = this.mapHubSpotLeadStatus(data.statusText, data.aiCategory);

    // 2. Create Contact if not found and allowed
    if (!contactId && cfg.hubspotAutoCreate !== false && (last10 || data.email)) {
      const nameParts = (data.customerName || 'Calliqo Lead').trim().split(/\s+/);
      const firstname = nameParts[0] || 'Calliqo';
      const lastname = nameParts.slice(1).join(' ') || 'Lead';

      const createResp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            firstname,
            lastname,
            ...(data.phone ? { phone: data.phone } : {}),
            ...(data.email ? { email: data.email } : {}),
            hs_lead_status: hsLeadStatus,
          },
        }),
      });
      if (createResp.ok) {
        const createJson: any = await createResp.json().catch(() => ({}));
        contactId = createJson?.id || null;
      }
    }

    if (!contactId) return false;

    // 3. Update Contact lead status
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          hs_lead_status: hsLeadStatus,
        },
      }),
    });

    // 4. Create Note engagement associated with the Contact (associationTypeId 202 = Note -> Contact)
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: data.noteBody.slice(0, 6000),
        },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
          },
        ],
      }),
    });

    return true;
  }

  /**
   * Update portalConfig writeback telemetry safely
   */
  private static async recordWritebackStatus(integ: LeadSourceIntegration, status: string) {
    try {
      const nextPortalConfig = {
        ...(integ.portalConfig || {}),
        lastWritebackAt: new Date().toISOString(),
        lastWritebackStatus: status,
      };
      await db
        .update(leadSourceIntegrations)
        .set({ portalConfig: nextPortalConfig, updatedAt: new Date() })
        .where(eq(leadSourceIntegrations.id, integ.id));
    } catch {
      // non-fatal telemetry update
    }
  }

  /**
   * Writeback completed AI call outcome to all active Zoho / HubSpot / External Webhook integrations
   */
  static async writebackCallOutcome(payload: ExternalCallOutcomePayload): Promise<{ syncedCount: number }> {
    try {
      const integrations = await db
        .select()
        .from(leadSourceIntegrations)
        .where(
          and(
            eq(leadSourceIntegrations.userId, payload.userId),
            eq(leadSourceIntegrations.status, 'active')
          )
        );

      if (!integrations.length) return { syncedCount: 0 };

      const durationText =
        typeof payload.duration === 'number'
          ? `${Math.floor(payload.duration / 60)}m ${payload.duration % 60}s`
          : 'N/A';

      const noteLines = [
        `📞 Calliqo AI Call Summary`,
        `Status: ${payload.callStatus || 'Completed'}`,
        `Duration: ${durationText}`,
        payload.aiCategory ? `Lead Quality: ${payload.aiCategory.toUpperCase()}` : '',
        typeof payload.leadScore === 'number' ? `Lead Score: ${payload.leadScore}/100` : '',
        payload.appointmentDate
          ? `Appointment: ${payload.appointmentDate}${payload.appointmentTime ? ` at ${payload.appointmentTime}` : ''}`
          : '',
        payload.aiSummary ? `\nSummary:\n${payload.aiSummary}` : '',
        payload.recordingUrl ? `\nRecording: ${payload.recordingUrl}` : '',
      ].filter(Boolean);
      const noteBody = noteLines.join('\n');

      let syncedCount = 0;
      for (const integ of integrations) {
        const cfg = (integ.portalConfig || {}) as Record<string, any>;
        let syncedThis = false;

        try {
          if (integ.sourceType === 'zoho_crm' && cfg.zohoRefreshToken) {
            const ok = await this.writeToZohoCrm(integ, {
              phone: payload.phone,
              email: payload.email,
              customerName: payload.customerName,
              statusText: payload.stage || payload.callStatus,
              aiCategory: payload.aiCategory,
              noteTitle: `Calliqo AI Call (${payload.callStatus || 'Completed'})`,
              noteBody,
            });
            if (ok) syncedThis = true;
          }

          if (integ.sourceType === 'hubspot' && cfg.hubspotAccessToken) {
            const ok = await this.writeToHubSpotCrm(integ, {
              phone: payload.phone,
              email: payload.email,
              customerName: payload.customerName,
              statusText: payload.stage || payload.callStatus,
              aiCategory: payload.aiCategory,
              noteBody,
            });
            if (ok) syncedThis = true;
          }

          if (cfg.outboundWebhookUrl && typeof cfg.outboundWebhookUrl === 'string' && cfg.outboundWebhookUrl.startsWith('http')) {
            const resp = await fetch(cfg.outboundWebhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(integ.apiKey ? { Authorization: `Bearer ${integ.apiKey}`, 'X-API-Key': integ.apiKey } : {}),
              },
              body: JSON.stringify({
                event: 'call_completed',
                source: 'calliqo_ai_crm',
                integrationId: integ.id,
                integrationName: integ.name,
                timestamp: new Date().toISOString(),
                data: payload,
              }),
            });
            if (resp.ok) syncedThis = true;
          }

          if (syncedThis) {
            syncedCount++;
            await this.recordWritebackStatus(integ, 'success');
          }
        } catch (err: any) {
          logger.warn(`[ExternalCrmWriteback] Call writeback failed for ${integ.name}: ${err.message}`);
          await this.recordWritebackStatus(integ, `error: ${err.message}`);
        }
      }

      return { syncedCount };
    } catch (err: any) {
      logger.warn(`[ExternalCrmWriteback] writebackCallOutcome error: ${err?.message}`);
      return { syncedCount: 0 };
    }
  }

  /**
   * Push appointment/stage events to Zoho CRM & HubSpot REST APIs
   */
  static async pushEvent(userId: string, eventType: string, payload: Record<string, any>): Promise<{ syncedCount: number }> {
    try {
      const integrations = await db
        .select()
        .from(leadSourceIntegrations)
        .where(
          and(
            eq(leadSourceIntegrations.userId, userId),
            eq(leadSourceIntegrations.status, 'active')
          )
        );

      if (!integrations.length) return { syncedCount: 0 };

      const statusText = String(payload.appointmentStatus || payload.status || payload.stage || eventType);
      const noteLines = [
        `📅 Calliqo AI Event: ${eventType}`,
        `Status: ${statusText}`,
        payload.appointmentDate
          ? `Appointment: ${payload.appointmentDate}${payload.appointmentTime ? ` at ${payload.appointmentTime}` : ''}`
          : '',
        payload.notes || payload.summary ? `\nDetails:\n${payload.notes || payload.summary}` : '',
      ].filter(Boolean);
      const noteBody = noteLines.join('\n');

      let syncedCount = 0;
      for (const integ of integrations) {
        const cfg = (integ.portalConfig || {}) as Record<string, any>;
        try {
          let ok = false;
          if (integ.sourceType === 'zoho_crm' && cfg.zohoRefreshToken) {
            ok = await this.writeToZohoCrm(integ, {
              phone: payload.phone || payload.customerPhone,
              email: payload.email || payload.customerEmail,
              customerName: payload.customerName || payload.name,
              statusText,
              noteTitle: `Calliqo AI Update: ${eventType}`,
              noteBody,
            });
          } else if (integ.sourceType === 'hubspot' && cfg.hubspotAccessToken) {
            ok = await this.writeToHubSpotCrm(integ, {
              phone: payload.phone || payload.customerPhone,
              email: payload.email || payload.customerEmail,
              customerName: payload.customerName || payload.name,
              statusText,
              noteBody,
            });
          }
          if (ok) {
            syncedCount++;
            await this.recordWritebackStatus(integ, 'success');
          }
        } catch (err: any) {
          logger.warn(`[ExternalCrmWriteback] Event push failed for ${integ.name}: ${err.message}`);
          await this.recordWritebackStatus(integ, `error: ${err.message}`);
        }
      }

      return { syncedCount };
    } catch {
      return { syncedCount: 0 };
    }
  }
}
