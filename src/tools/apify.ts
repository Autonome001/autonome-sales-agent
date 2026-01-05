/**
 * Apify Leads Scraper Integration
 *
 * Uses the Apify actor "peakydev/leads-scraper-ppe" to generate B2B leads WITH emails.
 *
 * Pricing: $1 per 1,000 leads (uses Apify credits)
 * Email Rate: 70-90% of leads include verified email addresses
 *
 * Features:
 * - Generates targeted B2B contact lists using advanced filters
 * - Returns verified emails, phone numbers, LinkedIn URLs, and company data
 * - Filters: job title, location, industry, company size, seniority
 *
 * Requirements:
 * - APIFY_API_TOKEN: Your Apify API token with credits ($4.74 remaining)
 *
 * Apify Actor: https://apify.com/peakydev/leads-scraper-ppe
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  IMPORTANT: Before modifying this file or switching to a new Apify actor,   ║
 * ║  READ THE INTEGRATION GUIDE: docs/APIFY_INTEGRATION_GUIDE.md                ║
 * ║                                                                              ║
 * ║  Key learnings documented there:                                            ║
 * ║  - Actor ID format: Use tilde (~) not slash (/) → user~actor                ║
 * ║  - All filter values must be LOWERCASE                                      ║
 * ║  - Seniority uses underscore: c_suite (not c-suite)                         ║
 * ║  - Industries must be from a fixed valid list                               ║
 * ║  - See guide for full mapping tables and troubleshooting                    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { apifyConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';

const APIFY_API_BASE = 'https://api.apify.com/v2';
// Actor ID format uses tilde (~) not slash (/) for API calls
// See: https://docs.apify.com/academy/api/run-actor-and-retrieve-data-via-api
//
// ACTOR OPTIONS:
// - 'code_crafter~leads-finder' - FREE but doesn't return emails reliably
// - 'peakydev~leads-scraper-ppe' - $1/1k leads, 70-90% email rate (RECOMMENDED)
//
const LEADS_FINDER_ACTOR = 'peakydev~leads-scraper-ppe';

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

// Input schema for leads scrapers (peakydev/leads-scraper-ppe uses similar schema)
// See: https://apify.com/peakydev/leads-scraper-ppe
interface LeadsFinderInput {
  // Job title filters
  contact_job_title?: string[];
  contact_not_job_title?: string[];
  // Seniority levels (lowercase): founder, owner, c_suite, director, vp, head, manager, senior, entry, trainee
  seniority_level?: string[];
  // Functional levels: C-Level, Finance, Product, Engineering, Design, HR, IT, Legal, Marketing, Operations, Sales, Support
  functional_level?: string[];
  // Location filters
  contact_location?: string[];
  contact_city?: string[];
  contact_not_location?: string[];
  contact_not_city?: string[];
  // Company filters
  company_industry?: string[];
  company_not_industry?: string[];
  // Company size: 0-1, 2-10, 11-20, 21-50, 51-100, 101-200, 201-500, 501-1000, 1001-2000, 2001-5000, 10000+
  size?: string[];
  // Email status: validated, not_validated, unknown
  email_status?: string[];
  // Limit results
  limit?: number;
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

// Lead data from the Leads Finder output
interface LeadsFinderResult {
  // Contact info
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  email_status?: string;
  personal_email?: string;
  phone?: string;
  mobile_number?: string;
  // Professional info
  title?: string;
  job_title?: string;
  seniority?: string;
  linkedin_url?: string;
  linkedin?: string;
  // Company info
  company_name?: string;
  company?: string;
  organization?: string;
  company_website?: string;
  company_domain?: string;
  company_industry?: string;
  industry?: string;
  company_size?: string;
  company_linkedin?: string;
  // Location
  city?: string;
  state?: string;
  country?: string;
  location?: string;
}

// =============================================================================
// Seniority & Size Mapping
// =============================================================================

// Map our seniority values to Leads Finder API format
// API expects lowercase values: founder, owner, c_suite, director, vp, head, manager, senior, entry, trainee
const SENIORITY_MAP: Record<string, string> = {
  'owner': 'owner',
  'founder': 'founder',
  'c-suite': 'c_suite',
  'c_suite': 'c_suite',
  'csuite': 'c_suite',
  'c-level': 'c_suite',
  'clevel': 'c_suite',
  'ceo': 'c_suite',
  'cfo': 'c_suite',
  'cto': 'c_suite',
  'coo': 'c_suite',
  'cmo': 'c_suite',
  'vp': 'vp',
  'vice president': 'vp',
  'vice-president': 'vp',
  'head': 'head',
  'director': 'director',
  'manager': 'manager',
  'senior': 'senior',
  'entry': 'entry',
  'junior': 'entry',
  'intern': 'trainee',
  'trainee': 'trainee',
};

function mapSeniorities(seniorities?: string[]): string[] {
  if (!seniorities) return [];
  return seniorities
    .map(s => SENIORITY_MAP[s.toLowerCase()] || s)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// Map location values to Leads Finder API format (lowercase)
// API expects lowercase values like "united states", "california, us", etc.
function mapLocations(locations?: string[]): string[] {
  if (!locations) return [];
  return locations.map(loc => loc.toLowerCase());
}

// Map industry values to Leads Finder API format (lowercase)
// API expects specific lowercase values - map common variations to valid API values
const INDUSTRY_MAP: Record<string, string> = {
  // Direct mappings (already valid, just need lowercase)
  'information technology & services': 'information technology & services',
  'marketing & advertising': 'marketing & advertising',
  'management consulting': 'management consulting',
  'computer software': 'computer software',
  'professional training & coaching': 'professional training & coaching',

  // Common variations that need mapping
  'software development': 'computer software',
  'software': 'computer software',
  'saas': 'computer software',
  'technology': 'information technology & services',
  'tech': 'information technology & services',
  'it': 'information technology & services',
  'it services': 'information technology & services',
  'professional services': 'management consulting',
  'consulting': 'management consulting',
  'business services': 'management consulting',
  'business consulting': 'management consulting',
  'marketing': 'marketing & advertising',
  'advertising': 'marketing & advertising',
  'digital marketing': 'marketing & advertising',
  'b2b': 'information technology & services',
  'b2b services': 'management consulting',
  'finance': 'financial services',
  'fintech': 'financial services',
  'healthcare': 'hospital & health care',
  'health': 'health, wellness & fitness',
  'ecommerce': 'internet',
  'e-commerce': 'internet',
  'startup': 'internet',
  'startups': 'internet',
};

function mapIndustries(industries?: string[]): string[] {
  if (!industries || industries.length === 0) return [];

  const mapped = industries
    .map(ind => {
      const lower = ind.toLowerCase();
      // Use mapped value if exists, otherwise use lowercase original
      return INDUSTRY_MAP[lower] || lower;
    })
    // Remove duplicates
    .filter((v, i, a) => a.indexOf(v) === i)
    // Filter out values that aren't in the valid list (to avoid API errors)
    .filter(ind => isValidIndustry(ind));

  return mapped;
}

// Valid industries from the API (partial list of most common)
const VALID_INDUSTRIES = new Set([
  'information technology & services',
  'computer software',
  'internet',
  'marketing & advertising',
  'management consulting',
  'financial services',
  'professional training & coaching',
  'staffing & recruiting',
  'human resources',
  'retail',
  'health, wellness & fitness',
  'hospital & health care',
  'real estate',
  'construction',
  'education management',
  'e-learning',
  'higher education',
  'accounting',
  'legal services',
  'law practice',
  'insurance',
  'banking',
  'investment management',
  'telecommunications',
  'media production',
  'design',
  'graphic design',
  'architecture & planning',
  'entertainment',
  'hospitality',
  'restaurants',
  'food & beverages',
  'automotive',
  'logistics & supply chain',
  'transportation/trucking/railroad',
  'manufacturing',
  'consumer goods',
  'consumer services',
  'events services',
  'nonprofit organization management',
  'research',
  'biotechnology',
  'pharmaceuticals',
  'medical devices',
  'environmental services',
  'renewables & environment',
  'oil & energy',
  'mining & metals',
  'chemicals',
  'wholesale',
  'import & export',
  'computer & network security',
  'computer hardware',
  'computer networking',
  'computer games',
  'online media',
  'broadcast media',
  'publishing',
  'writing & editing',
  'public relations & communications',
  'market research',
  'venture capital & private equity',
  'capital markets',
  'investment banking',
]);

function isValidIndustry(industry: string): boolean {
  return VALID_INDUSTRIES.has(industry);
}

// Map employee ranges to Leads Finder size format
function mapEmployeeRanges(ranges?: string[]): string[] {
  if (!ranges || ranges.length === 0) return [];

  const sizeMap: Record<string, string> = {
    '1,10': '2-10',
    '11,20': '11-20',
    '21,50': '21-50',
    '51,100': '51-100',
    '101,200': '101-200',
    '201,500': '201-500',
    '501,1000': '501-1000',
    '1001,2000': '1001-2000',
    '2001,5000': '2001-5000',
    '5001,10000': '2001-5000', // Closest match
    '10001,': '10000+',
  };

  return ranges
    .map(r => sizeMap[r])
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// =============================================================================
// Employee Range Helpers (for backwards compatibility)
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
// Transform Functions
// =============================================================================

function transformLeadsFinderResult(lead: LeadsFinderResult): CreateLead | null {
  const email = lead.email || lead.personal_email;

  // Log what we received for debugging
  console.log(`   Processing lead: ${lead.first_name} ${lead.last_name} - email: ${email || 'NONE'}, status: ${lead.email_status || 'unknown'}`);

  if (!email) {
    console.log(`   ⚠️ Skipping lead - no email address`);
    return null;
  }

  // Skip invalid emails
  if (lead.email_status === 'invalid' || lead.email_status === 'bounced') {
    console.log(`   ⚠️ Skipping lead - email status: ${lead.email_status}`);
    return null;
  }

  // Parse name
  let firstName = lead.first_name || null;
  let lastName = lead.last_name || null;

  if (!firstName && !lastName && lead.full_name) {
    const nameParts = lead.full_name.split(' ');
    firstName = nameParts[0] || null;
    lastName = nameParts.slice(1).join(' ') || null;
  }

  // Parse location
  let city = lead.city || null;
  let state = lead.state || null;
  let country = lead.country || null;

  if (!city && !state && lead.location) {
    const locationParts = lead.location.split(',').map(s => s.trim());
    if (locationParts.length >= 2) {
      city = locationParts[0] || null;
      state = locationParts[1] || null;
      country = locationParts[2] || null;
    }
  }

  return {
    first_name: firstName,
    last_name: lastName,
    email: email.toLowerCase(),
    phone: lead.phone || lead.mobile_number || null,
    linkedin_url: lead.linkedin_url || lead.linkedin || null,
    company_name: lead.company_name || lead.company || lead.organization || null,
    job_title: lead.title || lead.job_title || null,
    seniority: lead.seniority || null,
    industry: lead.company_industry || lead.industry || null,
    website_url: lead.company_website || lead.company_domain || null,
    city,
    state,
    country,
    source: 'apify-leads-finder',
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
  input: LeadsFinderInput,
  apiToken: string,
  timeoutMs: number = 180000 // 3 minutes default
): Promise<{ success: boolean; datasetId?: string; error?: string }> {

  console.log('🚀 Starting Apify Leads Finder...');
  console.log('   Actor:', actorId);
  console.log('   Job Titles:', input.contact_job_title?.join(', ') || 'Any');
  console.log('   Locations:', input.contact_location?.join(', ') || 'Any');
  console.log('   Industries:', input.company_industry?.join(', ') || 'Any');
  console.log('   Limit:', input.limit);

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

    const runData = await runResponse.json() as ApifyRunResponse;
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

      const data = await response.json() as ApifyRunResponse;
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
): Promise<LeadsFinderResult[]> {
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

    const items = await response.json() as LeadsFinderResult[];
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
 * Search for leads using the FREE Apify Leads Finder
 * Requires only APIFY_API_TOKEN (no Apollo cookies needed!)
 *
 * Free tier: 100 leads per run
 */
export async function scrapeApify(params: ApifySearchParams): Promise<ApifyScraperResult> {
  console.log('🔍 Searching for leads via Apify Leads Finder...');
  console.log(`   Params: ${JSON.stringify(params, null, 2)}`);

  // Check for required token
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
    // Build actor input for code_crafter/leads-finder
    const actorInput: LeadsFinderInput = {
      // Job titles
      contact_job_title: params.jobTitles?.length > 0 ? params.jobTitles : undefined,
      // Seniority levels (mapped to lowercase API values)
      seniority_level: mapSeniorities(params.seniorities),
      // Locations (mapped to lowercase API values)
      contact_location: mapLocations(params.locations),
      // Industries (mapped to lowercase API values)
      company_industry: mapIndustries(params.industries),
      // Company sizes
      size: mapEmployeeRanges(params.employeeRanges),
      // Don't filter by email status - let all leads through and filter later if needed
      // (the 'validated' filter was too restrictive, returning very few results)
      // Limit results (free tier caps at 100)
      limit: Math.min(params.maxResults || 25, 100),
    };

    console.log('   Actor input:', JSON.stringify(actorInput, null, 2));

    // Run the actor and wait for completion
    const runResult = await runActorAndWait(
      LEADS_FINDER_ACTOR,
      actorInput,
      apifyConfig.apiToken,
      300000 // 5 minute timeout
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
      const lead = transformLeadsFinderResult(item);
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
    maxResults: Math.min(params.maxResults ?? 25, 100), // Free tier limit is 100 per run
  };
}

/**
 * Helper to build employee range parameter from ICP config
 */
export function buildEmployeeRanges(min: number, max: number): string[] {
  return getEmployeeRangeCodes(min, max);
}
