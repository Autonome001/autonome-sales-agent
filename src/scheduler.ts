/**
 * Autonome Sales Agent - Scheduled Pipeline v2
 * 
 * Features:
 * - Email sender rotation (multiple senders)
 * - Professional email signatures
 * - Correct opt-out links
 * - Slack notifications
 * 
 * Usage:
 *   npm run scheduler        - Run scheduler (stays running)
 *   npm run scheduler:once   - Run pipeline once immediately
 */

import cron from 'node-cron';
import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { leadsDb, eventsDb } from './db/index.js';
import { outreachAgent } from './agents/outreach/index.js';
import { sendingAgent } from './agents/sending/index.js';
import { Lead } from './types/index.js';
import { PERSONAS, Persona } from './config/personas.js';
import { ICP } from './config/icp.js';
import { discoveryAgent } from './agents/discovery/index.js';
import { researchAgent } from './agents/research/index.js';
import { buildEmployeeRanges } from './tools/apify.js';
import { logger, logSuccess } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

config();

// ============================================================================
// Sender Configuration
// ============================================================================



// Autonome Sales Team Senders
const SENDERS = PERSONAS;

// Booking link
const BOOKING_URL = 'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ37C4OHXBuDpQ79wsup6S8hiKCIgHQaRFi_uMHIChLa-KUzEvvbV4Qjv0NigQi5q8YodqVuC1vU';

// Opt-out base URL
const OPTOUT_BASE_URL = 'https://optout.autonome.us';

// ============================================================================
// Configuration
// ============================================================================

interface SchedulerConfig {
    schedule: string;           // Full pipeline run 1 (9 AM)
    schedule2: string;          // Full pipeline run 2 (1 PM)
    schedule3: string;          // Full pipeline run 3 (5 PM)
    timezone: string;
    limit: number;
    slackWebhookUrl?: string;
    enableSlack: boolean;
}

function getSchedulerConfig(): SchedulerConfig {
    return {
        schedule: process.env.PIPELINE_SCHEDULE || '0 9 * * 1-6',           // Full pipeline at 9 AM (Mon-Sat)
        schedule2: process.env.PIPELINE_SCHEDULE_2 || '0 13 * * 1-6',       // Full pipeline at 1 PM (Mon-Sat)
        schedule3: process.env.PIPELINE_SCHEDULE_3 || '0 17 * * 1-6',       // Full pipeline at 5 PM (Mon-Sat)
        timezone: process.env.PIPELINE_TIMEZONE || 'America/New_York',
        limit: parseInt(process.env.PIPELINE_LIMIT || '300', 10),
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        enableSlack: !!process.env.SLACK_WEBHOOK_URL,
    };
}

// ============================================================================
// Logging
// ============================================================================

// Redundant log function removed in favor of structured logger

// ============================================================================
// Pipeline Result Types
// ============================================================================

interface PipelineResult {
    discovered: number;
    researched: number;
    emailsCreated: number;
    emailsSent: number;
    duration: number;
    errors: string[];
    quarantineCount: number;
    leadsWithErrors: number;
    // Follow-up and engagement stats (optional for backward compatibility)
    followUpStats?: {
        email2Pending: number;  // Leads waiting for Email 2 (3+ days after Email 1)
        email3Pending: number;  // Leads waiting for Email 3 (5+ days after Email 1)
        totalReplies: number;   // Total leads that have replied
        interestedReplies: number;  // Leads marked as interested
    };
}

// ============================================================================
// Slack Notifications
// ============================================================================

async function sendSlackNotification(
    result: PipelineResult,
    config: SchedulerConfig
): Promise<void> {
    if (!config.enableSlack || !config.slackWebhookUrl) {
        logger.warn('Slack notifications disabled - SLACK_WEBHOOK_URL not set');
        return;
    }

    const hasErrors = result.errors && result.errors.length > 0;
    const emoji = hasErrors ? '⚠️' : '✅';
    const status = hasErrors ? 'completed with errors' : 'completed successfully';

    const blocks: any[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `${emoji} Autonome Pipeline ${status}`,
                emoji: true,
            },
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*🔎 Discovered:*\n${result.discovered}` },
                { type: 'mrkdwn', text: `*🔬 Researched:*\n${result.researched}` },
                { type: 'mrkdwn', text: `*📤 Sent:*\n${result.emailsSent}` },
                { type: 'mrkdwn', text: `*⚠️ Quarantined:*\n${result.quarantineCount}` },
            ],
        },
    ];

    // Add follow-up stats section if available
    if (result.followUpStats) {
        blocks.push({
            type: 'divider',
        });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*📬 Follow-up & Engagement Status:*`,
            },
        });
        blocks.push({
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Email 2 Pending:*\n${result.followUpStats.email2Pending} leads` },
                { type: 'mrkdwn', text: `*Email 3 Pending:*\n${result.followUpStats.email3Pending} leads` },
                { type: 'mrkdwn', text: `*Total Replies:*\n${result.followUpStats.totalReplies}` },
                { type: 'mrkdwn', text: `*🎉 Interested:*\n${result.followUpStats.interestedReplies}` },
            ],
        });
    }

    blocks.push({
        type: 'context',
        elements: [
            { type: 'mrkdwn', text: `⏱️ Duration: ${result.duration.toFixed(1)}s` },
        ],
    });

    // Include error details in notification
    if (hasErrors) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*❌ Errors (${result.errors.length}):*\n${result.errors.slice(0, 5).map(e => `• ${String(e).slice(0, 200)}`).join('\n')}${result.errors.length > 5 ? `\n_...and ${result.errors.length - 5} more_` : ''}`,
            },
        });
    }

    const message = { blocks };

    try {
        const response = await fetch(config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
        });
        if (!response.ok) {
            logger.error(`Slack notification failed: HTTP ${response.status}`);
        }
    } catch (error) {
        logger.error('Failed to send Slack notification', { metadata: error });
    }
}

/**
 * Stage 0: Discovery - Find new leads
 * Strategy: Request full batch (300 leads = ~3 min scrape time)
 * Batch size is small enough to avoid timeouts without chunking
 */
async function runDiscoveryStage(totalLimit: number, runNumber: number = 1): Promise<number> {
    logger.info(`🔎 DISCOVERY STAGE (Run ${runNumber}) - Target: ${totalLimit} leads`);

    try {
        const { scrapeApify } = await import('./tools/apify.js');
        const { leadsDb } = await import('./db/index.js');

        // =====================================================================
        // 🔄 10-ICP TRAVELING ROTATION LOGIC
        // =====================================================================
        // 🔄 14-ICP TRAVELING ROTATION LOGIC
        // Each ICP travels: Day N (USA) -> Day N+1 (Canada) -> Day N+2 (UK)
        // =====================================================================

        const ALL_ICPS = [
            {
                name: "ICP 0: Tech/SaaS CEOs/Founders",
                industries: ['technology', 'software', 'saas'],
                jobTitles: ['CEO', 'Founder', 'Co-Founder', 'President']
            },
            {
                name: "ICP 1: Legal - Practice Admin (Small/Mid Law Firm)",
                industries: ['law', 'legal practice', 'legal services'],
                jobTitles: ['Practice Administrator', 'Operations Director', 'Office Manager', 'Legal Ops']
            },
            {
                name: "ICP 2: Legal - Managing Partner (Solo/Small Law)",
                industries: ['law', 'legal services'],
                jobTitles: ['Managing Partner', 'Owner', 'Principal Attorney']
            },
            {
                name: "ICP 3: Legal - Legal Aid / Nonprofit Ops",
                industries: ['nonprofit', 'legal aid', 'community legal services'],
                jobTitles: ['Program Operations Manager', 'Executive Director', 'Intake Coordinator']
            },
            {
                name: "ICP 4: Legal - Court-adjacent Services",
                industries: ['mediation services', 'process server', 'court reporting', 'legal services'],
                jobTitles: ['Operations Manager', 'Owner', 'Office Manager']
            },
            {
                name: "ICP 5: Ag - Ag Retailer or Co-op Ops",
                industries: ['agriculture', 'agronomy', 'farm supply', 'farming'],
                jobTitles: ['Operations Manager', 'General Manager', 'Logistics Lead', 'Store Manager']
            },
            {
                name: "ICP 6: Ag - Farm Manager / GM (Mid-sized Farm)",
                industries: ['agriculture', 'farming', 'crops', 'livestock'],
                jobTitles: ['Farm Manager', 'General Manager', 'Operations Manager']
            },
            {
                name: "ICP 7: Ag - Ag Logistics & Warehousing",
                industries: ['logistics', 'warehousing', 'grain storage', 'cold chain', 'packhouse'],
                jobTitles: ['Logistics Coordinator', 'Operations Lead', 'Warehouse Manager', 'Shipping Coordinator']
            },
            {
                name: "ICP 8: Ag - Agronomy Consulting & Field Services",
                industries: ['agronomy', 'agriculture consulting', 'field services'],
                jobTitles: ['Operations Lead', 'Agronomy Services Manager', 'Field Services Manager']
            },
            {
                name: "ICP 9: Marketing - Multi-location Marketing Ops",
                industries: ['marketing', 'advertising', 'dental', 'med spa', 'home services'],
                jobTitles: ['Marketing Operations Manager', 'Demand Gen Ops', 'Revenue Ops']
            },
            {
                name: "ICP 10: Marketing - Client Delivery Ops (Boutique Agency)",
                industries: ['marketing agency', 'digital marketing', 'advertising agency'],
                jobTitles: ['Client Delivery Ops', 'Director of Operations', 'Account Director']
            },
            {
                name: "ICP 11: Services - Field Service Operations",
                industries: ['hvac', 'plumbing', 'electrical', 'pest control', 'cleaning services', 'security installers'],
                jobTitles: ['Field Service Operations Manager', 'Service Manager', 'Office Manager', 'Ops Lead']
            },
            {
                name: "ICP 12: Services - Professional Services Office Manager",
                industries: ['accounting', 'consulting', 'insurance agency'],
                jobTitles: ['Office Manager', 'Administrator', 'Operations Manager']
            },
            {
                name: "ICP 13: Services - Property Management Ops",
                industries: ['property management', 'real estate services'],
                jobTitles: ['Operations Lead', 'Property Manager', 'Site Manager', 'Maintenance Coordinator']
            }
        ];

        // Calculate stable index based on day of year
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 0);
        const diff = (now.getTime() - start.getTime()) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
        const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

        // Calculation: 
        // Run 1 (USA): ICP((DayOfYear - 0) % 14)
        // Run 2 (Canada): ICP((DayOfYear - 1) % 14)
        // Run 3 (UK): ICP((DayOfYear - 2) % 14)
        // This ensures ICP A is in USA today, Canada tomorrow, UK the day after.
        const icpIndex = (dayOfYear - (runNumber - 1) + 14) % 14;
        const currentIcp = ALL_ICPS[icpIndex];

        // Fixed Location Slots
        const locationSlots: Record<number, string[]> = {
            1: ['United States'],
            2: ['Canada'],
            3: ['United Kingdom']
        };

        const locations = locationSlots[runNumber] || ['United States'];
        const industries = currentIcp.industries;
        const jobTitles = currentIcp.jobTitles;

        logger.info(`   🔄 14-ICP Traveling Rotation (Day ${dayOfYear}, Run ${runNumber})`);
        logger.info(`   🎯 Current Target: ${currentIcp.name}`);
        logger.info(`   📍 Location: ${locations.join(', ')}`);
        logger.info(`   💼 Industries: ${industries.join(', ')}`);
        logger.info(`   👥 Job Titles: ${jobTitles.join(', ')}`);

        // Request batch from Apify
        const apifyResult = await scrapeApify({
            locations,
            industries,
            jobTitles,
            maxResults: totalLimit,
        });

        if (!apifyResult.success || !apifyResult.leads || apifyResult.leads.length === 0) {
            logger.warn('Discovery: No leads returned from Apify');
            return 0;
        }

        // Save all leads
        const saveResult = await leadsDb.createMany(apifyResult.leads);
        const totalSaved = saveResult.created.length;

        logger.info(`Saved ${totalSaved} leads (${saveResult.skipped} duplicates)`);
        logSuccess(`Discovery Complete: ${totalSaved} total leads discovered`);
        metrics.increment('leadsDiscovered', totalSaved);

        return totalSaved;
    } catch (error) {
        logger.error('Discovery failed', { metadata: error });
        metrics.increment('errorsCaught');
        throw error;
    }
}

// ============================================================================
// Database & AI Setup
// ============================================================================

// ============================================================================
// Database & Stats Helpers
// ============================================================================

async function getFollowUpStats(supabase: SupabaseClient): Promise<{
    email2Pending: number;
    email3Pending: number;
    totalReplies: number;
    interestedReplies: number;
}> {
    const email2DelayDays = parseInt(process.env.EMAIL_2_DELAY_DAYS || '3', 10);
    const email3DelayDays = parseInt(process.env.EMAIL_3_DELAY_DAYS || '5', 10);

    const email2Cutoff = new Date();
    email2Cutoff.setDate(email2Cutoff.getDate() - email2DelayDays);

    const email3Cutoff = new Date();
    email3Cutoff.setDate(email3Cutoff.getDate() - email3DelayDays);

    // Count leads pending Email 2
    const { count: email2Count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'email_1_sent')
        .lt('email_1_sent_at', email2Cutoff.toISOString())
        .not('email_2_body', 'is', null);

    // Count leads pending Email 3
    const { count: email3Count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'email_2_sent')
        .lt('email_1_sent_at', email3Cutoff.toISOString())
        .not('email_3_body', 'is', null);

    // Count total replies
    const { count: totalReplies } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .not('replied_at', 'is', null);

    // Count interested replies
    const { count: interestedCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'engaged');

    return {
        email2Pending: email2Count || 0,
        email3Pending: email3Count || 0,
        totalReplies: totalReplies || 0,
        interestedReplies: interestedCount || 0,
    };
}

// ============================================================================
// Stage 1: Research
// ============================================================================

async function runResearchStage(supabase: SupabaseClient, limit: number): Promise<number> {
    logger.info('STAGE 1: RESEARCH');

    const result = await researchAgent.researchPendingLeads(limit);

    if (!result.success) {
        logger.error('Research failed', { metadata: { error: result.error || result.message } });
        metrics.increment('errorsCaught');
        return 0;
    }

    const data = result.data as { successful: number; failed: number; total: number } | undefined;
    const processed = data?.successful || 0;

    logSuccess(`Stage 1 Complete: ${processed} leads researched`);
    metrics.increment('leadsResearched', processed);
    return processed;
}

// ============================================================================
// Stage 2: Outreach
// ============================================================================

async function runOutreachStage(supabase: SupabaseClient, limit: number): Promise<number> {
    logger.info('STAGE 2: OUTREACH (Email Generation)');

    const leads = await leadsDb.findByStatus('researched', limit);
    logger.info(`Found ${leads.length} leads for email generation`);

    let processed = 0;
    for (const lead of leads) {
        try {
            const result = await outreachAgent.generateEmailSequence(lead);
            if (result.success) {
                logger.info(`Emails generated for: ${lead.email}`);
                processed++;
                metrics.increment('emailsGenerated');
            } else {
                logger.error(`Generation failed for: ${lead.email}`, { metadata: { error: result.error || result.message } });
                // recordError is already handled inside outreachAgent.generateEmailSequence
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unexpected error for: ${lead.email}`, { metadata: error });
            await leadsDb.recordError(lead.id, `Outreach unexpected error: ${message}`);
            metrics.increment('errorsCaught');
        }
    }

    console.log(`\n🏁 Stage 2 Complete: ${processed} email sequences generated`);
    return processed;
}

// Stage 3: Sending Logic implemented via sendingAgent

async function runSendingStage(supabase: SupabaseClient, limit: number): Promise<number> {
    logger.info('STAGE 3: SENDING (Email 1)');

    const leads = await leadsDb.findByStatus('ready', limit);
    logger.info(`Found ${leads.length} leads ready to send (limit: ${limit})`);

    let sent = 0;
    for (const lead of leads) {
        try {
            logger.info(`Sending Email 1 to: ${lead.email}`);
            const result = await sendingAgent.sendEmail1(lead.id);

            if (result.success) {
                logSuccess(`Sent successfully to: ${lead.email}`);
                sent++;
                metrics.increment('emailsSent');
            } else {
                logger.error(`Failed to send to: ${lead.email}`, { metadata: { error: result.error || result.message } });
                // recordError is already handled inside sendingAgent.sendEmail1
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unexpected sending error for: ${lead.email}`, { metadata: error });
            await leadsDb.recordError(lead.id, `Sending unexpected error: ${message}`);
            metrics.increment('errorsCaught');
        }

        // Rate limiting: Resend allows 2 requests/second, so wait 600ms between emails
        // This ensures we stay safely under the limit (500ms = exactly 2/sec, 600ms = safety margin)
        await new Promise(resolve => setTimeout(resolve, 600));
    }

    logSuccess(`Stage 3 Complete: ${sent} emails sent`);
    return sent;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runPipeline(limit: number, runNumber: number = 1): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🚀 AUTONOME SALES PIPELINE ORCHESTRATOR              ║
╚═══════════════════════════════════════════════════════════════╝
`);

    const missingVars = [];
    if (!process.env.SUPABASE_URL) missingVars.push('SUPABASE_URL');
    if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) missingVars.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    if (!process.env.OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!;
    const openaiKey = process.env.OPENAI_API_KEY!;

    const supabase = createClient(supabaseUrl, supabaseKey);
    // Agents initialize their own OpenAI clients using config

    // Test connection
    try {
        const { error } = await supabase.from('leads').select('count').limit(1);
        if (error) throw error;
        console.log('✅ Database connected');
        console.log(`📧 Sender rotation: ${SENDERS.map(s => s.name).join(', ')}`);
    } catch (error: any) {
        const msg = `Database connection failed: ${error.message || JSON.stringify(error)}`;
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
        return { discovered: 0, researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [msg], quarantineCount: 0, leadsWithErrors: 0 };
    }



    let discovered = 0, researched = 0, emailsCreated = 0, emailsSent = 0;

    // Stage 0: Discovery - find new leads
    try { discovered = await runDiscoveryStage(limit, runNumber); }
    catch (error) {
        const msg = `Discovery: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
    }

    // Stage 1: Research - process ALL scraped leads (including newly discovered)
    try { researched = await runResearchStage(supabase, limit); }
    catch (error) {
        const msg = `Research: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
    }

    // Stage 2: Outreach - process ALL researched leads (including newly researched)
    try { emailsCreated = await runOutreachStage(supabase, limit); }
    catch (error) {
        const msg = `Outreach: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
    }

    // Stage 3: Sending - process ALL ready leads (including newly created emails)
    // This now includes leads that just went through stages 1-2 in this same run
    try { emailsSent = await runSendingStage(supabase, limit); }
    catch (error) {
        const msg = `Sending: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
    }

    const duration = (Date.now() - startTime) / 1000;

    // Fetch quarantine and error stats
    let quarantineCount = 0;
    let leadsWithErrors = 0;
    try {
        quarantineCount = await leadsDb.countQuarantined();
        const leadsWithErrorList = await leadsDb.findWithErrors(100);
        leadsWithErrors = leadsWithErrorList.length;
        metrics.set('quarantinedLeads', quarantineCount);
    } catch (e) {
        logger.warn('Failed to fetch quarantine/error stats', { metadata: e });
    }

    // Gather follow-up and engagement stats
    let followUpStats;
    try {
        followUpStats = await getFollowUpStats(supabase);
        logger.info('Follow-up stats retrieved', { metadata: followUpStats });
    } catch (error) {
        logger.warn('Failed to get follow-up stats', { metadata: error });
    }

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    🏁 PIPELINE SUMMARY                      │
├─────────────────────────────────────────────────────────────┤
│  🔎 Leads Discovered:      ${String(discovered).padStart(5)}                          │
│  🔬 Leads Researched:      ${String(researched).padStart(5)}                          │
│  📧 Email Sequences Created: ${String(emailsCreated).padStart(3)}                          │
│  📤 Emails Sent:           ${String(emailsSent).padStart(5)}                          │
│  ⚠️  Quarantined Leads:     ${String(quarantineCount).padStart(5)}                          │
│  ⏱️  Duration:            ${duration.toFixed(1).padStart(6)}s                         │
├─────────────────────────────────────────────────────────────┤
│  📬 FOLLOW-UP STATUS                                        │
│  Email 2 Pending:   ${String(followUpStats?.email2Pending || 0).padStart(5)}                               │
│  Email 3 Pending:   ${String(followUpStats?.email3Pending || 0).padStart(5)}                               │
│  Total Replies:     ${String(followUpStats?.totalReplies || 0).padStart(5)}                               │
│  🎉 Interested:     ${String(followUpStats?.interestedReplies || 0).padStart(5)}                               │
└─────────────────────────────────────────────────────────────┘
`);

    return { discovered, researched, emailsCreated, emailsSent, duration, errors, followUpStats, quarantineCount, leadsWithErrors };
}

// ============================================================================
// Research-Only Pipeline (for second daily run)
// ============================================================================

async function runResearchOnlyPipeline(limit: number, runNumber: number = 1): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🔬 AUTONOME RESEARCH PIPELINE (Afternoon Run)        ║
╚═══════════════════════════════════════════════════════════════╝
`);

    const missingVars = [];
    if (!process.env.SUPABASE_URL) missingVars.push('SUPABASE_URL');
    if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) missingVars.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    if (!process.env.OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!;
    const openaiKey = process.env.OPENAI_API_KEY!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test connection
    try {
        const { error } = await supabase.from('leads').select('count').limit(1);
        if (error) throw error;
        console.log('✅ Database connected');
    } catch (error: any) {
        const msg = `Database connection failed: ${error.message || JSON.stringify(error)}`;
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
        return { discovered: 0, researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [msg], quarantineCount: 0, leadsWithErrors: 0 };
    }

    let researched = 0;

    // Only run research stage (process scraped leads)
    try { researched = await runResearchStage(supabase, limit); }
    catch (error) {
        const msg = `Research: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        logger.error(msg, { metadata: error });
        metrics.increment('errorsCaught');
    }

    const duration = (Date.now() - startTime) / 1000;

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│              🏁 RESEARCH PIPELINE SUMMARY                   │
├─────────────────────────────────────────────────────────────┤
│  🔬 Leads Researched:      ${String(researched).padStart(5)}                          │
│  ⏱️  Duration:            ${duration.toFixed(1).padStart(6)}s                         │
└─────────────────────────────────────────────────────────────┘
`);

    return { discovered: 0, researched, emailsCreated: 0, emailsSent: 0, duration, errors, quarantineCount: 0, leadsWithErrors: 0 };
}

// ============================================================================
// Scheduler
// ============================================================================

function describeCron(expression: string): string {
    const parts = expression.split(' ');
    if (parts.length !== 5) return expression;
    const [minute, hour] = parts;
    if (minute === '0' && hour !== '*') {
        return `Daily at ${hour}:00`;
    }
    return expression;
}

function startScheduler(config: SchedulerConfig): void {
    logger.info('📅 Starting Autonome Sales Pipeline Scheduler', { metadata: config });

    // Validate all 3 cron expressions
    for (const [name, expr] of [['schedule', config.schedule], ['schedule2', config.schedule2], ['schedule3', config.schedule3]]) {
        if (!cron.validate(expr)) {
            logger.error(`Invalid cron expression for ${name}`, { metadata: { schedule: expr } });
            process.exit(1);
        }
    }

    logger.info(`⏰ Full Pipeline 1: ${describeCron(config.schedule)}`);
    logger.info(`⏰ Full Pipeline 2: ${describeCron(config.schedule2)}`);
    logger.info(`⏰ Full Pipeline 3: ${describeCron(config.schedule3)}`);
    logger.info(`📧 Senders: ${SENDERS.map(s => s.name).join(', ')}`);
    logger.info(`🎯 Target: ${config.limit * 3} leads/day (3 × ${config.limit})`);

    // Helper to create pipeline runner
    const createPipelineRunner = (runNumber: number) => async () => {
        try {
            logger.info(`Starting scheduled full pipeline run ${runNumber}/3...`);
            metrics.increment('pipelineRuns');
            const result = await runPipeline(config.limit, runNumber);
            await sendSlackNotification(result, config);
            logSuccess(`Scheduled full pipeline run ${runNumber}/3 completed`);
        } catch (error) {
            logger.error(`Pipeline execution ${runNumber}/3 failed`, { metadata: error });
            metrics.increment('errorsCaught');
            await sendSlackNotification({ discovered: 0, researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [error instanceof Error ? error.message : String(error)], quarantineCount: 0, leadsWithErrors: 0 }, config);
        }
    };

    // Full pipeline run 1 (morning) - 9 AM
    const pipelineTask1 = cron.schedule(
        config.schedule,
        createPipelineRunner(1),
        { timezone: config.timezone }
    );

    // Full pipeline run 2 (afternoon) - 1 PM
    const pipelineTask2 = cron.schedule(
        config.schedule2,
        createPipelineRunner(2),
        { timezone: config.timezone }
    );

    // Full pipeline run 3 (evening) - 5 PM
    const pipelineTask3 = cron.schedule(
        config.schedule3,
        createPipelineRunner(3),
        { timezone: config.timezone }
    );

    process.on('SIGINT', () => { pipelineTask1.stop(); pipelineTask2.stop(); pipelineTask3.stop(); process.exit(0); });
    process.on('SIGTERM', () => { pipelineTask1.stop(); pipelineTask2.stop(); pipelineTask3.stop(); process.exit(0); });

    logSuccess('Scheduler started with 3 daily FULL pipeline runs:');
    logger.info('   📋 9 AM:  Full pipeline (discover → research → outreach → send)');
    logger.info('   📋 1 PM:  Full pipeline (discover → research → outreach → send)');
    logger.info('   📋 5 PM:  Full pipeline (discover → research → outreach → send)');
    logger.info('Press Ctrl+C to stop');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
    const config = getSchedulerConfig();
    const args = process.argv.slice(2);

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🚀 AUTONOME SALES PIPELINE SCHEDULER                 ║
╚═══════════════════════════════════════════════════════════════╝
`);

    // Startup validation: warn if Slack notifications are disabled
    if (!config.enableSlack) {
        logger.warn('SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
    } else {
        logSuccess('Slack notifications enabled');
    }

    if (args.includes('--once') || args.includes('-o')) {
        logger.info('Running pipeline once (--once flag)');
        try {
            metrics.increment('pipelineRuns');
            const result = await runPipeline(config.limit, 1);
            await sendSlackNotification(result, config);
            process.exit(result.errors.length > 0 ? 1 : 0);
        } catch (error) {
            logger.error('Pipeline execution failed in --once mode', { metadata: error });
            metrics.increment('errorsCaught');
            await sendSlackNotification({ discovered: 0, researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [error instanceof Error ? error.message : String(error)], quarantineCount: 0, leadsWithErrors: 0 }, config);
            process.exit(1);
        }
    } else if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx tsx src/scheduler.ts [options]

Options:
  --once, -o     Run pipeline once immediately and exit
  --help, -h     Show this help message

Environment Variables:
  PIPELINE_SCHEDULE      Cron for full pipeline 1 (default: "0 9 * * *" = 9 AM daily)
  PIPELINE_SCHEDULE_2    Cron for full pipeline 2 (default: "0 13 * * *" = 1 PM daily)
  PIPELINE_SCHEDULE_3    Cron for full pipeline 3 (default: "0 17 * * *" = 5 PM daily)
  PIPELINE_TIMEZONE      Timezone (default: "America/New_York")
  PIPELINE_LIMIT         Max leads to discover per run (default: 300)
  SLACK_WEBHOOK_URL      Slack webhook for notifications (REQUIRED for alerts!)

Pipeline Schedules (3x Full Pipelines = ~900 leads/day):
  - 9 AM: Full pipeline (discover → research → outreach → send)
  - 1 PM: Full pipeline (discover → research → outreach → send)
  - 5 PM: Full pipeline (discover → research → outreach → send)

Senders Configured:
${SENDERS.map(s => `  - ${s.name} (${s.email}) - ${s.title}`).join('\n')}
`);
        process.exit(0);
    } else {
        startScheduler(config);
    }
}

// Global error handler with notification
import { fileURLToPath } from 'url';
import path from 'path';

const isMainModule = () => {
    if (!process.argv[1]) return false;
    const entryFile = process.argv[1];
    const currentFile = fileURLToPath(import.meta.url);
    return entryFile === currentFile || path.relative(entryFile, currentFile) === '';
};

if (isMainModule()) {
    main().catch(async (error) => {
        logger.error('Scheduler crashed', { metadata: error });
        process.exit(1);
    });
}

export { startScheduler, getSchedulerConfig };