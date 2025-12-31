# Autonome Sales Agent

Unified agentic sales system replacing the n8n multi-workflow architecture.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required credentials:
- **SUPABASE_URL** - Your Supabase project URL
- **SUPABASE_ANON_KEY** - Supabase anon/public key
- **SUPABASE_SERVICE_ROLE_KEY** - Supabase service role key (for backend)
- **ANTHROPIC_API_KEY** - Claude API key
- **APIFY_API_TOKEN** - Apify token (for Apollo scraper)

### 3. Set Up Database

Run the migration SQL in your Supabase SQL Editor:

```bash
cat src/db/migrations/001_initial_schema.sql
```

Copy the contents and run in Supabase Dashboard → SQL Editor.

### 4. Run Discovery Agent

```bash
npm run discovery
```

## Usage

### Natural Language Commands

The Discovery Agent understands natural language:

```
🤖 > Find CEOs of marketing agencies in Chicago and New York

⏳ Processing...

✅ Found 87 leads. Added 73 new leads to database (14 duplicates skipped).

📋 Sample leads added:
   • john@agency.com - John Smith @ Creative Agency Inc
   • sarah@marketing.co - Sarah Johnson @ Digital Marketing Co
   ...
```

### Multi-Turn Conversations

```
🤖 > Find founders

✅ I need more information. Which locations and industries should I search?

🤖 > Let's do Sydney and Melbourne, Australia

✅ Got it. What industry or type of business?

🤖 > SaaS companies

✅ Found 156 leads. Added 142 new leads to database...
```

### Commands

| Command | Description |
|---------|-------------|
| Natural language | Search for leads |
| `stats` | Show pipeline statistics |
| `search <query>` | Search existing leads |
| `reset` | Reset conversation context |
| `exit` | Exit the agent |

## Architecture

```
src/
├── agents/
│   └── discovery/      # Lead discovery agent
│       ├── index.ts    # Agent logic
│       └── cli.ts      # Interactive CLI
├── tools/
│   └── apollo.ts       # Apollo/Apify scraper
├── db/
│   ├── client.ts       # Supabase client
│   ├── leads.ts        # Leads queries
│   └── events.ts       # Event logging
├── config/
│   └── index.ts        # Environment config
└── types/
    └── index.ts        # TypeScript types
```

## Database Schema

The system uses a single `leads` table with state machine:

```
new → scraped → researched → ready → email_1_sent → email_2_sent → 
email_3_sent → engaged → meeting_booked → converted
```

See `src/db/migrations/001_initial_schema.sql` for full schema.

## Deployment (Railway)

1. Connect your GitHub repo to Railway
2. Add environment variables in Railway dashboard
3. Set start command: `npm run discovery` (or your preferred entry point)
4. Deploy!

## Next Steps

After Discovery Agent:
1. **Research Agent** - Deep lead research (LinkedIn, Perplexity, TrustPilot)
2. **Outreach Agent** - Email generation and sending
3. **Response Agent** - Inbound email handling
4. **Booking Agent** - Calendar and meeting management

## License

Proprietary - Autonome Partners
