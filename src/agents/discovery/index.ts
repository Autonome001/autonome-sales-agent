import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import { scrapeApollo, normalizeSearchParams, type ApolloSearchParams } from '../../tools/apify.js';
import type { DiscoveryQuery, DiscoveryResult, AgentResult, Lead } from '../../types/index.js';
import { logger, logSuccess } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';

const SYSTEM_PROMPT = `You are a lead discovery agent for Autonome, responsible for finding and qualifying B2B leads.

Your capabilities:
1. Parse natural language queries to extract search parameters
2. Scrape leads from Apollo.io based on ICP criteria
3. Deduplicate against existing database
4. Store new leads for the sales pipeline

When parsing queries, extract:
- locations: Cities, states, countries (e.g., "Chicago, United States", "Sydney, Australia")
- industries: Business types or keywords (e.g., "financial planners", "marketing agencies", "SaaS")
- job_titles: Target roles (e.g., "CEO", "Founder", "VP of Marketing")
- max_results: Number of leads to find (default 300, max 1000)

If the query is missing required information, ask for clarification.
If you have all required information, proceed with the scrape.

Output your response as JSON:
{
  "action": "scrape" | "clarify" | "error",
  "parameters": { "locations": [], "industries": [], "job_titles": [], "max_results": 300 },
  "message": "Human-readable response",
  "clarification_needed": ["list of missing fields"] // only if action is "clarify"
}`;

export class DiscoveryAgent {
  private claude: Anthropic;
  private conversationHistory: Anthropic.Messages.MessageParam[] = [];

  constructor() {
    this.claude = new Anthropic({
      apiKey: anthropicConfig.apiKey,
    });
  }

  /**
   * Reset conversation state
   */
  reset(): void {
    this.conversationHistory = [];
  }

  /**
   * Process a natural language command
   */
  async processCommand(input: string): Promise<DiscoveryResult> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: input,
    });

    try {
      // Get Claude's interpretation
      const response = await this.claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: this.conversationHistory,
      });

      const assistantMessage = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Parse the response
      const parsed = this.parseResponse(assistantMessage);

      if (parsed.action === 'clarify') {
        return {
          success: true,
          action: 'clarify',
          message: parsed.message,
          data: {
            total_found: 0,
            new_leads: 0,
            duplicates_skipped: 0,
            leads: [],
          },
        };
      }

      if (parsed.action === 'scrape' && parsed.parameters) {
        return this.executeScrape(parsed.parameters);
      }

      return {
        success: false,
        action: 'error',
        message: parsed.message || 'Failed to parse command',
        error: 'Invalid action',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        action: 'error',
        message: `Agent error: ${message}`,
        error: message,
      };
    }
  }

  /**
   * Execute a direct scrape with explicit parameters
   */
  async executeScrape(params: ApolloSearchParams): Promise<DiscoveryResult> {
    logger.info('🚀 Starting discovery scrape...', { metadata: params });

    // Normalize parameters
    const normalizedParams = normalizeSearchParams(params);

    // Scrape Apollo
    const scrapeResult = await scrapeApollo(normalizedParams);

    if (!scrapeResult.success) {
      return {
        success: false,
        action: 'scrape',
        message: `Scraping failed: ${scrapeResult.error}`,
        error: scrapeResult.error,
      };
    }

    // Store in database with deduplication
    const { created, skipped } = await leadsDb.createMany(scrapeResult.leads);

    // Log event
    await eventsDb.log({
      event_type: 'discovery_scrape',
      event_data: {
        params: normalizedParams,
        total_found: scrapeResult.totalFound,
        new_leads: created.length,
        duplicates_skipped: skipped,
      },
    });

    const leadSummary = created.slice(0, 10).map(lead => ({
      email: lead.email,
      name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown',
      company: lead.company_name,
    }));

    // Log success
    logSuccess(`Discovery complete: Found ${scrapeResult.totalFound} leads, added ${created.length} new ones.`, {
      metadata: { totalFound: scrapeResult.totalFound, created: created.length, skipped }
    });
    metrics.increment('leadsDiscovered', created.length);

    return {
      success: true,
      action: 'scrape',
      message: `Found ${scrapeResult.totalFound} leads. Added ${created.length} new leads to database (${skipped} duplicates skipped).`,
      data: {
        total_found: scrapeResult.totalFound,
        new_leads: created.length,
        duplicates_skipped: skipped,
        leads: leadSummary,
      },
    };
  }

  /**
   * Parse Claude's JSON response
   */
  private parseResponse(text: string): {
    action: 'scrape' | 'clarify' | 'error';
    parameters?: ApolloSearchParams;
    message: string;
  } {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { action: 'error', message: text };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        action: parsed.action || 'error',
        parameters: parsed.parameters ? {
          locations: parsed.parameters.locations || [],
          industries: parsed.parameters.industries || [],
          jobTitles: parsed.parameters.job_titles || [],
          maxResults: parsed.parameters.max_results || 300,
        } : undefined,
        message: parsed.message || 'No message provided',
      };
    } catch {
      return { action: 'error', message: `Failed to parse response: ${text}` };
    }
  }

  /**
   * Get current pipeline statistics
   */
  async getStats(): Promise<Record<string, number>> {
    return leadsDb.getStatusCounts();
  }

  /**
   * Search existing leads
   */
  async searchLeads(query: string): Promise<Lead[]> {
    return leadsDb.search(query);
  }
}

// Export singleton instance for convenience
export const discoveryAgent = new DiscoveryAgent();
