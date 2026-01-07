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
import { researchAgent } from './agents/research/index.js';
import { buildEmployeeRanges } from './tools/apify.js';

async function runDiscoveryStage(limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 0: DISCOVERY (Apify Leads Scraper)                    │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    const result = await discoveryAgent.executeScrape({
        industries: ICP.industries,
        jobTitles: ICP.jobTitles,
        locations: ICP.locations,
        seniorities: ICP.seniorities,
        employeeRanges: buildEmployeeRanges(ICP.employeeRange.min, ICP.employeeRange.max),
        maxResults: limit  // Use PIPELINE_LIMIT directly for discovery
    });

    // Handle discovery failures gracefully - don't crash the pipeline
    if (!result.success) {
        console.error(`   ❌ Discovery failed: ${result.message}`);
        return 0; // Return 0 instead of throwing to let pipeline continue
    }

    if (!result.data) {
        console.log('   ⚠️ No data returned from discovery');
        return 0;
    }

    // Check for zero leads found (correct property path)
    if (result.data.total_found === 0) {
        console.log('   ⚠️ No new leads found matching criteria');
        return 0;
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
    researchSchedule: string;  // Second daily run for research only
    timezone: string;
    limit: number;
    slackWebhookUrl?: string;
    enableSlack: boolean;
}

function getSchedulerConfig(): SchedulerConfig {
    return {
        schedule: process.env.PIPELINE_SCHEDULE || '0 9 * * *',           // Full pipeline at 9 AM
        researchSchedule: process.env.RESEARCH_SCHEDULE || '0 17 * * *',  // Research-only at 5 PM
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
    discovered: number;
    researched: number;
    emailsCreated: number;
    emailsSent: number;
    duration: number;
    errors: string[];
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
                text: `${emoji} Autonome Pipeline ${status}`,
                emoji: true,
            },
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*🔎 Discovered:*\n${result.discovered}` },
                { type: 'mrkdwn', text: `*🔬 Researched:*\n${result.researched}` },
                { type: 'mrkdwn', text: `*📧 Created:*\n${result.emailsCreated}` },
                { type: 'mrkdwn', text: `*📤 Sent:*\n${result.emailsSent}` },
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
            log('ERROR', `Slack notification failed: HTTP ${response.status}`);
        }
    } catch (error) {
        log('ERROR', `Failed to send Slack notification: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Send critical failure notification to Slack when pipeline crashes
 * This ensures you ALWAYS get notified, even on unhandled exceptions
 */
async function sendCriticalFailureNotification(
    error: Error | string,
    stage: string,
    config: SchedulerConfig
): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('ERROR', `CRITICAL FAILURE [${stage}]: ${errorMessage}`);

    if (!config.enableSlack || !config.slackWebhookUrl) {
        log('WARN', 'Cannot send Slack notification - SLACK_WEBHOOK_URL not configured');
        return;
    }

    const errorStack = error instanceof Error ? error.stack : undefined;

    const blocks: any[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '🚨 CRITICAL: Pipeline Crashed',
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
    // Research data stored as JSONB (proper field)
    research_data?: Record<string, any> | null;
    research_completed_at?: string | null;
    email_1_subject?: string;
    email_1_body?: string;
    email_2_body?: string;
    email_3_subject?: string;
    email_3_body?: string;
    assigned_sender?: string;
    // Reply tracking fields
    replied_at?: string | null;
    reply_category?: string | null;
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

    // Count leads pending Email 2 (status = email_1_sent, sent > 3 days ago)
    const { count: email2Count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'email_1_sent')
        .lt('email_1_sent_at', email2Cutoff.toISOString())
        .not('email_2_body', 'is', null);

    // Count leads pending Email 3 (status = email_2_sent, Email 1 sent > 5 days ago)
    const { count: email3Count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'email_2_sent')
        .lt('email_1_sent_at', email3Cutoff.toISOString())
        .not('email_3_body', 'is', null);

    // Count total replies (leads with replied_at set)
    const { count: totalReplies } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .not('replied_at', 'is', null);

    // Count interested replies (leads in 'engaged' status or with reply_category = 'interested')
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
// Stage 1: Research (uses researchAgent for proper research_data population)
// ============================================================================

async function runResearchStage(supabase: SupabaseClient, anthropic: Anthropic, limit: number): Promise<number> {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ STAGE 1: RESEARCH                                           │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    // Use the proper research agent (same as Slack uses)
    // This ensures research_data and research_completed_at are populated
    const result = await researchAgent.researchPendingLeads(limit);

    if (!result.success) {
        console.error(`   ❌ Research failed: ${result.error || result.message}`);
        return 0;
    }

    const data = result.data as { successful: number; failed: number; total: number } | undefined;
    const processed = data?.successful || 0;

    // Assign senders to newly researched leads
    const researchedLeads = await getLeadsByStatus(supabase, 'researched', limit);
    for (const lead of researchedLeads) {
        if (!lead.assigned_sender) {
            const assignedSender = getNextSender();
            await updateLead(supabase, lead.id, {
                assigned_sender: assignedSender.email,
            });
        }
    }

    console.log(`\n🏁 Stage 1 Complete: ${processed} leads researched`);
    return processed;
}

// ============================================================================
// Stage 2: Outreach
// ============================================================================

async function generateEmails(anthropic: Anthropic, lead: Lead, sender: Sender): Promise<{ subject1: string; body1: string; body2: string; subject3: string; body3: string }> {
    // Extract research insights from the research_data JSONB field
    const researchData = lead.research_data as { analysis?: {
        personalProfile?: string;
        companyProfile?: string;
        painPoints?: Array<{ pain: string; evidence: string; solution: string }>;
        personalizationOpportunities?: Array<{ type: string; hook: string; evidence: string }>;
        uniqueFacts?: string[];
        interests?: string[];
    }} | null;

    const analysis = researchData?.analysis;
    const personalProfile = analysis?.personalProfile || '';
    const companyProfile = analysis?.companyProfile || '';
    const painPoints = analysis?.painPoints?.map(p => p.pain).join(', ') || 'Not available';
    const hooks = analysis?.personalizationOpportunities?.map(p => p.hook).join('; ') || '';
    const uniqueFacts = analysis?.uniqueFacts?.join(', ') || '';

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

Research Insights:
- Personal Profile: ${personalProfile}
- Company Profile: ${companyProfile}
- Pain Points: ${painPoints}
- Personalization Hooks: ${hooks}
- Unique Facts: ${uniqueFacts}

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

        const data = await response.json() as { message?: string };
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

    // Debug: Check status counts before sending
    const { data: statusCounts } = await supabase
        .from('leads')
        .select('status');
    const counts: Record<string, number> = {};
    for (const row of statusCounts || []) {
        counts[row.status] = (counts[row.status] || 0) + 1;
    }
    console.log('📊 Current lead status counts:', JSON.stringify(counts));

    const leads = await getLeadsByStatus(supabase, 'ready', limit);
    console.log(`📋 Found ${leads.length} leads ready to send (limit: ${limit})`);

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
    // Use service role key to bypass RLS - important for backend operations
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
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

    // Stage 0: Discovery - find new leads
    try { discovered = await runDiscoveryStage(limit); }
    catch (error) {
        const msg = `Discovery: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log('ERROR', msg);
    }

    // Stage 1: Research - process ALL scraped leads (including newly discovered)
    try { researched = await runResearchStage(supabase, anthropic, limit); }
    catch (error) {
        const msg = `Research: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log('ERROR', msg);
    }

    // Stage 2: Outreach - process ALL researched leads (including newly researched)
    try { emailsCreated = await runOutreachStage(supabase, anthropic, limit); }
    catch (error) {
        const msg = `Outreach: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log('ERROR', msg);
    }

    // Stage 3: Sending - process ALL ready leads (including newly created emails)
    // This now includes leads that just went through stages 1-2 in this same run
    try { emailsSent = await runSendingStage(supabase, limit); }
    catch (error) {
        const msg = `Sending: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log('ERROR', msg);
    }

    const duration = (Date.now() - startTime) / 1000;

    // Gather follow-up and engagement stats
    let followUpStats;
    try {
        followUpStats = await getFollowUpStats(supabase);
        console.log('📊 Follow-up stats:', JSON.stringify(followUpStats));
    } catch (error) {
        log('WARN', `Failed to get follow-up stats: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    🏁 PIPELINE SUMMARY                      │
├─────────────────────────────────────────────────────────────┤
│  🔎 Leads Discovered:      ${String(discovered).padStart(5)}                          │
│  🔬 Leads Researched:      ${String(researched).padStart(5)}                          │
│  📧 Email Sequences Created: ${String(emailsCreated).padStart(3)}                          │
│  📤 Emails Sent:           ${String(emailsSent).padStart(5)}                          │
│  ⏱️  Duration:            ${duration.toFixed(1).padStart(6)}s                         │
├─────────────────────────────────────────────────────────────┤
│  📬 FOLLOW-UP STATUS                                        │
│  Email 2 Pending:   ${String(followUpStats?.email2Pending || 0).padStart(5)}                               │
│  Email 3 Pending:   ${String(followUpStats?.email3Pending || 0).padStart(5)}                               │
│  Total Replies:     ${String(followUpStats?.totalReplies || 0).padStart(5)}                               │
│  🎉 Interested:     ${String(followUpStats?.interestedReplies || 0).padStart(5)}                               │
└─────────────────────────────────────────────────────────────┘
`);

    return { discovered, researched, emailsCreated, emailsSent, duration, errors, followUpStats };
}

// ============================================================================
// Research-Only Pipeline (for second daily run)
// ============================================================================

async function runResearchOnlyPipeline(limit: number): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🔬 AUTONOME RESEARCH PIPELINE (Afternoon Run)        ║
╚═══════════════════════════════════════════════════════════════╝
`);

    const supabaseUrl = process.env.SUPABASE_URL;
    // Use service role key to bypass RLS - important for backend operations
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
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
    } catch (error: any) {
        const msg = `Database connection failed: ${error.message || JSON.stringify(error)}`;
        console.error(`❌ ${msg}`);
        return { researched: 0, emailsCreated: 0, emailsSent: 0, duration: 0, errors: [msg] };
    }

    let researched = 0;

    // Only run research stage (process scraped leads)
    try { researched = await runResearchStage(supabase, anthropic, limit); }
    catch (error) {
        const msg = `Research: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log('ERROR', msg);
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

    return { discovered: 0, researched, emailsCreated: 0, emailsSent: 0, duration, errors };
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
        researchSchedule: config.researchSchedule,
        timezone: config.timezone,
        limit: config.limit,
    });

    if (!cron.validate(config.schedule)) {
        log('ERROR', 'Invalid cron expression', { schedule: config.schedule });
        process.exit(1);
    }

    if (!cron.validate(config.researchSchedule)) {
        log('ERROR', 'Invalid research cron expression', { schedule: config.researchSchedule });
        process.exit(1);
    }

    log('INFO', `⏰ Full Pipeline: ${describeCron(config.schedule)}`);
    log('INFO', `🔬 Research Run: ${describeCron(config.researchSchedule)}`);
    log('INFO', `📧 Senders: ${SENDERS.map(s => s.name).join(', ')}`);

    // Full pipeline (morning) - discovery, research, outreach, sending
    const fullPipelineTask = cron.schedule(
        config.schedule,
        async () => {
            try {
                const result = await runPipeline(config.limit);
                await sendSlackNotification(result, config);
            } catch (error) {
                await sendCriticalFailureNotification(
                    error instanceof Error ? error : new Error(String(error)),
                    'Pipeline Execution (scheduled)',
                    config
                );
            }
        },
        { timezone: config.timezone }
    );

    // Research-only pipeline (afternoon) - processes any scraped leads
    const researchTask = cron.schedule(
        config.researchSchedule,
        async () => {
            try {
                const result = await runResearchOnlyPipeline(config.limit);
                await sendSlackNotification(result, config);
            } catch (error) {
                await sendCriticalFailureNotification(
                    error instanceof Error ? error : new Error(String(error)),
                    'Research Pipeline (scheduled)',
                    config
                );
            }
        },
        { timezone: config.timezone }
    );

    process.on('SIGINT', () => { fullPipelineTask.stop(); researchTask.stop(); process.exit(0); });
    process.on('SIGTERM', () => { fullPipelineTask.stop(); researchTask.stop(); process.exit(0); });

    log('SUCCESS', '✅ Scheduler started with 2 daily runs:');
    log('INFO', '   📋 9 AM: Full pipeline (discover → research → outreach → send)');
    log('INFO', '   🔬 5 PM: Research only (process any new scraped leads)');
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

    // Startup validation: warn if Slack notifications are disabled
    if (!config.enableSlack) {
        log('WARN', '⚠️  SLACK_WEBHOOK_URL not set - you will NOT receive failure notifications!');
        log('WARN', '   Set SLACK_WEBHOOK_URL in your environment to enable alerts.');
    } else {
        log('SUCCESS', '✅ Slack notifications enabled');
    }

    if (args.includes('--once') || args.includes('-o')) {
        log('INFO', 'Running pipeline once (--once flag)');
        try {
            const result = await runPipeline(config.limit);
            await sendSlackNotification(result, config);
            process.exit(result.errors.length > 0 ? 1 : 0);
        } catch (error) {
            await sendCriticalFailureNotification(
                error instanceof Error ? error : new Error(String(error)),
                'Pipeline (--once mode)',
                config
            );
            process.exit(1);
        }
    } else if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npx tsx src/scheduler.ts [options]

Options:
  --once, -o     Run pipeline once immediately and exit
  --help, -h     Show this help message

Environment Variables:
  PIPELINE_SCHEDULE    Cron for full pipeline (default: "0 9 * * *" = 9 AM daily)
  RESEARCH_SCHEDULE    Cron for research-only run (default: "0 17 * * *" = 5 PM daily)
  PIPELINE_TIMEZONE    Timezone (default: "America/New_York")
  PIPELINE_LIMIT       Max leads to discover AND process per stage (default: 10)
  SLACK_WEBHOOK_URL    Slack webhook for notifications (REQUIRED for alerts!)

Pipeline Schedules:
  - 9 AM: Full pipeline (discover → research → outreach → send)
  - 5 PM: Research only (process any new scraped leads from Slack discovery)

Senders Configured:
${SENDERS.map(s => `  - ${s.name} (${s.email}) - ${s.title}`).join('\n')}
`);
        process.exit(0);
    } else {
        startScheduler(config);
    }
}

// Global error handler with notification
main().catch(async (error) => {
    const config = getSchedulerConfig();
    log('ERROR', 'Scheduler crashed', { error: error instanceof Error ? error.message : String(error) });
    await sendCriticalFailureNotification(
        error instanceof Error ? error : new Error(String(error)),
        'Scheduler Startup',
        config
    );
    process.exit(1);
});