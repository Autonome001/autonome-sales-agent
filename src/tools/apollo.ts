import { apifyConfig } from '../config/index.js';
import type { ApolloPerson, CreateLead } from '../types/index.js';

const APIFY_APOLLO_ACTOR = 'code_crafter~apollo-io-scraper';
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
 * Build Apollo search URL from parameters
 * Replicates the n8n "Create URL" node logic
 */
function buildApolloUrl(params: ApolloSearchParams): string {
  const baseUrl = 'https://app.apollo.io/#/people';
  const queryParts: string[] = [];

  // Static params
  queryParts.push('sortByField=recommendations_score');
  queryParts.push('sortAscending=false');
  queryParts.push('page=1');

  // Add job titles
  for (const title of params.jobTitles) {
    const encoded = encodeURIComponent(title.replace(/\+/g, ' '));
    queryParts.push(`personTitles[]=${encoded}`);
  }

  // Add locations
  for (const location of params.locations) {
    const encoded = encodeURIComponent(location.replace(/\+/g, ' '));
    queryParts.push(`personLocations[]=${encoded}`);
  }

  // Add industries/business keywords
  for (const industry of params.industries) {
    const encoded = encodeURIComponent(industry.replace(/\+/g, ' '));
    queryParts.push(`qOrganizationKeywordTags[]=${encoded}`);
  }

  // Include organization keyword fields
  queryParts.push('includedOrganizationKeywordFields[]=tags');
  queryParts.push('includedOrganizationKeywordFields[]=name');

  return `${baseUrl}?${queryParts.join('&')}`;
}

/**
 * Transform Apollo API response to CreateLead format
 */
function transformApolloPerson(person: ApolloPerson, industry: string): CreateLead | null {
  // Skip if no email
  if (!person.email) return null;

  return {
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email.toLowerCase(),
    phone: person.organization?.primary_phone?.sanitized_number ?? null,
    linkedin_url: person.linkedin_url,
    company_name: person.employment_history?.[0]?.organization_name ?? null,
    job_title: person.employment_history?.[0]?.title ?? null,
    seniority: person.seniority,
    industry: industry.replace(/\+/g, ' '),
    website_url: person.organization_website_url,
    city: person.city,
    state: person.state,
    country: person.country,
    source: 'apollo',
  };
}

/**
 * Run Apollo scraper via Apify
 */
export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  const maxResults = params.maxResults ?? 100;
  const apolloUrl = buildApolloUrl(params);

  console.log('🔍 Scraping Apollo with URL:', apolloUrl);

  try {
    // Call Apify Apollo scraper with sync endpoint
    const response = await fetch(
      `${APIFY_BASE_URL}/acts/${APIFY_APOLLO_ACTOR}/run-sync-get-dataset-items?token=${apifyConfig.apiToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          getPersonalEmails: true,
          getWorkEmails: true,
          totalRecords: maxResults,
          url: apolloUrl,
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
