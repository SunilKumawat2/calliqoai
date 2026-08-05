/**
 * ============================================================
 * Customer Memory Service
 *
 * Manages customer memory system:
 * - Load customer profile on incoming call
 * - Store extracted facts after call
 * - Maintain interaction history
 * - Build context for LLM
 *
 * Workflow:
 * Incoming call → Identify customer → Load memory → Build context
 * End of call → Generate summary → Extract facts → Store memory
 * ============================================================
 */

import { db } from '../../../../server/db';
import { sql, eq, and, desc } from 'drizzle-orm';
import type { CustomerMemory, CustomerProfile, CustomerFact, CallSummary } from '../../types';

// Direct SQL queries since these tables are plugin-managed
const QUERIES = {
  findCustomer: (userId: string, phoneNumber: string) =>
    sql`SELECT * FROM ve_customer_memory WHERE user_id = ${userId} AND phone_number = ${phoneNumber} LIMIT 1`,

  createCustomer: (userId: string, phoneNumber: string) =>
    sql`INSERT INTO ve_customer_memory (user_id, phone_number) VALUES (${userId}, ${phoneNumber}) RETURNING *`,

  updateCustomer: (id: string, fields: Record<string, unknown>) => {
    const setClauses = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => sql`${sql.raw(k)} = ${v}`)
      .reduce((a, b) => sql`${a}, ${b}`);
    return sql`UPDATE ve_customer_memory SET ${setClauses}, updated_at = NOW() WHERE id = ${id}`;
  },

  getFacts: (memoryId: string, limit = 20) =>
    sql`SELECT * FROM ve_customer_facts WHERE memory_id = ${memoryId} AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY extracted_at DESC LIMIT ${limit}`,

  addFact: (memoryId: string, fact: string, category: string, confidence: number, sessionId?: string) =>
    sql`INSERT INTO ve_customer_facts (memory_id, fact, category, confidence, source_session_id) VALUES (${memoryId}, ${fact}, ${category}, ${confidence}, ${sessionId || null})`,

  getCallHistory: (memoryId: string, limit = 5) =>
    sql`SELECT * FROM ve_conversation_memory WHERE memory_id = ${memoryId} ORDER BY call_date DESC LIMIT ${limit}`,

  addCallSummary: (
    memoryId: string,
    sessionId: string,
    duration: number,
    direction: string,
    summary: string,
    outcome: string | null,
    sentiment: string | null,
    topics: string[]
  ) => sql`INSERT INTO ve_conversation_memory (memory_id, session_id, duration_seconds, direction, summary, outcome, sentiment, topics) VALUES (${memoryId}, ${sessionId}, ${duration}, ${direction}, ${summary}, ${outcome}, ${sentiment}, ${topics})`,

  incrementCallCount: (id: string, duration: number) =>
    sql`UPDATE ve_customer_memory SET total_calls = total_calls + 1, total_duration_seconds = total_duration_seconds + ${duration}, last_interaction_at = NOW(), updated_at = NOW() WHERE id = ${id}`,
};

export class MemoryService {
  /**
   * Load or create customer memory for an incoming call
   */
  async loadOrCreateMemory(userId: string, phoneNumber: string): Promise<CustomerMemory> {
    // Find existing customer
    const result = await db.execute(QUERIES.findCustomer(userId, phoneNumber));
    let customer = (result.rows as any[])[0];

    if (!customer) {
      // Create new customer record
      const createResult = await db.execute(QUERIES.createCustomer(userId, phoneNumber));
      customer = (createResult.rows as any[])[0];
    }

    // Load facts
    const factsResult = await db.execute(QUERIES.getFacts(customer.id));
    const facts: CustomerFact[] = (factsResult.rows as any[]).map((row) => ({
      id: row.id,
      fact: row.fact,
      category: row.category,
      confidence: row.confidence,
      source: row.source_session_id || '',
      extractedAt: new Date(row.extracted_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    }));

    // Load call history
    const historyResult = await db.execute(QUERIES.getCallHistory(customer.id));
    const callHistory: CallSummary[] = (historyResult.rows as any[]).map((row) => ({
      callId: row.session_id,
      date: new Date(row.call_date),
      duration: row.duration_seconds,
      direction: row.direction,
      summary: row.summary,
      outcome: row.outcome,
      sentiment: row.sentiment,
      topics: row.topics,
    }));

    return {
      customerId: customer.id,
      phoneNumber,
      profile: {
        name: customer.customer_name || undefined,
        email: customer.customer_email || undefined,
        company: customer.customer_company || undefined,
        language: customer.language || undefined,
        timezone: customer.timezone || undefined,
        tags: customer.tags || [],
        customFields: customer.custom_fields || {},
      },
      preferences: {},
      facts,
      callHistory,
      lastInteraction: customer.last_interaction_at ? new Date(customer.last_interaction_at) : undefined,
    };
  }

  /**
   * Store post-call data: summary, facts, and update customer record
   */
  async storePostCallData(
    userId: string,
    customerId: string,
    sessionId: string,
    duration: number,
    direction: string,
    summary: string,
    outcome: string | null,
    sentiment: string | null,
    topics: string[],
    extractedFacts: Array<{ fact: string; category: string; confidence: number }>
  ): Promise<void> {
    // Store call summary
    await db.execute(
      QUERIES.addCallSummary(
        customerId,
        sessionId,
        duration,
        direction,
        summary,
        outcome,
        sentiment,
        topics
      )
    );

    // Store extracted facts
    for (const fact of extractedFacts) {
      await db.execute(
        QUERIES.addFact(customerId, fact.fact, fact.category, fact.confidence, sessionId)
      );
    }

    // Update customer call count
    await db.execute(QUERIES.incrementCallCount(customerId, duration));

    console.log(
      `[MemoryService] Stored post-call data for customer ${customerId}: ` +
      `${extractedFacts.length} facts, 1 summary`
    );
  }

  /**
   * Update customer profile fields
   */
  async updateProfile(
    customerId: string,
    updates: Partial<CustomerProfile>
  ): Promise<void> {
    const dbUpdates: Record<string, unknown> = {};

    if (updates.name !== undefined) dbUpdates.customer_name = updates.name;
    if (updates.email !== undefined) dbUpdates.customer_email = updates.email;
    if (updates.company !== undefined) dbUpdates.customer_company = updates.company;
    if (updates.language !== undefined) dbUpdates.language = updates.language;
    if (updates.timezone !== undefined) dbUpdates.timezone = updates.timezone;
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
    if (updates.customFields !== undefined) dbUpdates.custom_fields = JSON.stringify(updates.customFields);

    if (Object.keys(dbUpdates).length > 0) {
      await db.execute(QUERIES.updateCustomer(customerId, dbUpdates));
    }
  }

  /**
   * Build context string from customer memory for LLM system prompt
   */
  buildContextFromMemory(memory: CustomerMemory): string {
    const lines: string[] = [];

    if (memory.profile.name) {
      lines.push(`Customer Name: ${memory.profile.name}`);
    }
    if (memory.profile.company) {
      lines.push(`Company: ${memory.profile.company}`);
    }
    if (memory.callHistory.length > 0) {
      lines.push(`Previous interactions: ${memory.callHistory.length} calls`);
      const lastCall = memory.callHistory[0];
      lines.push(`Last call: ${lastCall.summary}`);
    }

    if (memory.facts.length > 0) {
      lines.push('\nImportant customer facts:');
      for (const fact of memory.facts.slice(0, 8)) {
        lines.push(`• ${fact.fact}`);
      }
    }

    return lines.join('\n');
  }
}
