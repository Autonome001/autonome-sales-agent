#!/usr/bin/env node
import * as readline from 'readline';
import { OutreachAgent } from './index.js';
import { leadsDb, checkConnection } from '../../db/index.js';

const agent = new OutreachAgent();

async function main() {
    console.log('\n📧 Autonome Outreach Agent');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const dbConnected = await checkConnection();
    if (dbConnected) {
        console.log('✅ Database connected\n');
    } else {
        console.log('⚠️  Database not connected\n');
    }

    console.log('Commands:');
    console.log('  • generate <email>   - Generate emails for a lead');
    console.log('  • batch [limit]      - Generate emails for researched leads');
    console.log('  • pending            - Show leads pending email generation');
    console.log('  • preview <email>    - Preview generated emails');
    console.log('  • ready              - Show leads ready to send');
    console.log('  • exit               - Exit agent\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const prompt = () => {
        rl.question('📧 > ', async (input) => {
            const trimmed = input.trim();
            const [command, ...args] = trimmed.split(' ');

            if (!trimmed) { prompt(); return; }

            switch (command.toLowerCase()) {
                case 'exit':
                    console.log('\n👋 Goodbye!\n');
                    rl.close();
                    process.exit(0);

                case 'generate':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleGenerate(args[0]);
                    break;

                case 'batch':
                    await handleBatch(parseInt(args[0]) || 10);
                    break;

                case 'pending':
                    await handlePending();
                    break;

                case 'preview':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handlePreview(args[0]);
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

async function handleGenerate(email: string) {
    console.log('\n⏳ Generating emails...');
    const result = await agent.generateByEmail(email);
    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
        if (result.data?.sequence) {
            const seq = result.data.sequence;
            console.log(`━━━ EMAIL 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Subject: ${seq.email1.subject}\n${seq.email1.body}\n`);
            console.log(`━━━ EMAIL 2 (Reply) ━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`${seq.email2.body}\n`);
            console.log(`━━━ EMAIL 3 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Subject: ${seq.email3.subject}\n${seq.email3.body}\n`);
        }
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleBatch(limit: number) {
    console.log(`\n⏳ Batch generating (limit: ${limit})...\n`);
    const result = await agent.generateForPendingLeads(limit);
    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}\n`);
}

async function handlePending() {
    const leads = await leadsDb.findByStatus('researched', 20);
    if (leads.length === 0) { console.log('📭 No leads pending email generation\n'); return; }
    console.log(`\n📋 ${leads.length} leads ready for emails:\n`);
    for (const lead of leads) {
        console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name}`);
    }
    console.log('');
}

async function handlePreview(email: string) {
    const lead = await leadsDb.findByEmail(email);
    if (!lead) { console.log(`❌ No lead found: ${email}\n`); return; }
    if (!lead.email_1_body) { console.log('❌ No emails generated yet\n'); return; }
    console.log(`\n📬 Emails for ${lead.first_name} ${lead.last_name}\n`);
    console.log(`Subject: ${lead.email_1_subject}\n${lead.email_1_body}\n`);
    console.log(`Email 2: ${lead.email_2_body}\n`);
    console.log(`Subject: ${lead.email_3_subject}\n${lead.email_3_body}\n`);
}

async function handleReady() {
    const leads = await leadsDb.findByStatus('ready', 20);
    if (leads.length === 0) { console.log('📭 No leads ready to send\n'); return; }
    console.log(`\n📋 ${leads.length} leads ready:\n`);
    for (const lead of leads) {
        console.log(`   • ${lead.email} (${lead.timezone}) - ${lead.sender_email}`);
    }
    console.log('');
}

main().catch(console.error);