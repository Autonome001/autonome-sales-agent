import { apifyConfig } from '../config/index.js';
import type { ApolloPerson, CreateLead } from '../types/index.js';

const APIFY_APOLLO_ACTOR = 'code_crafter~leads-finder';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

// ... (interfaces remain the same)

// ... (buildApolloUrl function remains, useful for reference or if actor supports it)

export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  const maxResults = params.maxResults ?? 100;
  // const apolloUrl = buildApolloUrl(params); // Legacy URL builder

  console.log('🔍 Scraping with Leads Finder (Apollo Alternative)...');
  console.log(`   Params: ${JSON.stringify(params)}`);

  try {
    // Call Apify Leads Finder actor
    const response = await fetch(
      `${APIFY_BASE_URL}/acts/${APIFY_APOLLO_ACTOR}/run-sync-get-dataset-items?token=${apifyConfig.apiToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Structured parameters for leads-finder
          job_titles: params.jobTitles,
          locations: params.locations,
          industries: params.industries,
          limit: maxResults,
          // Optional: email validation if supported
          email_status: ["verified"],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Apify request failed: ${response.status} - ${errorText}`);
    }

    const data: ApolloPerson[] = await response.json();

    // Transform results
    const leads: CreateLead[] = [];
    const primaryIndustry = params.industries[0] || 'unknown';

    for (const person of data) {
      const lead = transformApolloPerson(person, primaryIndustry);
      if (lead) {
        leads.push(lead);
      }
    }

    console.log(`✅ Found ${data.length} results, ${leads.length} with valid emails`);

    return {
      success: true,
      totalFound: data.length,
      leads,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Apollo scraping failed:', message);

    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: message,
    };
  }
}

/**
 * Validate and normalize search parameters
 */
export function normalizeSearchParams(params: ApolloSearchParams): ApolloSearchParams {
  return {
    locations: params.locations.map(l => l.toLowerCase().replace(/\s+/g, '+')),
    industries: params.industries.map(i => i.toLowerCase().replace(/\s+/g, '+')),
    jobTitles: params.jobTitles.map(t => t.toLowerCase().replace(/\s+/g, '+')),
    maxResults: Math.min(params.maxResults ?? 100, 500), // Cap at 500
  };
}
