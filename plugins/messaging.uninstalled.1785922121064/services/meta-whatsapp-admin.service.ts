import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';
import type { MetaWhatsAppAdminConfig, WhatsAppProviderMode } from '../types';

const META_GRAPH_API_BASE = 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_WHATSAPP_API_VERSION || 'v22.0';

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformRow<T>(row: Record<string, any>): T {
  const transformed: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed as T;
}

export class MetaWhatsAppAdminService {
  async getConfig(): Promise<MetaWhatsAppAdminConfig | null> {
    const result = await db.execute(sql`
      SELECT * FROM meta_whatsapp_admin_config LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? transformRow<MetaWhatsAppAdminConfig>(row) : null;
  }

  async saveConfig(data: Partial<Omit<MetaWhatsAppAdminConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<MetaWhatsAppAdminConfig> {
    const existing = await this.getConfig();

    if (existing) {
      const result = await db.execute(sql`
        UPDATE meta_whatsapp_admin_config SET
          whatsapp_provider_mode = ${data.whatsappProviderMode !== undefined ? data.whatsappProviderMode : existing.whatsappProviderMode},
          meta_app_id = ${data.metaAppId !== undefined ? data.metaAppId : existing.metaAppId},
          meta_app_secret = ${data.metaAppSecret !== undefined ? data.metaAppSecret : existing.metaAppSecret},
          meta_config_id = ${data.metaConfigId !== undefined ? data.metaConfigId : existing.metaConfigId},
          embedded_signup_enabled = ${data.embeddedSignupEnabled !== undefined ? data.embeddedSignupEnabled : existing.embeddedSignupEnabled},
          coexistence_enabled = ${data.coexistenceEnabled !== undefined ? data.coexistenceEnabled : existing.coexistenceEnabled},
          webhook_verify_token = ${data.webhookVerifyToken !== undefined ? data.webhookVerifyToken : existing.webhookVerifyToken},
          updated_at = NOW()
        WHERE id = ${existing.id}
        RETURNING *
      `);

      return transformRow<MetaWhatsAppAdminConfig>((result as any).rows[0]);
    } else {
      const result = await db.execute(sql`
        INSERT INTO meta_whatsapp_admin_config (
          whatsapp_provider_mode,
          meta_app_id,
          meta_app_secret,
          meta_config_id,
          embedded_signup_enabled,
          coexistence_enabled,
          webhook_verify_token
        ) VALUES (
          ${data.whatsappProviderMode || 'both'},
          ${data.metaAppId || ''},
          ${data.metaAppSecret || ''},
          ${data.metaConfigId || ''},
          ${data.embeddedSignupEnabled ?? false},
          ${data.coexistenceEnabled ?? false},
          ${data.webhookVerifyToken || ''}
        )
        RETURNING *
      `);
      return transformRow<MetaWhatsAppAdminConfig>((result as any).rows[0]);
    }
  }

  async getProviderMode(): Promise<WhatsAppProviderMode> {
    const config = await this.getConfig();
    return config?.whatsappProviderMode || 'both';
  }

  async isMetaAllowed(): Promise<boolean> {
    const mode = await this.getProviderMode();
    return mode === 'meta_only' || mode === 'both';
  }

  async isWhatswayAllowed(): Promise<boolean> {
    const mode = await this.getProviderMode();
    return mode === 'whatsway_only' || mode === 'both';
  }

  async getEmbeddedSignupConfig(): Promise<{
    metaAppId: string;
    metaConfigId: string;
    embeddedSignupEnabled: boolean;
    coexistenceEnabled: boolean;
  }> {
    const config = await this.getConfig();
    return {
      metaAppId: config?.metaAppId || '',
      metaConfigId: config?.metaConfigId || '',
      embeddedSignupEnabled: config?.embeddedSignupEnabled ?? false,
      coexistenceEnabled: config?.coexistenceEnabled ?? false,
    };
  }

  async generateWebhookVerifyToken(): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.saveConfig({ webhookVerifyToken: token });
    return token;
  }

  async getWebhookVerifyToken(): Promise<string> {
    const config = await this.getConfig();
    return config?.webhookVerifyToken || '';
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const config = await this.getConfig();
    if (!config?.metaAppId || !config?.metaAppSecret) {
      throw new Error('Meta App ID and App Secret must be configured by the administrator before using Embedded Signup.');
    }

    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/oauth/access_token?client_id=${encodeURIComponent(config.metaAppId)}&client_secret=${encodeURIComponent(config.metaAppSecret)}&code=${encodeURIComponent(code)}`;

    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to exchange code for access token: ${errorText}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('No access_token returned from Meta OAuth exchange.');
    }

    return data.access_token;
  }

  async debugToken(accessToken: string): Promise<string[]> {
    const config = await this.getConfig();
    if (!config?.metaAppId || !config?.metaAppSecret) {
      throw new Error('Meta App ID and App Secret must be configured.');
    }

    const appToken = `${config.metaAppId}|${config.metaAppSecret}`;
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/debug_token?input_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${appToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to debug token: ${errorText}`);
    }

    const data = await response.json();
    const granularScopes = data?.data?.granular_scopes || [];
    const wabaIds: string[] = [];

    for (const scope of granularScopes) {
      if (scope.target_ids && Array.isArray(scope.target_ids)) {
        for (const id of scope.target_ids) {
          if (!wabaIds.includes(id)) {
            wabaIds.push(id);
          }
        }
      }
    }

    return wabaIds;
  }

  async getPhoneNumbers(wabaId: string, accessToken: string): Promise<Array<{ id: string; displayPhoneNumber: string; verifiedName: string }>> {
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/phone_numbers`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch phone numbers for WABA ${wabaId}: ${errorText}`);
    }

    const data = await response.json();
    const phones = data?.data || [];

    return phones.map((p: any) => ({
      id: p.id,
      displayPhoneNumber: p.display_phone_number || '',
      verifiedName: p.verified_name || '',
    }));
  }
}

export const metaWhatsAppAdminService = new MetaWhatsAppAdminService();
