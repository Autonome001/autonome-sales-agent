#!/usr/bin/env node
import * as readline from 'readline';
import { ResponseAgent } from './index.js';
import { leadsDb, checkConnection } from '../../db/index.js';

const agent = new ResponseAgent();

async function main() {
    console.log('\n📨 Autonome Response Agent');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const dbConnected = await checkConnection();
    if (dbConnected) {
        console.log('✅ Database connected\n');
    } else {
        console.log('⚠️  Database not connected\n');
    }

    console.log('Commands:');
    console.log('  • classify            - Classify a new inbound email (interactive)');
    console.log('  • followup <email>    - Generate follow-up for interested lead');
    console.log('  • engaged             - Show engaged leads');
    console.log('  • stats               - Show response statistics');
    console.log('  • exit                - Exit agent\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const prompt = () => {
        rl.question('📨 > ', async (input) => {
            const trimmed = input.trim();
            const [command, ...args] = trimmed.split(' ');

            if (!trimmed) { prompt(); return; }

            switch (command.toLowerCase()) {
                case 'exit':
                    console.log('\n👋 Goodbye!\n');
                    rl.close();
                    process.exit(0);

                case 'classify':
                    await handleClassify(rl);
                    break;

                case 'followup':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleFollowUp(args[0]);
                    break;

                case 'engaged':
                    await handleEngaged();
                    break;

                case 'stats':
                    await handleStats();
                    break;

                default:
                    console.log(`❌ Unknown command: ${command}\n`);
            }
            prompt();
        });
    };
    prompt();
}

async function handleClassify(rl: readline.Interface) {
    console.log('\n📧 Enter inbound email details:\n');

    const askQuestion = (question: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(question, (answer) => resolve(answer));
        });
    };

    const from = await askQuestion('From (email): ');
    const subject = await askQuestion('Subject: ');
    console.log('Body (enter blank line to finish):');

    let body = '';
    let line = await askQuestion('');
    while (line !== '') {
        body += line + '\n';
        line = await askQuestion('');
    }

    if (!from || !body) {
        console.log('❌ Email and body are required\n');
        return;
    }

    const result = await agent.processInboundEmail({
        from: from.trim(),
        subject: subject.trim(),
        body: body.trim(),
    });

    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleFollowUp(email: string) {
    const lead = await leadsDb.findByEmail(email);
    if (!lead) {
        console.log(`❌ No lead found: ${email}\n`);
        return;
    }

    const result = await agent.generateFollowUp(lead.id);
    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleEngaged() {
    const leads = await leadsDb.findByStatus('engaged', 20);
    if (leads.length === 0) {
        console.log('📭 No engaged leads\n');
        return;
    }

    console.log(`\n📋 ${leads.length} engaged leads:\n`);
    for (const lead of leads) {
        const category = (lead as any).reply_category || 'unknown';
        console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name} [${category}]`);
    }
    console.log('');
}

async function handleStats() {
    console.log('\n📊 Response Statistics:\n');
    console.log('   (Statistics tracking coming soon)\n');
}

main().catch(console.error);