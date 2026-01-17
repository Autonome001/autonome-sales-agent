# Autonome Sales System - Production Schedule

## Daily Pipeline Runs

The system is configured for **3 automated runs per day** with **300 leads per batch**.

### Schedule

| Run | Time | Leads | Purpose |
|-----|------|-------|---------|
| Morning | 9:00 AM EST | 300 | Primary outreach batch |
| Midday | 1:00 PM EST | 300 | Second batch |
| Evening | 5:00 PM EST | 300 | Final batch |

**Total Daily Volume:** 900 leads

**Monthly Volume:** ~27,000 leads (30 days)

---

## Configuration

### Environment Variables
```bash
# .env file
PIPELINE_SCHEDULE=0 9,13,17 * * *  # Runs at 9 AM, 1 PM, 5 PM
PIPELINE_TIMEZONE=America/New_York
PIPELINE_LIMIT=300
```

### Manual Runs
```bash
# Run a single batch manually
npm run pipeline

# Run with custom limit
npm run pipeline -- --all 300

# Test with smaller batch
npm run pipeline -- --all 10
```

---

## Why 300 Leads Per Batch?

### Risk Mitigation
- **Apify Scraping Time:** ~3 minutes (well under 15-min timeout)
- **Failure Impact:** If one batch fails, you only lose 300 leads, not 900
- **Recovery Time:** Can retry failed batch within same day

### Performance
- **Email Sending:** 300 emails × 600ms = ~3 minutes
- **Total Run Time:** ~60-90 minutes per batch (discovery → research → outreach → sending)
- **Overlaps:** Minimal (runs spaced 4 hours apart)

### Cost Efficiency
- **Same Cost:** $1 per 1,000 leads = $0.30 per 300-lead batch
- **Daily Cost:** $0.90/day (3 batches)
- **Monthly Cost:** ~$27/month in lead generation

---

## Monitoring

### Success Criteria (Per Batch)
- ✅ 300 leads discovered
- ✅ 280-300 researched (93%+ success rate)
- ✅ 280-300 emails generated
- ✅ 280-300 emails sent

### Alert Triggers
- ❌ Less than 250 leads discovered (potential Apify issue)
- ❌ Less than 80% research success rate
- ❌ Email sending failures exceed 5%
- ❌ Pipeline run exceeds 2 hours

---

## Cron Setup (For Production Deployment)

### Railway/Heroku
Add scheduler add-on and configure:
```
0 9 * * * npm run scheduler:once
0 13 * * * npm run scheduler:once
0 17 * * * npm run scheduler:once
```

### Linux Crontab
```bash
# Edit crontab
crontab -e

# Add these lines
0 9 * * * cd /path/to/autonome-sales-agent && npm run scheduler:once
0 13 * * * cd /path/to/autonome-sales-agent && npm run scheduler:once
0 17 * * * cd /path/to/autonome-sales-agent && npm run scheduler:once
```

### Manual Execution
For now, manually run:
```bash
# 9 AM
npm run pipeline

# 1 PM (wait 4 hours)
npm run pipeline

# 5 PM (wait 4 hours)
npm run pipeline
```

---

## Scaling Strategy

### Current (Week 1-2): 900 leads/day
- 3 runs × 300 leads
- Monitor success rates
- Tune configurations

### Phase 2 (Week 3-4): 1,200 leads/day
- 4 runs × 300 leads
- Add 11 PM run if needed
- Assess deliverability

### Long-term: 1,500+ leads/day
- Implement incremental Apify saving
- Increase to 500-lead batches
- 3 runs × 500 = 1,500/day
