import { Resend } from 'resend';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';

export interface SendingConfig {
    resendApiKey: string;
    defaultSenderEmail: string;
    defaultSenderName: string;
    replyToEmail?: string;
    sendingWindowStart: number; // Hour in 24h format (e.g., 9 for 9am)
    sendingWindowEnd: number;   // Hour in 24h format (e.g., 17 for 5pm)
    dailyLimit: number;
    delayBetweenEmails: number; // milliseconds
}

export interface EmailToSend {
    to: string;
    subject: string;
    body: string;
    htmlBody?: string;
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

export class SendingAgent {
    private resend: Resend | null = null;
    private config: SendingConfig;

    constructor(config?: Partial<SendingConfig>) {
        this.config = {
            resendApiKey: config?.resendApiKey || process.env.RESEND_API_KEY || '',
            defaultSenderEmail: config?.defaultSenderEmail || process.env.DEFAULT_SENDER_EMAIL || 'brian@autonome.us',
            defaultSenderName: config?.defaultSenderName || process.env.DEFAULT_SENDER_NAME || 'Brian from Autonome',
            replyToEmail: config?.replyToEmail || process.env.REPLY_TO_EMAIL,
            sendingWindowStart: config?.sendingWindowStart || 8,  // 8am
            sendingWindowEnd: config?.sendingWindowEnd || 18,     // 6pm
            dailyLimit: config?.dailyLimit || 100,
            delayBetweenEmails: config?.delayBetweenEmails || 600, // 0.6 seconds - respects Resend's 2 req/sec limit
        };

        if (this.config.resendApiKey) {
            this.resend = new Resend(this.config.resendApiKey);
        }
    }

    /**
     * Check if we're within the sending window based on lead's timezone
     */
    isWithinSendingWindow(timezone: string = 'T1'): boolean {
        const now = new Date();
        let hour = now.getHours();

        // Adjust for timezone (simplified)
        // T1 = US (no adjustment needed if you're in US)
        // T2 = APAC (+14 hours from US EST)
        // T3 = Europe (+5 hours from US EST)
        if (timezone === 'T2') hour = (hour + 14) % 24;
        if (timezone === 'T3') hour = (hour + 5) % 24;

        return hour >= this.config.sendingWindowStart && hour < this.config.sendingWindowEnd;
    }

    /**
     * Convert plain text email body to simple HTML
     */
    private textToHtml(text: string): string {
        if (!text) return '';
        return text
            .split('\n')
            .map(line => {
                const trimmed = line.trim();
                if (trimmed === '') return '<br>';
                return `<p style="margin: 0 0 10px 0;">${trimmed}</p>`;
            })
            .join('\n');
    }

    /**
     * Send email via Resend API
     */
    private async sendViaResend(email: EmailToSend): Promise<SendResult> {
        if (!this.resend) {
            return { success: false, error: 'Resend API key not configured' };
        }

        try {
            const fromAddress = `${this.config.defaultSenderName} <${this.config.defaultSenderEmail}>`;
            const htmlBody = email.htmlBody || this.textToHtml(email.body);
            const textBody = email.body.replace(/<[^>]*>/g, ''); // Strip HTML for text version

            const { data, error } = await this.resend.emails.send({
                from: fromAddress,
                to: [email.to],
                subject: email.subject,
                html: htmlBody,
                text: textBody,
                reply_to: this.config.replyToEmail || this.config.defaultSenderEmail,
            });

            if (error) {
                return { success: false, error: error.message };
            }

            return {
                success: true,
                messageId: data?.id,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    /**
     * Send Email 1 to a lead
     */
    async sendEmail1(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return { success: false, action: 'send_email_1', message: 'Lead not found', error: 'Lead not found' };
        }

        if (lead.status !== 'ready') {
            return { success: false, action: 'send_email_1', message: `Lead status is "${lead.status}", expected "ready"`, error: 'Invalid status' };
        }

        if (!lead.email_1_body || !lead.email_1_subject) {
            return { success: false, action: 'send_email_1', message: 'Email 1 not generated', error: 'Missing email content' };
        }

        console.log(`   📤 Sending to: ${lead.email}`);
        console.log(`   📧 Subject: ${lead.email_1_subject}`);
        console.log(`   👤 From: ${this.config.defaultSenderName} <${this.config.defaultSenderEmail}>`);

        const result = await this.sendViaResend({
            to: lead.email,
            subject: lead.email_1_subject,
            body: lead.email_1_body,
        });

        if (result.success) {
            await leadsDb.update(lead.id, {
                status: 'email_1_sent',
                email_1_sent_at: new Date().toISOString(),
                email_1_message_id: result.messageId,
                sender_email: this.config.defaultSenderEmail,
            });

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'email_1_sent',
                event_data: { messageId: result.messageId, sender: this.config.defaultSenderEmail },
            });

            return { success: true, action: 'send_email_1', message: `Email 1 sent to ${lead.email}`, data: { messageId: result.messageId } };
        } else {
            return { success: false, action: 'send_email_1', message: `Failed to send: ${result.error}`, error: result.error };
        }
    }

    /**
     * Send Email 2 to a lead (follow-up)
     */
    async sendEmail2(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return { success: false, action: 'send_email_2', message: 'Lead not found', error: 'Lead not found' };
        }

        if (lead.status !== 'email_1_sent') {
            return { success: false, action: 'send_email_2', message: 'Email 1 not sent yet', error: 'Invalid status' };
        }

        if (!lead.email_2_body) {
            return { success: false, action: 'send_email_2', message: 'Email 2 not generated', error: 'Missing email content' };
        }

        console.log(`   📤 Sending follow-up to: ${lead.email}`);

        const subject = `Re: ${lead.email_1_subject}`;
        const result = await this.sendViaResend({
            to: lead.email,
            subject: subject,
            body: lead.email_2_body,
        });

        if (result.success) {
            await leadsDb.update(lead.id, {
                status: 'email_2_sent',
                email_2_sent_at: new Date().toISOString(),
            });

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'email_2_sent',
                event_data: { messageId: result.messageId },
            });

            return { success: true, action: 'send_email_2', message: `Email 2 sent to ${lead.email}` };
        } else {
            return { success: false, action: 'send_email_2', message: `Failed to send: ${result.error}`, error: result.error };
        }
    }

    /**
     * Send Email 3 to a lead (final)
     */
    async sendEmail3(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return { success: false, action: 'send_email_3', message: 'Lead not found', error: 'Lead not found' };
        }

        if (lead.status !== 'email_2_sent') {
            return { success: false, action: 'send_email_3', message: 'Email 2 not sent yet', error: 'Invalid status' };
        }

        if (!lead.email_3_body || !lead.email_3_subject) {
            return { success: false, action: 'send_email_3', message: 'Email 3 not generated', error: 'Missing email content' };
        }

        console.log(`   📤 Sending final email to: ${lead.email}`);

        const result = await this.sendViaResend({
            to: lead.email,
            subject: lead.email_3_subject,
            body: lead.email_3_body,
        });

        if (result.success) {
            await leadsDb.update(lead.id, {
                status: 'email_3_sent',
                email_3_sent_at: new Date().toISOString(),
            });

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'email_3_sent',
                event_data: { messageId: result.messageId },
            });

            return { success: true, action: 'send_email_3', message: `Email 3 sent to ${lead.email}` };
        } else {
            return { success: false, action: 'send_email_3', message: `Failed to send: ${result.error}`, error: result.error };
        }
    }

    /**
     * Process batch sending for a specific email step
     */
    async processBatch(emailStep: 1 | 2 | 3, limit: number = 10, respectSendingWindow: boolean = true): Promise<AgentResult> {
        const statusMap = {
            1: 'ready',
            2: 'email_1_sent',
            3: 'email_2_sent',
        };

        const leads = await leadsDb.findByStatus(statusMap[emailStep], limit);

        if (leads.length === 0) {
            return { success: true, action: `batch_email_${emailStep}`, message: `No leads ready for Email ${emailStep}` };
        }

        console.log(`\n📧 Processing batch: Email ${emailStep} for ${leads.length} leads\n`);

        let successful = 0;
        let failed = 0;
        let skipped = 0;

        for (const lead of leads) {
            // Check sending window if enabled
            if (respectSendingWindow && !this.isWithinSendingWindow(lead.timezone || 'T1')) {
                console.log(`   ⏰ Outside sending window for ${lead.email} (timezone: ${lead.timezone || 'T1'})`);
                skipped++;
                continue;
            }

            let result: AgentResult;
            switch (emailStep) {
                case 1: result = await this.sendEmail1(lead.id); break;
                case 2: result = await this.sendEmail2(lead.id); break;
                case 3: result = await this.sendEmail3(lead.id); break;
            }

            if (result.success) {
                successful++;
                console.log(`   ✅ Sent to ${lead.email}\n`);
            } else {
                failed++;
                console.log(`   ❌ Failed: ${result.error}\n`);
            }

            // Delay between sends to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenEmails));
        }

        return {
            success: true,
            action: `batch_email_${emailStep}`,
            message: `Batch complete: ${successful} sent, ${failed} failed, ${skipped} skipped (outside window)`,
            data: { successful, failed, skipped, total: leads.length },
        };
    }

    /**
     * Get sending queue status
     */
    async getQueueStatus(): Promise<Record<string, number>> {
        const ready = await leadsDb.findByStatus('ready', 1000);
        const email1Sent = await leadsDb.findByStatus('email_1_sent', 1000);
        const email2Sent = await leadsDb.findByStatus('email_2_sent', 1000);

        return {
            readyForEmail1: ready.length,
            readyForEmail2: email1Sent.length,
            readyForEmail3: email2Sent.length,
        };
    }

    /**
     * Get current configuration (useful for debugging)
     */
    getConfig(): Omit<SendingConfig, 'resendApiKey'> & { resendApiKey: string } {
        return {
            ...this.config,
            resendApiKey: this.config.resendApiKey ? '***configured***' : 'NOT SET',
        };
    }
}

export const sendingAgent = new SendingAgent();