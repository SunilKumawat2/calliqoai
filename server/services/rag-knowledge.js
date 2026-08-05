import OpenAI from "openai";
import { db } from "../db.js";
import {
  knowledgeChunks,
  knowledgeProcessingQueue,
  userKnowledgeStorageLimits,
  globalSettings
} from "../../shared/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const MAX_CHUNK_CHARS = 2e3;
const DEFAULT_STORAGE_LIMIT_BYTES = 20 * 1024 * 1024;
let openaiClient = null;
let lastApiKey = null;
async function getOpenAIApiKey() {
  try {
    const [dbSetting] = await db.select().from(globalSettings).where(eq(globalSettings.key, "openai_api_key")).limit(1);
    if (dbSetting?.value) {
      return dbSetting.value;
    }
  } catch (e) {
  }
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  throw new Error("OPENAI_API_KEY is required for RAG knowledge system. Configure it in Admin Settings or as an environment variable.");
}
async function getOpenAIClient() {
  const apiKey = await getOpenAIApiKey();
  if (!openaiClient || lastApiKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    lastApiKey = apiKey;
  }
  return openaiClient;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function chunkText(text, maxChars = MAX_CHUNK_CHARS, overlapChars = 200) {
  const chunks = [];
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (cleanText.length <= maxChars) {
    return [cleanText];
  }
  let start = 0;
  while (start < cleanText.length) {
    let end = start + maxChars;
    if (end < cleanText.length) {
      const lastPeriod = cleanText.lastIndexOf(".", end);
      const lastNewline = cleanText.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + maxChars / 2) {
        end = breakPoint + 1;
      }
    }
    const chunk = cleanText.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end - overlapChars;
    if (start >= cleanText.length) break;
  }
  return chunks;
}
async function generateEmbedding(text) {
  const openai = await getOpenAIClient();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  return response.data[0].embedding;
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
class RAGKnowledgeService {
  /**
   * Get or create storage limit for user
   */
  static async getUserStorageLimit(userId) {
    const [existing] = await db.select().from(userKnowledgeStorageLimits).where(eq(userKnowledgeStorageLimits.userId, userId));
    if (existing) {
      return { maxBytes: existing.maxStorageBytes, usedBytes: existing.usedStorageBytes };
    }
    await db.insert(userKnowledgeStorageLimits).values({
      userId,
      maxStorageBytes: DEFAULT_STORAGE_LIMIT_BYTES,
      usedStorageBytes: 0
    });
    return { maxBytes: DEFAULT_STORAGE_LIMIT_BYTES, usedBytes: 0 };
  }
  /**
   * Update used storage for user
   */
  static async updateUsedStorage(userId, deltaBytes) {
    await db.update(userKnowledgeStorageLimits).set({
      usedStorageBytes: sql`${userKnowledgeStorageLimits.usedStorageBytes} + ${deltaBytes}`,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(userKnowledgeStorageLimits.userId, userId));
  }
  /**
   * Check if user has enough storage space
   */
  static async checkStorageSpace(userId, requiredBytes) {
    const { maxBytes, usedBytes } = await this.getUserStorageLimit(userId);
    return usedBytes + requiredBytes <= maxBytes;
  }
  /**
   * Process and store knowledge base item with embeddings
   */
  static async processKnowledgeItem(knowledgeBaseId, userId, content, metadata) {
    try {
      console.log(`[RAG] Processing knowledge item ${knowledgeBaseId} for user ${userId}`);
      const contentSize = Buffer.byteLength(content, "utf8");
      const hasSpace = await this.checkStorageSpace(userId, contentSize);
      if (!hasSpace) {
        return {
          success: false,
          chunksCreated: 0,
          error: "Storage limit exceeded. Please delete some knowledge items or upgrade your plan."
        };
      }
      const [queueEntry] = await db.insert(knowledgeProcessingQueue).values({
        knowledgeBaseId,
        userId,
        status: "processing"
      }).returning();
      const chunks = chunkText(content);
      console.log(`[RAG] Created ${chunks.length} chunks from content`);
      await db.update(knowledgeProcessingQueue).set({ totalChunks: chunks.length }).where(eq(knowledgeProcessingQueue.id, queueEntry.id));
      let processedCount = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunkText2 = chunks[i];
        try {
          const embedding = await generateEmbedding(chunkText2);
          await db.insert(knowledgeChunks).values({
            knowledgeBaseId,
            userId,
            chunkIndex: i,
            chunkText: chunkText2,
            embedding,
            // Store as JSON array
            tokenCount: estimateTokens(chunkText2),
            metadata: { ...metadata, chunkIndex: i, totalChunks: chunks.length }
          });
          processedCount++;
          await db.update(knowledgeProcessingQueue).set({ processedChunks: processedCount, updatedAt: /* @__PURE__ */ new Date() }).where(eq(knowledgeProcessingQueue.id, queueEntry.id));
        } catch (chunkError) {
          console.error(`[RAG] Error processing chunk ${i}:`, chunkError.message);
          if (chunkError.code === "23503" || chunkError.message?.includes("foreign key constraint")) {
            console.log(`[RAG] Knowledge base ${knowledgeBaseId} was deleted. Stopping chunk processing.`);
            break;
          }
        }
        if (i < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await this.updateUsedStorage(userId, contentSize);
      await db.update(knowledgeProcessingQueue).set({ status: "completed", updatedAt: /* @__PURE__ */ new Date() }).where(eq(knowledgeProcessingQueue.id, queueEntry.id));
      console.log(`[RAG] Successfully processed ${processedCount}/${chunks.length} chunks`);
      return { success: true, chunksCreated: processedCount };
    } catch (error) {
      console.error(`[RAG] Error processing knowledge item:`, error.message);
      await db.update(knowledgeProcessingQueue).set({ status: "failed", errorMessage: error.message, updatedAt: /* @__PURE__ */ new Date() }).where(eq(knowledgeProcessingQueue.knowledgeBaseId, knowledgeBaseId));
      return { success: false, chunksCreated: 0, error: error.message };
    }
  }
  /**
   * Search knowledge base using semantic similarity
   */
  static async searchKnowledge(query, knowledgeBaseIds, userId, maxResults = 5) {
    try {
      console.log(`[RAG] Searching knowledge for: "${query.substring(0, 50)}..."`);
      if (knowledgeBaseIds.length === 0) {
        return [];
      }
      const queryEmbedding = await generateEmbedding(query);
      const chunks = await db.select().from(knowledgeChunks).where(
        and(
          inArray(knowledgeChunks.knowledgeBaseId, knowledgeBaseIds),
          eq(knowledgeChunks.userId, userId)
        )
      );
      if (chunks.length === 0) {
        console.log(`[RAG] No chunks found for knowledge bases`);
        return [];
      }
      console.log(`[RAG] Searching ${chunks.length} chunks`);
      const scoredChunks = chunks.filter((chunk) => chunk.embedding && Array.isArray(chunk.embedding)).map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        source: chunk.knowledgeBaseId
      })).sort((a, b) => b.score - a.score).slice(0, maxResults);
      console.log(`[RAG] Found ${scoredChunks.length} relevant chunks (top score: ${scoredChunks[0]?.score.toFixed(3) || "N/A"})`);
      return scoredChunks;
    } catch (error) {
      console.error(`[RAG] Search error:`, error.message);
      return [];
    }
  }
  /**
   * Format search results for agent consumption
   */
  static formatResultsForAgent(results, maxTokens = 500) {
    if (results.length === 0) {
      return "No relevant information found in the knowledge base.";
    }
    let output = "Based on the knowledge base:\n\n";
    let totalTokens = estimateTokens(output);
    for (const result of results) {
      const chunkTokens = estimateTokens(result.chunk.chunkText);
      if (totalTokens + chunkTokens > maxTokens) {
        const remainingTokens = maxTokens - totalTokens - 10;
        if (remainingTokens > 50) {
          const truncatedChars = remainingTokens * 4;
          output += `\u2022 ${result.chunk.chunkText.substring(0, truncatedChars)}...
`;
        }
        break;
      }
      output += `\u2022 ${result.chunk.chunkText}

`;
      totalTokens += chunkTokens + 5;
    }
    return output.trim();
  }
  /**
   * Delete all chunks for a knowledge base item
   */
  static async deleteKnowledgeChunks(knowledgeBaseId, userId) {
    const chunks = await db.select().from(knowledgeChunks).where(
      and(
        eq(knowledgeChunks.knowledgeBaseId, knowledgeBaseId),
        eq(knowledgeChunks.userId, userId)
      )
    );
    const totalSize = chunks.reduce((sum, chunk) => {
      return sum + Buffer.byteLength(chunk.chunkText, "utf8");
    }, 0);
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.knowledgeBaseId, knowledgeBaseId));
    await db.delete(knowledgeProcessingQueue).where(eq(knowledgeProcessingQueue.knowledgeBaseId, knowledgeBaseId));
    if (totalSize > 0) {
      await this.updateUsedStorage(userId, -totalSize);
    }
    console.log(`[RAG] Deleted ${chunks.length} chunks for knowledge base ${knowledgeBaseId}`);
  }
  /**
   * Get processing status for a knowledge base item
   */
  static async getProcessingStatus(knowledgeBaseId) {
    const [entry] = await db.select().from(knowledgeProcessingQueue).where(eq(knowledgeProcessingQueue.knowledgeBaseId, knowledgeBaseId)).orderBy(sql`${knowledgeProcessingQueue.createdAt} DESC`).limit(1);
    if (!entry) {
      return null;
    }
    const progress = entry.totalChunks ? (entry.processedChunks || 0) / entry.totalChunks * 100 : 0;
    return {
      status: entry.status,
      progress: Math.round(progress),
      error: entry.errorMessage || void 0
    };
  }
  /**
   * Get chunk count for a knowledge base item
   */
  static async getChunkCount(knowledgeBaseId) {
    const result = await db.select({ count: sql`count(*)` }).from(knowledgeChunks).where(eq(knowledgeChunks.knowledgeBaseId, knowledgeBaseId));
    return Number(result[0]?.count || 0);
  }
}
var rag_knowledge_default = RAGKnowledgeService;
export {
  RAGKnowledgeService,
  rag_knowledge_default as default
};
