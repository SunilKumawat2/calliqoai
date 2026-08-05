import { Router } from "express";
import { apiAuthMiddleware, asyncHandler } from "../middleware/auth.middleware.js";
import { db } from "../../../server/db.js";
import { users, calls, plivoCalls, twilioOpenaiCalls, campaigns, creditTransactions } from "../../../shared/schema.js";
import { eq, and, gte, desc, sql } from "drizzle-orm";
const router = Router();
router.get(
  "/balance",
  apiAuthMiddleware("credits:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const [user] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "User not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const balance = {
      available: user.credits,
      reserved: 0,
      // Could calculate from active campaigns
      total: user.credits,
      currency: "credits"
    };
    const response = {
      success: true,
      data: balance,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.get(
  "/usage",
  apiAuthMiddleware("credits:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const days = parseInt(req.query.days) || 30;
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - days);
    const transactions = await db.select().from(creditTransactions).where(and(
      eq(creditTransactions.userId, userId),
      gte(creditTransactions.createdAt, startDate)
    )).orderBy(desc(creditTransactions.createdAt)).limit(1e3);
    const usageByDate = {};
    for (const tx of transactions) {
      const date = tx.createdAt.toISOString().split("T")[0];
      if (!usageByDate[date]) {
        usageByDate[date] = { calls: 0, minutes: 0, credits: 0 };
      }
      if (tx.type === "deduction") {
        usageByDate[date].calls += 1;
        usageByDate[date].credits += Math.abs(tx.amount);
        usageByDate[date].minutes += Math.abs(tx.amount);
      }
    }
    const usage = Object.entries(usageByDate).map(([date, data]) => ({ date, ...data })).sort((a, b) => a.date.localeCompare(b.date));
    const total = usage.reduce(
      (acc, day) => ({
        calls: acc.calls + day.calls,
        minutes: acc.minutes + day.minutes,
        credits: acc.credits + day.credits
      }),
      { calls: 0, minutes: 0, credits: 0 }
    );
    const response = {
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: (/* @__PURE__ */ new Date()).toISOString()
        },
        usage,
        total
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.get(
  "/calls",
  apiAuthMiddleware("analytics:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const days = parseInt(req.query.days) || 30;
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - days);
    const [elevenLabsStats, plivoStats, twilioStats, creditsResult] = await Promise.all([
      db.select({
        totalCalls: sql`count(*)`,
        completedCalls: sql`count(*) filter (where status = 'completed')`,
        failedCalls: sql`count(*) filter (where status = 'failed')`,
        totalDuration: sql`coalesce(sum(duration), 0)`
      }).from(calls).where(and(eq(calls.userId, userId), gte(calls.createdAt, startDate))),
      db.select({
        totalCalls: sql`count(*)`,
        completedCalls: sql`count(*) filter (where status = 'completed')`,
        failedCalls: sql`count(*) filter (where status = 'failed')`,
        totalDuration: sql`coalesce(sum(duration), 0)`
      }).from(plivoCalls).where(and(eq(plivoCalls.userId, userId), gte(plivoCalls.createdAt, startDate))),
      db.select({
        totalCalls: sql`count(*)`,
        completedCalls: sql`count(*) filter (where status = 'completed')`,
        failedCalls: sql`count(*) filter (where status = 'failed')`,
        totalDuration: sql`coalesce(sum(duration), 0)`
      }).from(twilioOpenaiCalls).where(and(eq(twilioOpenaiCalls.userId, userId), gte(twilioOpenaiCalls.createdAt, startDate))),
      db.select({
        totalCredits: sql`coalesce(sum(abs(amount)), 0)`
      }).from(creditTransactions).where(and(
        eq(creditTransactions.userId, userId),
        gte(creditTransactions.createdAt, startDate),
        sql`amount < 0`
      ))
    ]);
    const combined = {
      totalCalls: Number(elevenLabsStats[0]?.totalCalls || 0) + Number(plivoStats[0]?.totalCalls || 0) + Number(twilioStats[0]?.totalCalls || 0),
      completedCalls: Number(elevenLabsStats[0]?.completedCalls || 0) + Number(plivoStats[0]?.completedCalls || 0) + Number(twilioStats[0]?.completedCalls || 0),
      failedCalls: Number(elevenLabsStats[0]?.failedCalls || 0) + Number(plivoStats[0]?.failedCalls || 0) + Number(twilioStats[0]?.failedCalls || 0),
      totalDuration: Number(elevenLabsStats[0]?.totalDuration || 0) + Number(plivoStats[0]?.totalDuration || 0) + Number(twilioStats[0]?.totalDuration || 0),
      totalCredits: Number(creditsResult[0]?.totalCredits || 0)
    };
    const analytics = {
      totalCalls: combined.totalCalls,
      completedCalls: combined.completedCalls,
      failedCalls: combined.failedCalls,
      totalDurationMinutes: Math.round(combined.totalDuration / 60),
      averageDurationSeconds: combined.totalCalls > 0 ? Math.round(combined.totalDuration / combined.totalCalls) : 0,
      creditsUsed: combined.totalCredits,
      period: {
        start: startDate.toISOString(),
        end: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
    const response = {
      success: true,
      data: analytics,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.get(
  "/campaigns",
  apiAuthMiddleware("analytics:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 100);
    const offset = (page - 1) * pageSize;
    const [campaignList, countResult] = await Promise.all([
      db.select().from(campaigns).where(eq(campaigns.userId, userId)).orderBy(desc(campaigns.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: sql`count(*)` }).from(campaigns).where(eq(campaigns.userId, userId))
    ]);
    const totalItems = Number(countResult[0]?.count || 0);
    const analytics = campaignList.map((c) => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      totalContacts: c.totalContacts || 0,
      called: c.completedCalls || 0,
      connected: c.completedCalls || 0,
      completed: c.status === "completed" ? c.totalContacts : c.completedCalls || 0,
      failed: c.failedCalls || 0,
      pending: (c.totalContacts || 0) - (c.completedCalls || 0),
      successRate: c.totalContacts > 0 ? Math.round((c.successfulCalls || 0) / c.totalContacts * 100) : 0
    }));
    const response = {
      success: true,
      data: analytics,
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
var credits_routes_default = router;
export {
  credits_routes_default as default
};
