import { Resend } from 'resend';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';
import { withRetry } from '../../utils/retry.js';
import { logger, logSuccess } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';
import { PERSONAS, GET_PERSONA_BY_EMAIL } from '../../config/personas.js';
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
            dailyLimit: config?.dailyLimit || 2000,
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
        const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
        let hour = now.getHours();

        // ⛔ RESTRICTION: No sending on Sundays
        if (day === 0) {
            logger.warn('Today is Sunday - Sending Restricted');
            return false;
        }

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
     * Send email via Resend API (with retry)
     */
    private async sendViaResend(email: EmailToSend, senderProfile?: { name: string, email: string }): Promise<SendResult> {
        if (!this.resend) {
            return { success: false, error: 'Resend API key not configured' };
        }

        const resendClient = this.resend;
        const config = this.config;
        const textToHtmlFn = this.textToHtml.bind(this);

        return withRetry(
            async () => {
                const fromName = senderProfile?.name || config.defaultSenderName;
                const fromEmail = senderProfile?.email || config.defaultSenderEmail;
                const fromAddress = `${fromName} <${fromEmail}>`;
                const htmlBody = email.htmlBody || textToHtmlFn(email.body);
                const textBody = email.body.replace(/<[^>]*>/g, ''); // Strip HTML for text version

                const { data, error } = await resendClient.emails.send({
                    from: fromAddress,
                    to: [email.to],
                    subject: email.subject,
                    html: htmlBody,
                    text: textBody,
                    replyTo: config.replyToEmail || config.defaultSenderEmail,
                });

                if (error) {
                    // Check if this is a retryable error
                    const errMsg = error.message.toLowerCase();
                    if (errMsg.includes('rate') || errMsg.includes('429') || errMsg.includes('too many')) {
                        throw new Error(`Rate limited: ${error.message}`);
                    }
                    if (errMsg.includes('500') || errMsg.includes('server')) {
                        throw new Error(`Server error: ${error.message}`);
                    }
                    // Non-retryable errors return immediately
                    return { success: false, error: error.message };
                }

                return {
                    success: true,
                    messageId: data?.id,
                };
            },
            {
                maxAttempts: 3,
                initialDelay: 1000,
                maxDelay: 10000,
                backoffMultiplier: 2,
                operationName: 'Resend email send',
            }
        ).catch(error => {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Email send failed after retries`, { metadata: { error: message, to: email.to } });
            return { success: false, error: message };
        });
    }

    async sendCustomEmail(leadId: string, subject: string, body: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return { success: false, action: 'send_custom', message: 'Lead not found', error: 'Lead not found' };
        }

        logger.info(`Sending custom email to: ${lead.email}`, { metadata: { subject } });

        // Determine sender
        let senderProfile = {
            name: this.config.defaultSenderName,
            email: this.config.defaultSenderEmail,
            title: 'Solutions Consultant'
        };
        if (lead.sender_email) {
            const persona = GET_PERSONA_BY_EMAIL(lead.sender_email);
            if (persona) senderProfile = persona;
        }

        const signature = `\n\nBest,\n\n${senderProfile.name}\n${senderProfile.title}\nAutonome`;
        const bodyWithSignature = body + signature;

        const result = await this.sendViaResend({
            to: lead.email,
            subject: subject,
            body: bodyWithSignature,
        }, senderProfile);

        if (result.success) {
            metrics.increment('emailsSent');
            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'custom_email_sent',
                event_data: { messageId: result.messageId, subject },
            });

            return { success: true, action: 'send_custom', message: `Custom email sent to ${lead.email}`, data: { messageId: result.messageId } };
        } else {
            metrics.increment('errorsCaught');
            await leadsDb.recordError(lead.id, `Custom email failed: ${result.error}`);
            return { success: false, action: 'send_custom', message: `Failed to send: ${result.error}`, error: result.error };
        }
    }

    /**
     * Send initial email (Email 1)
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

        // Determine sender
        let senderProfile = {
            name: this.config.defaultSenderName,
            email: this.config.defaultSenderEmail,
            title: 'Solutions Consultant'
        };

        if (lead.sender_email) {
            const persona = GET_PERSONA_BY_EMAIL(lead.sender_email);
            if (persona) {
                senderProfile = persona;
            } else {
                // If assigned sender is not in config, try to use it anyway with default name, or fallback?
                // Better to just use it if it looks valid, or fallback to default.
                logger.warn(`Assigned sender ${lead.sender_email} not found in config, using defaults`);
            }
        }

        const signature = `\n\nBest,\n\n${senderProfile.name}\n${senderProfile.title}\nAutonome`;
        const bodyWithSignature = lead.email_1_body + signature;

        logger.info(`Sending Email 1 to: ${lead.email}`, {
            metadata: {
                subject: lead.email_1_subject,
                sender: senderProfile.email
            }
        });

        const result = await this.sendViaResend({
            to: lead.email,
            subject: lead.email_1_subject,
            body: bodyWithSignature,
        }, senderProfile);

        if (result.success) {
            await leadsDb.update(lead.id, {
                status: 'email_1_sent',
                email_1_sent_at: new Date().toISOString(),
                email_1_message_id: result.messageId,
                sender_email: senderProfile.email,
            });

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'email_1_sent',
                event_data: { messageId: result.messageId, sender: senderProfile.email },
            });

            return { success: true, action: 'send_email_1', message: `Email 1 sent to ${lead.email}`, data: { messageId: result.messageId } };
        } else {
            // Record error for quarantine system
            metrics.increment('errorsCaught');
            try {
                await leadsDb.recordError(lead.id, `Email 1 delivery failed: ${result.error}`);
            } catch (dbError) {
                logger.error('Failed to record error to database', { metadata: dbError });
            }

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

        // Determine sender (same as Email 1)
        let senderProfile = {
            name: this.config.defaultSenderName,
            email: this.config.defaultSenderEmail,
            title: 'Solutions Consultant'
        };
        if (lead.sender_email) {
            const persona = GET_PERSONA_BY_EMAIL(lead.sender_email);
            if (persona) senderProfile = persona;
        }

        const signature = `\n\nBest,\n\n${senderProfile.name}\n${senderProfile.title}\nAutonome`;
        const bodyWithSignature = lead.email_2_body + signature;

        const subject = `Re: ${lead.email_1_subject}`;
        const result = await this.sendViaResend({
            to: lead.email,
            subject: subject,
            body: bodyWithSignature,
        }, senderProfile);

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
            // Record error for quarantine system
            try {
                await leadsDb.recordError(lead.id, `Email 2 delivery failed: ${result.error}`);
            } catch (dbError) {
                console.error('   ❌ Failed to record error to database:', dbError);
            }

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

        // Determine sender
        let senderProfile = {
            name: this.config.defaultSenderName,
            email: this.config.defaultSenderEmail,
            title: 'Solutions Consultant'
        };
        if (lead.sender_email) {
            const persona = GET_PERSONA_BY_EMAIL(lead.sender_email);
            if (persona) senderProfile = persona;
        }

        const signature = `\n\nBest,\n\n${senderProfile.name}\n${senderProfile.title}\nAutonome`;
        const bodyWithSignature = lead.email_3_body + signature;

        const result = await this.sendViaResend({
            to: lead.email,
            subject: lead.email_3_subject,
            body: bodyWithSignature,
        }, senderProfile);

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
            // Record error for quarantine system
            try {
                await leadsDb.recordError(lead.id, `Email 3 delivery failed: ${result.error}`);
            } catch (dbError) {
                console.error('   ❌ Failed to record error to database:', dbError);
            }

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

        const leads = await leadsDb.findByStatus(statusMap[emailStep] as any, limit);

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