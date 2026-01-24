import type { Request, Response } from 'express';
import { leadsDb } from '../db/index.js';
import { tavusService } from '../services/tavus.js';
import { logger, logSuccess } from '../utils/logger.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send Slack notification when Tavus is unavailable
 */
async function notifyTavusUnavailable(
    leadName: string,
    leadEmail: string,
    reason: string
): Promise<void> {
    if (!SLACK_WEBHOOK_URL) {
        logger.warn('Slack webhook not configured, cannot notify about Tavus unavailability');
        return;
    }

    const message = {
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '⚠️ AI Consulting Agent Unavailable',
                    emoji: true,
                },
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Lead:*\n${leadName}` },
                    { type: 'mrkdwn', text: `*Email:*\n${leadEmail}` },
                ],
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Reason:*\n${reason}\n\n*Action Required:* The meeting has been booked, but no personalized AI video was generated. Consider reaching out manually before the call.`,
                },
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `📅 ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
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
            logSuccess('Slack notification sent about Tavus unavailability');
        } else {
            logger.error('Failed to send Slack notification', { metadata: { body: await response.text() } });
        }
    } catch (error) {
        logger.error('Error sending Slack notification', { metadata: error });
    }
}

/**
 * Handle Google Calendar Webhook
 * Trigger: calendar.events.created or appointment scheduled
 * 
 * Google Calendar webhook payloads vary based on setup:
 * - Google Calendar Push Notifications (Pub/Sub)
 * - Google Calendar API subscriptions
 * - Google Appointment Scheduling webhooks
 */
export async function handleGoogleCalendarWebhook(req: Request, res: Response) {
    logger.info('Google Calendar webhook received');

    try {
        const event = req.body;

        // Handle different Google Calendar event structures
        // Google Calendar push notification sync token
        if (event['X-Goog-Channel-Token'] || event['X-Goog-Resource-State']) {
            logger.info('Received Google Calendar push notification', { metadata: { state: event['X-Goog-Resource-State'] } });
            // This is a sync notification, acknowledge it
            if (event['X-Goog-Resource-State'] === 'sync') {
                return res.status(200).send('Sync acknowledged');
            }
        }

        // Try to extract attendee info from various Google Calendar formats
        let email: string | undefined;
        let name: string | undefined;
        let eventTitle: string | undefined;

        // Google Appointment Scheduling format
        if (event.attendees && Array.isArray(event.attendees)) {
            const externalAttendee = event.attendees.find((a: any) => !a.organizer && !a.self);
            if (externalAttendee) {
                email = externalAttendee.email;
                name = externalAttendee.displayName || externalAttendee.email.split('@')[0];
            }
        }

        // Alternative: wrapped in resource object
        if (!email && event.resource?.attendees) {
            const externalAttendee = event.resource.attendees.find((a: any) => !a.organizer && !a.self);
            if (externalAttendee) {
                email = externalAttendee.email;
                name = externalAttendee.displayName || externalAttendee.email.split('@')[0];
            }
        }

        // Alternative: email passed directly in payload
        if (!email && event.email) {
            email = event.email;
            name = event.name || event.email.split('@')[0];
        }

        // Get event title/summary
        eventTitle = event.summary || event.resource?.summary || 'Consultation Call';

        if (!email) {
            logger.warn('No attendee email found in webhook payload', { metadata: event });
            return res.status(200).send('No attendee email found');
        }

        logger.info(`Google Calendar attendee: ${name} (${email})`, { metadata: { eventTitle } });

        // 1. Find or acknowledge lead
        let lead = await leadsDb.findByEmail(email);
        let firstName = name?.split(' ')[0] || 'there';
        let companyName = 'your company';

        if (lead) {
            firstName = lead.first_name || firstName;
            companyName = lead.company_name || companyName;
            logger.info(`Found lead in database: ${lead.first_name} ${lead.last_name}`);
        } else {
            logger.info('Lead not in database (new booking from website)');
        }

        // 2. Attempt Tavus Video Generation with graceful fallback
        const REPLICA_ID = process.env.TAVUS_REPLICA_ID;
        const TAVUS_API_KEY = process.env.TAVUS_API_KEY;

        if (!REPLICA_ID || !TAVUS_API_KEY) {
            logger.warn('Tavus not configured (missing REPLICA_ID or API_KEY)');
            await notifyTavusUnavailable(
                name || 'Unknown',
                email,
                'Tavus credentials not configured'
            );
            return res.status(200).json({
                success: true,
                message: 'Booking processed, Tavus not configured',
                tavusVideo: false
            });
        }

        try {
            logger.info('🎥 Triggering Tavus video generation...');
            const video = await tavusService.generateVideo({
                replicaId: REPLICA_ID,
                script: `Hi ${firstName}, looking forward to our call about helping ${companyName} with automation and AI. See you soon!`,
                videoName: `pre-call-${lead?.id || Date.now()}`,
                variables: {
                    name: firstName,
                    company: companyName
                }
            });

            logSuccess(`Video queued: ${video.video_id}`);

            // Update lead with video info if we have one
            if (lead) {
                await leadsDb.update(lead.id, {
                    meeting_booked_at: new Date().toISOString(),
                    meeting_scheduled_at: new Date().toISOString(),
                    // Store video ID if you have a column for it
                });
            }

            res.status(200).json({
                success: true,
                videoId: video.video_id,
                tavusVideo: true
            });

        } catch (tavusError) {
            // Graceful fallback: booking still successful, just no video
            const errorMessage = tavusError instanceof Error ? tavusError.message : String(tavusError);
            logger.error('Tavus video generation failed', { metadata: tavusError });

            // Notify via Slack that AI agent is unavailable
            await notifyTavusUnavailable(
                name || 'Unknown',
                email,
                `Tavus API error: ${errorMessage}`
            );

            // Still return success - the meeting is booked, just no video
            res.status(200).json({
                success: true,
                message: 'Booking processed, video generation failed',
                tavusVideo: false,
                error: errorMessage
            });
        }

    } catch (error) {
        logger.error('Google Calendar webhook failed', { metadata: error });
        res.status(500).send(error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Legacy Calendly webhook handler (keeping for backwards compatibility)
 * @deprecated Use handleGoogleCalendarWebhook instead
 */
export async function handleCalendlyWebhook(req: Request, res: Response) {
    logger.info('Calendly webhook received (legacy)');
    logger.warn('Consider switching to Google Calendar webhook');

    const event = req.body;
    if (event.event !== 'invitee.created') {
        return res.status(200).send('Ignored event type');
    }

    const payload = event.payload;
    const email = payload.email;
    const name = payload.name;

    // Forward to new handler with normalized structure
    req.body = {
        email,
        name,
        summary: 'Consultation Call (via Calendly)'
    };

    return handleGoogleCalendarWebhook(req, res);
}
