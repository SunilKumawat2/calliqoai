'use strict';
/**
 * ============================================================
 * Super Admin - White-Label Agency & Client Management Routes
 * Completely isolated module for managing white-label businesses/tenants
 * ============================================================
 */

import { Router, Response } from 'express';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { db } from '../../db';
import { eq, desc, sql } from 'drizzle-orm';
import { users, crmWhitelabelConfigs } from '@shared/schema';
import { storage } from '../../storage';

export function registerWhitelabelAgencyRoutes(router: Router) {
  /**
   * GET /api/admin/whitelabel/clients
   * List all white-label clients/tenants with their brand and credit stats
   */
  router.get('/whitelabel/clients', requireAdminPermission('users', 'view_users', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      // Fetch users who have white-label configurations or are agency tenants
      const clients = await db
        .select({
          userId: users.id,
          userName: users.name,
          userEmail: users.email,
          userRole: users.role,
          credits: users.credits,
          isActive: users.isActive,
          planType: users.planType,
          createdAt: users.createdAt,
          configId: crmWhitelabelConfigs.id,
          businessName: crmWhitelabelConfigs.businessName,
          industry: crmWhitelabelConfigs.industry,
          subIndustry: crmWhitelabelConfigs.subIndustry,
          tagline: crmWhitelabelConfigs.tagline,
          appointmentTerm: crmWhitelabelConfigs.appointmentTerm,
          leadTerm: crmWhitelabelConfigs.leadTerm,
          primaryColor: crmWhitelabelConfigs.primaryColor,
          logoUrl: crmWhitelabelConfigs.logoUrl,
          customDomain: crmWhitelabelConfigs.customDomain,
          configUpdatedAt: crmWhitelabelConfigs.updatedAt,
        })
        .from(crmWhitelabelConfigs)
        .innerJoin(users, eq(crmWhitelabelConfigs.userId, users.id))
        .orderBy(desc(crmWhitelabelConfigs.updatedAt));

      res.json({
        success: true,
        clients: clients.map(c => ({
          id: c.userId,
          name: c.userName,
          email: c.userEmail,
          role: c.userRole,
          credits: c.credits,
          isActive: c.isActive,
          planType: c.planType,
          createdAt: c.createdAt,
          branding: {
            id: c.configId,
            businessName: c.businessName || c.userName,
            industry: c.industry || 'healthcare',
            subIndustry: c.subIndustry || 'General',
            tagline: c.tagline,
            appointmentTerm: c.appointmentTerm || 'Doctor Consultation',
            leadTerm: c.leadTerm || 'Patient',
            primaryColor: c.primaryColor || '#0284c7',
            logoUrl: c.logoUrl,
            customDomain: c.customDomain,
            updatedAt: c.configUpdatedAt,
          }
        })),
        total: clients.length,
      });
    } catch (error: any) {
      console.error('[Admin WhiteLabel] Error fetching clients:', error);
      res.status(500).json({ error: 'Failed to fetch white-label clients' });
    }
  });

  /**
   * POST /api/admin/whitelabel/clients
   * Create a brand-new white-label client (creates User + CRM Config + Allocates initial credits)
   */
  router.post('/whitelabel/clients', requireAdminPermission('users', 'edit_users', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const createClientSchema = z.object({
        email: z.string().email('Valid email is required'),
        password: z.string().min(6, 'Password must be at least 6 characters'),
        businessName: z.string().min(2, 'Business or clinic name is required'),
        industry: z.string().default('healthcare'),
        subIndustry: z.string().optional(),
        customDomain: z.string().optional(),
        credits: z.number().min(0).default(5000),
        primaryColor: z.string().optional(),
        appointmentTerm: z.string().optional(),
        leadTerm: z.string().optional(),
        tagline: z.string().optional(),
        logoUrl: z.string().optional(),
      });

      const data = createClientSchema.parse(req.body);

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(data.email.trim().toLowerCase());
      if (existingUser) {
        return res.status(400).json({ error: 'A user with this email already exists.' });
      }

      // Check if custom domain is already assigned
      if (data.customDomain && data.customDomain.trim()) {
        const cleanDomain = data.customDomain.trim().toLowerCase();
        const [existingDomain] = await db
          .select()
          .from(crmWhitelabelConfigs)
          .where(eq(crmWhitelabelConfigs.customDomain, cleanDomain))
          .limit(1);

        if (existingDomain) {
          return res.status(400).json({ error: `Domain "${cleanDomain}" is already mapped to another client.` });
        }
      }

      // Hash password safely
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // 1. Create client user account
      const [newUser] = await db.insert(users).values({
        email: data.email.trim().toLowerCase(),
        password: hashedPassword,
        name: data.businessName.trim(),
        role: 'user',
        planType: 'pro',
        credits: data.credits ?? 5000,
        isActive: true,
      }).returning();

      // 2. Setup industry-based default terminology if not provided
      const isHealthcare = data.industry === 'healthcare';
      const isRealEstate = data.industry === 'real_estate';

      const defaultApptTerm = data.appointmentTerm || (isHealthcare ? 'Doctor Consultation' : isRealEstate ? 'Property Site Visit' : 'Appointment');
      const defaultLeadTerm = data.leadTerm || (isHealthcare ? 'Patient' : isRealEstate ? 'Buyer' : 'Lead');
      const defaultColor = data.primaryColor || (isHealthcare ? '#0284c7' : isRealEstate ? '#059669' : '#9333ea');
      const defaultTagline = data.tagline || `Smart AI ${defaultApptTerm} & Lead Management`;

      // 3. Create white-label configuration
      const [newConfig] = await db.insert(crmWhitelabelConfigs).values({
        userId: newUser.id,
        businessName: data.businessName.trim(),
        industry: data.industry,
        subIndustry: data.subIndustry || (isHealthcare ? 'Dermatology & Skin Clinic' : 'Residential & Commercial'),
        tagline: defaultTagline,
        appointmentTerm: defaultApptTerm,
        leadTerm: defaultLeadTerm,
        primaryColor: defaultColor,
        customDomain: data.customDomain ? data.customDomain.trim().toLowerCase() : null,
        logoUrl: data.logoUrl || null,
      }).returning();

      res.status(201).json({
        success: true,
        message: `Client "${data.businessName}" created successfully!`,
        client: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          credits: newUser.credits,
          isActive: newUser.isActive,
          branding: newConfig,
        }
      });
    } catch (error: any) {
      console.error('[Admin WhiteLabel] Error creating client:', error);
      res.status(500).json({ error: error.message || 'Failed to create white-label client' });
    }
  });

  /**
   * PATCH /api/admin/whitelabel/clients/:userId
   * Update client status, domain, or branding from Super Admin
   */
  router.patch('/whitelabel/clients/:userId', requireAdminPermission('users', 'edit_users', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { 
        isActive, 
        businessName, 
        customDomain, 
        primaryColor, 
        industry, 
        subIndustry,
        appointmentTerm,
        leadTerm,
        creditsDelta,
        logoUrl
      } = req.body;

      // Update User if needed (isActive or creditsDelta)
      const userUpdates: Record<string, any> = {};
      if (typeof isActive === 'boolean') userUpdates.isActive = isActive;
      if (businessName) userUpdates.name = businessName;
      
      if (typeof creditsDelta === 'number' && creditsDelta !== 0) {
        userUpdates.credits = sql`GREATEST(0, ${users.credits} + ${creditsDelta})`;
      }

      if (Object.keys(userUpdates).length > 0) {
        await db.update(users).set(userUpdates).where(eq(users.id, userId));
      }

      // Update White-Label Config
      const [existingConfig] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);

      const configUpdates: Record<string, any> = { updatedAt: new Date() };
      if (businessName !== undefined) configUpdates.businessName = businessName;
      if (customDomain !== undefined) configUpdates.customDomain = customDomain ? customDomain.trim().toLowerCase() : null;
      if (primaryColor !== undefined) configUpdates.primaryColor = primaryColor;
      if (industry !== undefined) configUpdates.industry = industry;
      if (subIndustry !== undefined) configUpdates.subIndustry = subIndustry;
      if (appointmentTerm !== undefined) configUpdates.appointmentTerm = appointmentTerm;
      if (leadTerm !== undefined) configUpdates.leadTerm = leadTerm;
      if (logoUrl !== undefined) configUpdates.logoUrl = logoUrl;

      let updatedConfig;
      if (existingConfig) {
        [updatedConfig] = await db
          .update(crmWhitelabelConfigs)
          .set(configUpdates)
          .where(eq(crmWhitelabelConfigs.id, existingConfig.id))
          .returning();
      } else {
        [updatedConfig] = await db
          .insert(crmWhitelabelConfigs)
          .values({
            userId,
            businessName: businessName || 'Client Workspace',
            industry: industry || 'healthcare',
            subIndustry: subIndustry || 'General',
            primaryColor: primaryColor || '#0284c7',
            customDomain: customDomain ? customDomain.trim().toLowerCase() : null,
            logoUrl: logoUrl || null,
          })
          .returning();
      }

      res.json({
        success: true,
        message: 'Client updated successfully',
        config: updatedConfig,
      });
    } catch (error: any) {
      console.error('[Admin WhiteLabel] Error updating client:', error);
      res.status(500).json({ error: error.message || 'Failed to update client' });
    }
  });

  /**
   * POST /api/admin/whitelabel/clients/:userId/credits
   * Recharge or deduct credits directly for this client
   */
  router.post('/whitelabel/clients/:userId/credits', requireAdminPermission('billing', 'edit_credits', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { amount, reason } = req.body;

      const creditNum = parseInt(amount, 10);
      if (isNaN(creditNum) || creditNum === 0) {
        return res.status(400).json({ error: 'Valid non-zero credit amount is required' });
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          credits: sql`GREATEST(0, ${users.credits} + ${creditNum})`
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id, name: users.name, credits: users.credits });

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        success: true,
        message: `${creditNum > 0 ? 'Added' : 'Deducted'} ${Math.abs(creditNum)} credits for ${updatedUser.name}.`,
        newBalance: updatedUser.credits,
      });
    } catch (error: any) {
      console.error('[Admin WhiteLabel] Error adjusting credits:', error);
      res.status(500).json({ error: error.message || 'Failed to adjust credits' });
    }
  });
}

