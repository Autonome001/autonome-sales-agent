/**
 * Slack Webhook Test Script
 * 
 * Tests the Slack webhook connection and sends a test notification
 * 
 * Usage: npx tsx src/test-slack.ts
 */

import { config } from 'dotenv';

config();

async function testSlackWebhook(): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
        console.error('❌ SLACK_WEBHOOK_URL not found in .env file');
        process.exit(1);
    }

    console.log('🔔 Testing Slack webhook...\n');
    console.log(`Webhook URL: ${webhookUrl.substring(0, 50)}...`);

    const testMessage = {
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '🚀 Autonome Sales Agent - Connection Test',
                    emoji: true,
                },
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '*Slack integration is now active!*\n\nYou\'ll receive notifications here when:\n• Leads reply with interest\n• Questions need your attention\n• Daily pipeline summaries',
                },
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `Test sent at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
                    },
                ],
            },
        ],
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testMessage),
        });

        if (response.ok) {
            console.log('✅ Success! Check your Slack channel for the test message.');
            console.log('\n📊 Slack integration is ready for:');
            console.log('   • Pipeline run notifications');
            console.log('   • Interested lead alerts');
            console.log('   • Email reply classifications');
            console.log('   • Daily activity summaries');
        } else {
            const errorText = await response.text();
            console.error('❌ Failed to send message');
            console.error(`Status: ${response.status}`);
            console.error(`Error: ${errorText}`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error sending Slack message:');
        console.error(error);
        process.exit(1);
    }
}

testSlackWebhook();