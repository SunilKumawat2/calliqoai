/**
 * ============================================================
 * REST API Plugin - Credits & Analytics Routes
 * Endpoints for viewing credits and analytics
 * ============================================================
 */

import { Router, Response } from 'express';
import { apiAuthMiddleware, asyncHandler } from '../middleware/auth.middleware.js';
import type { AuthenticatedApiRequest, ApiResponse, CreditsBalance, CreditsUsage, CallAnalytics } from '../types.js';
import { db } from '../../../server/db.js';
import { users, calls, plivoCalls, twilioOpenaiCalls, campaigns, creditTransactions } from '../../../shared/schema.js';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';

const router = Router();

/**
 * GET /v1/credits/balance - Get credit balance
 */
router.get(
  '/balance',
  apiAuthMiddleware('credits:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    
    const [user] = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    const balance: CreditsBalance = {
      available: user.credits,
      reserved: 0, // Could calculate from active campaigns
      total: user.credits,
      currency: 'credits',
    };
    
    const response: ApiResponse<CreditsBalance> = {
      success: true,
      data: balance,
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

/**
 * GET /v1/credits/usage - Get credit usage history
 */
router.get(
  '/usage',
  apiAuthMiddleware('credits:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const days = parseInt(req.query.days as string) || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get credit transactions
    const transactions = await db
      .select()
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.userId, userId),
        gte(creditTransactions.createdAt, startDate)
      ))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(1000);
    
    // Group by date
    const usageByDate: Record<string, { calls: number; minutes: number; credits: number }> = {};
    
    for (const tx of transactions) {
      const date = tx.createdAt.toISOString().split('T')[0];
      if (!usageByDate[date]) {
        usageByDate[date] = { calls: 0, minutes: 0, credits: 0 };
      }
      if (tx.type === 'deduction') {
        usageByDate[date].calls += 1;
        usageByDate[date].credits += Math.abs(tx.amount);
        usageByDate[date].minutes += Math.abs(tx.amount); // 1 credit = 1 minute
      }
    }
    
    const usage = Object.entries(usageByDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    const total = usage.reduce(
      (acc, day) => ({
        calls: acc.calls + day.calls,
        minutes: acc.minutes + day.minutes,
        credits: acc.credits + day.credits,
      }),
      { calls: 0, minutes: 0, credits: 0 }
    );
    
    const response: ApiResponse<CreditsUsage> = {
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
        },
        usage,
        total,
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

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
      db
        .select({ count: sql<number>`count(*)` })
        .from(campaigns)
        .where(eq(campaigns.userId, userId)),
    ]);
    
    const totalItems = Number(countResult[0]?.count || 0);
    
    const analytics = campaignList.map(c => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      totalContacts: c.totalContacts || 0,
      called: c.completedCalls || 0,
      connected: c.completedCalls || 0,
      completed: c.status === 'completed' ? c.totalContacts : c.completedCalls || 0,
      failed: c.failedCalls || 0,
      pending: (c.totalContacts || 0) - (c.completedCalls || 0),
      successRate: c.totalContacts > 0 
        ? Math.round(((c.successfulCalls || 0) / c.totalContacts) * 100) 
        : 0,
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

export default router;
