import { Router, type Request, type Response } from "express";
import { ComplianceDndService } from "../services/compliance-dnd.service";
import { logger } from "../utils/logger";

export const complianceRouter = Router();

// 1. Compliance Metrics & Summary
complianceRouter.get("/metrics", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const metrics = await ComplianceDndService.getComplianceMetrics(userId);
    res.json(metrics);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] metrics error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to load compliance metrics" });
  }
});

// 2. Settings (DND Scrub & AI Disclosure)
complianceRouter.get("/settings", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const settings = await ComplianceDndService.getSettings(userId);
    res.json(settings);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] get settings error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to get settings" });
  }
});

complianceRouter.put("/settings", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const updated = await ComplianceDndService.updateSettings(userId, req.body);
    res.json(updated);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] update settings error: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to update settings" });
  }
});

// 3. Check single number for DND in real time
complianceRouter.post("/check-dnd", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });

  try {
    const result = await ComplianceDndService.isNumberDnd(userId, phoneNumber);
    res.json(result);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] check-dnd error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to check DND" });
  }
});

// 4. DND Records List
complianceRouter.get("/dnd-records", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const search = req.query.search as string;
  const category = req.query.category as string;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const offset = parseInt(req.query.offset as string, 10) || 0;

  try {
    const data = await ComplianceDndService.listDndRecords(userId, { search, category, limit, offset });
    res.json(data);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] list dnd records error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to list DND records" });
  }
});

// 5. Add single number to DND
complianceRouter.post("/dnd-records", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { phoneNumber, category, reason } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });

  try {
    const created = await ComplianceDndService.addDndRecord(userId, { phoneNumber, category, reason });
    res.json(created);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] add dnd record error: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to add DND record" });
  }
});

// 6. Remove number from DND
complianceRouter.delete("/dnd-records/:id", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    await ComplianceDndService.removeDndRecord(userId, id);
    res.json({ success: true, message: "Record removed from DND list" });
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] remove dnd record error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to delete DND record" });
  }
});

// 7. Bulk Import DND Numbers
complianceRouter.post("/bulk-import", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { phoneNumbers, reason } = req.body;
  if (!Array.isArray(phoneNumbers)) {
    return res.status(400).json({ error: "phoneNumbers must be an array of strings" });
  }

  try {
    const result = await ComplianceDndService.bulkImportDnd(userId, phoneNumbers, reason);
    res.json(result);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] bulk import error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Bulk import failed" });
  }
});

// 8. Execute Indian DPDP 2023 "Right to be Forgotten"
complianceRouter.post("/dpdp-purge", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required for DPDP purge" });

  try {
    const result = await ComplianceDndService.executeDpdpPurge(userId, phoneNumber);
    res.json(result);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] dpdp-purge error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to execute DPDP purge" });
  }
});

// 9. Scrub Campaign Contacts before calling
complianceRouter.post("/scrub-campaign/:campaignId", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { campaignId } = req.params;
  try {
    const result = await ComplianceDndService.scrubCampaignContacts(userId, campaignId);
    res.json(result);
  } catch (err: any) {
    logger.error(`[ComplianceRoutes] scrub campaign error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to scrub campaign" });
  }
});
