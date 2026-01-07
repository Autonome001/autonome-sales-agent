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
// - 'peakydev~leads-scraper-ppe' - $1/1k leads, 70-90% email rate (HIT 100 LEAD/MONTH FREE LIMIT)
// - 'pipelinelabs~lead-scraper-apollo-zoominfo-lusha-ppe' - $1/1k leads, alternative
//
const LEADS_FINDER_ACTOR = 'pipelinelabs~lead-scraper-apollo-zoominfo-lusha-ppe';

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

// Input schema for pipelinelabs~lead-scraper-apollo-zoominfo-lusha-ppe
// See: https://apify.com/pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe
interface LeadsFinderInput {
  // Total results limit
  totalResults?: number;
  // Email filters
  hasEmail?: boolean;
  emailStatus?: 'verified' | 'unverified';
  // Job title filters - uses predefined enum values
  personTitleIncludes?: string[];
  personTitleExcludes?: string[];
  personTitleExtraIncludes?: string[]; // Free text for custom titles
  includeSimilarTitles?: boolean;
  // Seniority/Management levels
  seniorityIncludes?: string[];
  seniorityExcludes?: string[];
  // Department/Function
  personFunctionIncludes?: string[];
  personFunctionExcludes?: string[];
  // Person location filters
  personLocationCountryIncludes?: string[];
  personLocationCountryExcludes?: string[];
  personLocationStateIncludes?: string[];
  personLocationStateExcludes?: string[];
  personLocationCityIncludes?: string[];
  // Company location filters
  companyLocationCountryIncludes?: string[];
  companyLocationStateIncludes?: string[];
  companyLocationCityIncludes?: string[];
  // Company filters
  companyIndustryIncludes?: string[];
  companyIndustryExcludes?: string[];
  companyEmployeeSizeIncludes?: string[];
  companyKeywordIncludes?: string[];
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
// Supports multiple actor formats:
// - peakydev~leads-scraper-ppe: snake_case (first_name, last_name, job_title)
// - pipelinelabs~lead-scraper-apollo-zoominfo-lusha-ppe: camelCase (firstName, lastName, position)
interface LeadsFinderResult {
  // Contact info - snake_case (peakydev)
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  email_status?: string;
  personal_email?: string;
  phone?: string;
  mobile_number?: string;
  // Contact info - camelCase (pipelinelabs)
  firstName?: string;
  lastName?: string;
  fullName?: string;
  mobilePhone?: string;
  // Professional info - snake_case
  title?: string;
  job_title?: string;
  seniority?: string;
  linkedin_url?: string;
  linkedin?: string;
  // Professional info - camelCase (pipelinelabs)
  position?: string;
  linkedinUrl?: string;
  // Company info - snake_case
  company_name?: string;
  company?: string;
  organization?: string;
  company_website?: string;
  company_domain?: string;
  company_industry?: string;
  industry?: string;
  company_size?: string;
  company_linkedin?: string;
  // Company info - camelCase (pipelinelabs)
  orgName?: string;
  orgWebsite?: string;
  orgIndustry?: string;
  orgSize?: string;
  orgLinkedin?: string;
  // Location
  city?: string;
  state?: string;
  country?: string;
  location?: string;
}

// =============================================================================
// Seniority & Size Mapping for pipelinelabs actor
// =============================================================================

// Map our seniority values to pipelinelabs API format (Title Case)
// Valid values: Entry, Senior, Manager, Director, VP, C-Suite, Owner, Head, Founder, Partner, Intern
const SENIORITY_MAP: Record<string, string> = {
  'owner': 'Owner',
  'founder': 'Founder',
  'c-suite': 'C-Suite',
  'c_suite': 'C-Suite',
  'csuite': 'C-Suite',
  'c-level': 'C-Suite',
  'clevel': 'C-Suite',
  'ceo': 'C-Suite',
  'cfo': 'C-Suite',
  'cto': 'C-Suite',
  'coo': 'C-Suite',
  'cmo': 'C-Suite',
  'vp': 'VP',
  'vice president': 'VP',
  'vice-president': 'VP',
  'head': 'Head',
  'director': 'Director',
  'manager': 'Manager',
  'senior': 'Senior',
  'entry': 'Entry',
  'junior': 'Entry',
  'intern': 'Intern',
  'trainee': 'Intern',
  'partner': 'Partner',
};

function mapSeniorities(seniorities?: string[]): string[] {
  if (!seniorities) return [];
  return seniorities
    .map(s => SENIORITY_MAP[s.toLowerCase()] || s)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// Parse location string to extract country and state
// Input: "North Carolina, United States" or "United States" or "California"
function parseLocation(location: string): { country?: string; state?: string } {
  const parts = location.split(',').map(p => p.trim());

  // Check if it's a US state
  const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'];

  if (parts.length >= 2) {
    // Format: "State, Country" or "City, State, Country"
    const lastPart = parts[parts.length - 1];
    const secondLastPart = parts[parts.length - 2];

    // Check if last part is a country
    if (lastPart.toLowerCase().includes('united states') || lastPart.toLowerCase() === 'usa' || lastPart.toLowerCase() === 'us') {
      return { country: 'United States', state: secondLastPart };
    }
    return { country: lastPart, state: secondLastPart };
  }

  // Single part - check if it's a country or state
  const single = parts[0];
  if (US_STATES.some(s => s.toLowerCase() === single.toLowerCase())) {
    return { country: 'United States', state: single };
  }
  return { country: single };
}

// Map industry values to pipelinelabs API format (Title Case with &)
// Valid values include: Computer Software, Information Technology & Services, Management Consulting, etc.
const INDUSTRY_MAP: Record<string, string> = {
  // Direct mappings to valid API values
  'information technology & services': 'Information Technology & Services',
  'marketing & advertising': 'Marketing & Advertising',
  'management consulting': 'Management Consulting',
  'computer software': 'Computer Software',
  'professional training & coaching': 'Professional Training & Coaching',
  'financial services': 'Financial Services',

  // Common variations that need mapping
  'software development': 'Computer Software',
  'software': 'Computer Software',
  'saas': 'Computer Software',
  'technology': 'Information Technology & Services',
  'tech': 'Information Technology & Services',
  'it': 'Information Technology & Services',
  'it services': 'Information Technology & Services',
  'professional services': 'Management Consulting',
  'consulting': 'Management Consulting',
  'consultants': 'Management Consulting',
  'business services': 'Management Consulting',
  'business consulting': 'Management Consulting',
  'marketing': 'Marketing & Advertising',
  'advertising': 'Marketing & Advertising',
  'digital marketing': 'Marketing & Advertising',
  'b2b': 'Information Technology & Services',
  'b2b services': 'Management Consulting',
  'finance': 'Financial Services',
  'fintech': 'Financial Services',
  'healthcare': 'Hospital & Health Care',
  'health': 'Health, Wellness & Fitness',
  'ecommerce': 'Internet',
  'e-commerce': 'Internet',
  'startup': 'Internet',
  'startups': 'Internet',
  'internet': 'Internet',
  'real estate': 'Real Estate',
  'construction': 'Construction',
  'retail': 'Retail',
  'education': 'Education Management',
  'staffing': 'Staffing & Recruiting',
  'recruiting': 'Staffing & Recruiting',
  'hr': 'Human Resources',
  'human resources': 'Human Resources',
  'accounting': 'Accounting',
  'legal': 'Legal Services',
  'law': 'Law Practice',
  'insurance': 'Insurance',
  'banking': 'Banking',
};

function mapIndustries(industries?: string[]): string[] {
  if (!industries || industries.length === 0) return [];

  const mapped = industries
    .map(ind => {
      const lower = ind.toLowerCase();
      // Use mapped value if exists, otherwise try to Title Case it
      return INDUSTRY_MAP[lower] || ind;
    })
    // Remove duplicates
    .filter((v, i, a) => a.indexOf(v) === i)
    // Filter out values that aren't in the valid list (to avoid API errors)
    .filter(ind => isValidIndustry(ind));

  return mapped;
}

// Valid industries from the pipelinelabs API (Title Case)
const VALID_INDUSTRIES = new Set([
  'Information Technology & Services',
  'Computer Software',
  'Internet',
  'Marketing & Advertising',
  'Management Consulting',
  'Financial Services',
  'Professional Training & Coaching',
  'Staffing & Recruiting',
  'Human Resources',
  'Retail',
  'Health, Wellness & Fitness',
  'Hospital & Health Care',
  'Real Estate',
  'Construction',
  'Education Management',
  'E-Learning',
  'Higher Education',
  'Accounting',
  'Legal Services',
  'Law Practice',
  'Insurance',
  'Banking',
  'Investment Management',
  'Telecommunications',
  'Media Production',
  'Design',
  'Graphic Design',
  'Architecture & Planning',
  'Entertainment',
  'Hospitality',
  'Restaurants',
  'Food & Beverages',
  'Automotive',
  'Logistics & Supply Chain',
  'Transportation/Trucking/Railroad',
  'Manufacturing',
  'Consumer Goods',
  'Consumer Services',
  'Events Services',
  'Nonprofit Organization Management',
  'Research',
  'Biotechnology',
  'Pharmaceuticals',
  'Medical Devices',
  'Environmental Services',
  'Renewables & Environment',
  'Oil & Energy',
  'Mining & Metals',
  'Chemicals',
  'Wholesale',
  'Import & Export',
  'Computer & Network Security',
  'Computer Hardware',
  'Computer Networking',
  'Computer Games',
  'Online Media',
  'Broadcast Media',
  'Publishing',
  'Writing & Editing',
  'Public Relations & Communications',
  'Market Research',
  'Venture Capital & Private Equity',
  'Capital Markets',
  'Investment Banking',
]);

function isValidIndustry(industry: string): boolean {
  return VALID_INDUSTRIES.has(industry);
}

// Map employee ranges to pipelinelabs size format
// Valid values: 1-10, 11-20, 21-50, 51-100, 101-200, 201-500, 501-1000, 1001-2000, 2001-5000, 5001-10000, 10001+
function mapEmployeeRanges(ranges?: string[]): string[] {
  if (!ranges || ranges.length === 0) return [];

  const sizeMap: Record<string, string> = {
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

  // Parse name - support both snake_case and camelCase formats
  let firstName = lead.first_name || lead.firstName || null;
  let lastName = lead.last_name || lead.lastName || null;
  const fullName = lead.full_name || lead.fullName;

  if (!firstName && !lastName && fullName) {
    const nameParts = fullName.split(' ');
    firstName = nameParts[0] || null;
    lastName = nameParts.slice(1).join(' ') || null;
  }

  // Log what we received for debugging
  console.log(`   Processing lead: ${firstName} ${lastName} - email: ${email || 'NONE'}, status: ${lead.email_status || 'unknown'}`);

  if (!email) {
    console.log(`   ⚠️ Skipping lead - no email address`);
    return null;
  }

  // Skip invalid emails
  if (lead.email_status === 'invalid' || lead.email_status === 'bounced') {
    console.log(`   ⚠️ Skipping lead - email status: ${lead.email_status}`);
    return null;
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

  // Map fields - support both snake_case (peakydev) and camelCase (pipelinelabs) formats
  return {
    first_name: firstName,
    last_name: lastName,
    email: email.toLowerCase(),
    phone: lead.phone || lead.mobile_number || lead.mobilePhone || null,
    linkedin_url: lead.linkedin_url || lead.linkedin || lead.linkedinUrl || null,
    company_name: lead.company_name || lead.company || lead.organization || lead.orgName || null,
    job_title: lead.title || lead.job_title || lead.position || null,
    seniority: lead.seniority || null,
    industry: lead.company_industry || lead.industry || lead.orgIndustry || null,
    website_url: lead.company_website || lead.company_domain || lead.orgWebsite || null,
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
  limit: number = 1000
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

    // Debug: Log the first item's raw structure to see actual field names
    if (items.length > 0) {
      console.log('🔍 DEBUG - First item raw fields:', JSON.stringify(items[0], null, 2));
    }

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
    // Parse locations to extract countries and states
    const countries: string[] = [];
    const states: string[] = [];
    if (params.locations?.length > 0) {
      for (const loc of params.locations) {
        const parsed = parseLocation(loc);
        if (parsed.country && !countries.includes(parsed.country)) {
          countries.push(parsed.country);
        }
        if (parsed.state && !states.includes(parsed.state)) {
          states.push(parsed.state);
        }
      }
    }

    // Build actor input for pipelinelabs actor
    const actorInput: LeadsFinderInput = {
      // Total results limit - no cap, use PIPELINE_LIMIT directly
      totalResults: params.maxResults || 25,
      // Require email addresses
      hasEmail: true,
      // Job titles - use free text field for custom titles
      personTitleExtraIncludes: params.jobTitles?.length > 0 ? params.jobTitles : undefined,
      includeSimilarTitles: true,
      // Seniority levels (mapped to Title Case)
      seniorityIncludes: mapSeniorities(params.seniorities),
      // Person location filters
      personLocationCountryIncludes: countries.length > 0 ? countries : undefined,
      personLocationStateIncludes: states.length > 0 ? states : undefined,
      // Company filters
      companyIndustryIncludes: mapIndustries(params.industries),
      companyEmployeeSizeIncludes: mapEmployeeRanges(params.employeeRanges),
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
      params.maxResults || 1000
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
