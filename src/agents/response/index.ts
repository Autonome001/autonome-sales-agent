import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';
import { logger, logSuccess } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';

export type ResponseCategory =
    | 'interested'
    | 'not_interested'
    | 'out_of_office'
    | 'wrong_person'
    | 'unsubscribe'
    | 'question'
    | 'meeting_request'
    | 'other';

export interface ClassificationResult {
    category: ResponseCategory;
    confidence: number;
    sentiment: 'positive' | 'neutral' | 'negative';
    suggestedAction: string;
    summary: string;
}

export interface InboundEmail {
    from: string;
    subject: string;
    body: string;
    receivedAt?: string;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert at classifying inbound email responses to cold outreach campaigns. Your job is to analyze the email and determine the appropriate category and next action.

CATEGORIES:
- interested: Prospect shows genuine interest, wants to learn more, or agrees to a call
- not_interested: Polite or direct decline, not a fit, bad timing
- out_of_office: Auto-reply indicating person is away
- wrong_person: Email reached wrong person, they suggest someone else
- unsubscribe: Request to stop emails, remove from list
- question: Prospect has questions before committing
- meeting_request: Prospect wants to schedule a specific meeting
- other: Doesn't fit other categories

ANALYSIS REQUIREMENTS:
1. Read the full email carefully
2. Determine the primary intent
3. Assess sentiment (positive/neutral/negative)
4. Suggest the appropriate next action
5. Provide a brief summary

OUTPUT FORMAT (JSON):
{
  "category": "one of the categories above",
  "confidence": 0.0-1.0,
  "sentiment": "positive" | "neutral" | "negative",
  "suggestedAction": "specific action to take",
  "summary": "1-2 sentence summary of the response"
}

Be accurate. Misclassifying an interested lead as not interested loses business. Misclassifying not interested as interested wastes time.`;

export class ResponseAgent {
    private claude: Anthropic;

    constructor() {
        this.claude = new Anthropic({
            apiKey: anthropicConfig.apiKey,
        });
    }

    /**
     * Process an inbound email response
     */
    async processInboundEmail(email: InboundEmail): Promise<AgentResult> {
        logger.info(`Processing inbound email from: ${email.from}`, { metadata: { subject: email.subject } });

        // Find the lead by email
        const lead = await leadsDb.findByEmail(email.from);

        if (!lead) {
            logger.warn(`No matching lead found for email: ${email.from}`);
            return {
                success: false,
                action: 'classify_response',
                message: `No lead found for email: ${email.from}`,
                error: 'Lead not found',
            };
        }

        try {
            // Classify the response
            logger.info('Classifying response with Claude...');
            const classification = await this.classifyEmail(email);

            logger.info('Classification result', { metadata: classification });

            // Update lead status based on classification
            const newStatus = this.mapCategoryToStatus(classification.category);

            await leadsDb.update(lead.id, {
                status: newStatus,
                replied_at: new Date().toISOString(),
                reply_category: classification.category,
                reply_sentiment: classification.sentiment,
            });

            // Special handling for meeting requests
            if (classification.category === 'meeting_request') {
                await this.handleMeetingRequest(lead, email);
            }

            // Log event
            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'response_received',
                event_data: {
                    category: classification.category,
                    confidence: classification.confidence,
                    sentiment: classification.sentiment,
                    summary: classification.summary,
                    suggestedAction: classification.suggestedAction,
                    subject: email.subject,
                },
            });

            logSuccess(`Lead status updated to: ${newStatus}`, { metadata: { action: classification.suggestedAction } });

            return {
                success: true,
                action: 'classify_response',
                message: `Response classified as "${classification.category}" with ${(classification.confidence * 100).toFixed(0)}% confidence.`,
                data: {
                    leadId: lead.id,
                    classification,
                    newStatus,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Classification failed for ${email.from}`, { metadata: error });
            metrics.increment('errorsCaught');

            return {
                success: false,
                action: 'classify_response',
                message: `Classification failed: ${message}`,
                error: message,
            };
        }
    }

    /**
     * Handle meeting request by drafting reply and asking for human review
     */
    private async handleMeetingRequest(lead: Lead, email: InboundEmail) {
        console.log('📅 Handling meeting request - Drafting reply & requesting review...');

        // Dynamic import to avoid cycles
        const { bookingAgent } = await import('../booking/index.js');
        const { config } = await import('../../config/index.js');

        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: `You are a helpful sales assistant. The prospect has expressed interest in a meeting. 
            Your goal is to get them to book a time or confirm a proposed time.
            Keep the tone professional but friendly. 
            Use the context of their email.
            Include the scheduling link: https://calendly.com/autonome/15min`,
            messages: [
                {
                    role: 'user',
                    content: `Prospect said: "${email.body}".\n\nDraft a reply to ${lead.first_name} to schedule the call.`
                }
            ]
        });

        const draftReply = response.content[0].type === 'text' ? response.content[0].text : '';

        await bookingAgent.requestHumanReview(
            lead.id,
            `Received response: "${email.subject}"\n> ${email.body.substring(0, 200)}...`,
            draftReply
        );
    }

    /**
     * Classify an email using Claude
     */
    private async classifyEmail(email: InboundEmail): Promise<ClassificationResult> {
        const emailContext = `
FROM: ${email.from}
SUBJECT: ${email.subject}
BODY:
${email.body}
`;

        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: CLASSIFICATION_SYSTEM_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: `Classify this inbound email response:\n\n${emailContext}`,
                },
            ],
        });

        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found');
            return JSON.parse(jsonMatch[0]) as ClassificationResult;
        } catch {
            return {
                category: 'other',
                confidence: 0.5,
                sentiment: 'neutral',
                suggestedAction: 'Manual review required',
                summary: 'Could not automatically classify this response',
            };
        }
    }

    /**
     * Map response category to lead status
     */
    private mapCategoryToStatus(category: ResponseCategory): string {
        const statusMap: Record<ResponseCategory, string> = {
            interested: 'engaged',
            not_interested: 'closed_lost',
            out_of_office: 'email_1_sent', // Keep in sequence, will retry
            wrong_person: 'closed_lost',
            unsubscribe: 'unsubscribed',
            question: 'engaged',
            meeting_request: 'meeting_negotiation',
            other: 'engaged',
        };
        return statusMap[category];
    }

    /**
     * Generate a follow-up reply for interested leads
     */
    async generateFollowUp(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return {
                success: false,
                action: 'generate_followup',
                message: 'Lead not found',
                error: 'Lead not found',
            };
        }

        if (lead.status !== 'engaged' && lead.reply_category !== 'interested') {
            return {
                success: false,
                action: 'generate_followup',
                message: 'Lead is not in engaged status',
                error: 'Invalid status',
            };
        }

        console.log(`\n✍️  Generating follow-up for: ${lead.first_name} ${lead.last_name}`);

        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: `You are writing a warm follow-up email to someone who responded positively to cold outreach. Keep it brief (under 75 words), friendly, and focused on scheduling a call. Include a Calendly link placeholder: [CALENDLY_LINK]`,
            messages: [
                {
                    role: 'user',
                    content: `Write a follow-up to ${lead.first_name} who showed interest. Their company is ${lead.company_name || 'their company'}. Keep it warm and get them to book a call.`,
                },
            ],
        });

        const followUpText = response.content[0].type === 'text' ? response.content[0].text : '';

        await eventsDb.log({
            lead_id: lead.id,
            event_type: 'followup_generated',
            event_data: { followUpText },
        });

        console.log('\n📧 Generated Follow-up:\n');
        console.log(followUpText);

        return {
            success: true,
            action: 'generate_followup',
            message: 'Follow-up email generated',
            data: { leadId: lead.id, followUpText },
        };
    }

    /**
     * Get response statistics
     */
    async getResponseStats(): Promise<Record<string, number>> {
        const categories: ResponseCategory[] = [
            'interested', 'not_interested', 'out_of_office',
            'wrong_person', 'unsubscribe', 'question', 'meeting_request', 'other'
        ];

        const stats: Record<string, number> = {};

        // This would ideally be a single aggregation query
        // For now, simplified version
        for (const category of categories) {
            stats[category] = 0; // Would query by reply_category
        }

        return stats;
    }
}

export const responseAgent = new ResponseAgent();