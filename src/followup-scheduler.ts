/**
 * Autonome Sales Agent - Follow-up Scheduler
 * 
 * Automatically sends Email 2 and Email 3 follow-ups at configured intervals.
 * 
 * Default Schedule:
 *   - Email 2: 3 days after Email 1
 *   - Email 3: 7 days after Email 1
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { config } from 'dotenv';
import { leadsDb, eventsDb } from './db/index.js';
import { sendingAgent } from './agents/sending/index.js';
import { Lead } from './types/index.js';
import { logger, logSuccess } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

config();

// ============================================================================
// Configuration
// ============================================================================

interface FollowUpConfig {
    supabaseUrl: string;
    supabaseKey: string;
    resendKey?: string;
    defaultSenderEmail: string;
    defaultSenderName: string;
    email2DelayDays: number;
    email3DelayDays: number;
    slackWebhookUrl?: string;
}

function getConfig(): FollowUpConfig {
    return {
        supabaseUrl: process.env.SUPABASE_URL || '',
        // Use service role key to bypass RLS - important for backend operations
        supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
        resendKey: process.env.RESEND_API_KEY,
        defaultSenderEmail: process.env.DEFAULT_SENDER_EMAIL || 'brian@autonome.us',
        defaultSenderName: process.env.DEFAULT_SENDER_NAME || 'Brian P.',
        email2DelayDays: parseInt(process.env.EMAIL_2_DELAY_DAYS || '3', 10),
        email3DelayDays: parseInt(process.env.EMAIL_3_DELAY_DAYS || '5', 10),  // 5 days after Email 1
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    };
}

// ============================================================================
// Types
// ============================================================================

interface FollowUpResult {
    email2Sent: number;
    email3Sent: number;
    quarantineCount: number;
    errors: string[];
}

// Removed legacy log function

// ============================================================================
// Slack Notifications
// ============================================================================

async function sendSlackNotification(result: FollowUpResult, config: FollowUpConfig): Promise<void> {
    if (!config.slackWebhookUrl) {
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
                text: `${emoji} Follow-up Scheduler ${status}`,
                emoji: true,
            },
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Email 2 Sent:*\n${result.email2Sent}` },
                { type: 'mrkdwn', text: `*Email 3 Sent:*\n${result.email3Sent}` },
                { type: 'mrkdwn', text: `*⚠️ Quarantined:*\n${result.quarantineCount}` },
            ],
        },
    ];

    if (hasErrors) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*❌ Errors (${result.errors.length}):*\n${result.errors.slice(0, 5).map(e => `• ${String(e).slice(0, 200)}`).join('\n')}${result.errors.length > 5 ? `\n_...and ${result.errors.length - 5} more_` : ''}`,
            },
        });
    }

    try {
        const response = await fetch(config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks }),
        });
        if (!response.ok) {
            logger.error(`Slack notification failed: HTTP ${response.status}`);
        }
    } catch (error) {
        logger.error('Failed to send Slack notification', { metadata: error });
    }
}

async function sendCriticalFailureNotification(
    error: Error | string,
    stage: string,
    config: FollowUpConfig
): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`CRITICAL FAILURE [${stage}]`, { metadata: error });

    if (!config.slackWebhookUrl) {
        logger.warn('Cannot send Slack notification - SLACK_WEBHOOK_URL not configured');
        return;
    }

    const errorStack = error instanceof Error ? error.stack : undefined;

    const blocks: any[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '🚨 CRITICAL: Follow-up Scheduler Crashed',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Stage:* ${stage}\n*Error:* ${errorMessage}`,
            },
        },
        {
            type: 'context',
            elements: [
                { type: 'mrkdwn', text: `⏰ ${new Date().toISOString()}` },
            ],
        },
    ];

    if (errorStack) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `\`\`\`${errorStack.slice(0, 500)}${errorStack.length > 500 ? '...' : ''}\`\`\``,
            },
        });
    }

    try {
        await fetch(config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks }),
        });
        logger.info('Critical failure notification sent to Slack');
    } catch (fetchError) {
        logger.error('Failed to send critical failure notification', { metadata: fetchError });
    }
}

// ============================================================================
// Database Operations
// ============================================================================

async function getLeadsForEmail2(supabase: SupabaseClient, delayDays: number): Promise<Lead[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - delayDays);

    const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'email_1_sent')
        .lt('email_1_sent_at', cutoffDate.toISOString())
        .not('email_2_body', 'is', null);

    if (error) {
        throw new Error(`Supabase query failed (getLeadsForEmail2): ${error.message || JSON.stringify(error)}`);
    }
    return (data || []) as Lead[];
}

async function getLeadsForEmail3(supabase: SupabaseClient, delayDays: number): Promise<Lead[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - delayDays);

    const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'email_2_sent')
        .lt('email_1_sent_at', cutoffDate.toISOString())
        .not('email_3_body', 'is', null);

    if (error) {
        throw new Error(`Supabase query failed (getLeadsForEmail3): ${error.message || JSON.stringify(error)}`);
    }
    return (data || []) as Lead[];
}

// ============================================================================
// Email Sending
// ============================================================================

// Email sending logic is now handled by sendingAgent

// ============================================================================
// Follow-up Processing
// ============================================================================

async function processEmail2Followups(supabase: SupabaseClient, config: FollowUpConfig): Promise<{ sent: number; errors: string[] }> {
    logger.info(`Checking for Email 2 follow-ups (${config.email2DelayDays} days after Email 1)`);

    const leads = await getLeadsForEmail2(supabase, config.email2DelayDays);
    logger.info(`Found ${leads.length} leads due for Email 2`);

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        try {
            logger.info(`Sending Email 2 to: ${lead.email}`);
            const result = await sendingAgent.sendEmail2(lead.id);

            if (result.success) {
                logSuccess(`Email 2 sent to ${lead.email}`);
                sent++;
                metrics.increment('emailsSent');
            } else {
                logger.error(`Failed to send Email 2: ${result.error || result.message}`);
                errors.push(`${lead.email}: ${result.error || result.message}`);
                // recordError is already handled inside sendingAgent.sendEmail2
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unexpected error sending Email 2 to ${lead.email}`, { metadata: error });
            errors.push(`${lead.email}: ${message}`);
            await leadsDb.recordError(lead.id, `Email 2 unexpected error: ${message}`);
        }

        // Rate limiting handled in loop
        await new Promise(resolve => setTimeout(resolve, 600));
    }

    return { sent, errors };
}

async function processEmail3Followups(supabase: SupabaseClient, config: FollowUpConfig): Promise<{ sent: number; errors: string[] }> {
    logger.info(`Checking for Email 3 follow-ups (${config.email3DelayDays} days after Email 1)`);

    const leads = await getLeadsForEmail3(supabase, config.email3DelayDays);
    logger.info(`Found ${leads.length} leads due for Email 3`);

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        try {
            logger.info(`Sending Email 3 to: ${lead.email}`);
            const result = await sendingAgent.sendEmail3(lead.id);

            if (result.success) {
                logSuccess(`Email 3 sent to ${lead.email}`);
                sent++;
                metrics.increment('emailsSent');
            } else {
                logger.error(`Failed to send Email 3: ${result.error || result.message}`);
                errors.push(`${lead.email}: ${result.error || result.message}`);
                // recordError is already handled inside sendingAgent.sendEmail3
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Unexpected error sending Email 3 to ${lead.email}`, { metadata: error });
            errors.push(`${lead.email}: ${message}`);
            await leadsDb.recordError(lead.id, `Email 3 unexpected error: ${message}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 600));
    }

    return { sent, errors };
}

// ============================================================================
// Main Follow-up Runner
// ============================================================================

async function countPendingFollowups(supabase: SupabaseClient, config: FollowUpConfig): Promise<{ email2Count: number; email3Count: number }> {
    const email2Cutoff = new Date();
    email2Cutoff.setDate(email2Cutoff.getDate() - config.email2DelayDays);

    const email3Cutoff = new Date();
    email3Cutoff.setDate(email3Cutoff.getDate() - config.email3DelayDays);

    const [email2Result, email3Result] = await Promise.all([
        supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'email_1_sent')
            .lt('email_1_sent_at', email2Cutoff.toISOString())
            .not('email_2_body', 'is', null),
        supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'email_2_sent')
            .lt('email_1_sent_at', email3Cutoff.toISOString())
            .not('email_3_body', 'is', null)
    ]);

    return {
        email2Count: email2Result.count || 0,
        email3Count: email3Result.count || 0
    };
}

async function runFollowups(): Promise<FollowUpResult | null> {
    const config = getConfig();
    const result: FollowUpResult = { email2Sent: 0, email3Sent: 0, quarantineCount: 0, errors: [] };

    // Validate required environment variables
    if (!config.supabaseUrl || !config.supabaseKey) {
        const msg = 'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables';
        logger.error(msg);
        result.errors.push(msg);
        return result;
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseKey);

    // Test database connection first
    try {
        const { error: testError } = await supabase.from('leads').select('count').limit(1);
        if (testError) {
            throw new Error(`Database connection test failed: ${testError.message || JSON.stringify(testError)}`);
        }
    } catch (connError) {
        const msg = `Database connection failed: ${connError instanceof Error ? connError.message : String(connError)}`;
        logger.error(msg, { metadata: connError });
        result.errors.push(msg);
        return result;
    }

    // Early exit: Check if there are any pending follow-ups before processing
    try {
        const pending = await countPendingFollowups(supabase, config);

        if (pending.email2Count === 0 && pending.email3Count === 0) {
            logger.info('No pending follow-ups - skipping run');
            return null; // null signals "nothing to do" - no Slack notification needed
        }

        logger.info(`Found ${pending.email2Count} Email 2 and ${pending.email3Count} Email 3 follow-ups pending`);
    } catch (countError) {
        logger.warn('Could not count pending follow-ups, proceeding with full check', { metadata: countError });
    }

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          📬 AUTONOME FOLLOW-UP SCHEDULER                      ║
╚═══════════════════════════════════════════════════════════════╝
`);

    try {
        const email2Result = await processEmail2Followups(supabase, config);
        result.email2Sent = email2Result.sent;
        result.errors.push(...email2Result.errors);

        // CRITICAL: Add delay between Email 2 and Email 3 batches
        // This prevents the last Email 2 and first Email 3 from hitting rate limits
        if (email2Result.sent > 0) {
            logger.info('Waiting 600ms before Email 3 batch to respect rate limits...');
            await new Promise(resolve => setTimeout(resolve, 600));
        }

        const email3Result = await processEmail3Followups(supabase, config);
        result.email3Sent = email3Result.sent;
        result.errors.push(...email3Result.errors);
    } catch (error) {
        // Handle various error types properly
        let errorMsg: string;
        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === 'object' && error !== null) {
            // Supabase errors come as objects with message/details
            errorMsg = JSON.stringify(error);
        } else {
            errorMsg = String(error);
        }
        result.errors.push(errorMsg);
    }

    // Fetch quarantine stats
    try {
        result.quarantineCount = await leadsDb.countQuarantined();
    } catch (e) {
        logger.warn('Failed to fetch quarantine stats', { metadata: e });
    }

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                 📊 FOLLOW-UP SUMMARY                        │
├─────────────────────────────────────────────────────────────┤
│  📧 Email 2 Sent:  ${String(result.email2Sent).padStart(5)}                               │
│  📧 Email 3 Sent:  ${String(result.email3Sent).padStart(5)}                               │
│  ⚠️  Quarantined:    ${String(result.quarantineCount).padStart(5)}                               │
│  ❌ Errors:        ${String(result.errors.length).padStart(5)}                               │
└─────────────────────────────────────────────────────────────┘
`);

    return result;
}

// ============================================================================
// Watch Mode
// ============================================================================

export function startFollowupScheduler(): void {
    const config = getConfig();
    logger.info('👀 Starting follow-up watcher (runs every hour)');

    // Startup validation
    if (!config.slackWebhookUrl) {
        logger.warn('SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
    } else {
        logSuccess('Slack notifications enabled');
    }

    // Run immediately on start
    runFollowups().then(result => {
        // Only send Slack notification if there was work to do (result !== null)
        if (result) {
            sendSlackNotification(result, config);
        }
    }).catch(async error => {
        await sendCriticalFailureNotification(
            error instanceof Error ? error : new Error(String(error)),
            'Initial run',
            config
        );
    });

    // Schedule hourly runs with error handling
    cron.schedule('0 * * * 1-6', async () => {
        try {
            const result = await runFollowups();
            // Only send Slack notification if there was work to do (result !== null)
            if (result) {
                await sendSlackNotification(result, config);
            }
        } catch (error) {
            await sendCriticalFailureNotification(
                error instanceof Error ? error : new Error(String(error)),
                'Scheduled run',
                config
            );
        }
    });

    logger.info('Follow-up Watcher started');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
    const config = getConfig();
    const args = process.argv.slice(2);

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          📬 AUTONOME FOLLOW-UP SCHEDULER                      ║
╚═══════════════════════════════════════════════════════════════╝
`);

    // Startup validation
    if (!config.slackWebhookUrl) {
        logger.warn('SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
    } else {
        logSuccess('Slack notifications enabled');
    }

    if (args.includes('--watch') || args.includes('-w')) {
        startFollowupScheduler();
    } else if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx tsx src/followup-scheduler.ts [options]

Options:
  --watch, -w    Run continuously (check every hour)
  --help, -h     Show this help message

Environment Variables:
  EMAIL_2_DELAY_DAYS   Days after Email 1 to send Email 2 (default: 3)
  EMAIL_3_DELAY_DAYS   Days after Email 1 to send Email 3 (default: 7)
  SLACK_WEBHOOK_URL    Slack webhook for notifications (REQUIRED for alerts!)
`);
    } else {
        try {
            const result = await runFollowups();
            // Only send Slack notification if there was work to do (result !== null)
            if (result) {
                await sendSlackNotification(result, config);
                process.exit(result.errors.length > 0 ? 1 : 0);
            } else {
                // Nothing to do - exit cleanly without notification
                process.exit(0);
            }
        } catch (error) {
            await sendCriticalFailureNotification(
                error instanceof Error ? error : new Error(String(error)),
                'Follow-up run',
                config
            );
            process.exit(1);
        }
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
        const config = getConfig();
        logger.error('Follow-up scheduler crashed', { metadata: error });
        await sendCriticalFailureNotification(
            error instanceof Error ? error : new Error(String(error)),
            'Scheduler Startup',
            config
        );
        process.exit(1);
    });
}