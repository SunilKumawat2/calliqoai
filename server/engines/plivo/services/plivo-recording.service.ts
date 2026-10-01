'use strict';
/**
 * ============================================================
 * Plivo Recording Service
 * 
 * Manages call recording via Plivo REST API:
 * - Start recording on active calls
 * - Stop recording on active calls
 * - Handle recording callbacks
 * ============================================================
 */

import axios from 'axios';
import { db } from '../../../db';
import { plivoCredentials } from '@shared/schema';
import { logger } from '../../../utils/logger';
import { getDomain } from '../../../utils/domain';
import { storage } from '../../../storage';
import { eq, and } from 'drizzle-orm';

interface PlivoCredentialRecord {
  id: string;
  authId: string;
  authToken: string;
  isActive: boolean;
  isPrimary: boolean;
}

interface StartRecordingParams {
  callUuid: string;
  callRecordId: string;
  plivoCredentialId?: string;
}

interface StopRecordingParams {
  callUuid: string;
  plivoCredentialId?: string;
}

interface StartRecordingResult {
  success: boolean;
  recordingId?: string;
  url?: string;
  error?: string;
}

interface StopRecordingResult {
  success: boolean;
  error?: string;
}

export class PlivoRecordingService {
  private static readonly PLIVO_API_BASE = 'https://api.plivo.com/v1';

  /**
   * Get Plivo credentials for API authentication
   */
  private static async getPlivoClient(credentialId?: string): Promise<{ authId: string; authToken: string; id?: string }> {
    let credential: { authId: string; authToken: string; id?: string } | undefined;

    if (credentialId) {
      const [cred] = await db
        .select()
        .from(plivoCredentials)
        .where(and(eq(plivoCredentials.id, credentialId), eq(plivoCredentials.isActive, true)))
        .limit(1);
      credential = cred;
    }

    if (!credential) {
      const [primaryCred] = await db
        .select()
        .from(plivoCredentials)
        .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
        .limit(1);
      credential = primaryCred;
    }

    if (!credential) {
      const [anyCred] = await db
        .select()
        .from(plivoCredentials)
        .where(eq(plivoCredentials.isActive, true))
        .limit(1);
      credential = anyCred;
    }

    if (!credential) {
      // Fallback: Check globalSettings ('plivo_auth_id' & 'plivo_auth_token') or process.env
      try {
        const dbAuthId = await storage.getGlobalSetting('plivo_auth_id');
        const dbAuthToken = await storage.getGlobalSetting('plivo_auth_token');
        const authId = (typeof dbAuthId?.value === 'string' ? dbAuthId.value.trim() : '') || (process.env.PLIVO_AUTH_ID || '').trim();
        const authToken = (typeof dbAuthToken?.value === 'string' ? dbAuthToken.value.trim() : '') || (process.env.PLIVO_AUTH_TOKEN || '').trim();

        if (authId && authToken && authId !== 'your_plivo_auth_id_here') {
          credential = { authId, authToken };
        }
      } catch (err: any) {
        logger.error(`[Recording] Failed to fetch fallback Plivo credentials from global settings: ${err?.message || err}`, err, 'Recording');
      }
    }

    if (!credential) {
      throw new Error('No active Plivo credentials found. Please configure Plivo credentials in admin settings.');
    }

    return credential;
  }

  /**
   * Get base URL for webhooks
   */
  private static getBaseUrl(): string {
    return getDomain();
  }

  /**
   * Build the recording callback URL
   */
  private static getRecordingCallbackUrl(callRecordId: string): string {
    const baseUrl = this.getBaseUrl();
    return `${baseUrl}/api/plivo/recording/callback/${callRecordId}`;
  }

  /**
   * Start recording on an active call
   */
  static async startRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
    const { callUuid, callRecordId, plivoCredentialId } = params;

    logger.info(`[Recording] Starting recording for call ${callUuid}`, undefined, 'Recording');

    try {
      const credential = await this.getPlivoClient(plivoCredentialId);
      const callbackUrl = this.getRecordingCallbackUrl(callRecordId);
      
      logger.info(`[Recording] Callback URL: ${callbackUrl}`, undefined, 'Recording');

      const url = `${this.PLIVO_API_BASE}/Account/${credential.authId}/Call/${callUuid}/Record/`;

      const response = await axios.post(
        url,
        {
          time_limit: 3600,
          file_format: 'mp3',
          callback_url: callbackUrl,
          callback_method: 'POST',
        },
        {
          auth: {
            username: credential.authId,
            password: credential.authToken,
          },
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;
      logger.info(`[Recording] Started successfully: ${JSON.stringify(data)}`, undefined, 'Recording');

      return {
        success: true,
        recordingId: data.recording_id || data.recordingId,
        url: data.url,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
      logger.error(`[Recording] Failed to start recording for call ${callUuid}: ${errorMessage}`, error, 'Recording');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Stop recording on an active call
   */
  static async stopRecording(params: StopRecordingParams): Promise<StopRecordingResult> {
    const { callUuid, plivoCredentialId } = params;

    logger.info(`[Recording] Stopping recording for call ${callUuid}`, undefined, 'Recording');

    try {
      const credential = await this.getPlivoClient(plivoCredentialId);

      const url = `${this.PLIVO_API_BASE}/Account/${credential.authId}/Call/${callUuid}/Record/`;

      const response = await axios.delete(url, {
        auth: {
          username: credential.authId,
          password: credential.authToken,
        },
      });

      logger.info(`[Recording] Stop API Response Status: ${response.status}`, undefined, 'Recording');
      logger.info(`[Recording] ✓ Stopped successfully for ${callUuid}`, undefined, 'Recording');

      return {
        success: true,
      };
    } catch (error: any) {
      // 204 No Content or 404 Not Found (call already ended, Plivo auto-saves recording)
      if (error.response?.status === 204 || error.response?.status === 404) {
        logger.info(`[Recording] Stop API returned status ${error.response?.status} (call ended, Plivo auto-saves recording for ${callUuid})`, undefined, 'Recording');
        return {
          success: true,
        };
      }

      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
      logger.error(`[Recording] Failed to stop recording for call ${callUuid}: ${errorMessage}`, error, 'Recording');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
