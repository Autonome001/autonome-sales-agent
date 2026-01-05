# Apify Lead Discovery Integration Guide

> **Purpose**: This document captures all lessons learned from integrating Apify actors for lead discovery. Use this guide when switching actors, troubleshooting errors, or onboarding new lead sources.

---

## Table of Contents

1. [Quick Reference: Common Fixes](#quick-reference-common-fixes)
2. [Actor ID Format](#actor-id-format)
3. [API Value Requirements](#api-value-requirements)
4. [Field-Specific Mappings](#field-specific-mappings)
5. [Common Error Patterns](#common-error-patterns)
6. [Integration Checklist](#integration-checklist)
7. [Actor-Specific Notes](#actor-specific-notes)
8. [File Locations](#file-locations)

---

## Quick Reference: Common Fixes

| Issue | Root Cause | Solution |
|-------|------------|----------|
| `page-not-found` 404 | Actor ID uses `/` instead of `~` | Change `user/actor` to `user~actor` |
| `Actor was not found` | Wrong actor ID or actor doesn't exist | Verify actor exists on Apify marketplace |
| `Field must be equal to one of the allowed values` | Value not in API's allowed list | Map to valid values or filter invalid ones |
| `seniority_level` invalid | Capitalized values (`Owner`) | Use lowercase (`owner`, `c_suite`) |
| `contact_location` invalid | Capitalized values (`United States`) | Use lowercase (`united states`) |
| `company_industry` invalid | Non-existent industry or capitalized | Map to valid lowercase values |
| Very few results returned | `email_status: ['validated']` filter | Remove or make optional |
| Authentication error | Missing or invalid API token | Check `APIFY_API_TOKEN` env var |

---

## Actor ID Format

### Critical Rule: Use Tilde (`~`) Not Slash (`/`)

When calling the Apify API, actor IDs must use **tilde (`~`)** as the separator, not slash (`/`).

```
❌ WRONG: curious_coder/apollo-scraper
✅ RIGHT: curious_coder~apollo-scraper
```

**Why?** The Apify web UI shows `user/actor` format, but the API requires `user~actor` format.

### Examples

| Apify Marketplace URL | API Actor ID |
|----------------------|--------------|
| `apify.com/code_crafter/leads-finder` | `code_crafter~leads-finder` |
| `apify.com/onidivo/apollo-scraper` | `onidivo~apollo-scraper` |
| `apify.com/curious_coder/apollo-scraper` | `curious_coder~apollo-scraper` |

### Code Location
```typescript
// src/tools/apify.ts
const LEADS_FINDER_ACTOR = 'code_crafter~leads-finder';  // Use tilde!
```

---

## API Value Requirements

### Universal Rule: Most Apify Actors Require Lowercase Values

Almost all filter fields require **lowercase** values. This is the #1 source of validation errors.

```typescript
// ❌ WRONG - Will cause validation errors
{
  seniority_level: ['Owner', 'Founder', 'C-Level'],
  contact_location: ['United States', 'California'],
  company_industry: ['Software Development', 'Marketing & Advertising']
}

// ✅ RIGHT - All lowercase
{
  seniority_level: ['owner', 'founder', 'c_suite'],
  contact_location: ['united states', 'california, us'],
  company_industry: ['computer software', 'marketing & advertising']
}
```

### Exception: Job Titles

Job titles (`contact_job_title`) typically accept mixed case and are more flexible.

---

## Field-Specific Mappings

### Seniority Levels

The API uses specific seniority values. Map common inputs to valid API values:

| Input Variations | Valid API Value |
|-----------------|-----------------|
| `Owner`, `owner` | `owner` |
| `Founder`, `founder` | `founder` |
| `C-Suite`, `C-Level`, `CEO`, `CFO`, `CTO`, `COO`, `CMO` | `c_suite` |
| `VP`, `Vice President` | `vp` |
| `Head` | `head` |
| `Director` | `director` |
| `Manager` | `manager` |
| `Senior` | `senior` |
| `Entry`, `Junior` | `entry` |
| `Intern`, `Trainee` | `trainee` |

**Note**: Use underscore (`c_suite`) not hyphen (`c-suite`) for the API value.

### Locations

Locations must be lowercase. The API accepts:
- Countries: `united states`, `germany`, `united kingdom`
- States: `california, us`, `texas, us`, `new york, us`
- Cities: Check API documentation for exact format

### Industries

Industries have a **fixed list** of valid values. Invalid industries will cause errors.

**Common Mappings Needed:**

| Invalid Input | Valid API Value |
|--------------|-----------------|
| `Software Development` | `computer software` |
| `Professional Services` | `management consulting` |
| `Business Services` | `management consulting` |
| `B2B` | `information technology & services` |
| `SaaS` | `computer software` |
| `Tech`, `Technology` | `information technology & services` |
| `Marketing` | `marketing & advertising` |
| `Finance`, `Fintech` | `financial services` |
| `Healthcare` | `hospital & health care` |
| `E-commerce` | `internet` |

**Strategy**: Map known variations, filter out unknown values to prevent API errors.

### Company Size / Employee Ranges

Different actors use different formats:

| Our Internal Format | Leads Finder Format |
|--------------------|---------------------|
| `1,10` | `2-10` |
| `11,20` | `11-20` |
| `21,50` | `21-50` |
| `51,100` | `51-100` |
| `101,200` | `101-200` |
| `201,500` | `201-500` |
| `501,1000` | `501-1000` |
| `1001,2000` | `1001-2000` |
| `2001,5000` | `2001-5000` |
| `10001,` | `10000+` |

---

## Common Error Patterns

### Error: `page-not-found` (404)

```json
{
  "error": {
    "type": "page-not-found",
    "message": "Page not found"
  }
}
```

**Cause**: Actor ID uses wrong format (slash instead of tilde)
**Fix**: Change `user/actor` to `user~actor`

### Error: `Actor was not found`

```json
{
  "error": {
    "type": "actor-not-found",
    "message": "Actor was not found"
  }
}
```

**Cause**: Actor doesn't exist or ID is misspelled
**Fix**:
1. Verify actor exists at `https://apify.com/[user]/[actor]`
2. Check for typos in actor ID
3. Ensure actor is public or you have access

### Error: `invalid-input` - Field must equal allowed values

```json
{
  "error": {
    "type": "invalid-input",
    "message": "Field input.seniority_level.0 must be equal to one of the allowed values: \"founder\", \"owner\", \"c_suite\"..."
  }
}
```

**Cause**: Value not in API's allowed list (usually case sensitivity)
**Fix**:
1. Convert value to lowercase
2. Map to valid API value if different
3. Filter out invalid values

### Error: Very Few Results (1-2 leads)

**Cause**: Overly restrictive filters, especially `email_status: ['validated']`
**Fix**:
1. Remove `email_status` filter
2. Broaden search criteria
3. Check if other filters are too narrow

### Error: `API key must be passed in X-Api-Key header`

**Cause**: Apollo.io API changed authentication method
**Fix**: Move API key from request body to header:
```typescript
headers: {
  'Content-Type': 'application/json',
  'X-Api-Key': apiKey,  // Not in body!
}
```

---

## Integration Checklist

When integrating a new Apify actor or switching actors:

### Pre-Integration

- [ ] Verify actor exists on Apify marketplace
- [ ] Check actor pricing (free tier limits?)
- [ ] Review actor's input schema documentation
- [ ] Identify required vs optional fields
- [ ] Check what values each field accepts (case sensitivity!)

### Configuration

- [ ] Actor ID uses tilde (`~`) format
- [ ] All filter values are lowercase
- [ ] Seniority values mapped to valid API values
- [ ] Location values are lowercase
- [ ] Industry values mapped to valid API values
- [ ] Company size format matches actor's expected format
- [ ] API token is set in environment variables

### Testing

- [ ] Test with minimal filters first
- [ ] Add filters one at a time to identify issues
- [ ] Check logs for actual values being sent
- [ ] Verify results are returned (not just 0-1)
- [ ] Confirm leads are saved to database

### Post-Integration

- [ ] Update this document with new learnings
- [ ] Add any new mappings discovered
- [ ] Document actor-specific quirks

---

## Actor-Specific Notes

### code_crafter~leads-finder (Current)

**Pricing**: FREE (100 leads/run on free Apify plan)
**No Apollo cookies required**

**Input Schema Highlights**:
- `contact_job_title`: Array of strings (mixed case OK)
- `seniority_level`: Lowercase only (`founder`, `owner`, `c_suite`, etc.)
- `contact_location`: Lowercase only (`united states`, `california, us`)
- `company_industry`: Lowercase, must be from fixed list
- `size`: Format like `11-20`, `21-50`, `51-100`
- `email_status`: `['validated']` is too restrictive - omit for more results
- `limit`: Max 100 on free tier

**Known Issues**:
- Very restrictive industry list - many common terms are invalid
- Email validation filter severely limits results

### onidivo~apollo-scraper

**Pricing**: ~$35/month
**Requires Apollo cookies**

**Notes**:
- Uses Apollo.io data
- More reliable for US-based leads
- Requires browser cookie extraction from Apollo account

### curious_coder~apollo-scraper

**Status**: Actor not found (may have been removed or renamed)

---

## File Locations

### Primary Integration File
```
src/tools/apify.ts
```
Contains:
- Actor ID constant
- All mapping functions (seniority, location, industry, size)
- Valid value lists
- API call logic

### Configuration
```
src/config/index.ts
```
Contains:
- `APIFY_API_TOKEN` environment variable config

### Exports
```
src/tools/index.ts
```
Contains:
- Exports for `scrapeApollo`, `normalizeSearchParams`, `buildEmployeeRanges`

### Usage Points
```
src/slack/conversational-agent.ts  - Slack bot discovery
src/scheduler.ts                    - Scheduled discovery runs
src/agents/discovery/index.ts       - Discovery agent
```

---

## Troubleshooting Workflow

When discovery fails:

1. **Check the error message** - Usually tells you exactly which field is invalid
2. **Check the logs** - Look at "Actor input:" to see actual values sent
3. **Verify value format**:
   - Is it lowercase?
   - Is it in the valid values list?
   - Does the field use underscore or hyphen?
4. **Add mapping if needed** - Update the appropriate `*_MAP` constant
5. **Add to valid list if needed** - Update `VALID_INDUSTRIES` or similar
6. **Test incrementally** - Start with minimal filters, add one at a time

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2026-01-05 | Initial document created after 2-day troubleshooting | Claude |
| 2026-01-05 | Switched from Apollo scrapers to code_crafter~leads-finder | Claude |
| 2026-01-05 | Added seniority, location, industry mappings | Claude |
| 2026-01-05 | Removed email_status filter for better results | Claude |

---

## Quick Debug Commands

```bash
# Check current actor configuration
grep -n "ACTOR" src/tools/apify.ts

# Check what's being sent to API
# Look for "Actor input:" in Railway logs

# Verify environment variables
echo $APIFY_API_TOKEN

# Test actor exists (replace with your actor)
curl "https://api.apify.com/v2/acts/code_crafter~leads-finder" \
  -H "Authorization: Bearer $APIFY_API_TOKEN"
```
