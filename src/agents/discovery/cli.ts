#!/usr/bin/env node
import * as readline from 'readline';
import { DiscoveryAgent } from './index.js';
import { checkConnection } from '../../db/index.js';

const agent = new DiscoveryAgent();

async function main() {
  console.log('\n🔍 Autonome Discovery Agent');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check database connection
  const dbConnected = await checkConnection();
  if (dbConnected) {
    console.log('✅ Database connected\n');
  } else {
    console.log('⚠️  Database not connected (running in offline mode)\n');
  }

  console.log('Commands:');
  console.log('  • Natural language: "Find CEOs of marketing agencies in Chicago"');
  console.log('  • stats     - Show pipeline statistics');
  console.log('  • search    - Search existing leads');
  console.log('  • reset     - Reset conversation');
  console.log('  • exit      - Exit agent\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('🤖 > ', async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }

      // Handle special commands
      if (trimmed.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye!\n');
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'reset') {
        agent.reset();
        console.log('🔄 Conversation reset.\n');
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'stats') {
        try {
          const stats = await agent.getStats();
          console.log('\n📊 Pipeline Statistics:');
          for (const [status, count] of Object.entries(stats)) {
            console.log(`   ${status}: ${count}`);
          }
          console.log('');
        } catch (error) {
          console.log('❌ Failed to get stats (database may not be connected)\n');
        }
        prompt();
        return;
      }

      if (trimmed.toLowerCase().startsWith('search ')) {
        const query = trimmed.slice(7).trim();
        try {
          const leads = await agent.searchLeads(query);
          console.log(`\n🔎 Found ${leads.length} leads matching "${query}":`);
          for (const lead of leads.slice(0, 10)) {
            console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name} @ ${lead.company_name}`);
          }
          if (leads.length > 10) {
            console.log(`   ... and ${leads.length - 10} more`);
          }
          console.log('');
        } catch (error) {
          console.log('❌ Search failed\n');
        }
        prompt();
        return;
      }

      // Process natural language command
      console.log('\n⏳ Processing...\n');
      
      try {
        const result = await agent.processCommand(trimmed);
        
        if (result.success) {
          console.log(`✅ ${result.message}\n`);
          
          if (result.data && result.data.leads && result.data.leads.length > 0) {
            console.log('📋 Sample leads added:');
            for (const lead of result.data.leads.slice(0, 5)) {
              console.log(`   • ${lead.email} - ${lead.name} @ ${lead.company || 'Unknown'}`);
            }
            if (result.data.leads.length > 5) {
              console.log(`   ... and ${result.data.leads.length - 5} more\n`);
            }
          }
        } else {
          console.log(`❌ ${result.message}\n`);
          if (result.error) {
            console.log(`   Error: ${result.error}\n`);
          }
        }
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
