import { reportingService } from '../services/reporting.js';
import { logger } from '../utils/logger.js';
import { config } from 'dotenv';

config();

async function main() {
    logger.info('🚀 Starting Weekly Impact Report Generation...');

    try {
        const metrics = await reportingService.generateWeeklyMetrics();

        // 1. Send to Slack (always)
        await reportingService.sendSlackReport(metrics);

        // 2. Update Google Sheet (if configured)
        await reportingService.updateGoogleSheet(metrics);

        logger.info('✅ Weekly Impact Report Complete!');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Failed to generate weekly report', { metadata: error });
        process.exit(1);
    }
}

main();
