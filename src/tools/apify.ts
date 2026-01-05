/**
 * Apify Apollo.io Lead Scraper Integration
 *
 * Uses the Apify actor "onidivo/apollo-scraper" to scrape leads
 * from Apollo.io search results. Uses your Apollo.io account cookies to access the data.
 *
 * Requirements:
 * - APIFY_API_TOKEN: Your Apify API token
 * - APOLLO_COOKIE: Your Apollo.io browser cookies (JSON array from Cookie-Editor extension)
 *
 * How to get your Apollo cookies:
 * 1. Install the Cookie-Editor Chrome extension
 * 2. Log into Apollo.io in your browser
 * 3. Click on Cookie-Editor extension icon
 * 4. Click "Export" to copy all cookies as JSON
 * 5. Set APOLLO_COOKIE environment variable to the exported JSON
 *
 * Apify Actor: https://apify.com/onidivo/apollo-scraper
 * Pricing: $35/month + usage (pay-per-result)
 */

import { apifyConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';

const APIFY_API_BASE = 'https://api.apify.com/v2';
// Actor ID format uses tilde (~) not slash (/) for API calls
// See: https://docs.apify.com/academy/api/run-actor-and-retrieve-data-via-api
const APOLLO_SCRAPER_ACTOR = 'onidivo~apollo-scraper';

// =============================================================================
// Types
// =============================================================================

export interface ApifySearchParams {
  locations: string[];
  industries: string[];
  jobTitles: string[];
  seniorities?: string[];
  employeeRanges?: string[];
  maxResults?: number;
}

export interface ApifyScraperResult {
  success: boolean;
  totalFound: number;
  leads: CreateLead[];
  error?: string;
}

// Cookie format from Cookie-Editor extension
interface ApolloCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
}

// Input schema for onidivo/apollo-scraper
// See: https://apify.com/onidivo/apollo-scraper/input-schema
interface ApolloScraperInput {
  // Array of search URLs - each with a 'url' property
  searchUrls: Array<{ url: string }>;
  // Cookies from Apollo.io browser session (array format from Cookie-Editor)
  cookies: ApolloCookie[];
  // Starting page number (default: 1)
  startPage?: number;
  // Maximum pages to scrape (controls result count)
  maxPages?: number;
  // Proxy configuration
  proxyConfiguration?: {
    useApifyProxy?: boolean;
  };
  // Page navigation timeout in milliseconds
  pageNavigationTimeoutMs?: number;
}

// Apify actor run response
interface ApifyRunResponse {
  data: {
    id: string;
    actId: string;
    status: string;
    defaultDatasetId: string;
    defaultKeyValueStoreId: string;
  };
}

// Lead data from the Apollo scraper output
interface ApolloLeadResult {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_status?: string;
  phone?: string;
  mobile_phone?: string;
  linkedin_url?: string;
  title?: string;
  seniority?: string;
  organization_name?: string;
  organization?: {
    name?: string;
    website_url?: string;
    industry?: string;
    estimated_num_employees?: number;
  };
  city?: string;
  state?: string;
  country?: string;
  // Alternative field names
  firstName?: string;
  lastName?: string;
  linkedInUrl?: string;
  companyName?: string;
  companyWebsite?: string;
  companyIndustry?: string;
  jobTitle?: string;
}

// =============================================================================
// Apollo Search URL Builder
// =============================================================================

/**
 * Build an Apollo.io search URL from parameters
 * Apollo uses URL query params for filtering
 */
function buildApolloSearchUrl(params: ApifySearchParams): string {
  const baseUrl = 'https://app.apollo.io/#/people';
  const queryParams: string[] = [];

  // Job titles
  if (params.jobTitles?.length > 0) {
    params.jobTitles.forEach(title => {
      queryParams.push(`personTitles[]=${encodeURIComponent(title)}`);
    });
  }

  // Locations
  if (params.locations?.length > 0) {
    params.locations.forEach(loc => {
      queryParams.push(`personLocations[]=${encodeURIComponent(loc)}`);
    });
  }

  // Industries
  if (params.industries?.length > 0) {
    params.industries.forEach(industry => {
      queryParams.push(`organizationIndustryTagIds[]=${encodeURIComponent(industry)}`);
    });
  }

  // Seniorities
  if (params.seniorities?.length > 0) {
    const mappedSeniorities = mapSeniorities(params.seniorities);
    mappedSeniorities.forEach(s => {
      queryParams.push(`personSeniorities[]=${encodeURIComponent(s)}`);
    });
  }

  // Employee ranges
  if (params.employeeRanges?.length > 0) {
    params.employeeRanges.forEach(range => {
      queryParams.push(`organizationNumEmployeesRanges[]=${encodeURIComponent(range)}`);
    });
  }

  // Only show contacts with email
  queryParams.push('contactEmailStatusV2[]=verified');
  queryParams.push('contactEmailStatusV2[]=guessed');
  queryParams.push('contactEmailStatusV2[]=likely_to_engage');

  return queryParams.length > 0
    ? `${baseUrl}?${queryParams.join('&')}`
    : baseUrl;
}

// =============================================================================
// Employee Range Helpers
// =============================================================================

function getEmployeeRangeCodes(min: number, max: number): string[] {
  const ranges: string[] = [];

  if (min <= 10 && max >= 1) ranges.push('1,10');
  if (min <= 20 && max >= 11) ranges.push('11,20');
  if (min <= 50 && max >= 21) ranges.push('21,50');
  if (min <= 100 && max >= 51) ranges.push('51,100');
  if (min <= 200 && max >= 101) ranges.push('101,200');
  if (min <= 500 && max >= 201) ranges.push('201,500');
  if (min <= 1000 && max >= 501) ranges.push('501,1000');
  if (min <= 2000 && max >= 1001) ranges.push('1001,2000');
  if (min <= 5000 && max >= 2001) ranges.push('2001,5000');
  if (min <= 10000 && max >= 5001) ranges.push('5001,10000');
  if (max >= 10001) ranges.push('10001,');

  return ranges;
}

// =============================================================================
// Seniority Mapping
// =============================================================================

const SENIORITY_MAP: Record<string, string> = {
  'owner': 'owner',
  'founder': 'founder',
  'c-suite': 'c_suite',
  'c_suite': 'c_suite',
  'csuite': 'c_suite',
  'partner': 'partner',
  'vp': 'vp',
  'head': 'head',
  'director': 'director',
  'manager': 'manager',
  'senior': 'senior',
  'entry': 'entry',
  'intern': 'intern',
};

function mapSeniorities(seniorities?: string[]): string[] {
  if (!seniorities) return [];
  return seniorities
    .map(s => SENIORITY_MAP[s.toLowerCase()] || s.toLowerCase())
    .filter((v, i, a) => a.indexOf(v) === i);
}

// =============================================================================
// Transform Functions
// =============================================================================

function transformApolloLead(lead: ApolloLeadResult): CreateLead | null {
  const email = lead.email;
  if (!email) return null;

  // Skip invalid or bounced emails
  if (lead.email_status === 'invalid' || lead.email_status === 'bounced') {
    return null;
  }

  // Parse name if needed
  let firstName = lead.first_name || lead.firstName || null;
  let lastName = lead.last_name || lead.lastName || null;

  if (!firstName && !lastName && lead.name) {
    const nameParts = lead.name.split(' ');
    firstName = nameParts[0] || null;
    lastName = nameParts.slice(1).join(' ') || null;
  }

  return {
    first_name: firstName,
    last_name: lastName,
    email: email.toLowerCase(),
    phone: lead.phone || lead.mobile_phone || null,
    linkedin_url: lead.linkedin_url || lead.linkedInUrl || null,
    company_name: lead.organization_name || lead.organization?.name || lead.companyName || null,
    job_title: lead.title || lead.jobTitle || null,
    seniority: lead.seniority || null,
    industry: lead.organization?.industry || lead.companyIndustry || null,
    website_url: lead.organization?.website_url || lead.companyWebsite || null,
    city: lead.city || null,
    state: lead.state || null,
    country: lead.country || null,
    source: 'apify-apollo',
  };
}

// =============================================================================
// Apify API Functions
// =============================================================================

/**
 * Start an Apify actor run and wait for completion
 */
async function runActorAndWait(
  actorId: string,
  input: ApolloScraperInput,
  apiToken: string,
  timeoutMs: number = 180000 // 3 minutes default
): Promise<{ success: boolean; datasetId?: string; error?: string }> {

  console.log('🚀 Starting Apify Apollo scraper...');
  console.log('   Actor:', actorId);
  console.log('   Search URL:', input.searchUrl.substring(0, 100) + '...');
  console.log('   Count:', input.count);

  try {
    // Start the actor run with waitForFinish
    const runResponse = await fetch(
      `${APIFY_API_BASE}/acts/${actorId}/runs?waitForFinish=${Math.floor(timeoutMs / 1000)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(input),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('❌ Apify actor start failed:', runResponse.status, errorText);
      return { success: false, error: `Apify API error: ${runResponse.status} - ${errorText.slice(0, 200)}` };
    }

    const runData: ApifyRunResponse = await runResponse.json();
    console.log('   Run ID:', runData.data.id);
    console.log('   Status:', runData.data.status);
    console.log('   Dataset ID:', runData.data.defaultDatasetId);

    // Check if run succeeded
    if (runData.data.status === 'SUCCEEDED') {
      return { success: true, datasetId: runData.data.defaultDatasetId };
    }

    // If still running, poll for completion
    if (runData.data.status === 'RUNNING') {
      console.log('⏳ Actor still running, polling for completion...');
      const pollResult = await pollRunStatus(runData.data.id, apiToken, timeoutMs);
      if (pollResult.success) {
        return { success: true, datasetId: runData.data.defaultDatasetId };
      }
      return pollResult;
    }

    // Run failed
    return { success: false, error: `Actor run failed with status: ${runData.data.status}` };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Apify actor run error:', message);
    return { success: false, error: message };
  }
}

/**
 * Poll for actor run completion
 */
async function pollRunStatus(
  runId: string,
  apiToken: string,
  timeoutMs: number
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(
        `${APIFY_API_BASE}/actor-runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
          },
        }
      );

      if (!response.ok) {
        return { success: false, error: `Failed to get run status: ${response.status}` };
      }

      const data = await response.json();
      console.log(`   Poll: Status = ${data.data.status}`);

      if (data.data.status === 'SUCCEEDED') {
        return { success: true };
      }

      if (data.data.status === 'FAILED' || data.data.status === 'ABORTED') {
        return { success: false, error: `Actor run ${data.data.status.toLowerCase()}` };
      }

      // Still running, wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  return { success: false, error: 'Actor run timed out' };
}

/**
 * Get results from an Apify dataset
 */
async function getDatasetItems(
  datasetId: string,
  apiToken: string,
  limit: number = 100
): Promise<ApolloLeadResult[]> {
  try {
    const response = await fetch(
      `${APIFY_API_BASE}/datasets/${datasetId}/items?limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('❌ Failed to get dataset items:', response.status);
      return [];
    }

    const items: ApolloLeadResult[] = await response.json();
    console.log(`📊 Retrieved ${items.length} items from dataset`);
    return items;

  } catch (error) {
    console.error('❌ Dataset fetch error:', error);
    return [];
  }
}

// =============================================================================
// Main Search Function
// =============================================================================

/**
 * Search for leads using the FREE Apify Apollo scraper
 * Requires APIFY_API_TOKEN and APOLLO_COOKIE environment variables
 */
export async function scrapeApify(params: ApifySearchParams): Promise<ApifyScraperResult> {
  console.log('🔍 Searching for leads via Apify Apollo scraper...');
  console.log(`   Params: ${JSON.stringify(params, null, 2)}`);

  // Check for required tokens
  if (!apifyConfig.apiToken) {
    console.error('❌ APIFY_API_TOKEN not configured');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APIFY_API_TOKEN environment variable not set. Please add your Apify API token.',
    };
  }

  const apolloCookieRaw = process.env.APOLLO_COOKIE;
  if (!apolloCookieRaw) {
    console.error('❌ APOLLO_COOKIE not configured');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APOLLO_COOKIE environment variable not set. Please add your Apollo.io browser cookie (use Cookie-Editor extension to export as JSON array).',
    };
  }

  // Parse cookie - MUST be JSON array from Cookie-Editor extension
  let apolloCookies: ApolloCookie[];
  try {
    const parsed = JSON.parse(apolloCookieRaw);
    if (Array.isArray(parsed)) {
      apolloCookies = parsed;
      console.log(`   Parsed ${parsed.length} cookies from JSON array`);
    } else {
      console.error('❌ APOLLO_COOKIE must be a JSON array from Cookie-Editor extension');
      return {
        success: false,
        totalFound: 0,
        leads: [],
        error: 'APOLLO_COOKIE must be a JSON array exported from Cookie-Editor extension. Please re-export your cookies.',
      };
    }
  } catch {
    console.error('❌ APOLLO_COOKIE is not valid JSON');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APOLLO_COOKIE is not valid JSON. Please use Cookie-Editor extension to export cookies as JSON array.',
    };
  }

  try {
    // Build the Apollo search URL from parameters
    const searchUrl = buildApolloSearchUrl(params);
    console.log('   Built search URL:', searchUrl.substring(0, 150) + '...');

    // Calculate max pages based on desired results (Apollo shows ~25 per page)
    const maxResults = params.maxResults || 25;
    const maxPages = Math.ceil(maxResults / 25);

    // Build actor input for onidivo/apollo-scraper
    const actorInput: ApolloScraperInput = {
      searchUrls: [{ url: searchUrl }],
      cookies: apolloCookies,
      startPage: 1,
      maxPages: maxPages,
      proxyConfiguration: {
        useApifyProxy: true,
      },
      pageNavigationTimeoutMs: 60000,
    };

    // Run the actor and wait for completion
    const runResult = await runActorAndWait(
      APOLLO_SCRAPER_ACTOR,
      actorInput,
      apifyConfig.apiToken,
      300000 // 5 minute timeout (scraping takes time)
    );

    if (!runResult.success || !runResult.datasetId) {
      return {
        success: false,
        totalFound: 0,
        leads: [],
        error: runResult.error || 'Actor run failed',
      };
    }

    // Get results from the dataset
    const items = await getDatasetItems(
      runResult.datasetId,
      apifyConfig.apiToken,
      params.maxResults || 100
    );

    // Transform to leads
    const leads: CreateLead[] = [];
    for (const item of items) {
      const lead = transformApolloLead(item);
      if (lead?.email) {
        leads.push(lead);
      }
    }

    console.log(`✅ Final result: ${leads.length} leads with valid emails`);

    return {
      success: true,
      totalFound: items.length,
      leads,
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Apify search failed:', message);

    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: message,
    };
  }
}

// =============================================================================
// Compatibility Exports (matching apollo.ts interface)
// =============================================================================

// Re-export types with Apollo-compatible names for seamless swap
export type ApolloSearchParams = ApifySearchParams;
export type ApolloScraperResult = ApifyScraperResult;

/**
 * Main search function - drop-in replacement for scrapeApollo
 */
export async function scrapeApollo(params: ApifySearchParams): Promise<ApifyScraperResult> {
  return scrapeApify(params);
}

/**
 * Validate and normalize search parameters
 */
export function normalizeSearchParams(params: ApifySearchParams): ApifySearchParams {
  return {
    locations: params.locations || [],
    industries: params.industries || [],
    jobTitles: params.jobTitles || [],
    seniorities: params.seniorities || [],
    employeeRanges: params.employeeRanges || getEmployeeRangeCodes(20, 200),
    maxResults: Math.min(params.maxResults ?? 25, 75), // Free tier limit is 75 per search
  };
}

/**
 * Helper to build employee range parameter from ICP config
 */
export function buildEmployeeRanges(min: number, max: number): string[] {
  return getEmployeeRangeCodes(min, max);
}
