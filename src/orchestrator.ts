#!/usr/bin/env node
import { ResearchAgent } from './agents/research/index.js';
import { OutreachAgent } from './agents/outreach/index.js';
import { SendingAgent } from './agents/sending/index.js';
import { leadsDb, checkConnection } from './db/index.js';

interface PipelineConfig {
    researchLimit: number;
    outreachLimit: number;
    sendingLimit: number;
    delayBetweenLeads: number;    // ms between processing each lead
    delayBetweenStages: number;   // ms between pipeline stages
    delayBetweenEmails: number;   // ms between sending emails
}

const defaultConfig: PipelineConfig = {
    researchLimit: 10,
    outreachLimit: 10,
    sendingLimit: 10,
    delayBetweenLeads: 500,       // 0.5 seconds (was 1 second)
    delayBetweenStages: 1000,     // 1 second (was 5 seconds)
    delayBetweenEmails: 600,      // 0.6 seconds - respects Resend's 2 req/sec limit (was 5 seconds)
};

// Fast mode for testing
const fastConfig: PipelineConfig = {
    researchLimit: 10,
    outreachLimit: 10,
    sendingLimit: 10,
    delayBetweenLeads: 100,       // 0.1 seconds
    delayBetweenStages: 500,      // 0.5 seconds
    delayBetweenEmails: 600,      // 0.6 seconds - MUST respect Resend's 2 req/sec limit
};

async function runPipeline(config: Partial<PipelineConfig> = {}) {
    const cfg = { ...defaultConfig, ...config };

    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           🚀 AUTONOME SALES PIPELINE ORCHESTRATOR             ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    // Check database connection
    const dbConnected = await checkConnection();
    if (!dbConnected) {
        console.log('❌ Database not connected. Aborting pipeline.\n');
        process.exit(1);
    }
    console.log('✅ Database connected\n');

    const startTime = Date.now();
    const stats = {
        researched: 0,
        emailsGenerated: 0,
        emailsSent: 0,
    };

    // Initialize agents
    const researchAgent = new ResearchAgent();
    const outreachAgent = new OutreachAgent();
    const sendingAgent = new SendingAgent();

    try {
        // ═══════════════════════════════════════════════════════════════
        // STAGE 1: RESEARCH
        // ═══════════════════════════════════════════════════════════════
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ STAGE 1: RESEARCH                                          │');
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        const scrapedLeads = await leadsDb.findByStatus('scraped', cfg.researchLimit);
        console.log(`📋 Found ${scrapedLeads.length} leads to research\n`);

        for (const lead of scrapedLeads) {
            console.log(`🔬 Researching: ${lead.first_name} ${lead.last_name} (${lead.email})`);
            const result = await researchAgent.researchLead(lead);
            if (result.success) {
                stats.researched++;
                console.log(`   ✅ Research complete\n`);
            } else {
                console.log(`   ❌ Research failed: ${result.error}\n`);
            }
            await delay(cfg.delayBetweenLeads);
        }

        console.log(`\n📊 Stage 1 Complete: ${stats.researched} leads researched\n`);
        await delay(cfg.delayBetweenStages);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 2: OUTREACH (Email Generation)
        // ═══════════════════════════════════════════════════════════════
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ STAGE 2: OUTREACH (Email Generation)                       │');
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        const researchedLeads = await leadsDb.findByStatus('researched', cfg.outreachLimit);
        console.log(`📋 Found ${researchedLeads.length} leads for email generation\n`);

        for (const lead of researchedLeads) {
            console.log(`📧 Generating emails for: ${lead.first_name} ${lead.last_name}`);
            const result = await outreachAgent.generateEmailSequence(lead);
            if (result.success) {
                stats.emailsGenerated++;
                console.log(`   ✅ Emails generated\n`);
            } else {
                console.log(`   ❌ Generation failed: ${result.error}\n`);
            }
            await delay(cfg.delayBetweenLeads);
        }

        console.log(`\n📊 Stage 2 Complete: ${stats.emailsGenerated} email sequences generated\n`);
        await delay(cfg.delayBetweenStages);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 3: SENDING (Email 1)
        // ═══════════════════════════════════════════════════════════════
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ STAGE 3: SENDING (Email 1)                                 │');
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        const readyLeads = await leadsDb.findByStatus('ready', cfg.sendingLimit);
        console.log(`📋 Found ${readyLeads.length} leads ready to send\n`);

        if (!process.env.RESEND_API_KEY && !process.env.INSTANTLY_API_KEY) {
            console.log('⚠️  No email API configured (RESEND_API_KEY or INSTANTLY_API_KEY) - skipping sending\n');
        } else {
            for (const lead of readyLeads) {
                console.log(`📤 Sending Email 1 to: ${lead.email}`);
                const result = await sendingAgent.sendEmail1(lead.id);
                if (result.success) {
                    stats.emailsSent++;
                    console.log(`   ✅ Sent\n`);
                } else {
                    console.log(`   ❌ Failed: ${result.error}\n`);
                }
                await delay(cfg.delayBetweenEmails);
            }
        }

        console.log(`\n📊 Stage 3 Complete: ${stats.emailsSent} emails sent\n`);

        // ═══════════════════════════════════════════════════════════════
        // PIPELINE COMPLETE
        // ═══════════════════════════════════════════════════════════════
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('╔═══════════════════════════════════════════════════════════════╗');
        console.log('║                    📊 PIPELINE SUMMARY                        ║');
        console.log('╠═══════════════════════════════════════════════════════════════╣');
        console.log(`║  🔬 Leads Researched:        ${String(stats.researched).padStart(4)}                           ║`);
        console.log(`║  📧 Email Sequences Created: ${String(stats.emailsGenerated).padStart(4)}                           ║`);
        console.log(`║  📤 Emails Sent:             ${String(stats.emailsSent).padStart(4)}                           ║`);
        console.log(`║  ⏱️  Duration:               ${duration.padStart(5)}s                          ║`);
        console.log('╚═══════════════════════════════════════════════════════════════╝\n');

        console.log(`📝 Pipeline complete: ${stats.researched} researched, ${stats.emailsGenerated} emails created, ${stats.emailsSent} sent in ${duration}s\n`);

    } catch (error) {
        console.error('\n❌ Pipeline error:', error);
        process.exit(1);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse command line arguments
const args = process.argv.slice(2);
let config: Partial<PipelineConfig> = {};

// Check for --fast flag
if (args.includes('--fast')) {
    config = { ...fastConfig };
    console.log('⚡ Running in FAST mode\n');
}

for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = parseInt(args[i + 1]);

    if (isNaN(value)) continue;

    switch (flag) {
        case '--research': config.researchLimit = value; break;
        case '--outreach': config.outreachLimit = value; break;
        case '--sending': config.sendingLimit = value; break;
        case '--all':
            config.researchLimit = value;
            config.outreachLimit = value;
            config.sendingLimit = value;
            break;
    }
}

// Run the pipeline
runPipeline(config).then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Pipeline failed:', error);
    process.exit(1);
});