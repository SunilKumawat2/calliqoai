import { Router } from "express";
import { db } from "../../../server/db.js";
import { inArray } from "drizzle-orm";
import { globalSettings } from "../../../shared/schema.js";
const STORAGE_KEYS = {
  provider: "ve_recording_storage",
  retentionDays: "ve_recording_retention_days",
  bucket: "ve_recording_s3_bucket",
  region: "ve_recording_s3_region",
  accessKey: "ve_recording_s3_access_key",
  secretKey: "ve_recording_s3_secret_key",
  endpoint: "ve_recording_s3_endpoint",
  gcsBucket: "ve_recording_gcs_bucket",
  gcsProjectId: "ve_recording_gcs_project_id",
  gcsCredentials: "ve_recording_gcs_credentials"
};
function maskKey(key) {
  if (!key) return "";
  return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
}
function isMasked(value) {
  if (typeof value !== "string") return false;
  return value.includes("\u2022\u2022\u2022\u2022") || value === "";
}
function createAdminStorageRouter() {
  const router = Router();
  router.get("/", async (_req, res) => {
    try {
      const keys = Object.values(STORAGE_KEYS);
      const results = await db.select().from(globalSettings).where(inArray(globalSettings.key, keys));
      const settingsMap = {};
      for (const row of results) {
        settingsMap[row.key] = row.value;
      }
      const response = {
        provider: settingsMap[STORAGE_KEYS.provider] || "local",
        retentionDays: Number(settingsMap[STORAGE_KEYS.retentionDays] ?? 30),
        bucket: settingsMap[STORAGE_KEYS.bucket] || "",
        region: settingsMap[STORAGE_KEYS.region] || "",
        accessKey: settingsMap[STORAGE_KEYS.accessKey] || "",
        secretKey: settingsMap[STORAGE_KEYS.secretKey] ? maskKey(settingsMap[STORAGE_KEYS.secretKey]) : "",
        endpoint: settingsMap[STORAGE_KEYS.endpoint] || "",
        gcsBucket: settingsMap[STORAGE_KEYS.gcsBucket] || "",
        gcsProjectId: settingsMap[STORAGE_KEYS.gcsProjectId] || "",
        gcsCredentials: settingsMap[STORAGE_KEYS.gcsCredentials] ? maskKey(settingsMap[STORAGE_KEYS.gcsCredentials]) : ""
      };
      res.json({ success: true, data: response });
    } catch (err) {
      console.error("[VE Admin Storage] Error fetching settings:", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch storage settings" });
    }
  });
  router.post("/", async (req, res) => {
    try {
      const {
        provider,
        retentionDays,
        bucket,
        region,
        accessKey,
        secretKey,
        endpoint,
        gcsBucket,
        gcsProjectId,
        gcsCredentials
      } = req.body;
      const keys = Object.values(STORAGE_KEYS);
      const existingResults = await db.select().from(globalSettings).where(inArray(globalSettings.key, keys));
      const existingMap = {};
      for (const row of existingResults) {
        existingMap[row.key] = row.value;
      }
      const updates = [];
      updates.push({
        key: STORAGE_KEYS.provider,
        value: provider || "local",
        description: "Voice Engine: Recording storage provider"
      });
      updates.push({
        key: STORAGE_KEYS.retentionDays,
        value: retentionDays !== void 0 ? Number(retentionDays) : 30,
        description: "Voice Engine: Recording retention days"
      });
      updates.push({
        key: STORAGE_KEYS.bucket,
        value: bucket || "",
        description: "Voice Engine: S3 bucket name"
      });
      updates.push({
        key: STORAGE_KEYS.region,
        value: region || "",
        description: "Voice Engine: S3 region"
      });
      updates.push({
        key: STORAGE_KEYS.accessKey,
        value: accessKey || "",
        description: "Voice Engine: S3 access key ID"
      });
      const resolvedSecretKey = isMasked(secretKey) ? existingMap[STORAGE_KEYS.secretKey] || "" : secretKey || "";
      updates.push({
        key: STORAGE_KEYS.secretKey,
        value: resolvedSecretKey,
        description: "Voice Engine: S3 secret access key"
      });
      updates.push({
        key: STORAGE_KEYS.endpoint,
        value: endpoint || "",
        description: "Voice Engine: S3-compatible custom endpoint"
      });
      updates.push({
        key: STORAGE_KEYS.gcsBucket,
        value: gcsBucket || "",
        description: "Voice Engine: GCS bucket name"
      });
      updates.push({
        key: STORAGE_KEYS.gcsProjectId,
        value: gcsProjectId || "",
        description: "Voice Engine: GCS project ID"
      });
      const resolvedGcsCredentials = isMasked(gcsCredentials) ? existingMap[STORAGE_KEYS.gcsCredentials] || "" : gcsCredentials || "";
      updates.push({
        key: STORAGE_KEYS.gcsCredentials,
        value: resolvedGcsCredentials,
        description: "Voice Engine: GCS service account credentials JSON"
      });
      for (const update of updates) {
        await db.insert(globalSettings).values({
          key: update.key,
          value: update.value,
          description: update.description
        }).onConflictDoUpdate({
          target: globalSettings.key,
          set: { value: update.value }
        });
      }
      res.json({ success: true, message: "Recording storage settings saved successfully" });
    } catch (err) {
      console.error("[VE Admin Storage] Error saving settings:", err.message);
      res.status(500).json({ success: false, error: "Failed to save storage settings" });
    }
  });
  router.post("/activate", async (req, res) => {
    const { provider } = req.body;
    if (!["local", "s3", "gcs", "do_spaces", "wasabi"].includes(provider)) {
      return res.status(400).json({ success: false, error: "Invalid provider" });
    }
    await db.insert(globalSettings).values({ key: "ve_storage_active_provider", value: provider, description: "Active storage provider" }).onConflictDoUpdate({ target: globalSettings.key, set: { value: provider } });
    res.json({ success: true, activeProvider: provider });
  });
  router.post("/test", async (req, res) => {
    try {
      const {
        provider,
        bucket,
        region,
        accessKey,
        secretKey,
        endpoint,
        gcsBucket,
        gcsProjectId,
        gcsCredentials
      } = req.body;
      if (provider === "local") {
        return res.json({ success: true, message: "Local storage does not require connection test" });
      }
      let finalSecretKey = secretKey;
      let finalGcsCredentials = gcsCredentials;
      if (isMasked(secretKey) || isMasked(gcsCredentials)) {
        const keys = [STORAGE_KEYS.secretKey, STORAGE_KEYS.gcsCredentials];
        const results = await db.select().from(globalSettings).where(inArray(globalSettings.key, keys));
        const existingMap = {};
        for (const row of results) {
          existingMap[row.key] = row.value;
        }
        if (isMasked(secretKey)) {
          finalSecretKey = existingMap[STORAGE_KEYS.secretKey] || "";
        }
        if (isMasked(gcsCredentials)) {
          finalGcsCredentials = existingMap[STORAGE_KEYS.gcsCredentials] || "";
        }
      }
      if (["s3", "do_spaces", "wasabi"].includes(provider)) {
        if (!bucket || !region || !accessKey || !finalSecretKey) {
          return res.status(400).json({ success: false, message: "Bucket, Region, Access Key, and Secret Key are required" });
        }
        try {
          const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
          const s3Config = {
            region,
            credentials: {
              accessKeyId: accessKey,
              secretAccessKey: finalSecretKey
            }
          };
          if (endpoint) {
            s3Config.endpoint = endpoint;
          } else if (provider === "do_spaces") {
            s3Config.endpoint = `https://${region}.digitaloceanspaces.com`;
          } else if (provider === "wasabi") {
            s3Config.endpoint = `https://s3.${region}.wasabisys.com`;
          }
          const client = new S3Client(s3Config);
          await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
          return res.json({ success: true, message: `Successfully connected to ${provider} bucket "${bucket}"` });
        } catch (s3Err) {
          if (s3Err.code === "MODULE_NOT_FOUND" || s3Err.message?.includes("Cannot find module")) {
            console.warn("[VE Admin Storage] S3 client module not found, using HTTP check fallback");
            const host = endpoint ? new URL(endpoint).host : provider === "do_spaces" ? `${bucket}.${region}.digitaloceanspaces.com` : provider === "wasabi" ? `${bucket}.s3.${region}.wasabisys.com` : `${bucket}.s3.${region}.amazonaws.com`;
            try {
              const dns = await import("dns").then((m) => m.promises);
              await dns.lookup(host);
              return res.json({
                success: true,
                message: `Credentials configured. Host "${host}" is resolvable (AWS SDK is not installed on the server to perform full bucket API test).`
              });
            } catch (dnsErr) {
              return res.json({
                success: false,
                message: `Failed to resolve storage host "${host}": ${dnsErr.message}`
              });
            }
          }
          return res.json({ success: false, message: `Connection failed: ${s3Err.message}` });
        }
      }
      if (provider === "gcs") {
        if (!gcsBucket || !gcsProjectId || !finalGcsCredentials) {
          return res.status(400).json({ success: false, message: "Bucket Name, Project ID, and Service Account JSON are required" });
        }
        try {
          JSON.parse(finalGcsCredentials);
        } catch {
          return res.status(400).json({ success: false, message: "Invalid Service Account JSON format" });
        }
        try {
          const { Storage } = await import("@google-cloud/storage");
          const credentials = JSON.parse(finalGcsCredentials);
          const storageClient = new Storage({
            projectId: gcsProjectId,
            credentials
          });
          await storageClient.bucket(gcsBucket).exists();
          return res.json({ success: true, message: `Successfully authenticated GCS bucket "${gcsBucket}"` });
        } catch (gcsErr) {
          if (gcsErr.code === "MODULE_NOT_FOUND" || gcsErr.message?.includes("Cannot find module")) {
            return res.json({
              success: true,
              message: "GCS credentials format validated (Google Cloud Storage SDK not installed on the server for full bucket API check)."
            });
          }
          return res.json({ success: false, message: `GCS Auth failed: ${gcsErr.message}` });
        }
      }
      res.status(400).json({ success: false, message: `Unsupported provider: ${provider}` });
    } catch (err) {
      console.error("[VE Admin Storage] Connection test error:", err.message);
      res.status(500).json({ success: false, message: `Test failed: ${err.message}` });
    }
  });
  return router;
}
export {
  createAdminStorageRouter
};
