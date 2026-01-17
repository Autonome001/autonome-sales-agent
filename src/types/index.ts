import { z } from 'zod';

// Lead status state machine
export const LeadStatus = z.enum([
  'new',
  'scraped',
  'researched',
  'ready',
  'email_1_sent',
  'email_2_sent',
  'email_3_sent',
  'engaged',
  'meeting_booked',
  'converted',
  'opted_out',
  'bounced',
  'invalid',
]);
export type LeadStatus = z.infer<typeof LeadStatus>;

// Core Lead schema
export const LeadSchema = z.object({
  id: z.string().uuid(),

  // Identity
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  linkedin_url: z.string().url().nullable(),

  // Professional
  company_name: z.string().nullable(),
  job_title: z.string().nullable(),
  seniority: z.string().nullable(),
  industry: z.string().nullable(),
  website_url: z.string().nullable(),

  // Location
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  timezone: z.string().nullable(),

  // State
  status: LeadStatus,

  // Research (stored as JSONB)
  research_data: z.record(z.any()).nullable(),
  research_completed_at: z.string().datetime().nullable(),

  // Email content
  email_1_subject: z.string().nullable(),
  email_1_body: z.string().nullable(),
  email_2_body: z.string().nullable(),
  email_3_subject: z.string().nullable(),
  email_3_body: z.string().nullable(),

  // Sending
  sender_email: z.string().email().nullable(),
  opt_out_token: z.string(),
  gmail_thread_id: z.string().nullable(),

  // Timestamps
  email_1_sent_at: z.string().datetime().nullable(),
  email_2_sent_at: z.string().datetime().nullable(),
  email_3_sent_at: z.string().datetime().nullable(),
  replied_at: z.string().datetime().nullable(),
  meeting_booked_at: z.string().datetime().nullable(),
  meeting_scheduled_at: z.string().datetime().nullable(),

  // Booking & Meeting
  meeting_link: z.string().nullable(),
  meeting_outcome: z.string().nullable(),

  // Response Tracking
  reply_category: z.string().nullable(),
  reply_sentiment: z.string().nullable(),

  // Message IDs for thread tracking
  email_1_message_id: z.string().nullable(),
  email_2_message_id: z.string().nullable(),
  email_3_message_id: z.string().nullable(),

  // Metadata
  source: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),

  // Error Tracking
  error_reason: z.string().nullable(),
  error_count: z.number().int().default(0),
  last_error_at: z.string().datetime().nullable(),
});
export type Lead = z.infer<typeof LeadSchema>;

// For creating new leads (without auto-generated fields)
export const CreateLeadSchema = LeadSchema.omit({
  id: true,
  status: true,
  opt_out_token: true,
  created_at: true,
  updated_at: true,
}).partial().extend({
  email: z.string().email(),
});
export type CreateLead = z.infer<typeof CreateLeadSchema>;

// Discovery query input
export const DiscoveryQuerySchema = z.object({
  locations: z.array(z.string()).min(1),
  industries: z.array(z.string()).min(1),
  job_titles: z.array(z.string()).min(1),
  max_results: z.number().int().positive().default(100),
});
export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;

// Apollo scraper result
export const ApolloPersonSchema = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().email().nullable(),
  linkedin_url: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  seniority: z.string().nullable(),
  organization_website_url: z.string().nullable(),
  organization: z.object({
    primary_phone: z.object({
      sanitized_number: z.string().nullable(),
    }).nullable(),
  }).nullable(),
  employment_history: z.array(z.object({
    title: z.string().nullable(),
    organization_name: z.string().nullable(),
  })).nullable(),
});
export type ApolloPerson = z.infer<typeof ApolloPersonSchema>;

// Agent action result
export const AgentResultSchema = z.object({
  success: z.boolean(),
  action: z.string(),
  message: z.string(),
  data: z.any().optional(),
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

// Discovery agent specific result
export const DiscoveryResultSchema = AgentResultSchema.extend({
  data: z.object({
    total_found: z.number(),
    new_leads: z.number(),
    duplicates_skipped: z.number(),
    leads: z.array(z.object({
      email: z.string(),
      name: z.string(),
      company: z.string().nullable(),
    })),
  }).optional(),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
