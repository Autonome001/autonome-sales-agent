import { supabase } from '../db/client.js';
import { logger, logSuccess } from '../utils/logger.js';
import { google } from 'googleapis';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';

export interface WeeklyMetrics {
    period: {
        start: Date;
        end: Date;
    };
    volume: {
        totalSent: number;
        bounced: number;
        unsubscribed: number;
        discovered: number;
        researched: number;
    };
    engagement: {
        totalReplies: number;
        interested: number;
        questions: number;
        bookedCalls: number;
        replyRate: number;
    };
    byStep: {
        step1: number;
        step2: number;
        step3: number;
    };
    demographics: {
        regions: Record<string, number>;
        industries: Record<string, number>;
        seniority: Record<string, number>;
    };
}

export class ReportingService {
    private slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    private googleSheetId = process.env.GOOGLE_REPORT_SHEET_ID;

    /**
     * Generate metrics for the past 7 days (Thursday to Thursday)
     */
    async generateWeeklyMetrics(endDate: Date = new Date()): Promise<WeeklyMetrics> {
        const startDate = subDays(endDate, 7);
        const startIso = startDate.toISOString();
        const endIso = endDate.toISOString();

        logger.info(`Generating weekly metrics from ${startIso} to ${endIso}`);

        // 1. Fetch Volume Metrics
        const { data: leadsInPeriod, error: leadsError } = await supabase
            .from('leads')
            .select('*')
            .or(`created_at.gte.${startIso},email_1_sent_at.gte.${startIso},replied_at.gte.${startIso}`);

        if (leadsError) throw leadsError;

        const metrics: WeeklyMetrics = {
            period: { start: startDate, end: endDate },
            volume: { totalSent: 0, bounced: 0, unsubscribed: 0, discovered: 0, researched: 0 },
            engagement: { totalReplies: 0, interested: 0, questions: 0, bookedCalls: 0, replyRate: 0 },
            byStep: { step1: 0, step2: 0, step3: 0 },
            demographics: { regions: {}, industries: {}, seniority: {} }
        };

        for (const lead of (leadsInPeriod as any[]) || []) {
            // Discovered
            if (lead.created_at && lead.created_at >= startIso && lead.created_at <= endIso) {
                metrics.volume.discovered++;
            }

            // Researched
            if (lead.research_completed_at && lead.research_completed_at >= startIso && lead.research_completed_at <= endIso) {
                metrics.volume.researched++;
            }

            // Sent
            if (lead.email_1_sent_at && lead.email_1_sent_at >= startIso && lead.email_1_sent_at <= endIso) {
                metrics.volume.totalSent++;
            }
            if (lead.email_2_sent_at && lead.email_2_sent_at >= startIso && lead.email_2_sent_at <= endIso) {
                metrics.volume.totalSent++;
            }
            if (lead.email_3_sent_at && lead.email_3_sent_at >= startIso && lead.email_3_sent_at <= endIso) {
                metrics.volume.totalSent++;
            }

            // Status based (Bounced / Unsubscribed)
            // Note: This relies on updated_at which covers the change in this period
            if (lead.updated_at && lead.updated_at >= startIso && lead.updated_at <= endIso) {
                if (lead.status === 'bounced') metrics.volume.bounced++;
                if (lead.status === 'opted_out') metrics.volume.unsubscribed++;
            }

            // Replies
            if (lead.replied_at && lead.replied_at >= startIso && lead.replied_at <= endIso) {
                metrics.engagement.totalReplies++;
                if (lead.reply_category === 'interested') metrics.engagement.interested++;
                if (lead.reply_category === 'question') metrics.engagement.questions++;

                // Determine which step they replied to
                if (lead.email_3_sent_at) metrics.byStep.step3++;
                else if (lead.email_2_sent_at) metrics.byStep.step2++;
                else metrics.byStep.step1++;
            }

            // Booked Calls
            if (lead.meeting_booked_at && lead.meeting_booked_at >= startIso && lead.meeting_booked_at <= endIso) {
                metrics.engagement.bookedCalls++;
            }

            // Demographics (only for new leads in period)
            if (lead.created_at >= startIso) {
                const region = lead.country || 'Unknown';
                const industry = lead.industry || 'Unknown';
                const seniority = lead.seniority || 'Unknown';

                metrics.demographics.regions[region] = (metrics.demographics.regions[region] || 0) + 1;
                metrics.demographics.industries[industry] = (metrics.demographics.industries[industry] || 0) + 1;
                metrics.demographics.seniority[seniority] = (metrics.demographics.seniority[seniority] || 0) + 1;
            }
        }

        // Calculate rates
        if (metrics.volume.totalSent > 0) {
            metrics.engagement.replyRate = (metrics.engagement.totalReplies / metrics.volume.totalSent) * 100;
        }

        return metrics;
    }

    /**
     * Send summary to Slack
     */
    async sendSlackReport(metrics: WeeklyMetrics) {
        if (!this.slackWebhookUrl) {
            logger.warn('No Slack webhook configured for reporting');
            return;
        }

        const blocks = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `📊 Weekly Impact Report: ${format(metrics.period.start, 'MMM d')} - ${format(metrics.period.end, 'MMM d')}`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Outreach Volume*\nTotal Sent: ${metrics.volume.totalSent}\nDiscovered: ${metrics.volume.discovered}\nResearched: ${metrics.volume.researched}` },
                    { type: 'mrkdwn', text: `*Engagement*\nReplies: ${metrics.engagement.totalReplies} (${metrics.engagement.replyRate.toFixed(1)}%)\nInterested: ${metrics.engagement.interested}\nBooked: ${metrics.engagement.bookedCalls}` }
                ]
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Health*\nBounced: ${metrics.volume.bounced}\nUnsubscribed: ${metrics.volume.unsubscribed}` },
                    { type: 'mrkdwn', text: `*By Step*\nStep 1: ${metrics.byStep.step1}\nStep 2: ${metrics.byStep.step2}\nStep 3: ${metrics.byStep.step3}` }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Top Industry:* ${Object.entries(metrics.demographics.industries).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}`
                }
            }
        ];

        if (this.googleSheetId) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `[📄 View Full Google Sheet History](https://docs.google.com/spreadsheets/d/${this.googleSheetId})`
                }
            } as any);
        }

        await fetch(this.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks })
        });

        logSuccess('Slack impact report sent');
    }

    /**
     * Update Google Sheet (requires GOOGLE_SERVICE_ACCOUNT_JSON)
     */
    async updateGoogleSheet(metrics: WeeklyMetrics) {
        const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (!credentialsJson || !this.googleSheetId) {
            logger.warn('Google Sheet reporting skipped: missing credentials or sheet ID');
            return;
        }

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const dateStr = format(metrics.period.end, 'yyyy-MM-dd');

        // Prepare row data
        const row = [
            dateStr,
            metrics.volume.totalSent,
            metrics.volume.discovered,
            metrics.volume.researched,
            metrics.volume.bounced,
            metrics.volume.unsubscribed,
            metrics.engagement.totalReplies,
            metrics.engagement.interested,
            metrics.engagement.bookedCalls,
            metrics.engagement.replyRate.toFixed(2) + '%',
            metrics.byStep.step1,
            metrics.byStep.step2,
            metrics.byStep.step3
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: this.googleSheetId,
            range: 'Sheet1!A2',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row]
            },
        });

        logSuccess('Google Sheet updated with weekly metrics');
    }
}

export const reportingService = new ReportingService();
