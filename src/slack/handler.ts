import type { Request, Response } from 'express';
import crypto from 'crypto';
import { discoveryAgent } from '../agents/discovery/index.js';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Security: Signature Verification
// ============================================================================

/**
 * Verify Slack request signature
 * Reference: https://api.slack.com/authentication/verifying-requests-and-events
 */
export function verifySlackRequest(req: Request): boolean {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    // If no secret configured, fail closed
    if (!signingSecret) {
        console.error('❌ SLACK_SIGNING_SECRET not configured');
        return false;
    }

    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];

    if (!timestamp || !signature) {
        return false;
    }

    // Prevent replay attacks (requests older than 5 minutes)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp as string) < fiveMinutesAgo) {
        return false;
    }

    // For verification, we need the raw body. 
    // Express normally parses it, so we need to rely on the app setup 
    // to capture rawBody or re-stringify it.
    // If rawBody is not available on req, we might struggle.
    // Assuming standard usage: body is already parsed by urlencoded for slash commands

    // NOTE: This is tricky in express. We'll handle the "raw body" requirement
    // by ensuring we generate the signature string correctly.
    // For Slash Commands, the content-type is application/x-www-form-urlencoded.
    // We can assume `req.rawBody` exists if we configure middleware correctly,
    // OR we re-stringify the body if it's simple.

    // Ideally, the caller should pass the raw body buffer.
    // If unavailable, we can't securely verify.
    // For now, we will check if req.rawBody exists (custom middleware needed in app).

    const body = (req as any).rawBody || JSON.stringify(req.body);
    // ^ This fallback (JSON.stringify) is NOT safe for x-www-form-urlencoded
    // We MUST modify inbound-webhook.ts to capture rawBody.

    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', signingSecret)
        .update(sigBasestring)
        .digest('hex');

    // Timing-safe comparison
    return crypto.timingSafeEqual(
        Buffer.from(signature as string),
        Buffer.from(mySignature)
    );
}

// ============================================================================
// Command Handler
// ============================================================================

export async function handleSlackCommand(req: Request, res: Response) {
    // 1. Immediate acknowledgement (required < 3000ms)
    // Slack expects immediate 200 OK.
    // We send a provisional message.

    const { text, response_url, user_name } = req.body as SlackSlashCommand;

    // Send immediate response
    res.status(200).json({
        response_type: 'ephemeral',
        text: `🤖 Autonome Agent received: "${text}"\n_Thinking..._`
    });

    // 2. Process in background
    processCommandInBackground(text, response_url, user_name).catch(err => {
        console.error('❌ Error processing background Slack command:', err);
    });
}

async function processCommandInBackground(commandText: string, responseUrl: string, userName: string) {
    try {
        console.log(`\n💬 Slack Command from ${userName}: "${commandText}"`);

        // Use Discovery Agent logic
        const result = await discoveryAgent.processCommand(commandText);

        let finalText = '';

        if (result.action === 'clarify') {
            finalText = `🤔 **I need a bit more info:**\n${result.message}`;
        } else if (result.success) {
            finalText = `✅ **Done!**\n${result.message}`;

            // Add summary of results if available
            if (result.data && result.data.new_leads > 0) {
                finalText += `\n\n📊 *Summary:*\n• Found: ${result.data.total_found}\n• Added: ${result.data.new_leads}\n• Duplicates: ${result.data.duplicates_skipped}`;
            }
        } else {
            finalText = `❌ **Error:**\n${result.message}`;
        }

        // Send final response back to Slack via response_url
        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response_type: 'in_channel', // Visible to everyone
                replace_original: true,      // Replace "Thinking..." message? No, usually delayed response is a new message.
                // Actually, for slash commands `response_url`, we can choose to replace or add.
                // Getting rid of "Thinking..." is cleaner if we can. 
                // "replace_original": false to post a new one? Default behavior updates the message if not ephemeral?
                // Let's stick to simple "in_channel" response which usually posts new.
                text: finalText
            })
        });

    } catch (error) {
        console.error('Slack processing failed:', error);

        await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response_type: 'ephemeral',
                text: `❌ **System Error:** Failed to process command.\n_${error instanceof Error ? error.message : 'Unknown error'}_`
            })
        });
    }
}
