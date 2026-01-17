#!/usr/bin/env node
import { ResearchAgent } from './agents/research/index.js';
import { OutreachAgent } from './agents/outreach/index.js';
import { SendingAgent } from './agents/sending/index.js';
import { leadsDb, checkConnection } from './db/index.js';
import { logger, logSuccess } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

interface PipelineConfig {
    researchLimit: number;
    outreachLimit: number;
    sendingLimit: number;
    delayBetweenLeads: number;    // ms between processing each lead
    delayBetweenStages: number;   // ms between pipeline stages
    delayBetweenEmails: number;   // ms between sending emails
}

const defaultConfig: PipelineConfig = {
    researchLimit: 300,           // 300 leads per batch (saved in 2× 150-lead chunks = 900/day)
    outreachLimit: 300,
    sendingLimit: 300,
    delayBetweenLeads: 500,       // 0.5 seconds (was 1 second)
    delayBetweenStages: 1000,     // 1 second (was 5 seconds)
    delayBetweenEmails: 600,      // 0.6 seconds - respects Resend's 2 req/sec limit (was 5 seconds)
};

// Fast mode for testing
const fastConfig: PipelineConfig = {
    researchLimit: 100,
    outreachLimit: 100,
    sendingLimit: 100,
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
        logger.error('Database not connected. Aborting pipeline.');
        process.exit(1);
    }
    logSuccess('Database connected');

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
        // STAGE 1: RESEARCH
        // ═══════════════════════════════════════════════════════════════
        logger.info('STAGE 1: RESEARCH');

        const scrapedLeads = await leadsDb.findByStatus('scraped', cfg.researchLimit);
        logger.info(`Found ${scrapedLeads.length} leads to research`);

        for (const lead of scrapedLeads) {
            logger.info(`Researching: ${lead.first_name} ${lead.last_name} (${lead.email})`);
            const result = await researchAgent.researchLead(lead);
            if (result.success) {
                stats.researched++;
                metrics.increment('leadsResearched');
                logSuccess(`Research complete for: ${lead.email}`);
            } else {
                logger.error(`Research failed for: ${lead.email}`, { metadata: { error: result.error } });
                metrics.increment('errorsCaught');
            }
            await delay(cfg.delayBetweenLeads);
        }

        logSuccess(`Stage 1 Complete: ${stats.researched} leads researched`);
        await delay(cfg.delayBetweenStages);

        // STAGE 2: OUTREACH (Email Generation)
        // ═══════════════════════════════════════════════════════════════
        logger.info('STAGE 2: OUTREACH (Email Generation)');

        const researchedLeads = await leadsDb.findByStatus('researched', cfg.outreachLimit);
        logger.info(`Found ${researchedLeads.length} leads for email generation`);

        for (const lead of researchedLeads) {
            logger.info(`Generating emails for: ${lead.first_name} ${lead.last_name}`);
            const result = await outreachAgent.generateEmailSequence(lead);
            if (result.success) {
                stats.emailsGenerated++;
                metrics.increment('emailsGenerated');
                logSuccess(`Emails generated for: ${lead.email}`);
            } else {
                logger.error(`Generation failed for: ${lead.email}`, { metadata: { error: result.error } });
                metrics.increment('errorsCaught');
            }
            await delay(cfg.delayBetweenLeads);
        }

        logSuccess(`Stage 2 Complete: ${stats.emailsGenerated} email sequences generated`);
        await delay(cfg.delayBetweenStages);

        // STAGE 3: SENDING (Email 1)
        // ═══════════════════════════════════════════════════════════════
        logger.info('STAGE 3: SENDING (Email 1)');

        const readyLeads = await leadsDb.findByStatus('ready', cfg.sendingLimit);
        logger.info(`Found ${readyLeads.length} leads ready to send`);

        if (!process.env.RESEND_API_KEY && !process.env.INSTANTLY_API_KEY) {
            logger.warn('No email API configured (RESEND_API_KEY or INSTANTLY_API_KEY) - skipping sending');
        } else {
            for (const lead of readyLeads) {
                logger.info(`Sending Email 1 to: ${lead.email}`);
                const result = await sendingAgent.sendEmail1(lead.id);
                if (result.success) {
                    stats.emailsSent++;
                    metrics.increment('emailsSent');
                    logSuccess(`Sent Email 1 to: ${lead.email}`);
                } else {
                    logger.error(`Failed to send to: ${lead.email}`, { metadata: { error: result.error } });
                    metrics.increment('errorsCaught');
                }
                await delay(cfg.delayBetweenEmails);
            }
        }

        logSuccess(`Stage 3 Complete: ${stats.emailsSent} emails sent`);

        // Fetch quarantine and error stats
        let quarantineCount = 0;
        let leadsWithErrors = 0;
        try {
            quarantineCount = await leadsDb.countQuarantined();
            const leadsWithErrorList = await leadsDb.findWithErrors(100);
            leadsWithErrors = leadsWithErrorList.length;
            metrics.set('quarantinedLeads', quarantineCount);
        } catch (e) {
            logger.warn('Failed to fetch quarantine/error stats', { metadata: e });
        }

        const durationSeconds = (Date.now() - startTime) / 1000;
        logSuccess('PIPELINE COMPLETE', { metadata: { ...stats, quarantineCount, leadsWithErrors, duration: durationSeconds } });
    } catch (error) {
        logger.error('Pipeline error', { metadata: error });
        metrics.increment('errorsCaught');
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
    logger.info('⚡ Running in FAST mode');
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