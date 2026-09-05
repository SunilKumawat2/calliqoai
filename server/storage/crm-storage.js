'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRMStorage = exports.DEFAULT_STAGES = void 0;
/**
 * ============================================================
 * CRM Storage Interface
 * Isolated storage layer for CRM module
 * ============================================================
 */
const db_1 = require("../db");
const schema_1 = require("@shared/schema");
const drizzle_orm_1 = require("drizzle-orm");
// Default stages with colors (created per user on first access)
exports.DEFAULT_STAGES = [
    { name: 'New Lead', color: '#9CA3AF', order: 0, stage: 'new' },
    { name: 'Hot Lead', color: '#EF4444', order: 1, stage: 'hot' },
    { name: 'Appointment Booked', color: '#22C55E', order: 2, stage: 'appointment' },
    { name: 'Form Submitted', color: '#3B82F6', order: 3, stage: 'form_submitted' },
    { name: 'Needs Follow-up', color: '#F59E0B', order: 4, stage: 'follow_up' },
    { name: 'Not Interested', color: '#6B7280', order: 5, stage: 'not_interested' },
    { name: 'No Answer', color: '#D1D5DB', order: 6, stage: 'no_answer' },
];
class CRMStorage {
    // ============================================================
    // Lead Stages
    // ============================================================
    static async getStagesByUser(userId) {
        return db_1.db
            .select()
            .from(schema_1.leadStages)
            .where((0, drizzle_orm_1.eq)(schema_1.leadStages.userId, userId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.leadStages.order));
    }
    static async ensureDefaultStages(userId) {
        const existing = await this.getStagesByUser(userId);
        if (existing.length > 0) {
            return existing;
        }
        const stagesToInsert = exports.DEFAULT_STAGES.map((s) => ({
            userId,
            name: s.name,
            color: s.color,
            order: s.order,
            isDefault: true,
            isCustom: false,
        }));
        const inserted = await db_1.db
            .insert(schema_1.leadStages)
            .values(stagesToInsert)
            .returning();
        return inserted;
    }
    static async createStage(data) {
        const maxOrder = await db_1.db
            .select({ maxOrder: (0, drizzle_orm_1.sql) `COALESCE(MAX("order"), 0)` })
            .from(schema_1.leadStages)
            .where((0, drizzle_orm_1.eq)(schema_1.leadStages.userId, data.userId));
        const [stage] = await db_1.db
            .insert(schema_1.leadStages)
            .values({
            ...data,
            order: (maxOrder[0]?.maxOrder || 0) + 1,
            isDefault: false,
            isCustom: true,
        })
            .returning();
        return stage;
    }
    static async updateStage(id, userId, data) {
        const [stage] = await db_1.db
            .update(schema_1.leadStages)
            .set({ ...data, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadStages.id, id), (0, drizzle_orm_1.eq)(schema_1.leadStages.userId, userId)))
            .returning();
        return stage || null;
    }
    static async deleteStage(id, userId) {
        const result = await db_1.db
            .delete(schema_1.leadStages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadStages.id, id), (0, drizzle_orm_1.eq)(schema_1.leadStages.userId, userId), (0, drizzle_orm_1.eq)(schema_1.leadStages.isCustom, true)))
            .returning();
        return result.length > 0;
    }
    static async reorderStages(userId, stageIds) {
        for (let i = 0; i < stageIds.length; i++) {
            await db_1.db
                .update(schema_1.leadStages)
                .set({ order: i, updatedAt: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadStages.id, stageIds[i]), (0, drizzle_orm_1.eq)(schema_1.leadStages.userId, userId)));
        }
    }
    // ============================================================
    // Leads
    // ============================================================
    static async getLeadById(id, userId) {
        const [lead] = await db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)));
        return lead || null;
    }
    static async getLeadsBySource(userId, sourceType, sourceId, filters) {
        const conditions = [
            (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId),
            (0, drizzle_orm_1.eq)(schema_1.leads.sourceType, sourceType),
        ];
        if (sourceType === 'campaign') {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.campaignId, sourceId));
        }
        else {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.incomingConnectionId, sourceId));
        }
        if (filters?.stage) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.stage, filters.stage));
        }
        if (filters?.minScore) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.leadScore, filters.minScore));
        }
        if (filters?.maxScore) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.leadScore, filters.maxScore));
        }
        if (filters?.startDate) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.createdAt, filters.startDate));
        }
        if (filters?.endDate) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.createdAt, filters.endDate));
        }
        if (filters?.search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.leads.firstName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.lastName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.phone, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.email, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.company, `%${filters.search}%`)));
        }
        // Apply hideLeadsWithoutPhone filter
        if (filters?.hideLeadsWithoutPhone) {
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        return db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.leads.createdAt));
    }
    static async getAllLeads(userId, filters) {
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)];
        if (filters?.stage) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.stage, filters.stage));
        }
        if (filters?.minScore) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.leadScore, filters.minScore));
        }
        if (filters?.maxScore) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.leadScore, filters.maxScore));
        }
        if (filters?.startDate) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.createdAt, filters.startDate));
        }
        if (filters?.endDate) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.createdAt, filters.endDate));
        }
        if (filters?.search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.leads.firstName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.lastName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.phone, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.email, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.company, `%${filters.search}%`)));
        }
        // Apply hideLeadsWithoutPhone filter
        if (filters?.hideLeadsWithoutPhone) {
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        return db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.leads.createdAt));
    }
    static async getLeadsBySourceType(userId, sourceType, filters) {
        const conditions = [
            (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId),
            (0, drizzle_orm_1.eq)(schema_1.leads.sourceType, sourceType),
        ];
        if (filters?.stage) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.stage, filters.stage));
        }
        if (filters?.minScore) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.leadScore, filters.minScore));
        }
        if (filters?.maxScore) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.leadScore, filters.maxScore));
        }
        if (filters?.startDate) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.leads.createdAt, filters.startDate));
        }
        if (filters?.endDate) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.leads.createdAt, filters.endDate));
        }
        if (filters?.search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.leads.firstName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.lastName, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.phone, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.email, `%${filters.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.company, `%${filters.search}%`)));
        }
        // Apply hideLeadsWithoutPhone filter
        if (filters?.hideLeadsWithoutPhone) {
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        return db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.leads.createdAt));
    }
    static async getLeadsGroupedByStage(userId, sourceType, sourceId, options) {
        const allLeads = await this.getLeadsBySource(userId, sourceType, sourceId, {
            hideLeadsWithoutPhone: options?.hideLeadsWithoutPhone,
        });
        const grouped = new Map();
        for (const lead of allLeads) {
            const stage = lead.stage;
            if (!grouped.has(stage)) {
                grouped.set(stage, []);
            }
            grouped.get(stage).push(lead);
        }
        return grouped;
    }
    // ============================================================
    // AI-Categorized Leads (Paginated) - Only qualified prospects
    // ============================================================
    /**
     * Get paginated leads filtered by AI category
     * Only returns leads that have been categorized (not null aiCategory)
     * Now also respects user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
     */
    static async getPaginatedLeadsByCategory(userId, options) {
        const limit = options.limit || 50;
        const offset = options.offset || 0;
        const conditions = [
            (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId),
            (0, drizzle_orm_1.isNotNull)(schema_1.leads.aiCategory), // Only categorized leads
        ];
        if (options.aiCategory) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.aiCategory, options.aiCategory));
        }
        // Apply hidden categories filter - exclude leads in hidden categories
        if (options.hiddenCategories && options.hiddenCategories.length > 0) {
            // If filtering by a specific category that is hidden, return empty
            if (options.aiCategory && options.hiddenCategories.includes(options.aiCategory)) {
                return { leads: [], total: 0, hasMore: false };
            }
            // When fetching all categories (no specific aiCategory), exclude hidden ones
            if (!options.aiCategory) {
                conditions.push((0, drizzle_orm_1.notInArray)(schema_1.leads.aiCategory, options.hiddenCategories));
            }
        }
        // Apply hideLeadsWithoutPhone filter
        if (options.hideLeadsWithoutPhone) {
            // Only include leads that have a valid phone (not null, not empty, not 'Unknown')
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        if (options.sourceType) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.sourceType, options.sourceType));
            if (options.sourceId) {
                if (options.sourceType === 'campaign') {
                    conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.campaignId, options.sourceId));
                }
                else {
                    conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.incomingConnectionId, options.sourceId));
                }
            }
        }
        if (options.search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.leads.firstName, `%${options.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.lastName, `%${options.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.phone, `%${options.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.email, `%${options.search}%`), (0, drizzle_orm_1.ilike)(schema_1.leads.company, `%${options.search}%`)));
        }
        // Get total count
        const [countResult] = await db_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions));
        const total = countResult?.count || 0;
        // Determine sort order
        let orderBy;
        switch (options.sortBy) {
            case 'oldest':
                orderBy = (0, drizzle_orm_1.asc)(schema_1.leads.createdAt);
                break;
            case 'score-high':
                orderBy = (0, drizzle_orm_1.desc)(schema_1.leads.leadScore);
                break;
            case 'score-low':
                orderBy = (0, drizzle_orm_1.asc)(schema_1.leads.leadScore);
                break;
            default:
                orderBy = (0, drizzle_orm_1.desc)(schema_1.leads.createdAt);
        }
        // Get paginated leads
        const results = await db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset);
        return {
            leads: results,
            total,
            hasMore: offset + results.length < total,
        };
    }
    /**
     * Get lead counts grouped by AI category
     * Now also respects user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
     */
    static async getLeadCountsByCategory(userId, options) {
        const conditions = [
            (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId),
            (0, drizzle_orm_1.isNotNull)(schema_1.leads.aiCategory),
        ];
        // Apply hideLeadsWithoutPhone filter
        if (options?.hideLeadsWithoutPhone) {
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        // Exclude hidden categories from the query for efficiency
        if (options?.hiddenCategories && options.hiddenCategories.length > 0) {
            conditions.push((0, drizzle_orm_1.notInArray)(schema_1.leads.aiCategory, options.hiddenCategories));
        }
        if (options?.sourceType) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.sourceType, options.sourceType));
            if (options.sourceId) {
                if (options.sourceType === 'campaign') {
                    conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.campaignId, options.sourceId));
                }
                else {
                    conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.incomingConnectionId, options.sourceId));
                }
            }
        }
        const results = await db_1.db
            .select({
            category: schema_1.leads.aiCategory,
            count: (0, drizzle_orm_1.count)(),
        })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .groupBy(schema_1.leads.aiCategory);
        // Initialize all categories with 0
        const counts = {
            [schema_1.AI_LEAD_CATEGORIES.WARM]: 0,
            [schema_1.AI_LEAD_CATEGORIES.HOT]: 0,
            [schema_1.AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED]: 0,
            [schema_1.AI_LEAD_CATEGORIES.FORM_SUBMITTED]: 0,
            [schema_1.AI_LEAD_CATEGORIES.CALL_TRANSFER]: 0,
            [schema_1.AI_LEAD_CATEGORIES.NEED_FOLLOW_UP]: 0,
        };
        for (const row of results) {
            if (row.category && row.category in counts) {
                counts[row.category] = row.count;
            }
        }
        return counts;
    }
    /**
     * Get leads grouped by AI category for Kanban view (paginated per column)
     * Now also respects user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
     */
    static async getLeadsByAICategory(userId, category, options) {
        return this.getPaginatedLeadsByCategory(userId, {
            aiCategory: category,
            sourceType: options?.sourceType,
            sourceId: options?.sourceId,
            limit: options?.limit || 20,
            offset: options?.offset || 0,
            hideLeadsWithoutPhone: options?.hideLeadsWithoutPhone,
            hiddenCategories: options?.hiddenCategories,
        });
    }
    static async createLead(data) {
        const [lead] = await db_1.db
            .insert(schema_1.leads)
            .values(data)
            .returning();
        return lead;
    }
    static async updateLead(id, userId, data) {
        const [lead] = await db_1.db
            .update(schema_1.leads)
            .set({ ...data, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)))
            .returning();
        return lead || null;
    }
    static async updateLeadStage(id, userId, stage, stageId) {
        const [lead] = await db_1.db
            .update(schema_1.leads)
            .set({
            stage,
            stageId: stageId || null,
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)))
            .returning();
        return lead || null;
    }
    static async deleteLead(id, userId) {
        const result = await db_1.db
            .delete(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)))
            .returning();
        return result.length > 0;
    }
    static async bulkDeleteLeads(ids, userId) {
        if (ids.length === 0)
            return 0;
        const result = await db_1.db
            .delete(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId), (0, drizzle_orm_1.inArray)(schema_1.leads.id, ids)))
            .returning();
        return result.length;
    }
    static async bulkUpdateStage(ids, userId, stage, stageId) {
        const result = await db_1.db
            .update(schema_1.leads)
            .set({
            stage,
            stageId: stageId || null,
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.leads.id, ids), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)))
            .returning();
        return result.length;
    }
    static async bulkAddTags(ids, userId, newTags) {
        const leadsToUpdate = await db_1.db
            .select()
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.leads.id, ids), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)));
        let updated = 0;
        for (const lead of leadsToUpdate) {
            const existingTags = lead.tags || [];
            const mergedTags = Array.from(new Set([...existingTags, ...newTags]));
            await db_1.db
                .update(schema_1.leads)
                .set({ tags: mergedTags, updatedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.leads.id, lead.id));
            updated++;
        }
        return updated;
    }
    static async bulkAssign(ids, userId, assignedUserId) {
        const result = await db_1.db
            .update(schema_1.leads)
            .set({
            assignedUserId,
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.leads.id, ids), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)))
            .returning();
        return result.length;
    }
    static async getLeadCountsByStage(userId, sourceType, sourceId, options) {
        const conditions = [
            (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId),
            (0, drizzle_orm_1.eq)(schema_1.leads.sourceType, sourceType),
        ];
        if (sourceType === 'campaign') {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.campaignId, sourceId));
        }
        else {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.leads.incomingConnectionId, sourceId));
        }
        // Apply hideLeadsWithoutPhone filter
        if (options?.hideLeadsWithoutPhone) {
            conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.leads.phone));
            conditions.push((0, drizzle_orm_1.sql) `TRIM(${schema_1.leads.phone}) != ''`);
            conditions.push((0, drizzle_orm_1.sql) `LOWER(TRIM(${schema_1.leads.phone})) != 'unknown'`);
        }
        const counts = await db_1.db
            .select({
            stage: schema_1.leads.stage,
            count: (0, drizzle_orm_1.sql) `COUNT(*)::int`,
        })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .groupBy(schema_1.leads.stage);
        return counts;
    }
    // ============================================================
    // Lead Notes
    // ============================================================
    static async getNotesByLead(leadId) {
        return db_1.db
            .select()
            .from(schema_1.leadNotes)
            .where((0, drizzle_orm_1.eq)(schema_1.leadNotes.leadId, leadId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.leadNotes.createdAt));
    }
    /**
     * Get notes count for multiple leads at once (batch operation)
     */
    static async getNotesCountByLeadIds(leadIds) {
        if (leadIds.length === 0)
            return new Map();
        const counts = await db_1.db
            .select({
            leadId: schema_1.leadNotes.leadId,
            count: (0, drizzle_orm_1.sql) `COUNT(*)::int`,
        })
            .from(schema_1.leadNotes)
            .where((0, drizzle_orm_1.inArray)(schema_1.leadNotes.leadId, leadIds))
            .groupBy(schema_1.leadNotes.leadId);
        const map = new Map();
        for (const row of counts) {
            map.set(row.leadId, row.count);
        }
        return map;
    }
    /**
     * Enrich leads with notes count
     */
    static async enrichLeadsWithNotesCount(leadsList) {
        if (leadsList.length === 0)
            return [];
        const leadIds = leadsList.map(l => l.id);
        const notesCounts = await this.getNotesCountByLeadIds(leadIds);
        return leadsList.map(lead => ({
            ...lead,
            notesCount: notesCounts.get(lead.id) || 0,
        }));
    }
    static async createNote(data) {
        const [note] = await db_1.db
            .insert(schema_1.leadNotes)
            .values(data)
            .returning();
        return note;
    }
    static async updateNote(id, userId, content) {
        const [note] = await db_1.db
            .update(schema_1.leadNotes)
            .set({ content, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadNotes.id, id), (0, drizzle_orm_1.eq)(schema_1.leadNotes.userId, userId)))
            .returning();
        return note || null;
    }
    static async deleteNote(id, userId) {
        const result = await db_1.db
            .delete(schema_1.leadNotes)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadNotes.id, id), (0, drizzle_orm_1.eq)(schema_1.leadNotes.userId, userId)))
            .returning();
        return result.length > 0;
    }
    // ============================================================
    // Source Data Helpers
    // ============================================================
    static async getUserCampaigns(userId) {
        const campaignList = await db_1.db
            .select({
            id: schema_1.campaigns.id,
            name: schema_1.campaigns.name,
        })
            .from(schema_1.campaigns)
            .where((0, drizzle_orm_1.eq)(schema_1.campaigns.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.campaigns.createdAt));
        const result = [];
        for (const c of campaignList) {
            const [countResult] = await db_1.db
                .select({ count: (0, drizzle_orm_1.sql) `COUNT(*)::int` })
                .from(schema_1.leads)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.campaignId, c.id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)));
            result.push({
                id: c.id,
                name: c.name,
                totalLeads: countResult?.count || 0,
            });
        }
        return result;
    }
    static async getUserIncomingConnections(userId) {
        const connections = await db_1.db
            .select()
            .from(schema_1.incomingConnections)
            .where((0, drizzle_orm_1.eq)(schema_1.incomingConnections.userId, userId));
        const result = [];
        for (const conn of connections) {
            const [countResult] = await db_1.db
                .select({ count: (0, drizzle_orm_1.sql) `COUNT(*)::int` })
                .from(schema_1.leads)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.incomingConnectionId, conn.id), (0, drizzle_orm_1.eq)(schema_1.leads.userId, userId)));
            result.push({
                id: conn.id,
                name: `Incoming - ${conn.id.slice(0, 8)}`,
                phoneNumber: conn.phoneNumberId,
                totalLeads: countResult?.count || 0,
            });
        }
        return result;
    }
    // ============================================================
    // Lead Creation from Call Completion
    // ============================================================
    static async createOrUpdateLeadFromCall(userId, callData) {
        // Determine stage based on call outcome
        let stage = 'new';
        if (callData.hasAppointment) {
            stage = 'appointment';
        }
        else if (callData.hasFormSubmission) {
            stage = 'form_submitted';
        }
        else if (callData.hasCallback) {
            stage = 'follow_up';
        }
        else if (callData.hasTransfer) {
            stage = 'hot';
        }
        else if (callData.leadScore && callData.leadScore >= 70) {
            stage = 'hot';
        }
        else if (callData.sentiment === 'negative') {
            stage = 'not_interested';
        }
        const leadData = {
            userId,
            phone: callData.phone,
            firstName: callData.firstName,
            lastName: callData.lastName,
            email: callData.email,
            company: callData.company,
            customFields: callData.customFields,
            sourceType: callData.sourceType,
            campaignId: callData.campaignId,
            incomingConnectionId: callData.incomingConnectionId,
            stage,
            callId: callData.callId,
            plivoCallId: callData.plivoCallId,
            twilioOpenaiCallId: callData.twilioOpenaiCallId,
            sipCallId: callData.sipCallId,
            aiSummary: callData.aiSummary,
            leadScore: callData.leadScore,
            aiNextAction: callData.aiNextAction,
            sentiment: callData.sentiment,
            hasAppointment: callData.hasAppointment || false,
            hasFormSubmission: callData.hasFormSubmission || false,
            hasTransfer: callData.hasTransfer || false,
            hasCallback: callData.hasCallback || false,
            appointmentDate: callData.appointmentDate,
            appointmentDetails: callData.appointmentDetails,
            formData: callData.formData,
            transferredTo: callData.transferredTo,
            callbackScheduled: callData.callbackScheduled,
            lastCallAt: new Date(),
        };
        const lead = await this.createLead(leadData);
        return lead;
    }
    // ============================================================
    // Lead Activities - Activity Timeline
    // ============================================================
    static async getActivitiesByLead(leadId, userId) {
        return db_1.db
            .select()
            .from(schema_1.leadActivities)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadActivities.leadId, leadId), (0, drizzle_orm_1.eq)(schema_1.leadActivities.userId, userId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.leadActivities.createdAt));
    }
    static async createActivity(data) {
        const [activity] = await db_1.db
            .insert(schema_1.leadActivities)
            .values(data)
            .returning();
        return activity;
    }
    static async logStageChange(leadId, userId, fromStage, toStage, fromStageName, toStageName) {
        return this.createActivity({
            leadId,
            userId,
            activityType: 'stage_change',
            title: `Stage changed to ${toStageName || toStage}`,
            description: `Moved from "${fromStageName || fromStage}" to "${toStageName || toStage}"`,
            metadata: { fromStage, toStage, fromStageName, toStageName },
        });
    }
    static async logNoteAdded(leadId, userId, noteId, noteContent) {
        return this.createActivity({
            leadId,
            userId,
            activityType: 'note',
            title: 'Note added',
            description: noteContent.substring(0, 200) + (noteContent.length > 200 ? '...' : ''),
            metadata: { noteId, noteContent: noteContent.substring(0, 500) },
        });
    }
    static async logCallActivity(leadId, userId, callId, callDuration, callStatus) {
        const durationStr = callDuration > 60
            ? `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`
            : `${callDuration}s`;
        return this.createActivity({
            leadId,
            userId,
            activityType: 'call',
            title: `Call ${callStatus}`,
            description: `Duration: ${durationStr}`,
            metadata: { callId, callDuration, callStatus },
        });
    }
    static async logTagChange(leadId, userId, action, tagName) {
        return this.createActivity({
            leadId,
            userId,
            activityType: action === 'added' ? 'tag_added' : 'tag_removed',
            title: `Tag ${action}: ${tagName}`,
            metadata: { tagName },
        });
    }
    static async logLeadCreated(leadId, userId, source) {
        return this.createActivity({
            leadId,
            userId,
            activityType: 'created',
            title: 'Lead created',
            description: `Source: ${source}`,
        });
    }
    // ============================================================
    // Analytics & Export
    // ============================================================
    static async getLeadsWithDetails(userId) {
        const allLeads = await this.getAllLeads(userId);
        const leadsWithDetails = await Promise.all(allLeads.map(async (lead) => {
            const [notes, activities] = await Promise.all([
                this.getNotesByLead(lead.id),
                this.getActivitiesByLead(lead.id, userId),
            ]);
            return { ...lead, notes, activities };
        }));
        return leadsWithDetails;
    }
    static async getAnalytics(userId) {
        // Total leads count
        const [totalResult] = await db_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId));
        const totalLeads = totalResult?.count || 0;
        // Leads by AI category (primary grouping)
        const categoryResults = await db_1.db
            .select({ category: schema_1.leads.aiCategory, count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId), (0, drizzle_orm_1.isNotNull)(schema_1.leads.aiCategory)))
            .groupBy(schema_1.leads.aiCategory);
        const leadsByCategory = categoryResults.map(r => ({
            category: r.category || 'uncategorized',
            count: Number(r.count)
        }));
        // Leads by stage (legacy - kept for backward compatibility)
        const stageResults = await db_1.db
            .select({ stage: schema_1.leads.stage, count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId))
            .groupBy(schema_1.leads.stage);
        const leadsByStage = stageResults.map(r => ({ stage: r.stage, count: Number(r.count) }));
        // Leads by source
        const sourceResults = await db_1.db
            .select({ sourceType: schema_1.leads.sourceType, count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId))
            .groupBy(schema_1.leads.sourceType);
        const leadsBySource = sourceResults.map(r => ({ sourceType: r.sourceType, count: Number(r.count) }));
        // Leads by date (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateResults = await db_1.db
            .select({
            date: (0, drizzle_orm_1.sql) `DATE(${schema_1.leads.createdAt})`,
            count: (0, drizzle_orm_1.count)(),
        })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_1.leads.createdAt, thirtyDaysAgo)))
            .groupBy((0, drizzle_orm_1.sql) `DATE(${schema_1.leads.createdAt})`)
            .orderBy((0, drizzle_orm_1.sql) `DATE(${schema_1.leads.createdAt})`);
        const leadsByDate = dateResults.map(r => ({ date: r.date, count: Number(r.count) }));
        // Average lead score
        const [scoreResult] = await db_1.db
            .select({ avg: (0, drizzle_orm_1.sql) `COALESCE(AVG(${schema_1.leads.leadScore}), 0)` })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId), (0, drizzle_orm_1.sql) `${schema_1.leads.leadScore} IS NOT NULL`));
        const avgLeadScore = Math.round(scoreResult?.avg || 0);
        // Sentiment breakdown
        const sentimentResults = await db_1.db
            .select({ sentiment: schema_1.leads.sentiment, count: (0, drizzle_orm_1.count)() })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId), (0, drizzle_orm_1.sql) `${schema_1.leads.sentiment} IS NOT NULL`))
            .groupBy(schema_1.leads.sentiment);
        const sentimentBreakdown = sentimentResults.map(r => ({
            sentiment: r.sentiment || 'unknown',
            count: Number(r.count),
        }));
        // Conversion rates (based on stage changes in activities)
        const stageChanges = await db_1.db
            .select()
            .from(schema_1.leadActivities)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.leadActivities.userId, userId), (0, drizzle_orm_1.eq)(schema_1.leadActivities.activityType, 'stage_change')));
        const conversionMap = new Map();
        for (const change of stageChanges) {
            const metadata = change.metadata;
            if (metadata?.fromStage && metadata?.toStage) {
                const key = metadata.fromStage;
                if (!conversionMap.has(key)) {
                    conversionMap.set(key, { total: 0, conversions: new Map() });
                }
                const data = conversionMap.get(key);
                data.total++;
                data.conversions.set(metadata.toStage, (data.conversions.get(metadata.toStage) || 0) + 1);
            }
        }
        const conversionRates = [];
        Array.from(conversionMap.entries()).forEach(([fromStage, data]) => {
            Array.from(data.conversions.entries()).forEach(([toStage, cnt]) => {
                conversionRates.push({
                    fromStage,
                    toStage,
                    rate: Math.round((cnt / data.total) * 100),
                });
            });
        });
        return {
            totalLeads,
            leadsByStage,
            leadsByCategory,
            leadsBySource,
            leadsByDate,
            conversionRates,
            avgLeadScore,
            sentimentBreakdown,
        };
    }
    static async getAllUniqueTags(userId) {
        const allLeads = await db_1.db
            .select({ tags: schema_1.leads.tags })
            .from(schema_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_1.leads.userId, userId));
        const tagsSet = new Set();
        for (const lead of allLeads) {
            if (lead.tags) {
                for (const tag of lead.tags) {
                    tagsSet.add(tag);
                }
            }
        }
        return Array.from(tagsSet).sort();
    }
    // ============================================================
    // CRM Category Preferences
    // ============================================================
    static async getCategoryPreferences(userId) {
        const [prefs] = await db_1.db
            .select()
            .from(schema_1.crmCategoryPreferences)
            .where((0, drizzle_orm_1.eq)(schema_1.crmCategoryPreferences.userId, userId));
        return prefs || null;
    }
    static async getOrCreateCategoryPreferences(userId) {
        const existing = await this.getCategoryPreferences(userId);
        if (existing)
            return existing;
        const [created] = await db_1.db
            .insert(schema_1.crmCategoryPreferences)
            .values({ userId })
            .returning();
        return created;
    }
    static async updateCategoryPreferences(userId, updates) {
        const existing = await this.getOrCreateCategoryPreferences(userId);
        const updateData = { updatedAt: new Date() };
        if (updates.columnOrder !== undefined) {
            updateData.columnOrder = updates.columnOrder;
        }
        if (updates.colorOverrides !== undefined) {
            updateData.colorOverrides = updates.colorOverrides;
        }
        if (updates.columnSortPreferences !== undefined) {
            updateData.columnSortPreferences = updates.columnSortPreferences;
        }
        if (updates.hideLeadsWithoutPhone !== undefined) {
            updateData.hideLeadsWithoutPhone = updates.hideLeadsWithoutPhone;
        }
        if (updates.categoryPipelineMappings !== undefined) {
            updateData.categoryPipelineMappings = updates.categoryPipelineMappings;
        }
        if (updates.hotScoreThreshold !== undefined) {
            updateData.hotScoreThreshold = updates.hotScoreThreshold;
        }
        if (updates.warmScoreThreshold !== undefined) {
            updateData.warmScoreThreshold = updates.warmScoreThreshold;
        }
        if (updates.hiddenCategories !== undefined) {
            updateData.hiddenCategories = updates.hiddenCategories;
        }
        const [updated] = await db_1.db
            .update(schema_1.crmCategoryPreferences)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.crmCategoryPreferences.id, existing.id))
            .returning();
        return updated;
    }
    static async updateCategoryColor(userId, categoryId, color) {
        const prefs = await this.getOrCreateCategoryPreferences(userId);
        const colorOverrides = { ...(prefs.colorOverrides || {}), [categoryId]: color };
        return this.updateCategoryPreferences(userId, { colorOverrides });
    }
    static async updateColumnOrder(userId, columnOrder) {
        return this.updateCategoryPreferences(userId, { columnOrder });
    }
    static async updateColumnSort(userId, categoryId, sortBy) {
        const prefs = await this.getOrCreateCategoryPreferences(userId);
        const columnSortPreferences = { ...(prefs.columnSortPreferences || {}), [categoryId]: sortBy };
        return this.updateCategoryPreferences(userId, { columnSortPreferences });
    }
}
exports.CRMStorage = CRMStorage;
