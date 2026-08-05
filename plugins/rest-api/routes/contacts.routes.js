import { Router } from "express";
import { apiAuthMiddleware, asyncHandler } from "../middleware/auth.middleware.js";
import { db } from "../../../server/db.js";
import { leads } from "../../../shared/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
const router = Router();
const createContactSchema = z.object({
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.unknown()).optional()
});
const updateContactSchema = z.object({
  phone: z.string().min(10, "Phone number must be at least 10 digits").optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")).optional(),
  company: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.unknown()).optional(),
  stage: z.string().optional()
});
const bulkImportSchema = z.object({
  contacts: z.array(createContactSchema).min(1).max(1e4),
  skipDuplicates: z.boolean().optional().default(true)
});
router.get(
  "/",
  apiAuthMiddleware("contacts:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 100);
    const offset = (page - 1) * pageSize;
    const [contactList, countResult] = await Promise.all([
      db.select().from(leads).where(eq(leads.userId, userId)).orderBy(desc(leads.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: sql`count(*)` }).from(leads).where(eq(leads.userId, userId))
    ]);
    const totalItems = Number(countResult[0]?.count || 0);
    const response = {
      success: true,
      data: contactList.map((c) => ({
        id: c.id,
        phone: c.phone,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        company: c.company,
        tags: c.tags,
        customFields: c.customFields,
        stage: c.stage,
        leadScore: c.leadScore,
        aiSummary: c.aiSummary,
        sentiment: c.sentiment,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      })),
      meta: {
        requestId: req.requestId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
          hasNext: page < Math.ceil(totalItems / pageSize),
          hasPrev: page > 1
        }
      }
    };
    res.json(response);
  })
);
router.post(
  "/",
  apiAuthMiddleware("contacts:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const parseResult = createContactSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response2 = {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: { errors: parseResult.error.flatten().fieldErrors }
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const data = parseResult.data;
    const [existing] = await db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.phone, data.phone))).limit(1);
    if (existing) {
      const response2 = {
        success: false,
        error: { code: "ALREADY_EXISTS", message: "Contact with this phone number already exists." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(409).json(response2);
    }
    const [contact] = await db.insert(leads).values({
      userId,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || void 0,
      company: data.company,
      tags: data.tags,
      customFields: data.customFields,
      sourceType: "api",
      // Created via API
      stage: "new"
    }).returning();
    const response = {
      success: true,
      data: {
        id: contact.id,
        phone: contact.phone,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        company: contact.company,
        tags: contact.tags,
        customFields: contact.customFields,
        stage: contact.stage,
        createdAt: contact.createdAt
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.status(201).json(response);
  })
);
router.get(
  "/:id",
  apiAuthMiddleware("contacts:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [contact] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
    if (!contact) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Contact not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const response = {
      success: true,
      data: contact,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.put(
  "/:id",
  apiAuthMiddleware("contacts:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [existing] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
    if (!existing) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Contact not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const parseResult = updateContactSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response2 = {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: { errors: parseResult.error.flatten().fieldErrors }
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const { phone, firstName, lastName, email, company, tags, customFields, stage } = parseResult.data;
    const [updated] = await db.update(leads).set({
      phone: phone ?? existing.phone,
      firstName: firstName ?? existing.firstName,
      lastName: lastName ?? existing.lastName,
      email: email ?? existing.email,
      company: company ?? existing.company,
      tags: tags ?? existing.tags,
      customFields: customFields ?? existing.customFields,
      stage: stage ?? existing.stage,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(leads.id, id)).returning();
    const response = {
      success: true,
      data: updated,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.delete(
  "/:id",
  apiAuthMiddleware("contacts:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const result = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).returning();
    if (result.length === 0) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Contact not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const response = {
      success: true,
      data: { deleted: true },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.post(
  "/bulk-import",
  apiAuthMiddleware("contacts:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const parseResult = bulkImportSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response2 = {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: { errors: parseResult.error.flatten().fieldErrors }
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const { contacts: newContacts, skipDuplicates } = parseResult.data;
    let imported = 0;
    let skipped = 0;
    const errors = [];
    for (let i = 0; i < newContacts.length; i++) {
      const contact = newContacts[i];
      try {
        const [existing] = await db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.phone, contact.phone))).limit(1);
        if (existing) {
          if (skipDuplicates) {
            skipped++;
            continue;
          } else {
            errors.push({ row: i + 1, phone: contact.phone, error: "Duplicate phone number" });
            continue;
          }
        }
        await db.insert(leads).values({
          userId,
          phone: contact.phone,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email || void 0,
          company: contact.company,
          tags: contact.tags,
          customFields: contact.customFields,
          sourceType: "api",
          stage: "new"
        });
        imported++;
      } catch (error) {
        errors.push({ row: i + 1, phone: contact.phone, error: error.message });
      }
    }
    const responseData = {
      imported,
      skipped,
      errors: errors.map((e) => ({ row: e.row, phoneNumber: e.phone, error: e.error }))
    };
    const response = {
      success: true,
      data: responseData,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.status(201).json(response);
  })
);
var contacts_routes_default = router;
export {
  contacts_routes_default as default
};
