/**
 * Autonome Sales Agent - Inbound Email Webhook Handler
 * 
 * Receives incoming email replies, classifies them with Claude AI,
 * and sends Slack notifications for actions needed.
 * 
 * Usage:
 *   npm run inbound:server  - Start webhook server
 *   npm run inbound:test    - Test classification with sample email
 */

import express from 'express';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { logger, logSuccess } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

config();

const app = express();

// Custom middleware to capture raw body for Slack signature verification
const rawBodySaver = (req: any, res: any, buf: Buffer, encoding: string) => {
    if (buf && buf.length) {
        req.rawBody = buf;
    }
};

app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, verify: rawBodySaver }));

import { handleSlackCommand, handleSlackEvent, verifySlackRequest } from './slack/handler.js';
import { handleGoogleCalendarWebhook, handleCalendlyWebhook } from './webhooks/calendly.js';

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.INBOUND_PORT || 3000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

interface EmailReplyClassification {
    category: 'interested' | 'not_interested' | 'out_of_office' | 'question' | 'neutral';
    confidence: number; // 0-1
    reason: string;
    suggestedAction: string;
    sentiment: 'positive' | 'negative' | 'neutral';
}

// ============================================================================
// Slack Notifications
// ============================================================================

async function sendSlackNotification(
    type: 'interested' | 'question' | 'not_interested' | 'ooo' | 'neutral',
    leadEmail: string,
    leadName: string,
    replyText: string,
    classification: EmailReplyClassification
): Promise<void> {
    if (!SLACK_WEBHOOK_URL) {
        logger.warn('Slack webhook not configured, skipping notification');
        return;
    }

    const emojiMap = {
        interested: '🎉',
        question: '❓',
        not_interested: '❌',
        ooo: '📧',
        neutral: '🤔',
    };

    const colorMap = {
        interested: '#36a64f', // green
        question: '#ff9900',   // orange
        not_interested: '#ff0000', // red
        ooo: '#808080',        // gray
        neutral: '#0099ff',    // blue
    };

    const priorityMap = {
        interested: 'HIGH PRIORITY - Action Required',
        question: 'Action Required',
        not_interested: 'FYI Only',
        ooo: 'FYI Only',
        neutral: 'FYI Only',
    };

    // Only send notifications for interested and question (action needed)
    const shouldNotify = type === 'interested' || type === 'question';

    if (!shouldNotify) {
        logger.info(`Not sending Slack notification for ${type} (FYI only)`);
        return;
    }

    const message = {
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emojiMap[type]} New Reply: ${classification.category.toUpperCase()}`,
                    emoji: true,
                },
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Lead:*\n${leadName}`,
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Email:*\n${leadEmail}`,
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Priority:*\n${priorityMap[type]}`,
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Confidence:*\n${(classification.confidence * 100).toFixed(0)}%`,
                    },
                ],
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Reply Preview:*\n>${replyText.substring(0, 200)}${replyText.length > 200 ? '...' : ''}`,
                },
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*AI Analysis:*\n${classification.reason}`,
                },
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Suggested Action:*\n${classification.suggestedAction}`,
                },
            },
            {
                type: 'divider',
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `Received at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
                    },
                ],
            },
        ],
    };

    try {
        const response = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
        });

        if (response.ok) {
            logSuccess('Slack notification sent successfully');
        } else {
            logger.error('Failed to send Slack notification', { metadata: { status: response.status, body: await response.text() } });
        }
    } catch (error) {
        logger.error('Error sending Slack notification', { metadata: error });
    }
}

// ============================================================================
// Email Classification with Claude AI
// ============================================================================

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
        // Fallback if no JSON found (rare with json_object mode but safe to handle)
        return JSON.parse(text);
    }

    return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// Database Operations
// ============================================================================

async function updateLeadWithReply(
    email: string,
    classification: EmailReplyClassification,
    replyText: string
): Promise<void> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find the lead
    const { data: lead, error: findError } = await supabase
        .from('leads')
        .select('*')
        .eq('email', email)
        .single();

    if (findError || !lead) {
        logger.error(`Lead not found for reply: ${email}`);
        return;
    }

    // Update status based on classification
    let newStatus = lead.status;
    if (classification.category === 'interested') {
        newStatus = 'engaged';
    } else if (classification.category === 'not_interested') {
        newStatus = 'unsubscribed';
    } else if (classification.category === 'out_of_office') {
        // Keep current status, just note the OOO
        newStatus = lead.status;
    }

    // Update lead
    const { error: updateError } = await supabase
        .from('leads')
        .update({
            status: newStatus,
            last_reply_at: new Date().toISOString(),
            reply_category: classification.category,
            reply_sentiment: classification.sentiment,
            updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

    if (updateError) {
        logger.error('Failed to update lead with reply', { metadata: updateError });
        return;
    }

    logSuccess(`Lead updated: ${email} → ${newStatus} (${classification.category})`);
}

// ============================================================================
// Slack Command Endpoint
// ============================================================================

// Middleware to verify Slack requests
const verifySlackMiddleware = (req: any, res: any, next: any) => {
    if (process.env.NODE_ENV === 'production' || process.env.SLACK_SIGNING_SECRET) {
        if (!verifySlackRequest(req)) {
            logger.error('Slack signature verification failed');
            return res.status(401).send('Unauthorized');
        }
    } else {
        logger.warn('Running without Slack signature verification (Dev / No Secret)');
    }
    next();
};

// Slash command endpoint
app.post('/slack/command', verifySlackMiddleware, handleSlackCommand);

// Events endpoint (for thread replies / continuous conversation)
app.post('/slack/events', verifySlackMiddleware, handleSlackEvent);

// ============================================================================
// Calendar Booking Webhooks (Tavus Video Generation)
// ============================================================================

// Google Calendar webhook (primary)
app.post('/webhook/google-calendar', handleGoogleCalendarWebhook);

// Legacy Calendly webhook (backwards compatibility)
app.post('/webhook/calendly', handleCalendlyWebhook);


// ============================================================================
// Webhook Endpoint
// ============================================================================

app.post('/webhook/inbound-email', async (req, res) => {
    logger.info('Received inbound email webhook');

    try {
        // Resend webhook format
        const { from, subject, text, html } = req.body;

        if (!from || !text) {
            logger.error('Invalid webhook payload: missing from/text');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        logger.info(`Processing reply from: ${from}`, { metadata: { subject } });

        // Extract email address from "Name <email@domain.com>" format
        const emailMatch = from.match(/<([^>]+)>/) || [null, from];
        const fromEmail = emailMatch[1];

        // Classify the reply
        logger.info('Classifying reply with Claude AI...');
        const classification = await classifyEmailReply(text, subject, fromEmail);

        logger.info(`Classification result: ${classification.category}`, { metadata: classification });

        // Update database
        logger.info('Updating lead in database...');
        await updateLeadWithReply(fromEmail, classification, text);

        // Send Slack notification if action needed
        logger.info('Sending Slack notification for classification...', { metadata: { category: classification.category } });
        await sendSlackNotification(
            classification.category as any,
            fromEmail,
            from,
            text,
            classification
        );

        res.json({
            success: true,
            classification: classification.category,
            confidence: classification.confidence
        });

    } catch (error) {
        logger.error('Error processing webhook', { metadata: error });
        metrics.increment('errorsCaught');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'autonome-inbound-webhook',
        uptime: metrics.getSummary().uptimeSeconds,
        metrics: metrics.getSummary()
    });
});

// ============================================================================
// Server Start
// ============================================================================

// Start server when this file is run directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
    app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     📨 AUTONOME INBOUND EMAIL WEBHOOK SERVER                  ║
╚═══════════════════════════════════════════════════════════════╝

Server running on port ${PORT}

Endpoints:
  Slack Command:      http://localhost:${PORT}/slack/command
  Slack Events:       http://localhost:${PORT}/slack/events
  Google Calendar:    http://localhost:${PORT}/webhook/google-calendar
  Inbound Email:      http://localhost:${PORT}/webhook/inbound-email
  Health Check:       http://localhost:${PORT}/health

Ready for Slack conversations, calendar bookings, and inbound emails...
`);
    });
}

export { app, classifyEmailReply };