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
import Anthropic from '@anthropic-ai/sdk';

config();

// ============================================================================
// Sender Configuration
// ============================================================================

interface Sender {
    email: string;
    name: string;
    title: string;
}


import { ICP } from './config/icp.js';
import { discoveryAgent } from './agents/discovery/index.js';

async function runDiscoveryStage(limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 0: DISCOVERY (Apify Scraping)                         │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    const result = await discoveryAgent.executeScrape({
        industries: ICP.industries,
        jobTitles: ICP.jobTitles,
        locations: ICP.locations,
        maxResults: Math.min(limit, ICP.maxResultsPerRun)
    });

    if (!result.success || !result.data) {
        // If it's just no leads, don't crash pipeline
        if (result.totalFound === 0) {
            console.log('   ⚠️ No new leads found matching criteria');
            return 0;
        }
        console.error(`   ❌ Discovery failed: ${result.message}`);
        throw new Error(result.message);
    }

    console.log(`   ✅ Discovery complete: ${result.data.new_leads} new leads added`);
    return result.data.new_leads;
}

// Autonome Sales Team Senders
const SENDERS: Sender[] = [
    { email: 'brian@autonome.us', name: 'Brian P.', title: 'Solutions Consultant' },
    { email: 'crystal@autonome.us', name: 'Crystal R.', title: 'Director of Client Services & Automation Strategy' },
    { email: 'johnnie@autonome.us', name: 'Johnnie T.', title: 'Account Executive' },
    { email: 'kevin@autonome.us', name: 'Kevin J.', title: 'Director of Partnerships' },
    { email: 'jonathan@autonome.us', name: 'Jonathan R.', title: 'Account Executive' },
];

// Booking link
const BOOKING_URL = 'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ37C4OHXBuDpQ79wsup6S8hiKCIgHQaRFi_uMHIChLa-KUzEvvbV4Qjv0NigQi5q8YodqVuC1vU';

// Opt-out base URL
const OPTOUT_BASE_URL = 'https://optout.autonome.us';

let senderIndex = 0;

function getNextSender(): Sender {
    const sender = SENDERS[senderIndex];
    senderIndex = (senderIndex + 1) % SENDERS.length;
    return sender;
}

function generateSignature(sender: Sender, leadEmail: string): string {
    const optoutUrl = `${OPTOUT_BASE_URL}?email=${encodeURIComponent(leadEmail)}`;

    return `

All the Best,

---
${sender.name} | ${sender.title}
Autonome | Intelligent Systems & Automations
📅 Book a Call Now: ${BOOKING_URL}

Unsubscribe from future emails: ${optoutUrl}`;
}

// ============================================================================
// Email Body Cleaning
// ============================================================================

function cleanEmailBody(emailBody: string): string {
    // Multi-pass comprehensive cleaning to remove ANY signature content Claude adds
    let cleaned = emailBody;

    // PASS 1: Remove common closing phrases and everything after them
    // These patterns are GREEDY and will remove everything from the phrase onwards
    const closingPhrases = [
        /Best,[\s\S]*/gi,
        /Regards,[\s\S]*/gi,
        /Sincerely,[\s\S]*/gi,
        /All the best,[\s\S]*/gi,
        /Cheers,[\s\S]*/gi,
        /Thanks,[\s\S]*/gi,
        /Thank you,[\s\S]*/gi,
        /Warmly,[\s\S]*/gi,
        /Kind regards,[\s\S]*/gi,
        /Warm regards,[\s\S]*/gi,
    ];

    for (const pattern of closingPhrases) {
        cleaned = cleaned.replace(pattern, '');
    }

    // PASS 2: Remove placeholder patterns
    const placeholderPatterns = [
        /\[Name\][\s\S]*/gi,
        /\[Your Name\][\s\S]*/gi,
        /\[Sender Name\][\s\S]*/gi,
    ];

    for (const pattern of placeholderPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // PASS 3: Remove separator lines and everything after
    cleaned = cleaned.replace(/---[\s\S]*/g, '');
    cleaned = cleaned.replace(/___[\s\S]*/g, '');
    cleaned = cleaned.replace(/\n\s*-{3,}[\s\S]*/g, '');

    // PASS 4: Remove unsubscribe/opt-out text
    const unsubscribePatterns = [
        /Unsubscribe[\s\S]*/gi,
        /To opt out[\s\S]*/gi,
        /Click here to unsubscribe[\s\S]*/gi,
        /Opt out[\s\S]*/gi,
    ];

    for (const pattern of unsubscribePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // PASS 5: Remove any URLs that look like unsubscribe links
    cleaned = cleaned.replace(/https?:\/\/[^\s]*opt[-_]?out[^\s]*/gi, '');
    cleaned = cleaned.replace(/https?:\/\/[^\s]*unsubscribe[^\s]*/gi, '');

    // PASS 6: Aggressive trimming - remove multiple blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // PASS 7: Final trim
    cleaned = cleaned.trim();

    // PASS 8: Safety check - if email looks suspiciously short (< 50 chars), 
    // it might have been over-cleaned. In that case, return original.
    // If email is reasonable length, return cleaned version.
    if (cleaned.length < 50 && emailBody.length > 100) {
        console.warn('   ⚠️  Email body was over-cleaned, using original');
        return emailBody.trim();
    }

    return cleaned;
}

// ============================================================================
// Configuration
// ============================================================================

interface SchedulerConfig {
    schedule: string;
    timezone: string;
    limit: number;
    slackWebhookUrl?: string;
    enableSlack: boolean;
}

function getSchedulerConfig(): SchedulerConfig {
    return {
        schedule: process.env.PIPELINE_SCHEDULE || '0 9 * * *',
        timezone: process.env.PIPELINE_TIMEZONE || 'America/New_York',
        limit: parseInt(process.env.PIPELINE_LIMIT || '10', 10),
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        enableSlack: !!process.env.SLACK_WEBHOOK_URL,
    };
}

// ============================================================================
// Logging
// ============================================================================

function log(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const emoji = {
        INFO: 'ℹ️',
        WARN: '⚠️',
        ERROR: '❌',
        SUCCESS: '✅',
    }[level];

    console.log(`[${timestamp}] ${emoji} ${level}: ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

// ============================================================================
// Pipeline Result Types
// ============================================================================

interface PipelineResult {
    researched: number;
    emailsCreated: number;
    emailsSent: number;
    duration: number;
    errors: string[];
}

// ============================================================================
// Slack Notifications
// ============================================================================

async function sendSlackNotification(
    result: PipelineResult,
    config: SchedulerConfig
): Promise<void> {
    if (!config.enableSlack || !config.slackWebhookUrl) {
        return;
    }

    const hasErrors = result.errors && result.errors.length > 0;
    const emoji = hasErrors ? '⚠️' : '✅';
    const status = hasErrors ? 'completed with errors' : 'completed successfully';

    const message = {
        blocks: [
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
                    { type: 'mrkdwn', text: `*Leads Researched:*\n${result.researched}` },
                    { type: 'mrkdwn', text: `*Emails Created:*\n${result.emailsCreated}` },
                    { type: 'mrkdwn', text: `*Emails Sent:*\n${result.emailsSent}` },
                    { type: 'mrkdwn', text: `*Duration:*\n${result.duration.toFixed(1)}s` },
                ],
            },
        ],
    };

    try {
        await fetch(config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
        });
    } catch (error) {
        log('WARN', 'Failed to send Slack notification');
    }
}

// ============================================================================
// Database & AI Setup
// ============================================================================

interface Lead {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    job_title?: string;
    linkedin_url?: string;
    status: string;
    research_summary?: string;
    pain_points?: string[];
    talking_points?: string[];
    email_1_subject?: string;
    email_1_body?: string;
    email_2_body?: string;
    email_3_subject?: string;
    email_3_body?: string;
    assigned_sender?: string;
}

async function getLeadsByStatus(supabase: SupabaseClient, status: string, limit: number): Promise<Lead[]> {
    const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('status', status)
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function updateLead(supabase: SupabaseClient, id: string, updates: Partial<Lead> & Record<string, any>): Promise<void> {
    const { error } = await supabase
        .from('leads')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

// ============================================================================
// Stage 1: Research
// ============================================================================

async function researchLead(anthropic: Anthropic, lead: Lead): Promise<{ summary: string; painPoints: string[]; talkingPoints: string[] }> {
    const prompt = `You are a B2B sales research analyst. Analyze this lead and provide insights.

Lead Information:
- Name: ${lead.first_name} ${lead.last_name}
- Title: ${lead.job_title || 'Unknown'}
- Company: ${lead.company_name || 'Unknown'}
- LinkedIn: ${lead.linkedin_url || 'Not provided'}

Provide:
1. A brief summary (2-3 sentences)
2. 3 potential pain points
3. 3 talking points for outreach

Format as JSON:
{
  "summary": "...",
  "painPoints": ["...", "...", "..."],
  "talkingPoints": ["...", "...", "..."]
}`;

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse research response');
    return JSON.parse(jsonMatch[0]);
}

async function runResearchStage(supabase: SupabaseClient, anthropic: Anthropic, limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 1: RESEARCH                                           │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    const leads = await getLeadsByStatus(supabase, 'scraped', limit);
    console.log(`📋 Found ${leads.length} leads to research`);

    let processed = 0;
    for (const lead of leads) {
        try {
            console.log(`\n🔍 Researching: ${lead.email}`);
            const research = await researchLead(anthropic, lead);

            // Assign a sender to this lead for consistent communication
            const assignedSender = getNextSender();

            await updateLead(supabase, lead.id, {
                research_summary: research.summary,
                pain_points: research.painPoints,
                talking_points: research.talkingPoints,
                assigned_sender: assignedSender.email,
                status: 'researched',
            });
            console.log(`   ✅ Research complete (assigned to ${assignedSender.name})`);
            processed++;
        } catch (error) {
            console.error(`   ❌ Failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    console.log(`\n🏁 Stage 1 Complete: ${processed} leads researched`);
    return processed;
}

// ============================================================================
// Stage 2: Outreach
// ============================================================================

async function generateEmails(anthropic: Anthropic, lead: Lead, sender: Sender): Promise<{ subject1: string; body1: string; body2: string; subject3: string; body3: string }> {
    const prompt = `You are an expert cold email copywriter. Write a 3-email sequence.

CRITICAL INSTRUCTIONS - READ CAREFULLY:
- DO NOT write "Best,", "Regards,", "Sincerely," or ANY closing salutation
- DO NOT write the sender's name at the end
- DO NOT include "---" separator lines
- DO NOT include ANY unsubscribe links or opt-out text
- DO NOT include "[Name]" or any name placeholder
- The email body should END with your question or call-to-action
- A professional signature will be automatically added after your content

Lead Information:
- Name: ${lead.first_name} ${lead.last_name}
- Title: ${lead.job_title || 'Professional'}
- Company: ${lead.company_name || 'their company'}

You are writing as: ${sender.name}, ${sender.title} at Autonome

Research Summary: ${lead.research_summary}
Pain Points: ${lead.pain_points?.join(', ')}
Talking Points: ${lead.talking_points?.join(', ')}

Write 3 emails (under 100 words each). Be conversational, not salesy.
Each email should end with a question or soft CTA - NOTHING ELSE after that.

Example of what your email body should look like:
"Hi Sarah,

Noticed you're running things with a Gmail address - respect for keeping it lean and accessible.

I'm guessing like most bootstrap CEOs, you're drowning in admin tasks that eat into strategic time. Things like data entry, scheduling, basic customer follow-ups.

We help CEOs like you automate the mundane stuff so you can focus on what actually moves the needle.

Worth a 15-min chat?"

THAT'S IT. The email ends with the question mark. No "Best," no name, no unsubscribe text.

Format as JSON:
{
  "email1_subject": "...",
  "email1_body": "...",
  "email2_body": "...",
  "email3_subject": "...",
  "email3_body": "..."
}`;

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse email response');
    const emails = JSON.parse(jsonMatch[0]);

    // Clean the email bodies to remove any signature elements Claude might have added
    return {
        subject1: emails.email1_subject,
        body1: cleanEmailBody(emails.email1_body),
        body2: cleanEmailBody(emails.email2_body),
        subject3: emails.email3_subject,
        body3: cleanEmailBody(emails.email3_body),
    };
}

async function runOutreachStage(supabase: SupabaseClient, anthropic: Anthropic, limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 2: OUTREACH (Email Generation)                        │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    const leads = await getLeadsByStatus(supabase, 'researched', limit);
    console.log(`📋 Found ${leads.length} leads for email generation`);

    let processed = 0;
    for (const lead of leads) {
        try {
            // Get the assigned sender or assign a new one
            const sender = lead.assigned_sender
                ? SENDERS.find(s => s.email === lead.assigned_sender) || getNextSender()
                : getNextSender();

            console.log(`\n✉️ Generating emails for: ${lead.email} (from ${sender.name})`);
            const emails = await generateEmails(anthropic, lead, sender);

            await updateLead(supabase, lead.id, {
                email_1_subject: emails.subject1,
                email_1_body: emails.body1,
                email_2_body: emails.body2,
                email_3_subject: emails.subject3,
                email_3_body: emails.body3,
                assigned_sender: sender.email,
                status: 'ready',
            });
            console.log(`   ✅ Emails generated`);
            processed++;
        } catch (error) {
            console.error(`   ❌ Failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    console.log(`\n🏁 Stage 2 Complete: ${processed} email sequences generated`);
    return processed;
}

// ============================================================================
// Stage 3: Sending
// ============================================================================

async function sendEmailViaResend(
    to: string,
    subject: string,
    body: string,
    sender: Sender
): Promise<{ success: boolean; error?: string }> {
    const resendKey = process.env.RESEND_API_KEY;

    if (!resendKey) {
        return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    // Add signature to body
    const fullBody = body + generateSignature(sender, to);

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: `${sender.name} <${sender.email}>`,
                to: [to],
                subject,
                html: convertTextToHtml(fullBody),
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

function convertTextToHtml(text: string): string {
    // Convert plain text to HTML with proper hyperlinks
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    // Convert "Book a Call Now: [URL]" to hyperlinked version
    html = html.replace(
        /📅 Book a Call Now: (https?:\/\/[^\s<]+)/g,
        '📅 <a href="$1">Book a Call Now</a>'
    );

    // Convert "Unsubscribe from future emails: [URL]" to hyperlinked version
    html = html.replace(
        /Unsubscribe from future emails: (https?:\/\/[^\s<]+)/g,
        '<a href="$1">Unsubscribe from future emails</a>'
    );

    return html;
}

async function runSendingStage(supabase: SupabaseClient, limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 3: SENDING (Email 1)                                  │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    const leads = await getLeadsByStatus(supabase, 'ready', limit);
    console.log(`📋 Found ${leads.length} leads ready to send`);

    let sent = 0;
    for (const lead of leads) {
        if (!lead.email_1_subject || !lead.email_1_body) {
            console.log(`\n⚠️ Skipping ${lead.email}: Missing email content`);
            continue;
        }

        // Get the assigned sender
        const sender = lead.assigned_sender
            ? SENDERS.find(s => s.email === lead.assigned_sender) || SENDERS[0]
            : SENDERS[0];

        console.log(`\n📤 Sending Email 1 to: ${lead.email}`);
        console.log(`   📧 Sending to: ${lead.email}`);
        console.log(`   📋 Subject: ${lead.email_1_subject}`);
        console.log(`   🎤 From: ${sender.name} <${sender.email}>`);

        const result = await sendEmailViaResend(
            lead.email,
            lead.email_1_subject,
            lead.email_1_body,
            sender
        );

        if (result.success) {
            await updateLead(supabase, lead.id, {
                status: 'email_1_sent',
                email_1_sent_at: new Date().toISOString(),
            });
            console.log(`   ✅ Sent successfully`);
            sent++;
        } else {
            console.log(`   ❌ Failed: ${result.error}`);
        }
    }

    console.log(`\n🏁 Stage 3 Complete: ${sent} emails sent`);
    return sent;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runPipeline(limit: number): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🚀 AUTONOME SALES PIPELINE ORCHESTRATOR              ║
╚═══════════════════════════════════════════════════════════════╝
`);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey || !anthropicKey) {
        throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Test connection
    try {
        const { error } = await supabase.from('leads').select('count').limit(1);
        if (error) throw error;
        console.log('✅ Database connected');
        console.log(`📧 Sender rotation: ${SENDERS.map(s => s.name).join(', ')}`);
    } catch (error: any) {
        const msg = `Database connection failed: ${error.message || JSON.stringify(error)}`;
        console.error(`❌ ${msg}`);
        if (error.details) console.error(error.details);
        if (error.hint) console.error(error.hint);
        return { researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [msg] };
    }



    let discovered = 0, researched = 0, emailsCreated = 0, emailsSent = 0;

    try { discovered = await runDiscoveryStage(limit); }
    catch (error) { errors.push(`Discovery: ${error}`); }

    try { researched = await runResearchStage(supabase, anthropic, limit); }
    catch (error) { errors.push(`Research: ${error}`); }

    try { emailsCreated = await runOutreachStage(supabase, anthropic, limit); }
    catch (error) { errors.push(`Outreach: ${error}`); }

    try { emailsSent = await runSendingStage(supabase, limit); }
    catch (error) { errors.push(`Sending: ${error}`); }

    const duration = (Date.now() - startTime) / 1000;

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    🏁 PIPELINE SUMMARY                      │
├─────────────────────────────────────────────────────────────┤
│  🔎 Leads Discovered:      ${String(discovered).padStart(5)}                          │
│  🔬 Leads Researched:      ${String(researched).padStart(5)}                          │
│  📧 Email Sequences Created: ${String(emailsCreated).padStart(3)}                          │
│  📤 Emails Sent:           ${String(emailsSent).padStart(5)}                          │
│  ⏱️  Duration:            ${duration.toFixed(1).padStart(6)}s                         │
└─────────────────────────────────────────────────────────────┘
`);

    return { researched, emailsCreated, emailsSent, duration, errors };
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
    log('INFO', '📅 Starting Autonome Sales Pipeline Scheduler', {
        schedule: config.schedule,
        timezone: config.timezone,
        limit: config.limit,
    });

    if (!cron.validate(config.schedule)) {
        log('ERROR', 'Invalid cron expression', { schedule: config.schedule });
        process.exit(1);
    }

    log('INFO', `⏰ Schedule: ${describeCron(config.schedule)}`);
    log('INFO', `📧 Senders: ${SENDERS.map(s => s.name).join(', ')}`);

    const task = cron.schedule(
        config.schedule,
        async () => {
            const result = await runPipeline(config.limit);
            await sendSlackNotification(result, config);
        },
        { scheduled: true, timezone: config.timezone }
    );

    process.on('SIGINT', () => { task.stop(); process.exit(0); });
    process.on('SIGTERM', () => { task.stop(); process.exit(0); });

    log('SUCCESS', '✅ Scheduler started. Waiting for next scheduled run...');
    log('INFO', 'Press Ctrl+C to stop');
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

    if (args.includes('--once') || args.includes('-o')) {
        log('INFO', 'Running pipeline once (--once flag)');
        const result = await runPipeline(config.limit);
        await sendSlackNotification(result, config);
        process.exit(result.errors.length > 0 ? 1 : 0);
    } else if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx tsx src/scheduler.ts [options]

Options:
  --once, -o     Run pipeline once immediately and exit
  --help, -h     Show this help message

Environment Variables:
  PIPELINE_SCHEDULE    Cron expression (default: "0 9 * * *" = 9 AM daily)
  PIPELINE_TIMEZONE    Timezone (default: "America/New_York")
  PIPELINE_LIMIT       Max leads per stage (default: 10)
  SLACK_WEBHOOK_URL    Slack webhook for notifications (optional)

Senders Configured:
${SENDERS.map(s => `  - ${s.name} (${s.email}) - ${s.title}`).join('\n')}
`);
        process.exit(0);
    } else {
        startScheduler(config);
    }
}

main().catch((error) => {
    log('ERROR', 'Scheduler failed', { error });
    process.exit(1);
});