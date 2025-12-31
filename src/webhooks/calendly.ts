import type { Request, Response } from 'express';
import { leadsDb } from '../db/index.js';
import { tavusService } from '../services/tavus.js';

/**
 * Handle Calendly Webhook
 * Trigger: invitee.created
 */
export async function handleCalendlyWebhook(req: Request, res: Response) {
    console.log('📅 Calendly webhook received');

    // 1. Validate (simulated, ideally check signature)
    const event = req.body;
    if (event.event !== 'invitee.created') {
        return res.status(200).send('Ignored event type');
    }

    const payload = event.payload;
    const email = payload.email;
    const name = payload.name; // "First Last"

    console.log(`   👤 Invitee: ${name} (${email})`);

    try {
        // 2. Find or Create Lead
        let lead = await leadsDb.findByEmail(email);
        if (!lead) {
            console.log('   ⚠️ Lead not in DB, skipping video gen for now (or create new)');
            // Create logic could go here
            return res.status(200).send('Lead not found');
        }

        // 3. Trigger Tavus Video Generation
        // Only if we want to send a pre-meeting video
        const REPLICA_ID = process.env.TAVUS_REPLICA_ID;
        if (!REPLICA_ID) {
            console.warn('   ⚠️ TAVUS_REPLICA_ID not configured');
            return res.status(200).send('Tavus not configured');
        }

        const firstName = lead.first_name || name.split(' ')[0];

        console.log('   🎥 Triggering Tavus video generation...');
        const video = await tavusService.generateVideo({
            replicaId: REPLICA_ID,
            script: `Hi ${firstName}, looking forward to our call about helping ${lead.company_name || 'your company'} automate sales. See you soon!`,
            videoName: `pre-call-${lead.id}`,
            variables: {
                name: firstName,
                company: lead.company_name || 'your company'
            }
        });

        // 4. Store Video Pending Status
        await leadsDb.update(lead.id, {
            // we might need a metadata field or new column
            // for now just log it
        });

        console.log(`   ✅ Video queued: ${video.video_id}`);

        res.status(200).json({ success: true, videoId: video.video_id });

    } catch (error) {
        console.error('❌ Calendly webhook failed:', error);
        res.status(500).send(error instanceof Error ? error.message : 'Unknown error');
    }
}
