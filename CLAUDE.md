# Autonome Sales Agent - Project Instructions

## Project Overview
This is a B2B sales automation system that discovers leads, researches them, and sends personalized outreach emails via a multi-stage pipeline.

## Critical Documentation

### Apify Integration
**BEFORE modifying lead discovery or switching Apify actors, READ:**
- `docs/APIFY_INTEGRATION_GUIDE.md`

This guide contains hard-won lessons from 2 days of troubleshooting, including:
- Actor ID format (tilde `~` vs slash `/`)
- Lowercase requirements for all API values
- Valid seniority, location, and industry mappings
- Common error patterns and fixes
- Integration checklist for new actors

## Key Files

| File | Purpose |
|------|---------|
| `src/tools/apify.ts` | Lead discovery via Apify actors |
| `src/tools/apollo.ts` | Apollo.io direct API (legacy) |
| `src/slack/conversational-agent.ts` | Slack bot for discovery commands |
| `src/scheduler.ts` | Scheduled pipeline runs |
| `src/config/icp.ts` | Ideal Customer Profile configuration |

## Environment Variables Required
- `APIFY_API_TOKEN` - Apify API token for lead discovery
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` - Database
- `ANTHROPIC_API_KEY` - Claude API for AI features
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` - Slack integration

## Common Tasks

### Switching Apify Actors
1. Read `docs/APIFY_INTEGRATION_GUIDE.md` first
2. Update actor ID in `src/tools/apify.ts` (use tilde format: `user~actor`)
3. Check the new actor's input schema
4. Update mapping functions if field names/formats differ
5. Test with minimal filters first

### Troubleshooting Discovery
1. Check Railway logs for "Actor input:" to see what's being sent
2. Look for validation errors mentioning specific fields
3. Verify all values are lowercase
4. Check `docs/APIFY_INTEGRATION_GUIDE.md` for known issues
