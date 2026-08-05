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
function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, "");
}
class WhatsAppConversationService {
  async getOrCreateConversation(userId, contactPhone, contactName, contactWaId) {
    const normalizedPhone = normalizePhone(contactPhone);
    const name = contactName || "";
    const waId = contactWaId || "";
    const result = await db.execute(sql`
      INSERT INTO whatsapp_conversations (user_id, contact_phone, contact_name, contact_wa_id)
      VALUES (${userId}, ${normalizedPhone}, ${name}, ${waId})
      ON CONFLICT (user_id, contact_phone) DO UPDATE SET
        contact_name = CASE WHEN EXCLUDED.contact_name != '' THEN EXCLUDED.contact_name ELSE whatsapp_conversations.contact_name END,
        contact_wa_id = CASE WHEN EXCLUDED.contact_wa_id != '' THEN EXCLUDED.contact_wa_id ELSE whatsapp_conversations.contact_wa_id END,
        updated_at = NOW()
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  async getConversations(userId, options = {}) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let whereClause = sql`WHERE user_id = ${userId}`;
    if (options.status) {
      whereClause = sql`${whereClause} AND status = ${options.status}`;
    }
    if (options.search) {
      const searchPattern = `%${options.search}%`;
      whereClause = sql`${whereClause} AND (contact_phone ILIKE ${searchPattern} OR contact_name ILIKE ${searchPattern})`;
    }
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as total FROM whatsapp_conversations ${whereClause}
    `);
    const total = countResult.rows[0]?.total || 0;
    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations ${whereClause}
      ORDER BY last_message_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const conversations = (result.rows || []).map(
      (row) => transformRow(row)
    );
    return { conversations, total };
  }
  async getConversation(userId, conversationId) {
    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations WHERE id = ${conversationId} AND user_id = ${userId} LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async getMessages(conversationId, options = {}) {
    const limit = options.limit || 50;
    let query;
    if (options.before) {
      query = sql`
        SELECT * FROM whatsapp_messages
        WHERE conversation_id = ${conversationId} AND created_at < ${options.before}
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
    } else {
      query = sql`
        SELECT * FROM (
          SELECT * FROM whatsapp_messages
          WHERE conversation_id = ${conversationId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        ) sub ORDER BY created_at ASC
      `;
    }
    const result = await db.execute(query);
    return (result.rows || []).map(
      (row) => transformRow(row)
    );
  }
  async addMessage(data) {
    const messageType = data.messageType || "text";
    const content = data.content || "";
    const status = data.status || "sent";
    const metadata = data.metadata ? JSON.stringify(data.metadata) : "{}";
    const preview = content.substring(0, 100);
    const result = await db.execute(sql`
      INSERT INTO whatsapp_messages (
        conversation_id, user_id, direction, sender_type, message_type,
        content, meta_message_id, template_name, media_url, media_mime_type,
        status, metadata
      ) VALUES (
        ${data.conversationId}, ${data.userId}, ${data.direction}, ${data.senderType}, ${messageType},
        ${content}, ${data.metaMessageId || null}, ${data.templateName || null}, ${data.mediaUrl || null}, ${data.mediaMimeType || null},
        ${status}, ${metadata}::jsonb
      )
      RETURNING *
    `);
    if (data.direction === "inbound") {
      await db.execute(sql`
        UPDATE whatsapp_conversations SET
          last_message_at = NOW(),
          last_message_preview = ${preview},
          unread_count = unread_count + 1,
          updated_at = NOW()
        WHERE id = ${data.conversationId}
      `);
    } else {
      await db.execute(sql`
        UPDATE whatsapp_conversations SET
          last_message_at = NOW(),
          last_message_preview = ${preview},
          updated_at = NOW()
        WHERE id = ${data.conversationId}
      `);
    }
    return transformRow(result.rows[0]);
  }
  async updateMessageStatus(metaMessageId, status, errorMessage) {
    await db.execute(sql`
      UPDATE whatsapp_messages SET
        status = ${status},
        error_message = ${errorMessage || null}
      WHERE meta_message_id = ${metaMessageId}
    `);
  }
  async markRead(userId, conversationId) {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        unread_count = 0,
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }
  async updateConversationStatus(userId, conversationId, status) {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }
  async setAutoReply(userId, conversationId, enabled, agentId) {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        auto_reply_enabled = ${enabled},
        assigned_agent_id = ${agentId || null},
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }
  async refreshWindow(conversationId) {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        window_expires_at = NOW() + INTERVAL '24 hours',
        updated_at = NOW()
      WHERE id = ${conversationId}
    `);
  }
  isWindowOpen(conversation) {
    if (!conversation.windowExpiresAt) return false;
    return new Date(conversation.windowExpiresAt) > /* @__PURE__ */ new Date();
  }
  async getConversationByPhone(userId, contactPhone) {
    const normalized = normalizePhone(contactPhone);
    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations
      WHERE user_id = ${userId} AND contact_phone = ${normalized}
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async findUserByPhoneNumberId(phoneNumberId) {
    const result = await db.execute(sql`
      SELECT user_id FROM meta_whatsapp_settings
      WHERE phone_number_id = ${phoneNumberId} AND is_active = true
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? row.user_id : null;
  }
  async findUserByWabaId(wabaId) {
    const result = await db.execute(sql`
      SELECT user_id, phone_number_id FROM meta_whatsapp_settings
      WHERE waba_id = ${wabaId} AND is_active = true
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? { userId: row.user_id, phoneNumberId: row.phone_number_id } : null;
  }
  async updatePhoneNumberId(userId, newPhoneNumberId) {
    await db.execute(sql`
      UPDATE meta_whatsapp_settings SET
        phone_number_id = ${newPhoneNumberId},
        updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }
  async isDuplicateMessage(metaMessageId) {
    if (!metaMessageId) return false;
    const result = await db.execute(sql`
      SELECT 1 FROM whatsapp_messages WHERE meta_message_id = ${metaMessageId} LIMIT 1
    `);
    return (result.rows || []).length > 0;
  }
  async getConversationUpdates(userId, since) {
    const result = await db.execute(sql`
      SELECT id, unread_count, last_message_at, last_message_preview, status, updated_at, window_expires_at,
             contact_phone, contact_name, contact_wa_id, user_id, assigned_agent_id, auto_reply_enabled, created_at
      FROM whatsapp_conversations
      WHERE user_id = ${userId} AND updated_at > ${since}
      ORDER BY last_message_at DESC
    `);
    return (result.rows || []).map(
      (row) => transformRow(row)
    );
  }
}
const whatsAppConversationService = new WhatsAppConversationService();
export {
  WhatsAppConversationService,
  whatsAppConversationService
};
