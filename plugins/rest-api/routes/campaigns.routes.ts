/**
 * ============================================================
 * REST API Plugin - Campaigns Routes
 * Endpoints for creating and managing campaigns
 * ============================================================
 */

import { Router, Response } from 'express';
import multer from 'multer';
import { apiAuthMiddleware, asyncHandler } from '../middleware/auth.middleware.js';
import type { AuthenticatedApiRequest, ApiResponse, CreateCampaignRequest, AddCampaignContactsRequest } from '../types.js';
import { db } from '../../../server/db.js';
import { campaigns, contacts, agents, phoneNumbers, users } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contactUploadService } from '../../../server/services/contact-upload-service.js';

const csvUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

const router = Router();

// Validation schemas
const createCampaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  agentId: z.string().uuid('Invalid agent ID'),
  phoneNumberId: z.string().uuid().optional(),
  engine: z.enum(['elevenlabs', 'plivo', 'twilio-openai']).optional(),
  scheduledStartTime: z.string().datetime().optional(),
  timezone: z.string().optional(),
  callWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  callWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(100).optional(),
  retryAttempts: z.number().int().min(0).max(5).optional(),
  retryDelayMinutes: z.number().int().min(1).max(1440).optional(),
});

const addContactsSchema = z.object({
  contacts: z.array(z.object({
    phoneNumber: z.string().min(10),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    customFields: z.record(z.string()).optional(),
  })).min(1).max(10000),
});

/**
 * POST /v1/campaigns - Create a new campaign with optional CSV contacts
 * Accepts multipart/form-data with campaign fields and optional contacts CSV file
 */
router.post(
  '/',
  apiAuthMiddleware('campaigns:write'),
  csvUpload.single('contacts'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    
    // Parse campaign data from form fields
    // Support both JSON string in 'data' field or individual form fields
    let campaignData: any;
    if (req.body.data) {
      try {
        campaignData = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
      } catch {
        const response: ApiResponse = {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON in data field' },
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        };
        return res.status(400).json(response);
      }
    } else {
      // Parse individual form fields
      campaignData = {
        name: req.body.name,
        agentId: req.body.agentId,
        phoneNumberId: req.body.phoneNumberId,
        engine: req.body.engine,
        scheduledStartTime: req.body.scheduledStartTime,
        timezone: req.body.timezone,
        callWindowStart: req.body.callWindowStart,
        callWindowEnd: req.body.callWindowEnd,
        maxConcurrentCalls: req.body.maxConcurrentCalls ? parseInt(req.body.maxConcurrentCalls) : undefined,
        retryAttempts: req.body.retryAttempts ? parseInt(req.body.retryAttempts) : undefined,
        retryDelayMinutes: req.body.retryDelayMinutes ? parseInt(req.body.retryDelayMinutes) : undefined,
      };
    }
    
    const parseResult = createCampaignSchema.safeParse(campaignData);
    if (!parseResult.success) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: { errors: parseResult.error.flatten().fieldErrors },
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
    
    const data = parseResult.data;
    
    // Verify agent exists and belongs to user
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, data.agentId), eq(agents.userId, userId)))
      .limit(1);
    
    if (!agent) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent not found or does not belong to you.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    // Get phone number if specified
    let fromPhoneId = data.phoneNumberId;
    if (!fromPhoneId) {
      const [userPhone] = await db
        .select()
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.userId, userId), eq(phoneNumbers.status, 'active')))
        .limit(1);
      if (userPhone) {
        fromPhoneId = userPhone.id;
      }
    }
    
    // Create campaign
    const [campaign] = await db
      .insert(campaigns)
      .values({
        userId,
        agentId: data.agentId,
        phoneNumberId: fromPhoneId,
        name: data.name,
        status: 'draft',
        scheduledStartTime: data.scheduledStartTime ? new Date(data.scheduledStartTime) : undefined,
        timezone: data.timezone || 'UTC',
        callWindowStart: data.callWindowStart || '09:00',
        callWindowEnd: data.callWindowEnd || '18:00',
        maxConcurrentCalls: data.maxConcurrentCalls || 5,
        retryAttempts: data.retryAttempts || 2,
        retryDelayMinutes: data.retryDelayMinutes || 30,
      })
      .returning();
    
    // Process CSV contacts if file was uploaded
    let contactStats = null;
    if (req.file) {
      try {
        const fileContent = await contactUploadService.readFileContent(req.file);
        const parsedContacts = contactUploadService.parseContactsFromCSV(fileContent, campaign.id);
        
        if (parsedContacts.length > 0) {
          const validContacts = parsedContacts.filter(c => c.phone && c.phone.trim().length >= 10);
          const invalidCount = parsedContacts.length - validContacts.length;
          
          let added = 0;
          let skipped = 0;
          
          for (const contact of validContacts) {
            const [existing] = await db
              .select()
              .from(contacts)
              .where(and(eq(contacts.campaignId, campaign.id), eq(contacts.phone, contact.phone)))
              .limit(1);
            
            if (existing) {
              skipped++;
              continue;
            }
            
            await db
              .insert(contacts)
              .values({
                campaignId: campaign.id,
                phone: contact.phone,
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                customFields: contact.customFields,
                status: 'pending',
              });
            
            added++;
          }
          
          // Update campaign contact count (use SQL increment for consistency)
          await db
            .update(campaigns)
            .set({ totalContacts: sql`COALESCE(${campaigns.totalContacts}, 0) + ${added}` })
            .where(eq(campaigns.id, campaign.id));
          
          contactStats = {
            fileName: req.file.originalname,
            totalRows: parsedContacts.length,
            contactsAdded: added,
            contactsSkipped: skipped,
            invalidRows: invalidCount,
          };
        }
      } catch (error: any) {
        // Log error but don't fail campaign creation
        console.error('[Campaigns API] CSV processing error:', error.message);
        contactStats = {
          fileName: req.file.originalname,
          error: 'Failed to parse CSV file',
        };
      }
    }
    
    const response: ApiResponse = {
      success: true,
      data: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        agentId: campaign.agentId,
        phoneNumberId: campaign.phoneNumberId,
        scheduledStartTime: campaign.scheduledStartTime,
        timezone: campaign.timezone,
        callWindowStart: campaign.callWindowStart,
        callWindowEnd: campaign.callWindowEnd,
        maxConcurrentCalls: campaign.maxConcurrentCalls,
        createdAt: campaign.createdAt,
        ...(contactStats && { contacts: contactStats }),
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.status(201).json(response);
  })
);

/**
 * GET /v1/campaigns - List campaigns
 */
router.get(
  '/',
  apiAuthMiddleware('campaigns:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const offset = (page - 1) * pageSize;
    
    const [campaignList, countResult] = await Promise.all([
      db
        .select()
        .from(campaigns)
        .where(eq(campaigns.userId, userId))
        .orderBy(desc(campaigns.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(campaigns).where(eq(campaigns.userId, userId)),
    ]);
    
    const totalItems = Number(countResult[0]?.count || 0);
    
    const response: ApiResponse = {
      success: true,
      data: campaignList.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        agentId: c.agentId,
        totalContacts: c.totalContacts,
        calledContacts: c.calledContacts,
        scheduledStartTime: c.scheduledStartTime,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        createdAt: c.createdAt,
      })),
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
          hasNext: page < Math.ceil(totalItems / pageSize),
          hasPrev: page > 1,
        },
      },
    };
    
    res.json(response);
  })
);

/**
 * GET /v1/campaigns/:id - Get campaign details
 */
router.get(
  '/:id',
  apiAuthMiddleware('campaigns:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .limit(1);
    
    if (!campaign) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    const response: ApiResponse = {
      success: true,
      data: campaign,
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

/**
 * POST /v1/campaigns/:id/contacts - Add contacts to campaign
 */
router.post(
  '/:id/contacts',
  apiAuthMiddleware('campaigns:write'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    // Verify campaign exists
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .limit(1);
    
    if (!campaign) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'CONFLICT', message: 'Cannot add contacts to an active or completed campaign.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(409).json(response);
    }
    
    const parseResult = addContactsSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: { errors: parseResult.error.flatten().fieldErrors },
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
    
    const { contacts: newContacts } = parseResult.data;
    
    // Create contacts directly for this campaign with deduplication
    // Check for existing contacts by campaignId + phone before inserting
    let added = 0;
    let skipped = 0;
    
    for (const contact of newContacts) {
      // Check for duplicate phone number in this campaign
      const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.campaignId, id), eq(contacts.phone, contact.phoneNumber)))
        .limit(1);
      
      if (existing) {
        skipped++;
        continue;
      }
      
      await db
        .insert(contacts)
        .values({
          campaignId: id,
          phone: contact.phoneNumber,
          firstName: contact.firstName || 'Unknown',
          lastName: contact.lastName,
          email: contact.email,
          customFields: contact.customFields,
          status: 'pending',
        });
      
      added++;
    }
    
    // Update campaign contact count
    await db
      .update(campaigns)
      .set({ totalContacts: sql`${campaigns.totalContacts} + ${added}` })
      .where(eq(campaigns.id, id));
    
    const response: ApiResponse = {
      success: true,
      data: {
        campaignId: id,
        contactsAdded: added,
        contactsSkipped: skipped,
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.status(201).json(response);
  })
);

/**
 * POST /v1/campaigns/:id/start - Start a campaign
 */
router.post(
  '/:id/start',
  apiAuthMiddleware('campaigns:write'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .limit(1);
    
    if (!campaign) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    if (campaign.status === 'running') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'CONFLICT', message: 'Campaign is already running.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(409).json(response);
    }
    
    // Check credits
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.credits < campaign.totalContacts) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits to run this campaign.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(402).json(response);
    }
    
    // Start campaign
    await db
      .update(campaigns)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(eq(campaigns.id, id));
    
    const response: ApiResponse = {
      success: true,
      data: {
        campaignId: id,
        status: 'running',
        message: 'Campaign started successfully.',
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

/**
 * POST /v1/campaigns/:id/pause - Pause a campaign
 */
router.post(
  '/:id/pause',
  apiAuthMiddleware('campaigns:write'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .limit(1);
    
    if (!campaign) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    if (campaign.status !== 'running') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'CONFLICT', message: 'Campaign is not running.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(409).json(response);
    }
    
    await db
      .update(campaigns)
      .set({ status: 'paused' })
      .where(eq(campaigns.id, id));
    
    const response: ApiResponse = {
      success: true,
      data: {
        campaignId: id,
        status: 'paused',
        message: 'Campaign paused successfully.',
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

/**
 * POST /v1/campaigns/:id/contacts-upload - Upload CSV file with contacts
 */
router.post(
  '/:id/contacts-upload',
  apiAuthMiddleware('campaigns:write'),
  csvUpload.single('file'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    // Check if file was uploaded
    if (!req.file) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No CSV file provided. Upload a file with field name "file".' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
    
    // Verify campaign exists and belongs to user
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .limit(1);
    
    if (!campaign) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'CONFLICT', message: 'Cannot add contacts to an active or completed campaign.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(409).json(response);
    }
    
    try {
      // Parse CSV file
      const fileContent = await contactUploadService.readFileContent(req.file);
      const parsedContacts = contactUploadService.parseContactsFromCSV(fileContent, id);
      
      if (parsedContacts.length === 0) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'CSV file is empty or has no valid rows.' },
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        };
        return res.status(400).json(response);
      }
      
      // Filter out contacts without valid phone numbers
      const validContacts = parsedContacts.filter(c => c.phone && c.phone.trim().length >= 10);
      const invalidCount = parsedContacts.length - validContacts.length;
      
      // Check for duplicates and insert contacts
      let added = 0;
      let skipped = 0;
      
      for (const contact of validContacts) {
        // Check for duplicate phone number in this campaign
        const [existing] = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.campaignId, id), eq(contacts.phone, contact.phone)))
          .limit(1);
        
        if (existing) {
          skipped++;
          continue;
        }
        
        await db
          .insert(contacts)
          .values({
            campaignId: id,
            phone: contact.phone,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            customFields: contact.customFields,
            status: 'pending',
          });
        
        added++;
      }
      
      // Update campaign contact count and store CSV filename
      await db
        .update(campaigns)
        .set({ 
          totalContacts: sql`${campaigns.totalContacts} + ${added}`,
        })
        .where(eq(campaigns.id, id));
      
      const response: ApiResponse = {
        success: true,
        data: {
          campaignId: id,
          fileName: req.file.originalname,
          totalRows: parsedContacts.length,
          contactsAdded: added,
          contactsSkipped: skipped,
          invalidRows: invalidCount,
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      
      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse = {
        success: false,
        error: { 
          code: 'VALIDATION_ERROR', 
          message: 'Failed to parse CSV file.',
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
  })
);

export default router;
