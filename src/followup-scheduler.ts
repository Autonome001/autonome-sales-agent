/**
 * Autonome Sales Agent - Follow-up Scheduler
 * 
 * Automatically sends Email 2 and Email 3 follow-ups at configured intervals.
 * 
 * Default Schedule:
 *   - Email 2: 3 days after Email 1
 *   - Email 3: 7 days after Email 1
 */

import cron from 'node-cron';
import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
        supabaseKey: process.env.SUPABASE_ANON_KEY || '',
        resendKey: process.env.RESEND_API_KEY,
        defaultSenderEmail: process.env.DEFAULT_SENDER_EMAIL || 'hello@example.com',
        defaultSenderName: process.env.DEFAULT_SENDER_NAME || 'Sales Team',
        email2DelayDays: parseInt(process.env.EMAIL_2_DELAY_DAYS || '3', 10),
        email3DelayDays: parseInt(process.env.EMAIL_3_DELAY_DAYS || '7', 10),
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    };
}

// ============================================================================
// Types
// ============================================================================

interface Lead {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    status: string;
    email_1_sent_at?: string;
    email_2_sent_at?: string;
    email_1_subject?: string;
    email_2_body?: string;
    email_3_subject?: string;
    email_3_body?: string;
}

interface FollowUpResult {
    email2Sent: number;
    email3Sent: number;
    errors: string[];
}

// ============================================================================
// Logging
// ============================================================================

function log(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const emoji = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌', SUCCESS: '✅' }[level];
    console.log(`[${timestamp}] ${emoji} ${level}: ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

// ============================================================================
// Slack Notifications
// ============================================================================

async function sendSlackNotification(result: FollowUpResult, config: FollowUpConfig): Promise<void> {
    if (!config.slackWebhookUrl) {
        log('WARN', 'Slack notifications disabled - SLACK_WEBHOOK_URL not set');
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
            log('ERROR', `Slack notification failed: HTTP ${response.status}`);
        }
    } catch (error) {
        log('ERROR', `Failed to send Slack notification: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function sendCriticalFailureNotification(
    error: Error | string,
    stage: string,
    config: FollowUpConfig
): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('ERROR', `CRITICAL FAILURE [${stage}]: ${errorMessage}`);

    if (!config.slackWebhookUrl) {
        log('WARN', 'Cannot send Slack notification - SLACK_WEBHOOK_URL not configured');
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
        log('INFO', 'Critical failure notification sent to Slack');
    } catch (fetchError) {
        log('ERROR', `Failed to send critical failure notification: ${fetchError}`);
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

    if (error) throw error;
    return data || [];
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

    if (error) throw error;
    return data || [];
}

async function updateLead(supabase: SupabaseClient, id: string, updates: any): Promise<void> {
    const { error } = await supabase
        .from('leads')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

// ============================================================================
// Email Sending
// ============================================================================

async function sendEmail(config: FollowUpConfig, to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }> {
    if (!config.resendKey) {
        return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: `${config.defaultSenderName} <${config.defaultSenderEmail}>`,
                to: [to],
                subject,
                text: body,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return { success: false, error: data.message || 'Unknown error' };
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// ============================================================================
// Follow-up Processing
// ============================================================================

async function processEmail2Followups(supabase: SupabaseClient, config: FollowUpConfig): Promise<{ sent: number; errors: string[] }> {
    log('INFO', `Checking for Email 2 follow-ups (${config.email2DelayDays} days after Email 1)`);

    const leads = await getLeadsForEmail2(supabase, config.email2DelayDays);
    log('INFO', `Found ${leads.length} leads due for Email 2`);

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        if (!lead.email_2_body) continue;

        const subject = `Re: ${lead.email_1_subject || 'Following up'}`;
        log('INFO', `Sending Email 2 to: ${lead.email}`);

        const result = await sendEmail(config, lead.email, subject, lead.email_2_body);

        if (result.success) {
            await updateLead(supabase, lead.id, { status: 'email_2_sent', email_2_sent_at: new Date().toISOString() });
            log('SUCCESS', `Email 2 sent to ${lead.email}`);
            sent++;
        } else {
            log('ERROR', `Failed: ${result.error}`);
            errors.push(`${lead.email}: ${result.error}`);
        }
    }

    return { sent, errors };
}

async function processEmail3Followups(supabase: SupabaseClient, config: FollowUpConfig): Promise<{ sent: number; errors: string[] }> {
    log('INFO', `Checking for Email 3 follow-ups (${config.email3DelayDays} days after Email 1)`);

    const leads = await getLeadsForEmail3(supabase, config.email3DelayDays);
    log('INFO', `Found ${leads.length} leads due for Email 3`);

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
        if (!lead.email_3_body || !lead.email_3_subject) continue;

        log('INFO', `Sending Email 3 to: ${lead.email}`);

        const result = await sendEmail(config, lead.email, lead.email_3_subject, lead.email_3_body);

        if (result.success) {
            await updateLead(supabase, lead.id, { status: 'email_3_sent', email_3_sent_at: new Date().toISOString() });
            log('SUCCESS', `Email 3 sent to ${lead.email}`);
            sent++;
        } else {
            log('ERROR', `Failed: ${result.error}`);
            errors.push(`${lead.email}: ${result.error}`);
        }
    }

    return { sent, errors };
}

// ============================================================================
// Main Follow-up Runner
// ============================================================================

async function runFollowups(): Promise<FollowUpResult> {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          📬 AUTONOME FOLLOW-UP SCHEDULER                      ║
╚═══════════════════════════════════════════════════════════════╝
`);

    const config = getConfig();
    const supabase = createClient(config.supabaseUrl, config.supabaseKey);

    const result: FollowUpResult = { email2Sent: 0, email3Sent: 0, errors: [] };

    try {
        const email2Result = await processEmail2Followups(supabase, config);
        result.email2Sent = email2Result.sent;
        result.errors.push(...email2Result.errors);

        const email3Result = await processEmail3Followups(supabase, config);
        result.email3Sent = email3Result.sent;
        result.errors.push(...email3Result.errors);
    } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
    }

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                 📊 FOLLOW-UP SUMMARY                        │
├─────────────────────────────────────────────────────────────┤
│  📧 Email 2 Sent:  ${String(result.email2Sent).padStart(5)}                               │
│  📧 Email 3 Sent:  ${String(result.email3Sent).padStart(5)}                               │
│  ❌ Errors:        ${String(result.errors.length).padStart(5)}                               │
└─────────────────────────────────────────────────────────────┘
`);

    return result;
}

// ============================================================================
// Watch Mode
// ============================================================================

function startWatchMode(): void {
    const config = getConfig();
    log('INFO', '👀 Starting follow-up watcher (runs every hour)');

    // Startup validation
    if (!config.slackWebhookUrl) {
        log('WARN', '⚠️  SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
    } else {
        log('SUCCESS', '✅ Slack notifications enabled');
    }

    // Run immediately on start
    runFollowups().then(result => {
        sendSlackNotification(result, config);
    }).catch(async error => {
        await sendCriticalFailureNotification(
            error instanceof Error ? error : new Error(String(error)),
            'Initial run',
            config
        );
    });

    // Schedule hourly runs with error handling
    cron.schedule('0 * * * *', async () => {
        try {
            const result = await runFollowups();
            await sendSlackNotification(result, config);
        } catch (error) {
            await sendCriticalFailureNotification(
                error instanceof Error ? error : new Error(String(error)),
                'Scheduled run',
                config
            );
        }
    });

    log('INFO', 'Watcher started. Press Ctrl+C to stop.');
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
        log('WARN', '⚠️  SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
    } else {
        log('SUCCESS', '✅ Slack notifications enabled');
    }

    if (args.includes('--watch') || args.includes('-w')) {
        startWatchMode();
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
            await sendSlackNotification(result, config);
            process.exit(result.errors.length > 0 ? 1 : 0);
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
main().catch(async (error) => {
    const config = getConfig();
    log('ERROR', 'Follow-up scheduler crashed', { error: error instanceof Error ? error.message : String(error) });
    await sendCriticalFailureNotification(
        error instanceof Error ? error : new Error(String(error)),
        'Scheduler Startup',
        config
    );
    process.exit(1);
});