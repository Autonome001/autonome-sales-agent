import { apifyConfig } from '../config/index.js';
import type { ApolloPerson, CreateLead } from '../types/index.js';

const APIFY_APOLLO_ACTOR = 'code_crafter~leads-finder';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface ApolloSearchParams {
  locations: string[];
  industries: string[];
  jobTitles: string[];
  maxResults?: number;
}

export interface ApolloScraperResult {
  success: boolean;
  totalFound: number;
  leads: CreateLead[];
  error?: string;
}

/**
 * Transform Apollo API response to CreateLead format
 */
function transformApolloPerson(person: ApolloPerson, industry: string): CreateLead | null {
  // Skip if no email
  if (!person.email) return null;

  return {
    first_name: person.first_name || null,
    last_name: person.last_name || null,
    email: person.email.toLowerCase(),
    phone: person.organization?.primary_phone?.sanitized_number ?? null,
    linkedin_url: person.linkedin_url || null,
    company_name: person.employment_history?.[0]?.organization_name ?? null,
    job_title: person.employment_history?.[0]?.title ?? null,
    seniority: person.seniority || null,
    industry: industry.replace(/\+/g, ' '),
    website_url: person.organization_website_url || null,
    city: person.city || null,
    state: person.state || null,
    country: person.country || null,
    source: 'apollo',
  };
}

export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  const maxResults = params.maxResults ?? 100;

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
          email_status: ["validated"],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Apify request failed: ${response.status} - ${errorText}`);
    }

    // Apify sometimes returns the error as the first item in the array if the actor fails but the request succeeds
    // The type definition says ApolloPerson[] but it might be any[]
    const data: any[] = await response.json();

    // Debug log FIRST so we can see what Apify returned before any checks
    if (data.length > 0) {
      console.log('📄 First item sample:', JSON.stringify(data[0], null, 2));
    }

    // Check for Apify platform errors (like plan limits)
    // The error can come in different formats depending on the actor/error type
    if (data.length > 0) {
      const firstItem = data[0];
      const errorMsg = firstItem.error || firstItem.errorMessage || firstItem.message;

      // Check if this looks like an error response rather than a lead
      const isErrorResponse = errorMsg && (
        typeof errorMsg === 'string' ||
        !firstItem.email // Real leads should have email field
      );

      if (isErrorResponse) {
        const errorText = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
        throw new Error(`Apify Actor Error: ${errorText}\n   NOTE: This usually means you need to upgrade your Apify plan to use API access.`);
      }
    }

    // Transform results
    const leads: CreateLead[] = [];
    const primaryIndustry = params.industries[0] || 'unknown';

    for (const person of data) {
      // Skip if it's not a person object (double check for error objects mixed in)
      if (person.error) continue;

      const lead = transformApolloPerson(person as ApolloPerson, primaryIndustry);
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
    // DO NOT normalize strings (no lowercasing or + replacements) 
    // The Apify actor handles spaces correctly and + might break it or reduce relevance
    locations: params.locations,
    industries: params.industries,
    jobTitles: params.jobTitles,
    maxResults: Math.min(params.maxResults ?? 100, 500), // Cap at 500
  };
}
