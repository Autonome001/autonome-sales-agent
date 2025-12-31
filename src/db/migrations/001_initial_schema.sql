-- Autonome Sales Agent Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Leads table (replaces Google Sheet)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identity
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  linkedin_url TEXT UNIQUE,
  
  -- Professional
  company_name TEXT,
  job_title TEXT,
  seniority TEXT,
  industry TEXT,
  website_url TEXT,
  
  -- Location
  city TEXT,
  state TEXT,
  country TEXT,
  timezone TEXT,
  
  -- State machine
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'scraped', 'researched', 'ready',
    'email_1_sent', 'email_2_sent', 'email_3_sent',
    'engaged', 'meeting_booked', 'converted',
    'opted_out', 'bounced', 'invalid'
  )),
  
  -- Research (stored as JSONB)
  research_data JSONB,
  research_completed_at TIMESTAMPTZ,
  
  -- Email content
  email_1_subject TEXT,
  email_1_body TEXT,
  email_2_body TEXT,
  email_3_subject TEXT,
  email_3_body TEXT,
  
  -- Sending
  sender_email TEXT,
  opt_out_token TEXT UNIQUE DEFAULT uuid_generate_v4()::text,
  gmail_thread_id TEXT,
  
  -- Timestamps
  email_1_sent_at TIMESTAMPTZ,
  email_2_sent_at TIMESTAMPTZ,
  email_3_sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  meeting_booked_at TIMESTAMPTZ,
  
  -- Metadata
  source TEXT DEFAULT 'apollo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events table for analytics
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled jobs table (for email sequences)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_linkedin ON leads(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_timezone ON leads(timezone);
CREATE INDEX IF NOT EXISTS idx_events_lead ON events(lead_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(scheduled_for) 
  WHERE status = 'pending';

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Row Level Security (optional - enable if needed)
-- ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;

-- Grant permissions (for service role)
GRANT ALL ON leads TO service_role;
GRANT ALL ON events TO service_role;
GRANT ALL ON scheduled_jobs TO service_role;

-- Comments
COMMENT ON TABLE leads IS 'Core leads table - replaces Google Sheets';
COMMENT ON TABLE events IS 'Event log for analytics and debugging';
COMMENT ON TABLE scheduled_jobs IS 'Job queue for scheduled email sending';
COMMENT ON COLUMN leads.status IS 'Lead state machine: new → scraped → researched → ready → email_*_sent → engaged/converted';
COMMENT ON COLUMN leads.opt_out_token IS 'Unique token for unsubscribe links';
