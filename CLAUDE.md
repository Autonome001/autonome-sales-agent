# Autonome Sales Agent - Project Instructions

## Project Overview
This is a B2B sales automation system that discovers leads, researches them, and sends personalized outreach emails via a multi-stage pipeline.

## Lead Discovery

### Current Setup: Apify Leads Scraper (PAID)
The system uses **peakydev/leads-scraper-ppe** Apify actor for lead discovery.

**Why this actor?**
- Returns leads WITH email addresses (70-90% email rate)
- $1 per 1,000 leads (uses Apify credits)
- Similar input schema to other Apollo-based scrapers

**Current Apify Balance:** $4.74 (~4,700 leads available)

### Key Files

| File | Purpose |
|------|---------|
| `src/tools/apify.ts` | Lead discovery via Apify actors (PRIMARY) |
| `src/tools/apollo.ts` | Apollo.io direct API (requires paid Apollo plan) |
| `src/slack/conversational-agent.ts` | Slack bot for discovery commands |
| `src/scheduler.ts` | Scheduled pipeline runs |
| `src/agents/discovery/index.ts` | Discovery agent |
| `src/config/icp.ts` | Ideal Customer Profile configuration |

### Environment Variables Required
- `APIFY_API_TOKEN` - Apify API token with credits
- `APOLLO_API_KEY` - Apollo.io API key (optional, for direct API)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` - Database
- `ANTHROPIC_API_KEY` - Claude API for AI features
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` - Slack integration

## Troubleshooting Discovery

### Before Modifying
**READ:** `docs/APIFY_INTEGRATION_GUIDE.md`

This guide contains critical information:
- Actor ID format (tilde `~` vs slash `/`)
- Lowercase requirements for all API values
- Valid seniority, location, and industry mappings
- Common error patterns and fixes

### Common Issues

| Issue | Solution |
|-------|----------|
| `page-not-found` 404 | Actor ID uses `/` instead of `~` → use `user~actor` |
| `0 leads with valid emails` | Actor doesn't return emails → switch to paid actor |
| Validation errors | Check lowercase requirements in integration guide |

### Switching Actors

1. Read `docs/APIFY_INTEGRATION_GUIDE.md` first
2. Update actor ID in `src/tools/apify.ts` (use tilde format: `user~actor`)
3. Check the new actor's input schema
4. Update mapping functions if field names/formats differ
5. Test with minimal filters first

## Actor History

| Actor | Status | Issue |
|-------|--------|-------|
| `code_crafter~leads-finder` | DEPRECATED | Doesn't return emails |
| `peakydev~leads-scraper-ppe` | CURRENT | $1/1k, 70-90% email rate |
