import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig, apifyConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';

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
        console.log(`\n🔬 Starting research for: ${lead.first_name} ${lead.last_name} (${lead.email})`);

        try {
            // AI Analysis based on available data
            console.log('\n🧠 Analyzing lead data...');
            const analysis = await this.analyzeResearch(lead);

            // Compile research data
            const researchData: ResearchData = {
                linkedin: {
                    profile: null,
                    posts: [],
                },
                companyResearch: '',
                personResearch: '',
                trustpilotReviews: '',
                citations: [],
                analysis,
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

            console.log('\n✅ Research complete!');
            console.log(`   • ${analysis.personalizationOpportunities.length} personalization opportunities`);
            console.log(`   • ${analysis.painPoints.length} pain points identified`);
            console.log(`   • ${analysis.uniqueFacts.length} unique facts`);

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
            console.error('\n❌ Research failed:', message);

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
     * Analyze lead data using Claude
     */
    private async analyzeResearch(lead: Lead): Promise<ResearchAnalysis> {
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
`;

        const response = await this.claude.messages.create({
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
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            return JSON.parse(jsonMatch[0]) as ResearchAnalysis;
        } catch {
            console.warn('Failed to parse analysis JSON, using fallback');
            return {
                personalProfile: 'Analysis parsing failed - see raw research data',
                companyProfile: 'Analysis parsing failed - see raw research data',
                interests: [],
                uniqueFacts: [],
                personalizationOpportunities: [],
                painPoints: [],
            };
        }
    }

    /**
     * Research all leads with 'scraped' status
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

        console.log(`\n📚 Starting batch research for ${leads.length} leads...\n`);

        let successful = 0;
        let failed = 0;

        for (const lead of leads) {
            const result = await this.researchLead(lead);
            if (result.success) {
                successful++;
            } else {
                failed++;
            }

            // Small delay between leads to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

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