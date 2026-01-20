import OpenAI from 'openai';
import { openaiConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';
import { logger, logSuccess } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';

export interface MeetingDetails {
    leadId: string;
    scheduledAt: string;
    duration: number; // minutes
    meetingLink?: string;
    calendarEventId?: string;
    notes?: string;
}

export interface BookingConfig {
    calendlyUrl: string;
    defaultDuration: number;
    reminderHoursBefore: number[];
}

export class BookingAgent {
    private openai: OpenAI;
    private config: BookingConfig;

    constructor(config?: Partial<BookingConfig>) {
        this.openai = new OpenAI({
            apiKey: openaiConfig.apiKey,
        });

        this.config = {
            calendlyUrl: config?.calendlyUrl || process.env.CALENDLY_URL || 'https://calendly.com/autonome/15min',
            defaultDuration: config?.defaultDuration || 15,
            reminderHoursBefore: config?.reminderHoursBefore || [24, 1],
        };
    }

    /**
     * Record a new meeting booking
     */
    async recordBooking(details: MeetingDetails): Promise<AgentResult> {
        logger.info(`Recording meeting booking for lead: ${details.leadId}`, { metadata: details });

        const lead = await leadsDb.findById(details.leadId);
        if (!lead) {
            return {
                success: false,
                action: 'record_booking',
                message: 'Lead not found',
                error: 'Lead not found',
            };
        }

        try {
            // Update lead with meeting details
            await leadsDb.update(lead.id, {
                status: 'meeting_booked',
                meeting_scheduled_at: details.scheduledAt,
                meeting_link: details.meetingLink,
            });

            // Log event
            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'meeting_booked',
                event_data: {
                    scheduledAt: details.scheduledAt,
                    duration: details.duration,
                    meetingLink: details.meetingLink,
                    notes: details.notes,
                },
            });

            logSuccess(`Meeting recorded for lead: ${lead.email}`, {
                metadata: {
                    date: new Date(details.scheduledAt).toLocaleString(),
                    duration: details.duration
                }
            });

            return {
                success: true,
                action: 'record_booking',
                message: `Meeting scheduled with ${lead.first_name} ${lead.last_name} for ${new Date(details.scheduledAt).toLocaleString()}`,
                data: { leadId: lead.id, details },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Booking failed for lead: ${details.leadId}`, { metadata: error });
            metrics.increment('errorsCaught');
            return {
                success: false,
                action: 'record_booking',
                message: `Booking failed: ${message}`,
                error: message,
            };
        }
    }

    /**
     * Record booking by lead email
     */
    async recordBookingByEmail(
        email: string,
        scheduledAt: string,
        meetingLink?: string
    ): Promise<AgentResult> {
        const lead = await leadsDb.findByEmail(email);
        if (!lead) {
            return {
                success: false,
                action: 'record_booking',
                message: `No lead found with email: ${email}`,
                error: 'Lead not found',
            };
        }

        return this.recordBooking({
            leadId: lead.id,
            scheduledAt,
            duration: this.config.defaultDuration,
            meetingLink,
        });
    }

    /**
     * Generate meeting confirmation email
     */
    async generateConfirmationEmail(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return {
                success: false,
                action: 'generate_confirmation',
                message: 'Lead not found',
                error: 'Lead not found',
            };
        }

        if (!lead.meeting_scheduled_at) {
            return {
                success: false,
                action: 'generate_confirmation',
                message: 'No meeting scheduled for this lead',
                error: 'No meeting scheduled',
            };
        }

        logger.info(`Generating confirmation email for: ${lead.first_name} ${lead.last_name}`);

        const meetingDate = new Date(lead.meeting_scheduled_at);

        const shortCompany = this.cleanCompanyName(lead.company_name || '');

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: `You are writing a brief, warm meeting confirmation email. Keep it under 75 words. Be friendly and professional. Include the meeting details clearly. Refer to the company naturally as "${shortCompany}".` },
                {
                    role: 'user',
                    content: `Write a confirmation email to ${lead.first_name} for our meeting scheduled on ${meetingDate.toLocaleString()}. Their company is ${shortCompany}. Meeting link: ${lead.meeting_link || '[MEETING_LINK]'}`,
                },
            ],
        });

        const confirmationText = response.choices[0].message.content || '';

        await eventsDb.log({
            lead_id: lead.id,
            event_type: 'confirmation_generated',
            event_data: { confirmationText },
        });

        console.log('\n📧 Generated Confirmation:\n');
        console.log(confirmationText);

        return {
            success: true,
            action: 'generate_confirmation',
            message: 'Confirmation email generated',
            data: { leadId: lead.id, confirmationText },
        };
    }

    /**
     * Generate meeting reminder email
     */
    async generateReminderEmail(leadId: string, hoursBefore: number = 24): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return {
                success: false,
                action: 'generate_reminder',
                message: 'Lead not found',
                error: 'Lead not found',
            };
        }

        if (!lead.meeting_scheduled_at) {
            return {
                success: false,
                action: 'generate_reminder',
                message: 'No meeting scheduled for this lead',
                error: 'No meeting scheduled',
            };
        }

        console.log(`\n✍️  Generating ${hoursBefore}hr reminder for: ${lead.first_name} ${lead.last_name}`);

        const meetingDate = new Date(lead.meeting_scheduled_at);
        const timeUntil = hoursBefore === 1 ? 'in 1 hour' : `tomorrow`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: `You are writing a brief meeting reminder email. Keep it under 50 words. Be friendly and include the meeting link.` },
                {
                    role: 'user',
                    content: `Write a reminder to ${lead.first_name} that our meeting is ${timeUntil} at ${meetingDate.toLocaleTimeString()}. Meeting link: ${lead.meeting_link || '[MEETING_LINK]'}`,
                },
            ],
        });

        const reminderText = response.choices[0].message.content || '';

        console.log('\n📧 Generated Reminder:\n');
        console.log(reminderText);

        return {
            success: true,
            action: 'generate_reminder',
            message: 'Reminder email generated',
            data: { leadId: lead.id, reminderText, hoursBefore },
        };
    }

    /**
     * Mark meeting as completed
     */
    async completeMeeting(leadId: string, outcome: 'completed' | 'no_show' | 'rescheduled', notes?: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return {
                success: false,
                action: 'complete_meeting',
                message: 'Lead not found',
                error: 'Lead not found',
            };
        }

        const statusMap = {
            completed: 'converted',
            no_show: 'meeting_booked',
            rescheduled: 'meeting_booked',
        };

        await leadsDb.update(lead.id, {
            status: statusMap[outcome],
            meeting_outcome: outcome,
        });

        await eventsDb.log({
            lead_id: lead.id,
            event_type: `meeting_${outcome}`,
            event_data: { outcome, notes },
        });

        console.log(`\n✅ Meeting marked as: ${outcome}`);

        return {
            success: true,
            action: 'complete_meeting',
            message: `Meeting marked as ${outcome}`,
            data: { leadId: lead.id, outcome },
        };
    }

    /**
     * Get upcoming meetings
     */
    async getUpcomingMeetings(days: number = 7): Promise<Lead[]> {
        const leads = await leadsDb.findByStatus('meeting_booked', 50);

        const now = new Date();
        const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

        return leads.filter(lead => {
            if (!lead.meeting_scheduled_at) return false;
            const meetingDate = new Date(lead.meeting_scheduled_at);
            return meetingDate >= now && meetingDate <= cutoff;
        }).sort((a, b) => {
            const dateA = new Date(a.meeting_scheduled_at!);
            const dateB = new Date(b.meeting_scheduled_at!);
            return dateA.getTime() - dateB.getTime();
        });
    }

    /**
     * Request human review via Slack
     */
    async requestHumanReview(leadId: string, context: string, draftedReply: string): Promise<AgentResult> {
        const { slackConfig } = await import('../../config/index.js');

        if (!slackConfig.botToken || !slackConfig.channelId) {
            console.warn('⚠️ Slack not configured, skipping human review request');
            return { success: false, action: 'request_review', message: 'Slack not configured', error: 'Slack not configured' };
        }

        const lead = await leadsDb.findById(leadId);
        if (!lead) return { success: false, action: 'request_review', message: 'Lead not found', error: 'Lead not found' };

        console.log(`\n📢 Sending Slack approval request for ${lead.first_name} ${lead.last_name}`);

        const blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "📅 New Meeting Request / Reply",
                    "emoji": true
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*Prospect:* ${lead.first_name} ${lead.last_name}\n*Company:* ${lead.company_name}\n*Status:* ${lead.status}`
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*Context:*\n${context}`
                }
            },
            {
                "type": "divider"
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*🤖 AI Drafted Reply:*\n>>>${draftedReply}`
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "approve & Send",
                            "emoji": true
                        },
                        "style": "primary",
                        "value": JSON.stringify({ action: 'approve_booking', leadId, reply: draftedReply }),
                        "action_id": "approve_booking"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Take Over",
                            "emoji": true
                        },
                        "style": "danger",
                        "value": leadId,
                        "action_id": "take_over_booking"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Update Draft",
                            "emoji": true
                        },
                        "value": leadId,
                        "action_id": "update_booking_draft"
                    }
                ]
            }
        ];

        try {
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${slackConfig.botToken}`
                },
                body: JSON.stringify({
                    channel: slackConfig.channelId,
                    text: `New Booking Request from ${lead.first_name} ${lead.last_name}`,
                    blocks
                })
            });

            const result = await response.json() as { ok: boolean; ts?: string; error?: string };
            if (!result.ok) throw new Error(result.error);

            return {
                success: true,
                action: 'request_review',
                message: 'Slack request sent',
                data: { ts: result.ts }
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Failed to send Slack request', { metadata: error });
            metrics.increment('errorsCaught');
            return {
                success: false,
                action: 'request_review',
                message: `Failed to send Slack request: ${msg}`,
                error: msg
            };
        }
    }

    /**
     * Get meetings needing reminders
     */
    async getMeetingsNeedingReminders(hoursBefore: number = 24): Promise<Lead[]> {
        const leads = await leadsDb.findByStatus('meeting_booked', 50);

        const now = new Date();
        const reminderWindow = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
        const reminderStart = new Date(now.getTime() + (hoursBefore - 1) * 60 * 60 * 1000);

        return leads.filter(lead => {
            if (!lead.meeting_scheduled_at) return false;
            const meetingDate = new Date(lead.meeting_scheduled_at);
            return meetingDate >= reminderStart && meetingDate <= reminderWindow;
        });
    }

    private cleanCompanyName(name: string): string {
        if (!name) return 'your company';
        let cleaned = name.replace(/\s*\(.*?\)\s*/g, ''); // Remove (Text)

        // Remove common suffixes (case insensitive)
        const suffixes = [
            ',?\\s*Inc\\.?$', ',?\\s*LLC\\.?$', ',?\\s*Ltd\\.?$', ',?\\s*Limited$',
            '\\s+Corp\\.?$', '\\s+Corporation$', '\\s+Group$', '\\s+Holdings$',
            '\\s+Technologies$', '\\s+Tech$', '\\s+Solutions$', '\\s+Services$',
            '\\s+Partners$', '\\s+Systems$', '\\s+Labs$', '\\s+Enterprises$'
        ];

        for (const suffix of suffixes) {
            cleaned = cleaned.replace(new RegExp(suffix, 'i'), '');
        }

        return cleaned.trim();
    }
}

export const bookingAgent = new BookingAgent();