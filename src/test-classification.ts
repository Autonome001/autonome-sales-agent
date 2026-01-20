/**
 * Test Email Classification
 * 
 * Tests the Claude AI email classification without needing webhook setup
 * 
 * Usage: npx tsx src/test-classification.ts
 */

import { config } from 'dotenv';
import OpenAI from 'openai';

config();

interface EmailReplyClassification {
    category: 'interested' | 'not_interested' | 'out_of_office' | 'question' | 'neutral';
    confidence: number;
    reason: string;
    suggestedAction: string;
    sentiment: 'positive' | 'negative' | 'neutral';
}

async function classifyEmailReply(
    emailBody: string,
    emailSubject: string,
    fromEmail: string
): Promise<EmailReplyClassification> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
        throw new Error('OPENAI_API_KEY not configured');
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    const prompt = `You are an expert email reply classifier for a B2B sales automation system.

Analyze this email reply and classify it into one of these categories:

1. **interested** - Lead wants to book a meeting, learn more, or engage further
2. **not_interested** - Lead explicitly declines, says no, or asks to stop contact
3. **out_of_office** - Automated out-of-office reply
4. **question** - Lead has questions that need human response
5. **neutral** - Acknowledgment or unclear intent

Email Details:
From: ${fromEmail}
Subject: ${emailSubject}
Body: ${emailBody}

Provide your classification in JSON format:
{
  "category": "interested|not_interested|out_of_office|question|neutral",
  "confidence": 0.95,
  "reason": "Brief explanation of why you classified it this way",
  "suggestedAction": "What the sales team should do next",
  "sentiment": "positive|negative|neutral"
}

Be conservative - if you're not sure, classify as "question" so a human can review.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
    });

    const text = response.choices[0].message.content || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        return JSON.parse(text);
    }

    return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// Test Cases
// ============================================================================

const testCases = [
    {
        name: 'Interested - Wants Meeting',
        from: 'john@example.com',
        subject: 'Re: Quick question about your operations',
        body: "Hey! This sounds interesting. I'd love to learn more. Can we schedule a call this week?",
    },
    {
        name: 'Not Interested - Hard No',
        from: 'sarah@example.com',
        subject: 'Re: Quick question about your operations',
        body: 'Thanks but not interested at this time. Please remove me from your list.',
    },
    {
        name: 'Out of Office',
        from: 'mike@example.com',
        subject: 'Re: Quick question about your operations',
        body: 'I am currently out of the office until January 15th. I will respond to your email when I return.',
    },
    {
        name: 'Question - Needs Clarification',
        from: 'lisa@example.com',
        subject: 'Re: Quick question about your operations',
        body: 'Interesting. How much does this cost? And what kind of integrations do you support?',
    },
    {
        name: 'Neutral - Acknowledgment',
        from: 'david@example.com',
        subject: 'Re: Quick question about your operations',
        body: 'Thanks for reaching out. Let me think about it.',
    },
];

runTests().catch(console.error);

async function runTests(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║        🧪 EMAIL CLASSIFICATION TEST SUITE                     ║
╚═══════════════════════════════════════════════════════════════╝
`);

    for (const testCase of testCases) {
        console.log(`\n📧 Test Case: ${testCase.name}`);
        console.log(`   From: ${testCase.from}`);
        console.log(`   Body: "${testCase.body.substring(0, 60)}..."`);

        try {
            const result = await classifyEmailReply(
                testCase.body,
                testCase.subject,
                testCase.from
            );

            const emoji = {
                interested: '🎉',
                not_interested: '❌',
                out_of_office: '📧',
                question: '❓',
                neutral: '🤔',
            }[result.category];

            console.log(`\n   ${emoji} Classification: ${result.category.toUpperCase()}`);
            console.log(`   📊 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
            console.log(`   💭 Reason: ${result.reason}`);
            console.log(`   🎯 Suggested Action: ${result.suggestedAction}`);
            console.log(`   😊 Sentiment: ${result.sentiment}`);
            console.log('   ✅ PASS');

        } catch (error) {
            console.error(`   ❌ FAIL: ${error}`);
        }
    }

    console.log(`
\n╔═══════════════════════════════════════════════════════════════╗
║        ✅ TEST SUITE COMPLETE                                 ║
╚═══════════════════════════════════════════════════════════════╝
`);
}