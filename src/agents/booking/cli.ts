#!/usr/bin/env node
import * as readline from 'readline';
import { BookingAgent } from './index.js';
import { leadsDb, checkConnection } from '../../db/index.js';

const agent = new BookingAgent();

async function main() {
    console.log('\n📅 Autonome Booking Agent');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const dbConnected = await checkConnection();
    if (dbConnected) {
        console.log('✅ Database connected\n');
    } else {
        console.log('⚠️  Database not connected\n');
    }

    console.log('Commands:');
    console.log('  • book <email> <datetime>  - Record a meeting booking');
    console.log('  • confirm <email>          - Generate confirmation email');
    console.log('  • remind <email>           - Generate reminder email');
    console.log('  • complete <email> <outcome> - Mark meeting complete/no_show/rescheduled');
    console.log('  • upcoming [days]          - Show upcoming meetings');
    console.log('  • scheduled                - Show all scheduled meetings');
    console.log('  • exit                     - Exit agent\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const prompt = () => {
        rl.question('📅 > ', async (input) => {
            const trimmed = input.trim();
            const [command, ...args] = trimmed.split(' ');

            if (!trimmed) { prompt(); return; }

            switch (command.toLowerCase()) {
                case 'exit':
                    console.log('\n👋 Goodbye!\n');
                    rl.close();
                    process.exit(0);

                case 'book':
                    if (!args[0] || !args[1]) {
                        console.log('❌ Usage: book <email> <datetime>');
                        console.log('   Example: book john@company.com 2025-01-15T10:00:00\n');
                        break;
                    }
                    await handleBook(args[0], args.slice(1).join(' '));
                    break;

                case 'confirm':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleConfirm(args[0]);
                    break;

                case 'remind':
                    if (!args[0]) { console.log('❌ Please provide a lead email\n'); break; }
                    await handleRemind(args[0]);
                    break;

                case 'complete':
                    if (!args[0] || !args[1]) {
                        console.log('❌ Usage: complete <email> <completed|no_show|rescheduled>\n');
                        break;
                    }
                    await handleComplete(args[0], args[1] as any);
                    break;

                case 'upcoming':
                    await handleUpcoming(parseInt(args[0]) || 7);
                    break;

                case 'scheduled':
                    await handleScheduled();
                    break;

                default:
                    console.log(`❌ Unknown command: ${command}\n`);
            }
            prompt();
        });
    };
    prompt();
}

async function handleBook(email: string, datetime: string) {
    console.log(`\n⏳ Recording booking for ${email}...`);

    // Parse datetime
    let scheduledAt: string;
    try {
        const date = new Date(datetime);
        if (isNaN(date.getTime())) throw new Error('Invalid date');
        scheduledAt = date.toISOString();
    } catch {
        console.log('❌ Invalid datetime format. Use: YYYY-MM-DDTHH:MM:SS\n');
        return;
    }

    const result = await agent.recordBookingByEmail(email, scheduledAt);

    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleConfirm(email: string) {
    const lead = await leadsDb.findByEmail(email);
    if (!lead) {
        console.log(`❌ No lead found: ${email}\n`);
        return;
    }

    const result = await agent.generateConfirmationEmail(lead.id);
    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleRemind(email: string) {
    const lead = await leadsDb.findByEmail(email);
    if (!lead) {
        console.log(`❌ No lead found: ${email}\n`);
        return;
    }

    const result = await agent.generateReminderEmail(lead.id, 24);
    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleComplete(email: string, outcome: 'completed' | 'no_show' | 'rescheduled') {
    const validOutcomes = ['completed', 'no_show', 'rescheduled'];
    if (!validOutcomes.includes(outcome)) {
        console.log('❌ Outcome must be: completed, no_show, or rescheduled\n');
        return;
    }

    const lead = await leadsDb.findByEmail(email);
    if (!lead) {
        console.log(`❌ No lead found: ${email}\n`);
        return;
    }

    const result = await agent.completeMeeting(lead.id, outcome);
    if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
    } else {
        console.log(`\n❌ ${result.message}\n`);
    }
}

async function handleUpcoming(days: number) {
    console.log(`\n⏳ Fetching meetings in next ${days} days...`);

    const meetings = await agent.getUpcomingMeetings(days);

    if (meetings.length === 0) {
        console.log('📭 No upcoming meetings\n');
        return;
    }

    console.log(`\n📅 ${meetings.length} upcoming meetings:\n`);
    for (const lead of meetings) {
        const date = new Date(lead.meeting_scheduled_at!);
        console.log(`   • ${date.toLocaleString()} - ${lead.first_name} ${lead.last_name} (${lead.email})`);
        console.log(`     ${lead.company_name || 'Unknown company'}`);
    }
    console.log('');
}

async function handleScheduled() {
    const leads = await leadsDb.findByStatus('meeting_booked', 50);

    if (leads.length === 0) {
        console.log('📭 No scheduled meetings\n');
        return;
    }

    console.log(`\n📅 ${leads.length} scheduled meetings:\n`);
    for (const lead of leads) {
        const date = lead.meeting_scheduled_at ? new Date(lead.meeting_scheduled_at).toLocaleString() : 'No date';
        console.log(`   • ${lead.email} - ${lead.first_name} ${lead.last_name}`);
        console.log(`     📆 ${date}`);
    }
    console.log('');
}

main().catch(console.error);