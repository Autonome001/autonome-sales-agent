import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../../config/index.js';
import { leadsDb, eventsDb } from '../../db/index.js';
import type { Lead, AgentResult } from '../../types/index.js';

export interface EmailSequence {
    email1: {
        subject: string;
        body: string;
    };
    email2: {
        body: string;
    };
    email3: {
        subject: string;
        body: string;
    };
}

export interface OutreachConfig {
    senderEmails: string[];
    optOutBaseUrl: string;
    calendlyUrl: string;
}

const TIMEZONE_MAP: Record<string, string> = {
    'united states': 'T1',
    'usa': 'T1',
    'us': 'T1',
    'canada': 'T1',
    'australia': 'T2',
    'new zealand': 'T2',
    'singapore': 'T2',
    'hong kong': 'T2',
    'japan': 'T2',
    'united kingdom': 'T3',
    'uk': 'T3',
    'england': 'T3',
    'germany': 'T3',
    'france': 'T3',
    'netherlands': 'T3',
    'ireland': 'T3',
};

const EMAIL_SYSTEM_PROMPT = `You are an expert B2B cold email copywriter for Autonome, an AI automation consultancy. Your job is to write highly personalized, conversion-focused email sequences.

CRITICAL RULES:
1. Maximum 100 words per email body
2. 6th grade reading level - simple, clear language
3. Subject lines: Maximum 4 words, intriguing but not clickbait
4. NO fluff, NO corporate jargon, NO "I hope this finds you well"
5. Every email must feel 1-to-1, not mass-generated
6. Focus on THEIR pain points, not our features

EMAIL SEQUENCE STRUCTURE:

**Email 1 (The Hook)**
- Open with specific personalization (reference their LinkedIn post, company news, or unique fact)
- Quickly transition to a pain point relevant to their role
- End with soft CTA: "Worth a 15-min chat?"
- NO Calendly link in first email

**Email 2 (The Bump)**
- Short follow-up (50 words max)
- "Pushing this back up" angle
- Reference the original email's value prop
- Still no hard sell

**Email 3 (The Close)**
- Different pain point than Email 1
- More direct approach
- Include Calendly link
- Create gentle urgency without being pushy

TONE:
- Conversational, like a knowledgeable peer
- Confident but not arrogant
- Genuinely curious about their challenges
- Zero desperation

OUTPUT FORMAT (JSON):
{
  "email1": {
    "subject": "4 words max",
    "body": "personalized opening... pain point... soft CTA"
  },
  "email2": {
    "body": "short bump message"
  },
  "email3": {
    "subject": "4 words max",
    "body": "different angle... calendly link... gentle close"
  }
}`;

export class OutreachAgent {
    private claude: Anthropic;
    private config: OutreachConfig;
    private senderIndex: number = 0;

    constructor(config?: Partial<OutreachConfig>) {
        this.claude = new Anthropic({
            apiKey: anthropicConfig.apiKey,
        });

        this.config = {
            senderEmails: config?.senderEmails || [
                process.env.SENDER_EMAIL_1 || 'brian@autonomepartners.ai',
                process.env.SENDER_EMAIL_2 || 'cole@autonomepartners.ai',
                process.env.SENDER_EMAIL_3 || 'melle@autonomepartners.ai',
            ],
            optOutBaseUrl: config?.optOutBaseUrl || process.env.OPT_OUT_URL || 'https://autonomepartners.ai/optout',
            calendlyUrl: config?.calendlyUrl || process.env.CALENDLY_URL || 'https://calendly.com/autonome/15min',
        };
    }

    async generateByEmail(email: string): Promise<AgentResult> {
        const lead = await leadsDb.findByEmail(email);
        if (!lead) {
            return {
                success: false,
                action: 'outreach',
                message: `No lead found with email: ${email}`,
                error: 'Lead not found',
            };
        }
        return this.generateEmailSequence(lead);
    }

    async generateEmailSequence(lead: Lead): Promise<AgentResult> {
        console.log(`\n📧 Generating email sequence for: ${lead.first_name} ${lead.last_name} (${lead.email})`);

        if (lead.status !== 'researched' && !lead.research_data) {
            return {
                success: false,
                action: 'outreach',
                message: 'Lead must be researched before generating emails. Run research first.',
                error: 'Lead not researched',
            };
        }

        try {
            const researchData = lead.research_data as any;
            const analysis = researchData?.analysis || {};
            const context = this.buildEmailContext(lead, analysis);

            console.log('✍️  Writing personalized emails...');
            const sequence = await this.generateWithClaude(context);

            const timezone = this.determineTimezone(lead);
            const senderEmail = this.getNextSender();

            await leadsDb.update(lead.id, {
                email_1_subject: sequence.email1.subject,
                email_1_body: this.appendOptOut(sequence.email1.body, lead.opt_out_token),
                email_2_body: sequence.email2.body,
                email_3_subject: sequence.email3.subject,
                email_3_body: this.appendOptOut(sequence.email3.body, lead.opt_out_token),
                sender_email: senderEmail,
                timezone: timezone,
                status: 'ready',
            });

            await eventsDb.log({
                lead_id: lead.id,
                event_type: 'emails_generated',
                event_data: { timezone, senderEmail },
            });

            console.log('\n✅ Email sequence generated!');
            console.log(`   📬 Sender: ${senderEmail}`);
            console.log(`   🌍 Timezone: ${timezone}`);

            return {
                success: true,
                action: 'outreach',
                message: `Email sequence generated for ${lead.first_name} ${lead.last_name}. Assigned to ${senderEmail} (${timezone}).`,
                data: { leadId: lead.id, sequence, timezone, senderEmail },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('\n❌ Email generation failed:', message);
            return {
                success: false,
                action: 'outreach',
                message: `Email generation failed: ${message}`,
                error: message,
            };
        }
    }

    private buildEmailContext(lead: Lead, analysis: any): string {
        const personalization = analysis.personalizationOpportunities || [];
        const painPoints = analysis.painPoints || [];
        const interests = analysis.interests || [];
        const uniqueFacts = analysis.uniqueFacts || [];

        const shortCompany = this.cleanCompanyName(lead.company_name || '');

        return `
## PROSPECT INFORMATION
- Name: ${lead.first_name} ${lead.last_name}
- Company: ${shortCompany} (Full: ${lead.company_name || 'Unknown'})
- Job Title: ${lead.job_title || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Location: ${lead.city || ''}, ${lead.country || ''}

## RESEARCH INSIGHTS
### Personal Profile
${analysis.personalizationOpportunities || 'No personal profile available'}

### Company Profile
${analysis.companyProfile || 'No company profile available'}

### Interests
${interests.length ? interests.map((i: string) => `- ${i}`).join('\n') : 'None identified'}

### Unique Facts (USE THESE FOR PERSONALIZATION)
${uniqueFacts.length ? uniqueFacts.map((f: string) => `- ${f}`).join('\n') : 'None identified'}

### Personalization Opportunities
${personalization.length ? personalization.map((p: any) => `- [${p.type}] ${p.hook}`).join('\n') : 'None identified'}

### Pain Points (USE DIFFERENT ONES FOR EMAIL 1 vs EMAIL 3)
${painPoints.length ? painPoints.map((p: any) => `- ${p.pain} → Solution: ${p.solution}`).join('\n') : 'None identified'}

## CALENDLY LINK (for Email 3 only)
${this.config.calendlyUrl}

## WRITING INSTRUCTION
Refers to the company as "${shortCompany}" to sound natural (e.g. "I saw ${shortCompany} is growing" instead of "I saw ${lead.company_name} is growing").
`;
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

    private async generateWithClaude(context: string): Promise<EmailSequence> {
        const response = await this.claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: EMAIL_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: `Generate a 3-email cold outreach sequence for this prospect:\n\n${context}` }],
        });

        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found');
            return JSON.parse(jsonMatch[0]) as EmailSequence;
        } catch {
            return {
                email1: { subject: 'Quick question', body: `Hi ${context.match(/Name: (\w+)/)?.[1] || 'there'},\n\nWorth a quick chat about automation?` },
                email2: { body: 'Just bumping this up - would love to hear your thoughts.' },
                email3: { subject: 'Last try', body: `Here's my calendar if interested: ${this.config.calendlyUrl}` },
            };
        }
    }

    private determineTimezone(lead: Lead): string {
        const country = (lead.country || '').toLowerCase();
        for (const [key, tz] of Object.entries(TIMEZONE_MAP)) {
            if (country.includes(key)) return tz;
        }
        return 'T1';
    }

    private getNextSender(): string {
        const sender = this.config.senderEmails[this.senderIndex];
        this.senderIndex = (this.senderIndex + 1) % this.config.senderEmails.length;
        return sender;
    }

    private appendOptOut(body: string, token: string): string {
        return `${body}\n\n---\nUnsubscribe: ${this.config.optOutBaseUrl}?tkn=${token}`;
    }

    async generateForPendingLeads(limit: number = 10): Promise<AgentResult> {
        const leads = await leadsDb.findByStatus('researched', limit);
        if (leads.length === 0) {
            return { success: true, action: 'outreach_batch', message: 'No researched leads pending email generation' };
        }

        console.log(`\n📧 Starting batch email generation for ${leads.length} leads...\n`);
        let successful = 0, failed = 0;

        for (const lead of leads) {
            const result = await this.generateEmailSequence(lead);
            if (result.success) successful++;
            else failed++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return {
            success: true,
            action: 'outreach_batch',
            message: `Batch complete: ${successful} successful, ${failed} failed`,
            data: { successful, failed, total: leads.length },
        };
    }
}

export const outreachAgent = new OutreachAgent();