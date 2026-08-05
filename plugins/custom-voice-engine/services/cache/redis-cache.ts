/**
 * Redis-based LLM Response Cache
 */
import { createHash } from 'crypto';

// Use ioredis if available, otherwise fallback to in-memory Map
let Redis: any;
try { Redis = (await import('ioredis')).default; } catch { Redis = null; }

export class RedisCache {
  private client: any = null;
  private fallbackMap: Map<string, { value: string; expiresAt: number }> = new Map();
  private connected = false;

  async connect(redisUrl?: string): Promise<void> {
    if (!redisUrl && !process.env.VE_REDIS_URL && !process.env.REDIS_URL) {
      console.log('[VE Cache] No Redis URL — using in-memory fallback');
      return;
    }

    if (!Redis) {
      console.log('[VE Cache] ioredis not available — using in-memory fallback');
      return;
    }

    try {
      this.client = new Redis(redisUrl || process.env.VE_REDIS_URL || process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keyPrefix: 've_cache:',
      });
      await this.client.connect();
      this.connected = true;
      console.log('[VE Cache] Redis connected');
    } catch (err: any) {
      console.warn('[VE Cache] Redis connection failed, using in-memory fallback:', err.message);
      this.client = null;
    }
  }

  async get(userId: string, prompt: string): Promise<string | null> {
    const key = this.makeKey(userId, prompt);

    if (this.connected && this.client) {
      try {
        const cached = await this.client.get(key);
        if (cached) {
          await this.client.hincrby(`${key}:meta`, 'hits', 1);
          return cached;
        }
      } catch { /* fallback */ }
    }

    const entry = this.fallbackMap.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    if (entry) this.fallbackMap.delete(key);
    return null;
  }

  async set(userId: string, prompt: string, response: string, ttlSeconds = 3600): Promise<void> {
    const key = this.makeKey(userId, prompt);

    if (this.connected && this.client) {
      try {
        await this.client.set(key, response, 'EX', ttlSeconds);
        return;
      } catch { /* fallback */ }
    }

    this.fallbackMap.set(key, { value: response, expiresAt: Date.now() + ttlSeconds * 1000 });
    // Cap fallback map size
    if (this.fallbackMap.size > 1000) {
      const first = this.fallbackMap.keys().next().value;
      if (first) this.fallbackMap.delete(first);
    }
  }

  async invalidate(userId: string, prompt: string): Promise<void> {
    const key = this.makeKey(userId, prompt);
    if (this.connected && this.client) {
      try { await this.client.del(key); } catch { /* ignore */ }
    }
    this.fallbackMap.delete(key);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.quit(); } catch { /* ignore */ }
    }
    this.fallbackMap.clear();
  }

  private makeKey(userId: string, prompt: string): string {
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    return `${userId}:${hash}`;
  }
}
