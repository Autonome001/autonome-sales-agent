/**
 * Conversational Agent for Slack
 *
 * A multi-turn conversational AI agent that can:
 * - Have continuous conversations via Slack threads
 * - Execute sales pipeline actions (discovery, stats, search)
 * - Answer questions about leads and the system
 * - Remember context across messages in a thread
 */

import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../config/index.js';
import { leadsDb, eventsDb } from '../db/index.js';
import { scrapeApollo, normalizeSearchParams, type ApolloSearchParams } from '../tools/apollo.js';
import { ICP, ICP1_SMB_OPS, ICP2_AGENCIES, ICP3_SAAS, POSITIONING_ANGLES } from '../config/icp.js';
import {
    getOrCreateConversation,
    addMessage,
    getMessagesForClaude,
    clearConversation,
} from './conversation-store.js';

// =============================================================================
// System Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are the Autonome Sales Agent, an AI assistant for a B2B sales automation system.

## Your Capabilities

1. **Lead Discovery** - Search for leads matching the Ideal Customer Profile (ICP)
   - Can search Apollo.io for leads by location, industry, job title, seniority
   - Default ICP targets SMB Ops/RevOps leaders in the US (20-120 employees)

2. **Pipeline Stats** - Show current pipeline statistics
   - Count leads by status (scraped, researched, email_1_sent, etc.)

3. **Lead Search** - Search existing leads in the database
   - Search by email, company name, or other fields

4. **ICP Information** - Explain the configured Ideal Customer Profiles
   - ICP1: SMB Ops/RevOps (primary)
   - ICP2: Agencies/Consultancies
   - ICP3: SaaS Platforms

5. **General Q&A** - Answer questions about the sales system

## Current ICP Configuration

Primary ICP (ICP1 - SMB Ops/RevOps):
- Locations: ${ICP.locations.join(', ')}
- Employee Range: ${ICP.employeeRange.min}-${ICP.employeeRange.max}
- Industries: ${ICP.industries.slice(0, 5).join(', ')}...
- Key Titles: CEO, COO, Head of Operations, RevOps, CTO
- Seniorities: ${ICP.seniorities.join(', ')}

## Response Format

When you need to execute an action, respond with JSON:
{
  "action": "discover" | "stats" | "search" | "info" | "clear" | "chat",
  "parameters": { ... },
  "message": "Human-readable response"
}

Actions:
- **discover**: Search for new leads. Parameters: { locations, industries, jobTitles, seniorities, maxResults }
- **stats**: Get pipeline statistics. Parameters: {}
- **search**: Search existing leads. Parameters: { query }
- **info**: Provide information. Parameters: { topic }
- **clear**: Clear conversation history. Parameters: {}
- **chat**: Just respond conversationally. Parameters: {}

## Conversation Guidelines

1. Be helpful and proactive - if the user's request is vague, ask clarifying questions
2. Remember context from earlier in the conversation
3. When discovering leads, confirm parameters before executing if they seem unusual
4. Provide actionable insights, not just data dumps
5. Be concise but informative

## Example Interactions

User: "Find me some marketing agency founders in New York"
Response: {
  "action": "discover",
  "parameters": {
    "locations": ["New York, United States"],
    "industries": ["Marketing & Advertising"],
    "jobTitles": ["Founder", "CEO", "Managing Partner"],
    "maxResults": 25
  },
  "message": "Searching Apollo for marketing agency founders in New York..."
}

User: "How many leads do we have?"
Response: {
  "action": "stats",
  "parameters": {},
  "message": "Let me check our pipeline stats..."
}

User: "What's our ICP?"
Response: {
  "action": "info",
  "parameters": { "topic": "icp" },
  "message": "Our primary ICP targets ops-heavy B2B SMBs..."
}
`;

// =============================================================================
// Agent Class
// =============================================================================

export class ConversationalAgent {
    private claude: Anthropic;

    constructor() {
        this.claude = new Anthropic({
            apiKey: anthropicConfig.apiKey,
        });
    }

    /**
     * Process a message in a conversation thread
     */
    async processMessage(
        channelId: string,
        threadTs: string,
        userMessage: string,
        userName: string
    ): Promise<string> {
        // Add user message to conversation history
        addMessage(channelId, threadTs, 'user', userMessage, userName);

        try {
            // Get conversation history
            const messages = getMessagesForClaude(channelId, threadTs);

            // Get Claude's response
            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: messages,
            });

            const assistantMessage = response.content[0].type === 'text'
                ? response.content[0].text
                : '';

            // Parse the response to check for actions
            const parsed = this.parseResponse(assistantMessage);

            // Execute action if needed
            let finalResponse: string;
            if (parsed.action && parsed.action !== 'chat') {
                finalResponse = await this.executeAction(parsed);
            } else {
                finalResponse = parsed.message || assistantMessage;
            }

            // Add assistant response to history
            addMessage(channelId, threadTs, 'assistant', finalResponse);

            return finalResponse;
        } catch (error) {
            const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            addMessage(channelId, threadTs, 'assistant', errorMsg);
            return errorMsg;
        }
    }

    /**
     * Parse Claude's response to extract action and parameters
     */
    private parseResponse(text: string): {
        action?: string;
        parameters?: any;
        message: string;
    } {
        try {
            // Try to extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    action: parsed.action,
                    parameters: parsed.parameters || {},
                    message: parsed.message || text,
                };
            }
        } catch {
            // Not JSON, treat as chat response
        }

        return { message: text };
    }

    /**
     * Execute an action based on Claude's response
     */
    private async executeAction(parsed: { action?: string; parameters?: any; message: string }): Promise<string> {
        const { action, parameters, message } = parsed;

        switch (action) {
            case 'discover':
                return this.executeDiscovery(parameters, message);

            case 'stats':
                return this.executeStats(message);

            case 'search':
                return this.executeSearch(parameters?.query || '', message);

            case 'info':
                return this.executeInfo(parameters?.topic || 'general', message);

            case 'clear':
                return message || 'Conversation cleared. How can I help you?';

            default:
                return message;
        }
    }

    /**
     * Execute lead discovery
     */
    private async executeDiscovery(params: any, initialMessage: string): Promise<string> {
        try {
            const searchParams: ApolloSearchParams = {
                locations: params.locations || ICP.locations,
                industries: params.industries || ICP.industries.slice(0, 5),
                jobTitles: params.jobTitles || ICP.jobTitles.slice(0, 10),
                seniorities: params.seniorities || ICP.seniorities,
                maxResults: params.maxResults || 25,
            };

            const normalizedParams = normalizeSearchParams(searchParams);
            const result = await scrapeApollo(normalizedParams);

            if (!result.success) {
                return `❌ Discovery failed: ${result.error}`;
            }

            // Store leads in database
            const { created, skipped } = await leadsDb.createMany(result.leads);

            // Log event
            await eventsDb.log({
                event_type: 'slack_discovery',
                event_data: {
                    params: normalizedParams,
                    total_found: result.totalFound,
                    new_leads: created.length,
                    duplicates_skipped: skipped,
                },
            });

            let response = `✅ **Discovery Complete!**\n\n`;
            response += `📊 **Results:**\n`;
            response += `• Total found: ${result.totalFound}\n`;
            response += `• New leads added: ${created.length}\n`;
            response += `• Duplicates skipped: ${skipped}\n`;

            if (created.length > 0) {
                response += `\n📋 **Sample leads:**\n`;
                for (const lead of created.slice(0, 5)) {
                    const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
                    response += `• ${name} - ${lead.job_title || 'N/A'} at ${lead.company_name || 'N/A'}\n`;
                }
                if (created.length > 5) {
                    response += `_...and ${created.length - 5} more_\n`;
                }
            }

            return response;
        } catch (error) {
            return `❌ Discovery error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Get pipeline statistics
     */
    private async executeStats(initialMessage: string): Promise<string> {
        try {
            const stats = await leadsDb.getStatusCounts();

            let response = `📊 **Pipeline Statistics**\n\n`;

            const statusEmoji: Record<string, string> = {
                scraped: '🔍',
                researched: '🔬',
                ready: '📝',
                email_1_sent: '📤',
                email_2_sent: '📤',
                email_3_sent: '📤',
                engaged: '🎉',
                meeting_booked: '📅',
                converted: '💰',
                opted_out: '🚫',
                bounced: '❌',
            };

            let total = 0;
            for (const [status, count] of Object.entries(stats)) {
                if (count > 0) {
                    const emoji = statusEmoji[status] || '•';
                    response += `${emoji} ${status}: ${count}\n`;
                    total += count;
                }
            }

            response += `\n**Total leads:** ${total}`;

            return response;
        } catch (error) {
            return `❌ Error getting stats: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Search existing leads
     */
    private async executeSearch(query: string, initialMessage: string): Promise<string> {
        try {
            if (!query) {
                return `❓ Please provide a search query (e.g., company name, email, or keyword)`;
            }

            const results = await leadsDb.search(query);

            if (results.length === 0) {
                return `🔍 No leads found matching "${query}"`;
            }

            let response = `🔍 **Found ${results.length} lead(s) matching "${query}":**\n\n`;

            for (const lead of results.slice(0, 10)) {
                const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
                response += `• **${name}** - ${lead.job_title || 'N/A'}\n`;
                response += `  📧 ${lead.email} | 🏢 ${lead.company_name || 'N/A'}\n`;
                response += `  Status: ${lead.status}\n\n`;
            }

            if (results.length > 10) {
                response += `_...and ${results.length - 10} more_`;
            }

            return response;
        } catch (error) {
            return `❌ Search error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Provide information about the system
     */
    private executeInfo(topic: string, initialMessage: string): string {
        switch (topic.toLowerCase()) {
            case 'icp':
                return `📋 **Ideal Customer Profiles**\n\n` +
                    `**ICP1 - SMB Ops/RevOps (Primary)**\n` +
                    `• Target: Ops-heavy B2B SMBs needing automation fast\n` +
                    `• Size: ${ICP1_SMB_OPS.config.employeeRange.min}-${ICP1_SMB_OPS.config.employeeRange.max} employees\n` +
                    `• Revenue: ${ICP1_SMB_OPS.config.revenueRange.min}-${ICP1_SMB_OPS.config.revenueRange.max}\n` +
                    `• Key titles: Founder, CEO, COO, RevOps, Operations\n\n` +
                    `**ICP2 - Agencies/Consultancies**\n` +
                    `• Target: Agencies selling services (fast sales, high leverage)\n` +
                    `• Size: ${ICP2_AGENCIES.config.employeeRange.min}-${ICP2_AGENCIES.config.employeeRange.max} employees\n\n` +
                    `**ICP3 - SaaS Platforms**\n` +
                    `• Target: B2B SaaS needing workflow + AI systems\n` +
                    `• Size: ${ICP3_SAAS.config.employeeRange.min}-${ICP3_SAAS.config.employeeRange.max} employees`;

            case 'positioning':
                return `🎯 **Positioning Angles by Persona**\n\n` +
                    `• **Founder/CEO:** ${POSITIONING_ANGLES.founderCeo}\n` +
                    `• **COO/Ops:** ${POSITIONING_ANGLES.cooOps}\n` +
                    `• **RevOps:** ${POSITIONING_ANGLES.revOps}\n` +
                    `• **CTO/IT:** ${POSITIONING_ANGLES.ctoIt}`;

            default:
                return initialMessage;
        }
    }
}

// Export singleton
export const conversationalAgent = new ConversationalAgent();
