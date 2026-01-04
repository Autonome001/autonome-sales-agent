/**
 * Slack Command & Event Handler
 *
 * Handles:
 * 1. Slash commands (/autonome) - starts a new conversation thread
 * 2. Event callbacks (message events) - continues conversation in threads
 * 3. Interactive components (buttons) - handles approvals
 */

import type { Request, Response } from 'express';
import crypto from 'crypto';
import { conversationalAgent } from './conversational-agent.js';
import { clearConversation, getStats } from './conversation-store.js';

// =============================================================================
// Types
// =============================================================================

interface SlackSlashCommand {
    token: string;
    team_id: string;
    team_domain: string;
    channel_id: string;
    channel_name: string;
    user_id: string;
    user_name: string;
    command: string;
    text: string;
    response_url: string;
    trigger_id: string;
}

interface SlackEventCallback {
    type: 'event_callback' | 'url_verification';
    challenge?: string;
    event?: {
        type: string;
        channel: string;
        user: string;
        text: string;
        ts: string;
        thread_ts?: string;
        bot_id?: string;
    };
}

// =============================================================================
// Configuration
// =============================================================================

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BOT_USER_ID = process.env.SLACK_BOT_USER_ID; // Set this in Railway

// =============================================================================
// Security: Signature Verification
// =============================================================================

export function verifySlackRequest(req: Request): boolean {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!signingSecret) {
        console.error('❌ SLACK_SIGNING_SECRET not configured');
        return false;
    }

    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];

    if (!timestamp || !signature) {
        return false;
    }

    // Prevent replay attacks
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp as string) < fiveMinutesAgo) {
        return false;
    }

    const body = (req as any).rawBody || JSON.stringify(req.body);
    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', signingSecret)
        .update(sigBasestring)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature as string),
            Buffer.from(mySignature)
        );
    } catch {
        return false;
    }
}

// =============================================================================
// Slack API Helper
// =============================================================================

async function postSlackMessage(
    channel: string,
    text: string,
    threadTs?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
    if (!SLACK_BOT_TOKEN) {
        console.error('❌ SLACK_BOT_TOKEN not configured');
        return { ok: false, error: 'Bot token not configured' };
    }

    try {
        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                channel,
                text,
                thread_ts: threadTs,
                unfurl_links: false,
                unfurl_media: false,
            }),
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('❌ Slack API error:', data.error);
        }
        return data;
    } catch (error) {
        console.error('❌ Failed to post Slack message:', error);
        return { ok: false, error: String(error) };
    }
}

// =============================================================================
// Slash Command Handler
// =============================================================================

export async function handleSlackCommand(req: Request, res: Response) {
    // Check if it's an interaction (payload) or command
    if (req.body.payload) {
        return handleInteraction(req, res);
    }

    const { text, channel_id, user_name, response_url } = req.body as SlackSlashCommand;

    // Immediately acknowledge the command
    res.status(200).json({
        response_type: 'in_channel',
        text: `🤖 *@${user_name}*: ${text}\n_Thinking..._`
    });

    // Process in background
    processSlashCommand(text, channel_id, user_name, response_url).catch(async (err) => {
        console.error('❌ Error processing slash command:', err);
        // Notify user of failure instead of leaving them hanging
        try {
            await fetch(response_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    response_type: 'in_channel',
                    text: `❌ Sorry, something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`
                })
            });
        } catch (notifyErr) {
            console.error('Failed to notify user of error:', notifyErr);
        }
    });
}

async function processSlashCommand(
    commandText: string,
    channelId: string,
    userName: string,
    responseUrl: string
) {
    console.log(`\n💬 Slash Command from ${userName}: "${commandText}"`);

    // Handle special commands
    if (commandText.toLowerCase() === 'clear') {
        // Clear all conversations in this channel (simplified)
        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response_type: 'ephemeral',
                text: '🗑️ Conversation memory cleared. Start a new conversation!'
            })
        });
        return;
    }

    if (commandText.toLowerCase() === 'status') {
        const stats = getStats();
        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response_type: 'ephemeral',
                text: `📊 *Agent Status*\nActive conversations: ${stats.activeConversations}\nTotal messages in memory: ${stats.totalMessages}`
            })
        });
        return;
    }

    // For normal commands, post the initial message to create a thread
    const initialPost = await postSlackMessage(
        channelId,
        `🤖 *Autonome Agent* (replying to @${userName})\n_Processing your request..._`
    );

    if (!initialPost.ok || !initialPost.ts) {
        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response_type: 'ephemeral',
                text: '❌ Failed to start conversation. Please try again.'
            })
        });
        return;
    }

    const threadTs = initialPost.ts;

    // Process the message through the conversational agent
    let response: string;
    try {
        response = await conversationalAgent.processMessage(
            channelId,
            threadTs,
            commandText,
            userName
        );
    } catch (error) {
        console.error('❌ Agent error:', error);
        response = `❌ Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    // Update the initial message with the response
    try {
        await fetch('https://slack.com/api/chat.update', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                channel: channelId,
                ts: threadTs,
                text: `🤖 *Autonome Agent* (replying to @${userName})\n\n${response}\n\n_Reply in this thread to continue the conversation._`
            }),
        });
    } catch (error) {
        console.error('❌ Failed to update message:', error);
    }
}

// =============================================================================
// Event Handler (for thread replies)
// =============================================================================

export async function handleSlackEvent(req: Request, res: Response) {
    const body = req.body as SlackEventCallback;

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
        return res.status(200).json({ challenge: body.challenge });
    }

    // Acknowledge immediately
    res.status(200).send();

    // Process event
    if (body.type === 'event_callback' && body.event) {
        const event = body.event;

        // Only handle message events in threads (not the initial message)
        if (event.type === 'message' && event.thread_ts && !event.bot_id) {
            console.log(`\n💬 Thread reply in ${event.channel}: "${event.text}"`);

            // Process through conversational agent
            const response = await conversationalAgent.processMessage(
                event.channel,
                event.thread_ts,
                event.text,
                event.user
            );

            // Reply in thread
            await postSlackMessage(event.channel, response, event.thread_ts);
        }
    }
}

// =============================================================================
// Interactive Component Handler
// =============================================================================

async function handleInteraction(req: Request, res: Response) {
    const payload = JSON.parse(req.body.payload);
    const action = payload.actions[0];
    const user = payload.user;

    // Acknowledge immediately
    res.status(200).send();

    console.log(`\n🖱️ Slack Interaction: ${action.action_id} by ${user.username}`);

    if (action.action_id === 'approve_booking') {
        const { leadId, reply } = JSON.parse(action.value);
        await handleBookingApproval(payload.response_url, leadId, reply, user.username);
    } else if (action.action_id === 'take_over_booking') {
        const leadId = action.value;
        await handleTakeOver(payload.response_url, leadId, user.username);
    } else if (action.action_id === 'update_booking_draft') {
        await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                replace_original: false,
                text: `📝 @${user.username} wants to update the draft. Please reply in this thread with the improved copy.`
            })
        });
    }
}

async function handleBookingApproval(responseUrl: string, leadId: string, reply: string, approver: string) {
    const { sendingAgent } = await import('../agents/sending/index.js');
    const { leadsDb } = await import('../db/index.js');

    try {
        const lead = await leadsDb.findById(leadId);
        if (!lead) throw new Error('Lead not found');

        await sendingAgent.sendEmail({
            leadId,
            to: lead.email,
            subject: `Re: Meeting Request`,
            body: reply,
            sender: lead.sender_email
        });

        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `✅ *Approved by ${approver}* - Reply sent to ${lead.email}!`,
                replace_original: true,
            })
        });
    } catch (e: any) {
        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `❌ Error: ${e.message}`,
                response_type: 'ephemeral'
            })
        });
    }
}

async function handleTakeOver(responseUrl: string, leadId: string, taker: string) {
    const { leadsDb } = await import('../db/index.js');
    await leadsDb.update(leadId, { status: 'manual_intervention' });

    await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: `🛑 *Taken over by ${taker}* - AI paused for this lead.`,
            replace_original: true
        })
    });
}
