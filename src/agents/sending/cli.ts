#!/usr/bin/env node
import * as readline from 'readline';
import { SendingAgent } from './index.js';
import { leadsDb, checkConnection } from '../../db/index.js';

const agent = new SendingAgent();

async function main() {
    console.log('\n📤 Autonome Sending Agent');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const dbConnected = await checkConnection();
    if (dbConnected) {
        console.log('✅ Database connected\n');
    } else {
        console.log('⚠️  Database not connected\n');
    }

    // Check Instantly API key
    if (!process.env.INSTANTLY_API_KEY) {
        console.log('⚠️  INSTANTLY_API_KEY not set in .env\n');
    }

    console.log('Commands:');
    console.log('  • send1 <email>      - Send Email 1 to a specific lead');
    console.log('  • send2 <email>      - Send Email 2 to a specific lead');
    console.log('  • send3 <email>      - Send Email 3 to a specific lead');
    console.log('  • batch1 [limit]     - Batch send Email 1');
    console.log('  • batch2 [limit]     - Batch send Email 2');
    console.log('  • batch3 [limit]     - Batch send Email 3');
    console.log('  • queue              - Show sending queue status');
    console.log('  • ready              - Show leads ready to send');
    console.log('  • exit               - Exit agent\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const prompt = () => {
        rl.question('📤 > ', async (input) => {
            const trimmed = input.trim();
            const [command, ...args] = trimmed.split(' ');

            if (!trimmed) { prompt(); return; }

            switch (command.toLowerCase()) {
                case 'exit':
                    console.log('\n👋 Goodbye!\n');
                    rl.close();
                    process.exit(0);

                case 'send1':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleSendEmail(args[0], 1);
                    break;

                case 'send2':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleSendEmail(args[0], 2);
                    break;

                case 'send3':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleSendEmail(args[0], 3);
                    break;

                case 'batch1':
                    await handleBatch(1, parseInt(args[0]) || 10);
                    break;

                case 'batch2':
                    await handleBatch(2, parseInt(args[0]) || 10);
                    break;

                case 'batch3':
                    await handleBatch(3, parseInt(args[0]) || 10);
                    break;

                case 'queue':
                    await handleQueue();
                    break;

                case 'ready':
                    await handleReady();
                    break;

                default:
                    console.log(`❌ Unknown command: ${command}\n`);
            }
            prompt();
        });
    };
    prompt();
}

async function handleSendEmail(email: string, step: 1 | 2 | 3) {
    const lead = await leadsDb.findByEmail(email);
    if (!lead) {
        console.log(`❌ No lead found: ${email}\n`);
        return;
    }

    let result;
    switch (step) {
        case 1: result = await agent.sendEmail1(lead.id); break;
        case 2: result = await agent.sendEmail2(lead.id); break;
        case 3: result = await agent.sendEmail3(lead.id); break;
    }

    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleBatch(step: 1 | 2 | 3, limit: number) {
    console.log(`\n⏳ Processing Email ${step} batch (limit: ${limit})...\n`);
    const result = await agent.processBatch(step, limit);
    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}\n`);
}

async function handleQueue() {
    console.log('\n⏳ Fetching queue status...');
    const status = await agent.getQueueStatus();

    console.log('\n📊 Sending Queue Status:\n');
    console.log(`   📧 Ready for Email 1: ${status.readyForEmail1}`);
    console.log(`   📧 Ready for Email 2: ${status.readyForEmail2}`);
    console.log(`   📧 Ready for Email 3: ${status.readyForEmail3}`);
    console.log(`   ─────────────────────`);
    console.log(`   📬 Total in queue: ${status.readyForEmail1 + status.readyForEmail2 + status.readyForEmail3}\n`);
}

async function handleReady() {
    const leads = await leadsDb.findByStatus('ready', 20);
    if (leads.length === 0) {
        console.log('📭 No leads ready to send\n');
        return;
    }

    console.log(`\n📋 ${leads.length} leads ready for Email 1:\n`);
    for (const lead of leads) {
        console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name} (${lead.timezone})`);
    }
    console.log('');
}

main().catch(console.error);