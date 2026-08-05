import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import type { MessagingLog, MessagingLogFilter } from '../types';

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

export class MessagingLogService {
  async logMessage(
    userId: string,
    channel: 'email' | 'whatsapp',
    data: {
      callId?: string;
      agentId?: string;
      recipientPhone?: string;
      recipientEmail?: string;
      templateName: string;
      status: 'sent' | 'failed' | 'pending';
      responseData?: any;
      errorMessage?: string;
      messageContent?: string;
      messageType?: string;
    }
  ): Promise<MessagingLog> {
    const result = await db.execute(sql`
      INSERT INTO messaging_logs (user_id, call_id, agent_id, channel, recipient_phone, recipient_email, template_name, status, response_data, error_message, message_content, message_type)
      VALUES (${userId}, ${data.callId || null}, ${data.agentId || null}, ${channel}, ${data.recipientPhone || null}, ${data.recipientEmail || null}, ${data.templateName}, ${data.status}, ${data.responseData ? JSON.stringify(data.responseData) : null}::jsonb, ${data.errorMessage || null}, ${data.messageContent || null}, ${data.messageType || null})
      RETURNING *
    `);
    return transformRow<MessagingLog>((result as any).rows[0]);
  }

  async getLogs(userId: string, filters: MessagingLogFilter = {}): Promise<{ logs: MessagingLog[]; total: number }> {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const channel = filters.channel && ['email', 'whatsapp'].includes(filters.channel) ? filters.channel : null;
    const status = filters.status && ['sent', 'failed', 'pending'].includes(filters.status) ? filters.status : null;

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM messaging_logs
      WHERE user_id = ${userId}
        AND (${channel}::text IS NULL OR channel = ${channel})
        AND (${status}::text IS NULL OR status = ${status})
    `);

    const result = await db.execute(sql`
      SELECT * FROM messaging_logs
      WHERE user_id = ${userId}
        AND (${channel}::text IS NULL OR channel = ${channel})
        AND (${status}::text IS NULL OR status = ${status})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = parseInt((countResult as any).rows[0]?.total || '0', 10);
    const logs = (result as any).rows.map((row: any) => transformRow<MessagingLog>(row));
    return { logs, total };
  }

  async getAdminLogs(filters: MessagingLogFilter = {}): Promise<{ logs: MessagingLog[]; total: number }> {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const channel = filters.channel && ['email', 'whatsapp'].includes(filters.channel) ? filters.channel : null;
    const status = filters.status && ['sent', 'failed', 'pending'].includes(filters.status) ? filters.status : null;

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM messaging_logs
      WHERE (${channel}::text IS NULL OR channel = ${channel})
        AND (${status}::text IS NULL OR status = ${status})
    `);

    const result = await db.execute(sql`
      SELECT ml.*, u.name as user_name, u.email as user_email
      FROM messaging_logs ml
      LEFT JOIN users u ON ml.user_id = u.id
      WHERE (${channel}::text IS NULL OR ml.channel = ${channel})
        AND (${status}::text IS NULL OR ml.status = ${status})
      ORDER BY ml.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = parseInt((countResult as any).rows[0]?.total || '0', 10);
    const logs = (result as any).rows.map((row: any) => ({
      ...transformRow<MessagingLog>(row),
      userName: row.user_name || row.user_email || row.user_id,
    }));
    return { logs, total };
  }

  async getStats(): Promise<{
    totalSent: number;
    totalFailed: number;
    successCount: number;
    failedCount: number;
    emailCount: number;
    whatsappCount: number;
    successRate: number;
  }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'sent') as success_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE channel = 'email') as email_count,
        COUNT(*) FILTER (WHERE channel = 'whatsapp') as whatsapp_count
      FROM messaging_logs
    `);
    const row = (result as any).rows[0];
    const total = parseInt(row?.total || '0', 10);
    const successCount = parseInt(row?.success_count || '0', 10);
    const failedCount = parseInt(row?.failed_count || '0', 10);
    return {
      totalSent: total,
      totalFailed: failedCount,
      successCount,
      failedCount,
      emailCount: parseInt(row?.email_count || '0', 10),
      whatsappCount: parseInt(row?.whatsapp_count || '0', 10),
      successRate: total > 0 ? (successCount / total) * 100 : 0,
    };
  }
}

export const messagingLogService = new MessagingLogService();
