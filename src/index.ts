// Autonome Sales Agent - Main Entry Point
import { config } from './config/index.js';
import { checkConnection } from './db/index.js';
import { DiscoveryAgent } from './agents/discovery/index.js';

export { DiscoveryAgent } from './agents/discovery/index.js';
export { leadsDb, eventsDb, supabase } from './db/index.js';
export { scrapeApollo } from './tools/index.js';
export type * from './types/index.js';

async function main() {
  console.log('🚀 Autonome Sales Agent Starting...');
  console.log(`   Environment: ${config.app.nodeEnv}`);
  
  // Check database connection
  const dbConnected = await checkConnection();
  console.log(`   Database: ${dbConnected ? '✅ Connected' : '❌ Not connected'}`);
  
  // Initialize agents
  const discovery = new DiscoveryAgent();
  console.log('   Discovery Agent: ✅ Ready');
  
  console.log('\n✨ Agent system ready!\n');
  
  return { discovery };
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
