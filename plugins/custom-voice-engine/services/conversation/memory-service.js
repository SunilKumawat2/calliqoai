import { db } from "../../../../server/db.js";
import { sql } from "drizzle-orm";
const QUERIES = {
  findCustomer: (userId, phoneNumber) => sql`SELECT * FROM ve_customer_memory WHERE user_id = ${userId} AND phone_number = ${phoneNumber} LIMIT 1`,
  createCustomer: (userId, phoneNumber) => sql`INSERT INTO ve_customer_memory (user_id, phone_number) VALUES (${userId}, ${phoneNumber}) RETURNING *`,
  updateCustomer: (id, fields) => {
    const setClauses = Object.entries(fields).filter(([, v]) => v !== void 0).map(([k, v]) => sql`${sql.raw(k)} = ${v}`).reduce((a, b) => sql`${a}, ${b}`);
    return sql`UPDATE ve_customer_memory SET ${setClauses}, updated_at = NOW() WHERE id = ${id}`;
  },
  getFacts: (memoryId, limit = 20) => sql`SELECT * FROM ve_customer_facts WHERE memory_id = ${memoryId} AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY extracted_at DESC LIMIT ${limit}`,
  addFact: (memoryId, fact, category, confidence, sessionId) => sql`INSERT INTO ve_customer_facts (memory_id, fact, category, confidence, source_session_id) VALUES (${memoryId}, ${fact}, ${category}, ${confidence}, ${sessionId || null})`,
  getCallHistory: (memoryId, limit = 5) => sql`SELECT * FROM ve_conversation_memory WHERE memory_id = ${memoryId} ORDER BY call_date DESC LIMIT ${limit}`,
  addCallSummary: (memoryId, sessionId, duration, direction, summary, outcome, sentiment, topics) => sql`INSERT INTO ve_conversation_memory (memory_id, session_id, duration_seconds, direction, summary, outcome, sentiment, topics) VALUES (${memoryId}, ${sessionId}, ${duration}, ${direction}, ${summary}, ${outcome}, ${sentiment}, ${topics})`,
  incrementCallCount: (id, duration) => sql`UPDATE ve_customer_memory SET total_calls = total_calls + 1, total_duration_seconds = total_duration_seconds + ${duration}, last_interaction_at = NOW(), updated_at = NOW() WHERE id = ${id}`
};
class MemoryService {
  /**
   * Load or create customer memory for an incoming call
   */
  async loadOrCreateMemory(userId, phoneNumber) {
    const result = await db.execute(QUERIES.findCustomer(userId, phoneNumber));
    let customer = result.rows[0];
    if (!customer) {
      const createResult = await db.execute(QUERIES.createCustomer(userId, phoneNumber));
      customer = createResult.rows[0];
    }
    const factsResult = await db.execute(QUERIES.getFacts(customer.id));
    const facts = factsResult.rows.map((row) => ({
      id: row.id,
      fact: row.fact,
      category: row.category,
      confidence: row.confidence,
      source: row.source_session_id || "",
      extractedAt: new Date(row.extracted_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : void 0
    }));
    const historyResult = await db.execute(QUERIES.getCallHistory(customer.id));
    const callHistory = historyResult.rows.map((row) => ({
      callId: row.session_id,
      date: new Date(row.call_date),
      duration: row.duration_seconds,
      direction: row.direction,
      summary: row.summary,
      outcome: row.outcome,
      sentiment: row.sentiment,
      topics: row.topics
    }));
    return {
      customerId: customer.id,
      phoneNumber,
      profile: {
        name: customer.customer_name || void 0,
        email: customer.customer_email || void 0,
        company: customer.customer_company || void 0,
        language: customer.language || void 0,
        timezone: customer.timezone || void 0,
        tags: customer.tags || [],
        customFields: customer.custom_fields || {}
      },
      preferences: {},
      facts,
      callHistory,
      lastInteraction: customer.last_interaction_at ? new Date(customer.last_interaction_at) : void 0
    };
  }
  /**
   * Store post-call data: summary, facts, and update customer record
   */
  async storePostCallData(userId, customerId, sessionId, duration, direction, summary, outcome, sentiment, topics, extractedFacts) {
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
    for (const fact of extractedFacts) {
      await db.execute(
        QUERIES.addFact(customerId, fact.fact, fact.category, fact.confidence, sessionId)
      );
    }
    await db.execute(QUERIES.incrementCallCount(customerId, duration));
    console.log(
      `[MemoryService] Stored post-call data for customer ${customerId}: ${extractedFacts.length} facts, 1 summary`
    );
  }
  /**
   * Update customer profile fields
   */
  async updateProfile(customerId, updates) {
    const dbUpdates = {};
    if (updates.name !== void 0) dbUpdates.customer_name = updates.name;
    if (updates.email !== void 0) dbUpdates.customer_email = updates.email;
    if (updates.company !== void 0) dbUpdates.customer_company = updates.company;
    if (updates.language !== void 0) dbUpdates.language = updates.language;
    if (updates.timezone !== void 0) dbUpdates.timezone = updates.timezone;
    if (updates.tags !== void 0) dbUpdates.tags = updates.tags;
    if (updates.customFields !== void 0) dbUpdates.custom_fields = JSON.stringify(updates.customFields);
    if (Object.keys(dbUpdates).length > 0) {
      await db.execute(QUERIES.updateCustomer(customerId, dbUpdates));
    }
  }
  /**
   * Build context string from customer memory for LLM system prompt
   */
  buildContextFromMemory(memory) {
    const lines = [];
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
      lines.push("\nImportant customer facts:");
      for (const fact of memory.facts.slice(0, 8)) {
        lines.push(`\u2022 ${fact.fact}`);
      }
    }
    return lines.join("\n");
  }
}
export {
  MemoryService
};
