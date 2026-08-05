import { createHash } from "crypto";
let Redis;
try {
  Redis = (await import("ioredis")).default;
} catch {
  Redis = null;
}
class RedisCache {
  client = null;
  fallbackMap = /* @__PURE__ */ new Map();
  connected = false;
  async connect(redisUrl) {
    if (!redisUrl && !process.env.VE_REDIS_URL && !process.env.REDIS_URL) {
      console.log("[VE Cache] No Redis URL \u2014 using in-memory fallback");
      return;
    }
    if (!Redis) {
      console.log("[VE Cache] ioredis not available \u2014 using in-memory fallback");
      return;
    }
    try {
      this.client = new Redis(redisUrl || process.env.VE_REDIS_URL || process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keyPrefix: "ve_cache:"
      });
      await this.client.connect();
      this.connected = true;
      console.log("[VE Cache] Redis connected");
    } catch (err) {
      console.warn("[VE Cache] Redis connection failed, using in-memory fallback:", err.message);
      this.client = null;
    }
  }
  async get(userId, prompt) {
    const key = this.makeKey(userId, prompt);
    if (this.connected && this.client) {
      try {
        const cached = await this.client.get(key);
        if (cached) {
          await this.client.hincrby(`${key}:meta`, "hits", 1);
          return cached;
        }
      } catch {
      }
    }
    const entry = this.fallbackMap.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    if (entry) this.fallbackMap.delete(key);
    return null;
  }
  async set(userId, prompt, response, ttlSeconds = 3600) {
    const key = this.makeKey(userId, prompt);
    if (this.connected && this.client) {
      try {
        await this.client.set(key, response, "EX", ttlSeconds);
        return;
      } catch {
      }
    }
    this.fallbackMap.set(key, { value: response, expiresAt: Date.now() + ttlSeconds * 1e3 });
    if (this.fallbackMap.size > 1e3) {
      const first = this.fallbackMap.keys().next().value;
      if (first) this.fallbackMap.delete(first);
    }
  }
  async invalidate(userId, prompt) {
    const key = this.makeKey(userId, prompt);
    if (this.connected && this.client) {
      try {
        await this.client.del(key);
      } catch {
      }
    }
    this.fallbackMap.delete(key);
  }
  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
      }
    }
    this.fallbackMap.clear();
  }
  makeKey(userId, prompt) {
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    return `${userId}:${hash}`;
  }
}
export {
  RedisCache
};
