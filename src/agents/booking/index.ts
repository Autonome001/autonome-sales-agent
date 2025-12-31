import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';

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
    private claude: Anthropic;
    private config: BookingConfig;

    constructor(config?: Partial<BookingConfig>) {
        this.claude = new Anthropic({
            apiKey: anthropicConfig.apiKey,
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
        console.log(`\n📅 Recording meeting booking for lead: ${details.leadId}`);

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
                status: 'meeting_scheduled',
                meeting_scheduled_at: details.scheduledAt,
                meeting_link: details.meetingLink,
                calendar_event_id: details.calendarEventId,
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

            console.log(`\n✅ Meeting recorded!`);
            console.log(`   📆 Date: ${new Date(details.scheduledAt).toLocaleString()}`);
            console.log(`   ⏱️  Duration: ${details.duration} minutes`);
            console.log(`   👤 Lead: ${lead.first_name} ${lead.last_name}`);

            return {
                success: true,
                action: 'record_booking',
                message: `Meeting scheduled with ${lead.first_name} ${lead.last_name} for ${new Date(details.scheduledAt).toLocaleString()}`,
                data: { leadId: lead.id, details },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('\n❌ Booking failed:', message);
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

        console.log(`\n✍️  Generating confirmation email for: ${lead.first_name} ${lead.last_name}`);

        const meetingDate = new Date(lead.meeting_scheduled_at);

        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: `You are writing a brief, warm meeting confirmation email. Keep it under 75 words. Be friendly and professional. Include the meeting details clearly.`,
            messages: [
                {
                    role: 'user',
                    content: `Write a confirmation email to ${lead.first_name} for our meeting scheduled on ${meetingDate.toLocaleString()}. Their company is ${lead.company_name || 'their company'}. Meeting link: ${lead.meeting_link || '[MEETING_LINK]'}`,
                },
            ],
        });

        const confirmationText = response.content[0].type === 'text' ? response.content[0].text : '';

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

        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            system: `You are writing a brief meeting reminder email. Keep it under 50 words. Be friendly and include the meeting link.`,
            messages: [
                {
                    role: 'user',
                    content: `Write a reminder to ${lead.first_name} that our meeting is ${timeUntil} at ${meetingDate.toLocaleTimeString()}. Meeting link: ${lead.meeting_link || '[MEETING_LINK]'}`,
                },
            ],
        });

        const reminderText = response.content[0].type === 'text' ? response.content[0].text : '';

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
            completed: 'meeting_completed',
            no_show: 'meeting_no_show',
            rescheduled: 'meeting_scheduled',
        };

        await leadsDb.update(lead.id, {
            status: statusMap[outcome],
            meeting_outcome: outcome,
            meeting_notes: notes,
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
        const leads = await leadsDb.findByStatus('meeting_scheduled', 50);

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
     * Get meetings needing reminders
     */
    async getMeetingsNeedingReminders(hoursBefore: number = 24): Promise<Lead[]> {
        const leads = await leadsDb.findByStatus('meeting_scheduled', 50);

        const now = new Date();
        const reminderWindow = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
        const reminderStart = new Date(now.getTime() + (hoursBefore - 1) * 60 * 60 * 1000);

        return leads.filter(lead => {
            if (!lead.meeting_scheduled_at) return false;
            const meetingDate = new Date(lead.meeting_scheduled_at);
            return meetingDate >= reminderStart && meetingDate <= reminderWindow;
        });
    }
}

export const bookingAgent = new BookingAgent();