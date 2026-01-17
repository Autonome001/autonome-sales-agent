/**
 * Autonome Sales Agent - Main Entry Point
 * 
 * Starts both the Express server (inbound webhooks) and the Scheduler (pipeline).
 * This allows single-container deployment on Railway.
 */

import { app } from './inbound-webhook.js';
import { startScheduler, getSchedulerConfig } from './scheduler.js';
import { startFollowupScheduler } from './followup-scheduler.js';
import { logger, logSuccess } from './utils/logger.js';
import { config as loadEnv } from 'dotenv';
loadEnv();

const PORT = process.env.PORT || 3000;

async function start() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🚀 AUTONOME AGENT SYSTEM STARTING                    ║
║                                                               ║
║  1. Inbound Webhook Server (Port ${PORT})                       
║  2. Sales Pipeline Scheduler (Cron)                           
║  3. Follow-up Email Watcher (Cron)                            
╚═══════════════════════════════════════════════════════════════╝
`);

  // 1. Start Web Server
  app.listen(PORT, () => {
    logSuccess(`Web Server running on port ${PORT}`);
  });

  // 2. Start Scheduler
  const schedulerConfig = getSchedulerConfig();
  startScheduler(schedulerConfig);

  // 3. Start Follow-up Watcher
  startFollowupScheduler();

  logger.info('System fully operational');
}

start().catch(error => {
  logger.error('Failed to start system', { metadata: error });
  process.exit(1);
});
