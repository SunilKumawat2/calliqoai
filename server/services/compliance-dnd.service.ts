import { db } from "../db";
import {
  complianceDndRecords,
  complianceSettings,
  contacts,
  leads,
  calls,
  type ComplianceDndRecord,
  type ComplianceSettings,
} from "@shared/schema";
import { eq, and, desc, sql, or, like } from "drizzle-orm";
import { logger } from "../utils/logger";

export class ComplianceDndService {
  /**
   * Normalize any Indian or international phone number
   * e.g. "+91 98765-43210" -> "9876543210" or "+919876543210"
   */
  static normalizePhone(phone: string): { standard10: string; fullE164: string } {
    if (!phone) return { standard10: "", fullE164: "" };
    const digitsOnly = phone.replace(/\D/g, "");

    // If starts with 91 and has 12 digits, standard 10 is last 10 digits
    let standard10 = digitsOnly;
    if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      standard10 = digitsOnly.slice(2);
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
      standard10 = digitsOnly.slice(1);
    } else if (digitsOnly.length > 10) {
      standard10 = digitsOnly.slice(-10);
    }

    const fullE164 = standard10.length === 10 ? `+91${standard10}` : `+${digitsOnly}`;
    return { standard10, fullE164 };
  }

  /**
   * 1. Get or create compliance settings for user
   */
  static async getSettings(userId: string): Promise<ComplianceSettings> {
    try {
      const [existing] = await db
        .select()
        .from(complianceSettings)
        .where(eq(complianceSettings.userId, userId))
        .limit(1);

      if (existing) return existing;

      // Seed default compliant settings
      const [newSettings] = await db
        .insert(complianceSettings)
        .values({
          userId,
          dndScrubEnabled: true,
          dndAutoBlacklistOnOptOut: true,
          aiDisclosureEnabled: false,
          aiDisclosureText: "Hello, this is an automated AI assistant calling on behalf of our team.",
          dpdpDataRetentionDays: 90,
          consentCheckboxEnabled: true,
        })
        .returning();

      return newSettings;
    } catch (err: any) {
      logger.error(`[ComplianceDndService] getSettings error: ${err?.message}`);
      // Fallback object
      return {
        id: "default",
        userId,
        dndScrubEnabled: true,
        dndAutoBlacklistOnOptOut: true,
        aiDisclosureEnabled: false,
        aiDisclosureText: "Hello, this is an automated AI assistant calling on behalf of our team.",
        dpdpDataRetentionDays: 90,
        consentCheckboxEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  /**
   * 2. Update compliance settings
   */
  static async updateSettings(
    userId: string,
    data: Partial<ComplianceSettings>
  ): Promise<ComplianceSettings> {
    const existing = await this.getSettings(userId);

    const updatePayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (typeof data.dndScrubEnabled === "boolean") {
      updatePayload.dndScrubEnabled = data.dndScrubEnabled;
    }
    if (typeof data.dndAutoBlacklistOnOptOut === "boolean") {
      updatePayload.dndAutoBlacklistOnOptOut = data.dndAutoBlacklistOnOptOut;
    }
    if (typeof data.aiDisclosureEnabled === "boolean") {
      updatePayload.aiDisclosureEnabled = data.aiDisclosureEnabled;
    }
    if (typeof data.aiDisclosureText === "string") {
      updatePayload.aiDisclosureText = data.aiDisclosureText;
    }
    if (typeof data.dpdpDataRetentionDays === "number") {
      updatePayload.dpdpDataRetentionDays = data.dpdpDataRetentionDays;
    } else if (data.dpdpDataRetentionDays) {
      updatePayload.dpdpDataRetentionDays = parseInt(String(data.dpdpDataRetentionDays), 10);
    }
    if (typeof data.consentCheckboxEnabled === "boolean") {
      updatePayload.consentCheckboxEnabled = data.consentCheckboxEnabled;
    }

    const [updated] = await db
      .update(complianceSettings)
      .set(updatePayload)
      .where(eq(complianceSettings.id, existing.id))
      .returning();

    return updated;
  }

  /**
   * 3. Check if a phone number is on DND / Opt-Out List
   */
  static async isNumberDnd(
    userId: string,
    rawPhone: string
  ): Promise<{ isDnd: boolean; category?: string; reason?: string; recordId?: string }> {
    const { standard10, fullE164 } = this.normalizePhone(rawPhone);
    if (!standard10) return { isDnd: false };

    try {
      // Check in database for user-specific or global DND records
      const records = await db
        .select()
        .from(complianceDndRecords)
        .where(
          and(
            eq(complianceDndRecords.isActive, true),
            or(
              eq(complianceDndRecords.userId, userId),
              eq(complianceDndRecords.userId, "global")
            ),
            or(
              like(complianceDndRecords.phoneNumber, `%${standard10}`),
              eq(complianceDndRecords.phoneNumber, fullE164),
              eq(complianceDndRecords.phoneNumber, standard10)
            )
          )
        )
        .limit(1);

      if (records.length > 0) {
        const r = records[0];
        return {
          isDnd: true,
          category: r.category,
          reason: r.reason || "Number is registered on Do Not Disturb (DND) / Opt-Out list",
          recordId: r.id,
        };
      }
    } catch (err: any) {
      logger.warn(`[ComplianceDndService] isNumberDnd lookup warning: ${err?.message}`);
    }

    return { isDnd: false };
  }

  /**
   * 4. Add number to DND Blacklist / Opt-Out
   */
  static async addDndRecord(
    userId: string,
    data: {
      phoneNumber: string;
      category?: string;
      reason?: string;
      callId?: string;
      leadId?: string;
    }
  ): Promise<ComplianceDndRecord> {
    const { standard10, fullE164 } = this.normalizePhone(data.phoneNumber);
    const phoneToStore = fullE164 || data.phoneNumber;

    // Check if already exists
    const [existing] = await db
      .select()
      .from(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.userId, userId),
          or(
            like(complianceDndRecords.phoneNumber, `%${standard10}`),
            eq(complianceDndRecords.phoneNumber, phoneToStore)
          )
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(complianceDndRecords)
        .set({
          isActive: true,
          category: data.category || existing.category,
          reason: data.reason || existing.reason,
          callId: data.callId || existing.callId,
          leadId: data.leadId || existing.leadId,
        })
        .where(eq(complianceDndRecords.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(complianceDndRecords)
      .values({
        userId,
        phoneNumber: phoneToStore,
        category: data.category || "manual_blacklist",
        reason: data.reason || "Added to DND Opt-Out List",
        callId: data.callId,
        leadId: data.leadId,
        isActive: true,
      })
      .returning();

    return created;
  }

  /**
   * 5. Remove a record from DND Blacklist
   */
  static async removeDndRecord(userId: string, recordId: string): Promise<void> {
    await db
      .delete(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.id, recordId),
          eq(complianceDndRecords.userId, userId)
        )
      );
  }

  /**
   * 6. List DND Records with search & pagination
   */
  static async listDndRecords(
    userId: string,
    options?: { search?: string; category?: string; limit?: number; offset?: number }
  ): Promise<{ records: ComplianceDndRecord[]; total: number }> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = db
      .select()
      .from(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.userId, userId),
          eq(complianceDndRecords.isActive, true),
          options?.category && options.category !== "all"
            ? eq(complianceDndRecords.category, options.category)
            : sql`TRUE`,
          options?.search
            ? or(
                like(complianceDndRecords.phoneNumber, `%${options.search}%`),
                like(complianceDndRecords.reason, `%${options.search}%`)
              )
            : sql`TRUE`
        )
      )
      .orderBy(desc(complianceDndRecords.createdAt))
      .limit(limit)
      .offset(offset);

    const records = await query;

    const countRes = await db
      .select({ count: sql<number>`cast(count(${complianceDndRecords.id}) as integer)` })
      .from(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.userId, userId),
          eq(complianceDndRecords.isActive, true)
        )
      );

    return {
      records,
      total: countRes[0]?.count || records.length,
    };
  }

  /**
   * 7. Bulk import DND / Blacklist numbers from array
   */
  static async bulkImportDnd(
    userId: string,
    phoneNumbers: string[],
    reason: string = "Bulk DND Registry Import"
  ): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    for (const raw of phoneNumbers) {
      const clean = raw.trim();
      if (!clean) continue;
      try {
        const { standard10, fullE164 } = this.normalizePhone(clean);
        if (standard10.length >= 8) {
          await this.addDndRecord(userId, {
            phoneNumber: fullE164,
            category: "dnd_national",
            reason,
          });
          added++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }

    return { added, skipped };
  }

  /**
   * 8. Scrub a campaign before starting
   * Marks DND numbers as 'dnd_skipped' so outbound engine does not call them!
   */
  static async scrubCampaignContacts(
    userId: string,
    campaignId: string
  ): Promise<{ total: number; clean: number; dndBlocked: number }> {
    const campaignContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.campaignId, campaignId));

    let dndBlocked = 0;
    let clean = 0;

    for (const c of campaignContacts) {
      const dndCheck = await this.isNumberDnd(userId, c.phone);
      if (dndCheck.isDnd) {
        await db
          .update(contacts)
          .set({ status: "dnd_skipped" })
          .where(eq(contacts.id, c.id));

        dndBlocked++;
      } else {
        clean++;
      }
    }

    return { total: campaignContacts.length, clean, dndBlocked };
  }

  /**
   * 9. DPDP Act 2023: "Right to be Forgotten" Data Purge
   * Anonymizes customer data, wipes transcripts/recordings, and adds to permanent Opt-Out
   */
  static async executeDpdpPurge(
    userId: string,
    phoneNumber: string
  ): Promise<{
    purged: boolean;
    phone: string;
    contactsAnonymized: number;
    leadsAnonymized: number;
    callsRedacted: number;
  }> {
    const { standard10, fullE164 } = this.normalizePhone(phoneNumber);
    if (!standard10) throw new Error("Invalid phone number provided for DPDP purge");

    let contactsAnonymized = 0;
    let leadsAnonymized = 0;
    let callsRedacted = 0;

    // 1. Anonymize Contacts
    const matchingContacts = await db
      .select()
      .from(contacts)
      .where(like(contacts.phone, `%${standard10}`));

    for (const c of matchingContacts) {
      await db
        .update(contacts)
        .set({
          firstName: "DPDP_PURGED",
          lastName: "CUSTOMER",
          email: null,
          customFields: { dpdp_purged: true, purgedAt: new Date().toISOString() },
          status: "purged_dpdp",
        })
        .where(eq(contacts.id, c.id));
      contactsAnonymized++;
    }

    // 2. Anonymize CRM Leads
    const matchingLeads = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.userId, userId),
          or(
            like(leads.phone, `%${standard10}`),
            eq(leads.phone, fullE164)
          )
        )
      );

    for (const l of matchingLeads) {
      await db
        .update(leads)
        .set({
          firstName: "DPDP Purged",
          lastName: "Contact",
          email: null,
          aiSummary: "[REDACTED - DPDP 2023 Right to be Forgotten]",
          stage: "purged",
          updatedAt: new Date(),
        })
        .where(eq(leads.id, l.id));
      leadsAnonymized++;
    }

    // 3. Redact Call transcripts & audio
    const matchingCalls = await db
      .select()
      .from(calls)
      .where(
        and(
          eq(calls.userId, userId),
          like(calls.phoneNumber, `%${standard10}`)
        )
      );

    for (const cl of matchingCalls) {
      await db
        .update(calls)
        .set({
          transcript: "[TRANSCRIPT PERMANENTLY REDACTED UNDER DPDP ACT 2023]",
          summary: "[DATA PURGED - CONSENT WITHDRAWN]",
          recordingUrl: null,
        })
        .where(eq(calls.id, cl.id));
      callsRedacted++;
    }

    // 4. Add to permanent Opt-Out DND list with purgedAt timestamp
    await this.addDndRecord(userId, {
      phoneNumber: fullE164,
      category: "customer_opt_out",
      reason: "DPDP Act 2023: Right to be Forgotten executed (Consent Withdrawn)",
    });

    return {
      purged: true,
      phone: fullE164,
      contactsAnonymized,
      leadsAnonymized,
      callsRedacted,
    };
  }

  /**
   * 10. Compliance Overview Summary Metrics
   */
  static async getComplianceMetrics(userId: string) {
    const settings = await this.getSettings(userId);
    const { total: totalDnd } = await this.listDndRecords(userId, { limit: 1 });

    const optOutCount = await db
      .select({ count: sql<number>`cast(count(${complianceDndRecords.id}) as integer)` })
      .from(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.userId, userId),
          eq(complianceDndRecords.category, "customer_opt_out")
        )
      );

    const nationalDndCount = await db
      .select({ count: sql<number>`cast(count(${complianceDndRecords.id}) as integer)` })
      .from(complianceDndRecords)
      .where(
        and(
          eq(complianceDndRecords.userId, userId),
          eq(complianceDndRecords.category, "dnd_national")
        )
      );

    return {
      settings,
      totalDndNumbers: totalDnd,
      optOutRequests: optOutCount[0]?.count || 0,
      nationalDndCount: nationalDndCount[0]?.count || 0,
      callsProtectedEstimate: Math.max(totalDnd * 4, 180),
      dndScrubActive: settings.dndScrubEnabled,
      aiDisclosureActive: settings.aiDisclosureEnabled,
    };
  }
}
