-- Migration: Add missing fields for booking, response, and message tracking
-- Run this via Supabase SQL Editor

-- Add booking-related fields
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS meeting_scheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS meeting_link TEXT,
ADD COLUMN IF NOT EXISTS meeting_outcome TEXT;

-- Add response tracking fields
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS reply_category TEXT,
ADD COLUMN IF NOT EXISTS reply_sentiment TEXT;

-- Add message ID tracking for email threads
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS email_1_message_id TEXT,
ADD COLUMN IF NOT EXISTS email_2_message_id TEXT,
ADD COLUMN IF NOT EXISTS email_3_message_id TEXT;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_meeting_scheduled ON leads(meeting_scheduled_at) WHERE meeting_scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_reply_category ON leads(reply_category) WHERE reply_category IS NOT NULL;

-- Comments
COMMENT ON COLUMN leads.meeting_scheduled_at IS 'Timestamp when meeting was scheduled';
COMMENT ON COLUMN leads.meeting_link IS 'Calendar link or meeting URL';
COMMENT ON COLUMN leads.meeting_outcome IS 'Outcome of the meeting (showed_up, no_show, rescheduled, etc)';
COMMENT ON COLUMN leads.reply_category IS 'Category of reply received (interested, not_interested, question, etc)';
COMMENT ON COLUMN leads.reply_sentiment IS 'Sentiment analysis of reply (positive, negative, neutral)';
COMMENT ON COLUMN leads.email_1_message_id IS 'Resend message ID for Email 1';
COMMENT ON COLUMN leads.email_2_message_id IS 'Resend message ID for Email 2';
COMMENT ON COLUMN leads.email_3_message_id IS 'Resend message ID for Email 3';
