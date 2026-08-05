/**
 * ============================================================
 * REST API Plugin - Analytics Routes
 * Endpoints for viewing call and campaign analytics
 * ============================================================
 */

import { Router, Response } from 'express';
import { apiAuthMiddleware, asyncHandler } from '../middleware/auth.middleware.js';
import type { AuthenticatedApiRequest, ApiResponse, CallAnalytics } from '../types.js';
import { db } from '../../../server/db.js';
import { calls, plivoCalls, twilioOpenaiCalls, campaigns, creditTransactions } from '../../../shared/schema.js';
import { eq, and, gte, desc, sql } from 'drizzle-orm';

const router = Router();

/**
 * GET /v1/analytics/calls - Get call analytics
 */
router.get(
  '/calls',
  apiAuthMiddleware('analytics:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const days = parseInt(req.query.days as string) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get calls from all engines
    const [elevenLabsStats, plivoStats, twilioStats, creditsResult] = await Promise.all([
      db
        .select({
          totalCalls: sql<number>`count(*)`,
          completedCalls: sql<number>`count(*) filter (where status = 'completed')`,
          failedCalls: sql<number>`count(*) filter (where status = 'failed')`,
          totalDuration: sql<number>`coalesce(sum(duration), 0)`,
        })
        .from(calls)
        .where(and(eq(calls.userId, userId), gte(calls.createdAt, startDate))),
      db
        .select({
          totalCalls: sql<number>`count(*)`,
          completedCalls: sql<number>`count(*) filter (where status = 'completed')`,
          failedCalls: sql<number>`count(*) filter (where status = 'failed')`,
          totalDuration: sql<number>`coalesce(sum(duration), 0)`,
        })
        .from(plivoCalls)
        .where(and(eq(plivoCalls.userId, userId), gte(plivoCalls.createdAt, startDate))),
      db
        .select({
          totalCalls: sql<number>`count(*)`,
          completedCalls: sql<number>`count(*) filter (where status = 'completed')`,
          failedCalls: sql<number>`count(*) filter (where status = 'failed')`,
          totalDuration: sql<number>`coalesce(sum(duration), 0)`,
        })
        .from(twilioOpenaiCalls)
        .where(and(eq(twilioOpenaiCalls.userId, userId), gte(twilioOpenaiCalls.createdAt, startDate))),
      db
        .select({
          totalCredits: sql<number>`coalesce(sum(abs(amount)), 0)`,
        })
        .from(creditTransactions)
        .where(and(
          eq(creditTransactions.userId, userId),
          gte(creditTransactions.createdAt, startDate),
          sql`amount < 0`
        )),
    ]);
    
    const combined = {
      totalCalls: Number(elevenLabsStats[0]?.totalCalls || 0) + Number(plivoStats[0]?.totalCalls || 0) + Number(twilioStats[0]?.totalCalls || 0),
      completedCalls: Number(elevenLabsStats[0]?.completedCalls || 0) + Number(plivoStats[0]?.completedCalls || 0) + Number(twilioStats[0]?.completedCalls || 0),
      failedCalls: Number(elevenLabsStats[0]?.failedCalls || 0) + Number(plivoStats[0]?.failedCalls || 0) + Number(twilioStats[0]?.failedCalls || 0),
      totalDuration: Number(elevenLabsStats[0]?.totalDuration || 0) + Number(plivoStats[0]?.totalDuration || 0) + Number(twilioStats[0]?.totalDuration || 0),
      totalCredits: Number(creditsResult[0]?.totalCredits || 0),
    };
    
    const analytics: CallAnalytics = {
      totalCalls: combined.totalCalls,
      completedCalls: combined.completedCalls,
      failedCalls: combined.failedCalls,
      totalDurationMinutes: Math.round(combined.totalDuration / 60),
      averageDurationSeconds: combined.totalCalls > 0 ? Math.round(combined.totalDuration / combined.totalCalls) : 0,
      creditsUsed: combined.totalCredits,
      period: {
        start: startDate.toISOString(),
        end: new Date().toISOString(),
      },
    };
    
    const response: ApiResponse<CallAnalytics> = {
      success: true,
      data: analytics,
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

/**
 * GET /v1/analytics/campaigns - Get campaign analytics
 */
router.get(
  '/campaigns',
  apiAuthMiddleware('analytics:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
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
    
    const analytics = campaignList.map(c => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      totalContacts: c.totalContacts || 0,
      completed: c.completedCalls || 0,
      successful: c.successfulCalls || 0,
      failed: c.failedCalls || 0,
      pending: (c.totalContacts || 0) - (c.completedCalls || 0),
      successRate: c.totalContacts > 0 
        ? Math.round(((c.successfulCalls || 0) / c.totalContacts) * 100) 
        : 0,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      createdAt: c.createdAt,
    }));
    
    const response: ApiResponse = {
      success: true,
      data: analytics,
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
 * GET /v1/analytics/summary - Get overall analytics summary
 */
router.get(
  '/summary',
  apiAuthMiddleware('analytics:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const days = parseInt(req.query.days as string) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const callCountSelect = {
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
    };
    const [elevenLabsStats, plivoStats, twilioStats, campaignStats] = await Promise.all([
      db.select(callCountSelect).from(calls)
        .where(and(eq(calls.userId, userId), gte(calls.createdAt, startDate))),
      db.select(callCountSelect).from(plivoCalls)
        .where(and(eq(plivoCalls.userId, userId), gte(plivoCalls.createdAt, startDate))),
      db.select(callCountSelect).from(twilioOpenaiCalls)
        .where(and(eq(twilioOpenaiCalls.userId, userId), gte(twilioOpenaiCalls.createdAt, startDate))),
      db
        .select({
          total: sql<number>`count(*)`,
          running: sql<number>`count(*) filter (where status = 'running')`,
          completed: sql<number>`count(*) filter (where status = 'completed')`,
        })
        .from(campaigns)
        .where(eq(campaigns.userId, userId)),
    ]);
    
    const totalCalls = Number(elevenLabsStats[0]?.total || 0) + Number(plivoStats[0]?.total || 0) + Number(twilioStats[0]?.total || 0);
    const completedCalls = Number(elevenLabsStats[0]?.completed || 0) + Number(plivoStats[0]?.completed || 0) + Number(twilioStats[0]?.completed || 0);
    
    const response: ApiResponse = {
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days,
        },
        calls: {
          total: totalCalls,
          completed: completedCalls,
        },
        campaigns: {
          total: Number(campaignStats[0]?.total || 0),
          running: Number(campaignStats[0]?.running || 0),
          completed: Number(campaignStats[0]?.completed || 0),
        },
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

export default router;
