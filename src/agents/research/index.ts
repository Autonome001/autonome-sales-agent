import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig, apifyConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import { googleSearch } from '../../tools/web-search.js';
import { readUrlContent } from '../../tools/web-reader.js';
import type { Lead, AgentResult } from '../../types/index.js';
import { withRetry } from '../../utils/retry.js';
import { logger, logSuccess } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';

export interface ResearchData {
    linkedin: {
        profile: any | null;
        posts: any[];
    };
    companyResearch: string;
    personResearch: string;
    trustpilotReviews: string;
    citations: string[];
    analysis: ResearchAnalysis;
    completedAt: string;
}

export interface ResearchAnalysis {
    personalProfile: string;
    companyProfile: string;
    interests: string[];
    uniqueFacts: string[];
    personalizationOpportunities: PersonalizationOpportunity[];
    painPoints: PainPoint[];
}

export interface PersonalizationOpportunity {
    type: 'post' | 'achievement' | 'background' | 'news';
    hook: string;
    evidence: string;
}

export interface PainPoint {
    pain: string;
    evidence: string;
    solution: string;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a B2B sales research analyst. Your job is to analyze research data about a prospect and extract actionable insights for cold outreach.

You will receive information about a prospect including their name, company, job title, and any available context.

Your analysis must include:

1. **Personal Profile**: One paragraph summary of the person - their likely career trajectory and professional identity based on their role.

2. **Company Profile**: One paragraph about their company - what they likely do based on the company name and industry.

3. **Interests**: 3-5 likely professional interests based on their role and industry.

4. **Unique Facts**: 2-3 potential talking points or personalization angles.

5. **Personalization Opportunities**: Specific hooks for cold email personalization. Each should include:
   - type: "post" | "achievement" | "background" | "news"
   - hook: The actual personalization angle to use
   - evidence: The reasoning behind this suggestion

6. **Pain Points**: Business challenges they likely face based on their role. Each should include:
   - pain: The specific pain point
   - evidence: Why someone in this role likely has this pain
   - solution: How AI/automation services could address this

Output your analysis as JSON matching this structure:
{
  "personalProfile": "string",
  "companyProfile": "string", 
  "interests": ["string"],
  "uniqueFacts": ["string"],
  "personalizationOpportunities": [
    { "type": "background", "hook": "string", "evidence": "string" }
  ],
  "painPoints": [
    { "pain": "string", "evidence": "string", "solution": "string" }
  ]
}

Be specific and actionable. The personalization hooks should feel like 1-to-1 communication.`;

export class ResearchAgent {
    private claude: Anthropic;

    constructor() {
        this.claude = new Anthropic({
            apiKey: anthropicConfig.apiKey,
        });
    }

    /**
     * Research a lead by ID
     */
    async researchLeadById(leadId: string): Promise<AgentResult> {
        const lead = await leadsDb.findById(leadId);
        if (!lead) {
            return {
                success: false,
                action: 'research',
                message: `Lead not found: ${leadId}`,
                error: 'Lead not found',
            };
        }
        return this.researchLead(lead);
    }

    /**
     * Research a lead by email
     */
    async researchByEmail(email: string): Promise<AgentResult> {
        const lead = await leadsDb.findByEmail(email);
        if (!lead) {
            return {
                success: false,
                action: 'research',
                message: `No lead found with email: ${email}`,
                error: 'Lead not found',
            };
        }
        return this.researchLead(lead);
    }

    /**
     * Full research pipeline for a lead
     */
    async researchLead(lead: Lead): Promise<AgentResult> {
        logger.info(`🔬 Starting research for: ${lead.first_name} ${lead.last_name} (${lead.email})`);

        try {
            // Scraping external market signals (G2, Trustpilot)
            logger.info('Gathering external market signals...');
            const companyName = lead.company_name || 'Unknown Company';

            // Search for reviews
            const [g2Results, trustpilotResults] = await Promise.all([
                googleSearch(`${companyName} G2 reviews`),
                googleSearch(`${companyName} Trustpilot reviews`)
            ]);

            // Filter to only actual review site URLs (ignore garbage results from free actors)
            const isRelevantUrl = (url: string) => {
                if (!url) return false;
                const lower = url.toLowerCase();
                return lower.includes('g2.com') ||
                    lower.includes('trustpilot.com') ||
                    lower.includes('capterra.com') ||
                    lower.includes('glassdoor.com') ||
                    lower.includes('linkedin.com') ||
                    lower.includes(companyName.toLowerCase().replace(/\s+/g, ''));
            };

            const g2Url = g2Results.find(r => isRelevantUrl(r.url))?.url;
            const trustpilotUrl = trustpilotResults.find(r => isRelevantUrl(r.url))?.url;
            const relevantUrl = g2Url || trustpilotUrl;
            let reviewsText = '';

            if (relevantUrl) {
                reviewsText = await readUrlContent(relevantUrl);
                logger.info(`Extracted ${reviewsText.length} chars of review context from ${relevantUrl}`);
            } else {
                logger.warn('No direct review sites found, skipping deep review analysis');
            }

            // AI Analysis based on available data AND scraped reviews
            // Re-running analysis to include the new context
            logger.info('Re-analyzing lead data with market signals...');
            const analysis = await this.analyzeResearch(lead, reviewsText);

            // Compile research data
            const researchData: ResearchData = {
                linkedin: {
                    profile: null,
                    posts: [],
                },
                companyResearch: `Scraped from: ${relevantUrl || 'None'}`,
                personResearch: '',
                trustpilotReviews: reviewsText.substring(0, 500) + '...', // snippet
                citations: relevantUrl ? [relevantUrl] : [],
                analysis: analysis,
                completedAt: new Date().toISOString(),
            };


            // Update lead in database
            await leadsDb.update(lead.id, {
                research_data: researchData,
                research_completed_at: new Date().toISOString(),
                status: 'researched',
            });

            // Log event
            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'research_completed',
                event_data: {
                    painPointsFound: analysis.painPoints.length,
                    personalizationOpportunities: analysis.personalizationOpportunities.length,
                },
            });

            logSuccess(`Research complete for ${lead.email}!`, {
                metadata: {
                    painPointsFound: analysis.painPoints.length,
                    personalizationOpportunities: analysis.personalizationOpportunities.length,
                    uniqueFacts: analysis.uniqueFacts.length
                }
            });

            return {
                success: true,
                action: 'research',
                message: `Research complete for ${lead.first_name} ${lead.last_name}. Found ${analysis.personalizationOpportunities.length} personalization opportunities and ${analysis.painPoints.length} pain points.`,
                data: {
                    leadId: lead.id,
                    analysis,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Research failed for ${lead.email}`, { metadata: error });

            // Record error for quarantine system
            try {
                await leadsDb.recordError(lead.id, `Research failed: ${message}`);
            } catch (dbError) {
                logger.error('Failed to record error to database', { metadata: dbError });
            }

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'research_failed',
                event_data: { error: message },
            });

            return {
                success: false,
                action: 'research',
                message: `Research failed: ${message}`,
                error: message,
            };
        }
    }

    /**
     * Analyze lead data using Claude (with retry)
     */
    private async analyzeResearch(lead: Lead, reviewsContext: string = ''): Promise<ResearchAnalysis> {
        const researchContext = `
## Prospect Information
- Name: ${lead.first_name} ${lead.last_name}
- Email: ${lead.email}
- Company: ${lead.company_name || 'Unknown'}
- Job Title: ${lead.job_title || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Location: ${lead.city || ''}, ${lead.state || ''}, ${lead.country || ''}
- Seniority: ${lead.seniority || 'Unknown'}
- Website: ${lead.website_url || 'Unknown'}
- LinkedIn: ${lead.linkedin_url || 'Not available'}

## Market Signals (Reviews/Feedback)
${reviewsContext ? reviewsContext.substring(0, 5000) : 'No external review data found.'}
`;

        const claude = this.claude;

        return withRetry(
            async () => {
                const response = await claude.messages.create({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 4096,
                    system: ANALYSIS_SYSTEM_PROMPT,
                    messages: [
                        {
                            role: 'user',
                            content: `Analyze this prospect and provide actionable insights for cold outreach:\n\n${researchContext}`,
                        },
                    ],
                });

                const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

                // Parse JSON response
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No JSON found in Claude response');
                }
                return JSON.parse(jsonMatch[0]) as ResearchAnalysis;
            },
            {
                maxAttempts: 3,
                initialDelay: 2000,
                maxDelay: 30000,
                backoffMultiplier: 2,
                operationName: 'Claude research analysis',
                isRetryable: (error) => {
                    const msg = error.message.toLowerCase();
                    // Retry on rate limits, overloaded, server errors, network issues
                    return msg.includes('429') ||
                        msg.includes('rate') ||
                        msg.includes('529') ||
                        msg.includes('overloaded') ||
                        msg.includes('timeout') ||
                        msg.includes('network') ||
                        msg.includes('500') ||
                        msg.includes('server');
                },
            }
        ).catch(error => {
            logger.warn('Failed to analyze with Claude after retries, using fallback', { metadata: error });
            return {
                personalProfile: 'Analysis failed - see raw research data',
                companyProfile: 'Analysis failed - see raw research data',
                interests: [],
                uniqueFacts: [],
                personalizationOpportunities: [],
                painPoints: [],
            };
        });
    }

    /**
     * Research all leads with 'scraped' status
     * Uses parallel processing with concurrency limit for speed
     */
    async researchPendingLeads(limit: number = 10): Promise<AgentResult> {
        const leads = await leadsDb.findByStatus('scraped', limit);

        if (leads.length === 0) {
            return {
                success: true,
                action: 'research_batch',
                message: 'No leads pending research',
            };
        }

        logger.info(`Starting batch research for ${leads.length} leads (parallel processing)...`);

        // Process leads in parallel with concurrency limit of 5
        // This balances speed vs API rate limits
        const CONCURRENCY = 5;
        const results: { success: boolean }[] = [];

        // Process in batches of CONCURRENCY
        for (let i = 0; i < leads.length; i += CONCURRENCY) {
            const batch = leads.slice(i, i + CONCURRENCY);
            logger.info(`Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(leads.length / CONCURRENCY)} (${batch.length} leads)...`);

            // Process batch in parallel
            const batchResults = await Promise.all(
                batch.map(lead => this.researchLead(lead))
            );

            results.push(...batchResults);

            // Small delay between batches to avoid rate limits
            if (i + CONCURRENCY < leads.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return {
            success: true,
            action: 'research_batch',
            message: `Batch research complete: ${successful} successful, ${failed} failed`,
            data: { successful, failed, total: leads.length },
        };
    }

    /**
     * Get research summary for a lead
     */
    async getResearchSummary(leadId: string): Promise<string | null> {
        const lead = await leadsDb.findById(leadId);
        if (!lead?.research_data) return null;

        const analysis = (lead.research_data as ResearchData).analysis;

        return `
## ${lead.first_name} ${lead.last_name} - Research Summary

### Personal Profile
${analysis.personalProfile}

### Company Profile  
${analysis.companyProfile}

### Interests
${analysis.interests.map(i => `• ${i}`).join('\n')}

### Unique Facts
${analysis.uniqueFacts.map(f => `• ${f}`).join('\n')}

### Personalization Opportunities
${analysis.personalizationOpportunities.map(p => `• [${p.type}] ${p.hook}`).join('\n')}

### Pain Points
${analysis.painPoints.map(p => `• ${p.pain} → ${p.solution}`).join('\n')}
`;
    }
}

// Export singleton instance
export const researchAgent = new ResearchAgent();