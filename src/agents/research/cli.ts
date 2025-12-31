#!/usr/bin/env node
import * as readline from 'readline';
import { ResearchAgent } from './index.js';
import { leadsDb, checkConnection } from '../../db/index.js';

const agent = new ResearchAgent();

async function main() {
    console.log('\n🔬 Autonome Research Agent');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const dbConnected = await checkConnection();
    if (dbConnected) {
        console.log('✅ Database connected\n');
    } else {
        console.log('⚠️  Database not connected (running in offline mode)\n');
    }

    console.log('Commands:');
    console.log('  • research <email>   - Research a specific lead by email');
    console.log('  • batch [limit]      - Research pending leads');
    console.log('  • pending            - Show leads pending research');
    console.log('  • summary <email>    - Show research summary');
    console.log('  • exit               - Exit agent\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const prompt = () => {
        rl.question('🔬 > ', async (input) => {
            const trimmed = input.trim();
            const [command, ...args] = trimmed.split(' ');

            if (!trimmed) {
                prompt();
                return;
            }

            switch (command.toLowerCase()) {
                case 'exit':
                    console.log('\n👋 Goodbye!\n');
                    rl.close();
                    process.exit(0);

                case 'research':
                    if (!args[0]) {
                        console.log('❌ Please provide a lead email\n');
                        break;
                    }
                    await handleResearch(args[0]);
                    break;

                case 'batch':
                    const limit = parseInt(args[0]) || 10;
                    await handleBatch(limit);
                    break;

                case 'pending':
                    await handlePending();
                    break;

                case 'summary':
                    if (!args[0]) {
                        console.log('❌ Please provide a lead email\n');
                        break;
                    }
                    await handleSummary(args[0]);
                    break;

                default:
                    console.log(`❌ Unknown command: ${command}`);
                    console.log('   Try: research, batch, pending, summary, exit\n');
            }

            prompt();
        });
    };

    prompt();
}

async function handleResearch(email: string) {
    console.log('\n⏳ Looking up lead...');

    const result = await agent.researchByEmail(email);

    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);

        if (result.data?.analysis) {
            const analysis = result.data.analysis;
            console.log('📊 Quick Summary:');
            console.log(`   Interests: ${analysis.interests.slice(0, 3).join(', ')}`);
            console.log(`   Top personalization: ${analysis.personalizationOpportunities[0]?.hook || 'N/A'}`);
            console.log(`   Top pain point: ${analysis.painPoints[0]?.pain || 'N/A'}\n`);
        }
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleBatch(limit: number) {
    console.log(`\n⏳ Starting batch research (limit: ${limit})...\n`);

    const result = await agent.researchPendingLeads(limit);

    console.log(`\n${result.success ? '✅' : '❌'} ${result.message}\n`);
}

async function handlePending() {
    console.log('\n⏳ Fetching pending leads...');

    const leads = await leadsDb.findByStatus('scraped', 20);

    if (leads.length === 0) {
        console.log('📭 No leads pending research\n');
        return;
    }

    console.log(`\n📋 ${leads.length} leads pending research:\n`);
    for (const lead of leads) {
        console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name} @ ${lead.company_name || 'Unknown'}`);
    }
    console.log('');
}

async function handleSummary(email: string) {
    console.log('\n⏳ Looking up lead...');

    const lead = await leadsDb.findByEmail(email);

    if (!lead) {
        console.log(`❌ No lead found with email: ${email}\n`);
        return;
    }

    const summary = await agent.getResearchSummary(lead.id);

    if (!summary) {
        console.log(`❌ No research data found for: ${email}`);
        console.log('   Run "research" first to generate insights.\n');
        return;
    }

    console.log(summary);
}

main().catch(console.error);