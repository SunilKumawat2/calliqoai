import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import type {
  WhatsAppConversation,
  WhatsAppMessage,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  WhatsAppMessageType,
  WhatsAppMessageStatus,
} from '../types';

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

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export class WhatsAppConversationService {
  async getOrCreateConversation(
    userId: string,
    contactPhone: string,
    contactName?: string,
    contactWaId?: string
  ): Promise<WhatsAppConversation> {
    const normalizedPhone = normalizePhone(contactPhone);
    const name = contactName || '';
    const waId = contactWaId || '';

    const result = await db.execute(sql`
      INSERT INTO whatsapp_conversations (user_id, contact_phone, contact_name, contact_wa_id)
      VALUES (${userId}, ${normalizedPhone}, ${name}, ${waId})
      ON CONFLICT (user_id, contact_phone) DO UPDATE SET
        contact_name = CASE WHEN EXCLUDED.contact_name != '' THEN EXCLUDED.contact_name ELSE whatsapp_conversations.contact_name END,
        contact_wa_id = CASE WHEN EXCLUDED.contact_wa_id != '' THEN EXCLUDED.contact_wa_id ELSE whatsapp_conversations.contact_wa_id END,
        updated_at = NOW()
      RETURNING *
    `);
    return transformRow<WhatsAppConversation>((result as any).rows[0]);
  }

  async getConversations(
    userId: string,
    options: { status?: ConversationStatus; search?: string; limit?: number; offset?: number } = {}
  ): Promise<{ conversations: WhatsAppConversation[]; total: number }> {
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
    const total = (countResult as any).rows[0]?.total || 0;

    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations ${whereClause}
      ORDER BY last_message_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const conversations = ((result as any).rows || []).map((row: any) =>
      transformRow<WhatsAppConversation>(row)
    );

    return { conversations, total };
  }

  async getConversation(userId: string, conversationId: string): Promise<WhatsAppConversation | null> {
    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations WHERE id = ${conversationId} AND user_id = ${userId} LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? transformRow<WhatsAppConversation>(row) : null;
  }

  async getMessages(
    conversationId: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<WhatsAppMessage[]> {
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
    return ((result as any).rows || []).map((row: any) =>
      transformRow<WhatsAppMessage>(row)
    );
  }

  async addMessage(data: {
    conversationId: string;
    userId: string;
    direction: MessageDirection;
    senderType: MessageSenderType;
    messageType?: WhatsAppMessageType;
    content?: string;
    metaMessageId?: string;
    templateName?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    status?: WhatsAppMessageStatus;
    metadata?: Record<string, any>;
  }): Promise<WhatsAppMessage> {
    const messageType = data.messageType || 'text';
    const content = data.content || '';
    const status = data.status || 'sent';
    const metadata = data.metadata ? JSON.stringify(data.metadata) : '{}';
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

    if (data.direction === 'inbound') {
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

    return transformRow<WhatsAppMessage>((result as any).rows[0]);
  }

  async updateMessageStatus(
    metaMessageId: string,
    status: WhatsAppMessageStatus,
    errorMessage?: string
  ): Promise<void> {
    await db.execute(sql`
      UPDATE whatsapp_messages SET
        status = ${status},
        error_message = ${errorMessage || null}
      WHERE meta_message_id = ${metaMessageId}
    `);
  }

  async markRead(userId: string, conversationId: string): Promise<void> {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        unread_count = 0,
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }

  async updateConversationStatus(
    userId: string,
    conversationId: string,
    status: ConversationStatus
  ): Promise<void> {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }

  async setAutoReply(
    userId: string,
    conversationId: string,
    enabled: boolean,
    agentId?: string
  ): Promise<void> {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        auto_reply_enabled = ${enabled},
        assigned_agent_id = ${agentId || null},
        updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
  }

  async refreshWindow(conversationId: string): Promise<void> {
    await db.execute(sql`
      UPDATE whatsapp_conversations SET
        window_expires_at = NOW() + INTERVAL '24 hours',
        updated_at = NOW()
      WHERE id = ${conversationId}
    `);
  }

  isWindowOpen(conversation: WhatsAppConversation): boolean {
    if (!conversation.windowExpiresAt) return false;
    return new Date(conversation.windowExpiresAt) > new Date();
  }

  async getConversationByPhone(userId: string, contactPhone: string): Promise<WhatsAppConversation | null> {
    const normalized = normalizePhone(contactPhone);
    const result = await db.execute(sql`
      SELECT * FROM whatsapp_conversations
      WHERE user_id = ${userId} AND contact_phone = ${normalized}
      LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? transformRow<WhatsAppConversation>(row) : null;
  }

  async findUserByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT user_id FROM meta_whatsapp_settings
      WHERE phone_number_id = ${phoneNumberId} AND is_active = true
      LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? row.user_id : null;
  }

  async findUserByWabaId(wabaId: string): Promise<{ userId: string; phoneNumberId: string } | null> {
    const result = await db.execute(sql`
      SELECT user_id, phone_number_id FROM meta_whatsapp_settings
      WHERE waba_id = ${wabaId} AND is_active = true
      LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? { userId: row.user_id, phoneNumberId: row.phone_number_id } : null;
  }

  async updatePhoneNumberId(userId: string, newPhoneNumberId: string): Promise<void> {
    await db.execute(sql`
      UPDATE meta_whatsapp_settings SET
        phone_number_id = ${newPhoneNumberId},
        updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }

  async isDuplicateMessage(metaMessageId: string): Promise<boolean> {
    if (!metaMessageId) return false;
    const result = await db.execute(sql`
      SELECT 1 FROM whatsapp_messages WHERE meta_message_id = ${metaMessageId} LIMIT 1
    `);
    return ((result as any).rows || []).length > 0;
  }

  async getConversationUpdates(userId: string, since: string): Promise<WhatsAppConversation[]> {
    const result = await db.execute(sql`
      SELECT id, unread_count, last_message_at, last_message_preview, status, updated_at, window_expires_at,
             contact_phone, contact_name, contact_wa_id, user_id, assigned_agent_id, auto_reply_enabled, created_at
      FROM whatsapp_conversations
      WHERE user_id = ${userId} AND updated_at > ${since}
      ORDER BY last_message_at DESC
    `);
    return ((result as any).rows || []).map((row: any) =>
      transformRow<WhatsAppConversation>(row)
    );
  }
}

export const whatsAppConversationService = new WhatsAppConversationService();
