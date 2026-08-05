import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
function transformRow(row) {
  const transformed = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed;
}
class MessagingLogService {
  async logMessage(userId, channel, data) {
    const result = await db.execute(sql`
      INSERT INTO messaging_logs (user_id, call_id, agent_id, channel, recipient_phone, recipient_email, template_name, status, response_data, error_message, message_content, message_type)
      VALUES (${userId}, ${data.callId || null}, ${data.agentId || null}, ${channel}, ${data.recipientPhone || null}, ${data.recipientEmail || null}, ${data.templateName}, ${data.status}, ${data.responseData ? JSON.stringify(data.responseData) : null}::jsonb, ${data.errorMessage || null}, ${data.messageContent || null}, ${data.messageType || null})
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  async getLogs(userId, filters = {}) {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const channel = filters.channel && ["email", "whatsapp"].includes(filters.channel) ? filters.channel : null;
    const status = filters.status && ["sent", "failed", "pending"].includes(filters.status) ? filters.status : null;
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
    const total = parseInt(countResult.rows[0]?.total || "0", 10);
    const logs = result.rows.map((row) => transformRow(row));
    return { logs, total };
  }
  async getAdminLogs(filters = {}) {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const channel = filters.channel && ["email", "whatsapp"].includes(filters.channel) ? filters.channel : null;
    const status = filters.status && ["sent", "failed", "pending"].includes(filters.status) ? filters.status : null;
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
    const total = parseInt(countResult.rows[0]?.total || "0", 10);
    const logs = result.rows.map((row) => ({
      ...transformRow(row),
      userName: row.user_name || row.user_email || row.user_id
    }));
    return { logs, total };
  }
  async getStats() {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'sent') as success_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE channel = 'email') as email_count,
        COUNT(*) FILTER (WHERE channel = 'whatsapp') as whatsapp_count
      FROM messaging_logs
    `);
    const row = result.rows[0];
    const total = parseInt(row?.total || "0", 10);
    const successCount = parseInt(row?.success_count || "0", 10);
    const failedCount = parseInt(row?.failed_count || "0", 10);
    return {
      totalSent: total,
      totalFailed: failedCount,
      successCount,
      failedCount,
      emailCount: parseInt(row?.email_count || "0", 10),
      whatsappCount: parseInt(row?.whatsapp_count || "0", 10),
      successRate: total > 0 ? successCount / total * 100 : 0
    };
  }
}
const messagingLogService = new MessagingLogService();
export {
  MessagingLogService,
  messagingLogService
};
