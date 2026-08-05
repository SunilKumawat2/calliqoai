import { LlmProviderFactory } from "../providers/llm/llm-provider.factory.js";
const MAX_CONTEXT_MESSAGES = 40;
const SUMMARIZE_THRESHOLD = 30;
class ConversationEngine {
  messages = [];
  context;
  agentConfig;
  llmConfig;
  turnCount = 0;
  constructor(agentConfig, llmConfig, context) {
    this.agentConfig = agentConfig;
    this.llmConfig = llmConfig;
    this.context = context;
    this.messages.push({
      role: "system",
      content: this.buildSystemPrompt()
    });
  }
  /**
   * Add a user message and get the assistant's response
   */
  async processUserMessage(userText) {
    this.turnCount++;
    this.messages.push({ role: "user", content: userText });
    if (this.messages.length > SUMMARIZE_THRESHOLD) {
      await this.compressContext();
    }
    const llm = LlmProviderFactory.create(this.llmConfig.provider);
    let response = await llm.complete(
      this.messages,
      this.llmConfig,
      this.context.activeTools
    );
    let iterations = 0;
    while (response.toolCalls && response.toolCalls.length > 0 && iterations < 5) {
      iterations++;
      this.messages.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls
      });
      for (const toolCall of response.toolCalls) {
        const result = await this.executeTool(toolCall);
        this.messages.push({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: toolCall.id
        });
      }
      response = await llm.complete(
        this.messages,
        this.llmConfig,
        this.context.activeTools
      );
    }
    const assistantText = response.content || "";
    this.messages.push({ role: "assistant", content: assistantText });
    return assistantText;
  }
  /**
   * Generate a conversation summary for memory storage
   */
  async generateSummary() {
    const llm = LlmProviderFactory.create(this.llmConfig.provider);
    const summaryPrompt = [
      {
        role: "system",
        content: `You are a conversation analyst. Analyze the following conversation and return a JSON object with:
- "summary": A 2-3 sentence summary of the conversation
- "topics": Array of main topics discussed
- "sentiment": Overall customer sentiment ("positive", "neutral", or "negative")
- "outcome": Brief description of the call outcome
- "keyFacts": Array of important facts about the customer (preferences, complaints, requests, personal details)

Return ONLY valid JSON, no markdown or explanation.`
      },
      {
        role: "user",
        content: this.messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => `${m.role}: ${m.content}`).join("\n")
      }
    ];
    try {
      const response = await llm.complete(summaryPrompt, {
        ...this.llmConfig,
        temperature: 0.3,
        maxTokens: 500
      });
      const parsed = JSON.parse(response.content || "{}");
      return {
        summary: parsed.summary || "No summary available",
        topics: parsed.topics || [],
        sentiment: parsed.sentiment || "neutral",
        outcome: parsed.outcome || "Unknown",
        keyFacts: parsed.keyFacts || []
      };
    } catch (err) {
      console.error("[ConversationEngine] Summary generation failed:", err.message);
      return {
        summary: "Summary generation failed",
        topics: [],
        sentiment: "neutral",
        outcome: "Unknown",
        keyFacts: []
      };
    }
  }
  /**
   * Get current message count
   */
  getMessageCount() {
    return this.messages.length;
  }
  /**
   * Get full message history
   */
  getMessages() {
    return [...this.messages];
  }
  // ── Private ────────────────────────────────────────────
  buildSystemPrompt() {
    const parts = [this.llmConfig.systemPrompt || this.agentConfig.systemPrompt];
    if (this.context.customerMemory) {
      const mem = this.context.customerMemory;
      const memoryLines = ["## Customer Context"];
      if (mem.profile.name) memoryLines.push(`- Name: ${mem.profile.name}`);
      if (mem.profile.company) memoryLines.push(`- Company: ${mem.profile.company}`);
      if (mem.profile.language) memoryLines.push(`- Preferred Language: ${mem.profile.language}`);
      if (mem.facts.length > 0) {
        memoryLines.push("\n### Known Facts:");
        for (const fact of mem.facts.slice(0, 10)) {
          memoryLines.push(`- ${fact.fact}`);
        }
      }
      if (mem.callHistory.length > 0) {
        memoryLines.push("\n### Recent Interactions:");
        for (const call of mem.callHistory.slice(0, 3)) {
          memoryLines.push(`- ${call.date.toLocaleDateString()}: ${call.summary}`);
        }
      }
      parts.push(memoryLines.join("\n"));
    }
    if (this.context.businessRules && this.context.businessRules.length > 0) {
      parts.push("## Business Rules\n" + this.context.businessRules.map((r) => `- ${r}`).join("\n"));
    }
    if (this.context.knowledgeContext) {
      parts.push("## Knowledge Base\n" + this.context.knowledgeContext);
    }
    let result = parts.join("\n\n");
    const langMatch = result.match(/#{0,2}\s*CRITICAL LANGUAGE REQUIREMENT[\s\S]*?(?=\n\n|$)/);
    if (langMatch) {
      const langBlock = langMatch[0].trim();
      result = result.replace(langBlock, "").trim();
      result = result + "\n\n" + langBlock;
    }
    return result;
  }
  async compressContext() {
    if (this.messages.length <= SUMMARIZE_THRESHOLD) return;
    try {
      const llm = LlmProviderFactory.create(this.llmConfig.provider);
      const toSummarize = this.messages.slice(1, -10);
      const toKeep = this.messages.slice(-10);
      const summaryPrompt = [
        {
          role: "system",
          content: "Summarize the following conversation concisely, preserving all important details, customer requests, and decisions made. Return a brief paragraph."
        },
        {
          role: "user",
          content: toSummarize.map((m) => `${m.role}: ${m.content}`).join("\n")
        }
      ];
      const response = await llm.complete(summaryPrompt, {
        ...this.llmConfig,
        temperature: 0.2,
        maxTokens: 300
      });
      this.messages = [
        this.messages[0],
        // System prompt
        {
          role: "system",
          content: `[Previous conversation summary: ${response.content}]`
        },
        ...toKeep
      ];
      console.log(`[ConversationEngine] Context compressed: ${toSummarize.length} messages \u2192 summary`);
    } catch (err) {
      console.warn("[ConversationEngine] Context compression failed:", err.message);
      this.messages = [
        this.messages[0],
        ...this.messages.slice(-MAX_CONTEXT_MESSAGES)
      ];
    }
  }
  async executeTool(toolCall) {
    const startTime = Date.now();
    const name = toolCall.function.name;
    try {
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }
      console.log(`[ConversationEngine] Tool called: ${name}`, args);
      return {
        toolCallId: toolCall.id,
        name,
        success: true,
        result: { message: `Tool ${name} executed successfully` },
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      return {
        toolCallId: toolCall.id,
        name,
        success: false,
        result: null,
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }
}
export {
  ConversationEngine
};
