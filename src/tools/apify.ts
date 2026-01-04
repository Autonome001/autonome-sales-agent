/**
 * Apify Lead Scraper Integration
 *
 * Uses the Apify "Leads Scraper (Like Apollo)" actor to search for leads.
 * Actor: pipelinelabs/lead-scraper-apollo-zoominfo-lusha
 *
 * This replaces direct Apollo.io API calls with Apify's scraping service,
 * which works without requiring a paid Apollo API plan.
 *
 * Apify API Documentation: https://docs.apify.com/api/v2
 */

import { apifyConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';

const APIFY_API_BASE = 'https://api.apify.com/v2';
const LEADS_SCRAPER_ACTOR = 'pipelinelabs/lead-scraper-apollo-zoominfo-lusha';

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

// Apify actor input schema for the Leads Scraper
interface LeadsScraperInput {
  totalResults: number;
  emailStatus?: string[];
  titles?: string[];
  seniorities?: string[];
  locations?: string[];
  industries?: string[];
  employeeCountRanges?: string[];
  includeEmail?: boolean;
  includePhone?: boolean;
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

// Lead data from the Apify actor output
interface ApifyLeadResult {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  title?: string;
  seniority?: string;
  companyName?: string;
  companyWebsite?: string;
  companyIndustry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  // Alternative field names the actor might use
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  job_title?: string;
  company_name?: string;
  website_url?: string;
  industry?: string;
}

// =============================================================================
// Employee Range Mapping (Apollo format to Apify format)
// =============================================================================

const EMPLOYEE_RANGE_MAP: Record<string, string> = {
  '1,10': '1-10',
  '11,20': '11-20',
  '21,50': '21-50',
  '51,100': '51-100',
  '101,200': '101-200',
  '201,500': '201-500',
  '501,1000': '501-1000',
  '1001,2000': '1001-2000',
  '2001,5000': '2001-5000',
  '5001,10000': '5001-10000',
  '10001,': '10001+',
};

function convertEmployeeRanges(apolloRanges?: string[]): string[] {
  if (!apolloRanges) return [];
  return apolloRanges.map(r => EMPLOYEE_RANGE_MAP[r] || r).filter(Boolean);
}

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
  'owner': 'Owner',
  'founder': 'Founder',
  'c-suite': 'C-Suite',
  'c_suite': 'C-Suite',
  'csuite': 'C-Suite',
  'partner': 'Partner',
  'vp': 'VP',
  'head': 'Head',
  'director': 'Director',
  'manager': 'Manager',
  'senior': 'Senior',
  'entry': 'Entry',
  'intern': 'Intern',
};

function mapSeniorities(seniorities?: string[]): string[] {
  if (!seniorities) return [];
  return seniorities
    .map(s => SENIORITY_MAP[s.toLowerCase()] || s)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// =============================================================================
// Transform Functions
// =============================================================================

function transformApifyLead(lead: ApifyLeadResult): CreateLead | null {
  const email = lead.email;
  if (!email) return null;

  return {
    first_name: lead.firstName || lead.first_name || null,
    last_name: lead.lastName || lead.last_name || null,
    email: email.toLowerCase(),
    phone: lead.phone || null,
    linkedin_url: lead.linkedInUrl || lead.linkedin_url || null,
    company_name: lead.companyName || lead.company_name || null,
    job_title: lead.title || lead.job_title || null,
    seniority: lead.seniority || null,
    industry: lead.companyIndustry || lead.industry || null,
    website_url: lead.companyWebsite || lead.website_url || null,
    city: lead.city || null,
    state: lead.state || null,
    country: lead.country || null,
    source: 'apify',
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
  input: LeadsScraperInput,
  apiToken: string,
  timeoutMs: number = 120000 // 2 minutes default
): Promise<{ success: boolean; datasetId?: string; error?: string }> {

  console.log('🚀 Starting Apify actor run...');
  console.log('   Actor:', actorId);
  console.log('   Input:', JSON.stringify(input, null, 2));

  try {
    // Start the actor run
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

    // If not finished yet (shouldn't happen with waitForFinish), poll for status
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
): Promise<ApifyLeadResult[]> {
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

    const items: ApifyLeadResult[] = await response.json();
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
 * Search for leads using the Apify Leads Scraper actor
 */
export async function scrapeApify(params: ApifySearchParams): Promise<ApifyScraperResult> {
  console.log('🔍 Searching for leads via Apify...');
  console.log(`   Params: ${JSON.stringify(params, null, 2)}`);

  if (!apifyConfig.apiToken) {
    console.error('❌ APIFY_API_TOKEN not configured');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APIFY_API_TOKEN environment variable not set. Please add your Apify API token.',
    };
  }

  try {
    // Build actor input
    const actorInput: LeadsScraperInput = {
      totalResults: params.maxResults || 25,
      emailStatus: ['verified', 'guessed', 'likely'],
      includeEmail: true,
      includePhone: true,
    };

    // Add filters
    if (params.jobTitles?.length > 0) {
      actorInput.titles = params.jobTitles;
    }

    if (params.locations?.length > 0) {
      actorInput.locations = params.locations;
    }

    if (params.industries?.length > 0) {
      actorInput.industries = params.industries;
    }

    if (params.seniorities?.length > 0) {
      actorInput.seniorities = mapSeniorities(params.seniorities);
    }

    if (params.employeeRanges?.length > 0) {
      actorInput.employeeCountRanges = convertEmployeeRanges(params.employeeRanges);
    }

    // Run the actor and wait for completion
    const runResult = await runActorAndWait(
      LEADS_SCRAPER_ACTOR,
      actorInput,
      apifyConfig.apiToken,
      180000 // 3 minute timeout for the actor run
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
      const lead = transformApifyLead(item);
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
    maxResults: Math.min(params.maxResults ?? 50, 100),
  };
}

/**
 * Helper to build employee range parameter from ICP config
 */
export function buildEmployeeRanges(min: number, max: number): string[] {
  return getEmployeeRangeCodes(min, max);
}
