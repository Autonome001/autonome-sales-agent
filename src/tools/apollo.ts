/**
 * Apollo.io API Integration
 *
 * Uses the Apollo.io API directly to search for leads based on ICP criteria.
 * Requires an APOLLO_API_KEY environment variable.
 *
 * AUTO-DETECTS PLAN TYPE:
 * - Paid plans: Uses /v1/mixed_people/search (single step, returns emails directly)
 * - Free plans: Uses /api/v1/mixed_people/api_search + enrichment (two steps)
 *
 * The code automatically falls back to the free method if the paid endpoint fails.
 * When you upgrade to a paid plan, it will automatically use the faster method.
 *
 * Apollo API Documentation: https://docs.apollo.io/
 */

import { apolloConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';
import { withRetry } from '../utils/retry.js';
import { logger, logSuccess } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

const APOLLO_API_BASE = 'https://api.apollo.io';

// Cache whether we have a paid plan (detected on first call)
let hasPaidPlan: boolean | null = null;

// =============================================================================
// Types
// =============================================================================

export interface ApolloSearchParams {
  locations: string[];
  industries: string[];
  jobTitles: string[];
  seniorities?: string[];
  employeeRanges?: string[];
  maxResults?: number;
}

export interface ApolloScraperResult {
  success: boolean;
  totalFound: number;
  leads: CreateLead[];
  error?: string;
}

// Person from the FREE api_search endpoint (limited data)
interface ApolloSearchPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  seniority: string;
  linkedin_url: string;
  city: string;
  state: string;
  country: string;
  headline: string;
  has_email: boolean;
  has_phone: boolean;
  organization?: {
    id: string;
    name: string;
    website_url: string;
    industry: string;
    estimated_num_employees: number;
  };
}

// Person from PAID endpoint or enrichment (full data with email)
interface ApolloEnrichedPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  email_status: string;
  title: string;
  seniority: string;
  linkedin_url: string;
  city: string;
  state: string;
  country: string;
  organization?: {
    id: string;
    name: string;
    website_url: string;
    primary_phone?: {
      number: string;
      sanitized_number: string;
    };
    industry: string;
    estimated_num_employees: number;
  };
}

interface ApolloSearchResponse {
  people: ApolloSearchPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

interface ApolloPaidSearchResponse {
  people: ApolloEnrichedPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

interface ApolloBulkMatchResponse {
  matches: ApolloEnrichedPerson[];
}

// =============================================================================
// Apollo Employee Range Mapping
// =============================================================================

const EMPLOYEE_RANGES = {
  '1-10': '1,10',
  '11-20': '11,20',
  '21-50': '21,50',
  '51-100': '51,100',
  '101-200': '101,200',
  '201-500': '201,500',
  '501-1000': '501,1000',
  '1001-2000': '1001,2000',
  '2001-5000': '2001,5000',
  '5001-10000': '5001,10000',
  '10001+': '10001,'
};

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

function transformEnrichedPerson(person: ApolloEnrichedPerson): CreateLead | null {
  if (!person.email) return null;

  if (person.email_status === 'invalid' || person.email_status === 'bounced') {
    return null;
  }

  return {
    first_name: person.first_name || null,
    last_name: person.last_name || null,
    email: person.email.toLowerCase(),
    phone: person.organization?.primary_phone?.sanitized_number ?? null,
    linkedin_url: person.linkedin_url || null,
    company_name: person.organization?.name ?? null,
    job_title: person.title || null,
    seniority: person.seniority || null,
    industry: person.organization?.industry || null,
    website_url: person.organization?.website_url || null,
    city: person.city || null,
    state: person.state || null,
    country: person.country || null,
    source: 'apollo',
  };
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

function mapSeniorities(seniorities: string[]): string[] {
  return seniorities
    .map(s => SENIORITY_MAP[s.toLowerCase()] || s.toLowerCase())
    .filter((v, i, a) => a.indexOf(v) === i);
}

// =============================================================================
// PAID PLAN: Direct Search (Single Step)
// =============================================================================

/**
 * Search using the PAID /v1/mixed_people/search endpoint
 * Returns emails directly - more efficient but requires paid plan
 */
async function searchPeoplePaid(params: ApolloSearchParams, apiKey: string): Promise<{
  success: boolean;
  people: ApolloEnrichedPerson[];
  totalFound: number;
  error?: string;
  isPlanError?: boolean;
}> {
  const maxResults = params.maxResults ?? 50;

  const searchBody: Record<string, any> = {
    page: 1,
    per_page: Math.min(maxResults, 100),
  };

  if (params.jobTitles?.length > 0) {
    searchBody.person_titles = params.jobTitles;
  }

  if (params.locations?.length > 0) {
    searchBody.person_locations = params.locations;
  }

  if (params.industries?.length > 0) {
    searchBody.q_organization_keyword_tags = params.industries;
  }

  if (params.seniorities && params.seniorities.length > 0) {
    searchBody.person_seniorities = mapSeniorities(params.seniorities);
  }

  if (params.employeeRanges && params.employeeRanges.length > 0) {
    searchBody.organization_num_employees_ranges = params.employeeRanges;
  }

  searchBody.contact_email_status = ['verified', 'guessed', 'likely'];

  logger.info('Apollo PAID Search request', { metadata: { titles: params.jobTitles, locations: params.locations } });

  try {
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(`${APOLLO_API_BASE}/v1/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey, // lowercase as per Apollo docs
      },
      body: JSON.stringify(searchBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    logger.info('PAID Response status', { metadata: { status: response.status } });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Apollo search failed: ${response.status}`;
      let isPlanError = false;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = errorJson.error;
          // Detect if this is a plan restriction error
          if (errorMessage.includes('not accessible') && errorMessage.includes('free plan')) {
            isPlanError = true;
          }
        }
      } catch {
        errorMessage += ` - ${errorText.slice(0, 200)}`;
      }

      return { success: false, people: [], totalFound: 0, error: errorMessage, isPlanError };
    }

    const data = await response.json() as ApolloPaidSearchResponse;

    logger.info(`Apollo PAID search returned ${data.people?.length || 0} results`, {
      metadata: { total: data.pagination?.total_entries }
    });

    return {
      success: true,
      people: data.people || [],
      totalFound: data.pagination?.total_entries || 0,
    };
  } catch (error) {
    logger.error('Apollo PAID search failed', { metadata: error });
    return { success: false, people: [], totalFound: 0, error: String(error) };
  }
}

// =============================================================================
// FREE PLAN: Two-Step Search (Search + Enrich)
// =============================================================================

/**
 * Search using the FREE /api/v1/mixed_people/api_search endpoint
 * Does NOT return emails - requires enrichment step
 */
async function searchPeopleFree(params: ApolloSearchParams, apiKey: string): Promise<{
  success: boolean;
  people: ApolloSearchPerson[];
  totalFound: number;
  error?: string;
}> {
  const maxResults = params.maxResults ?? 50;

  const queryParams = new URLSearchParams();
  queryParams.append('per_page', String(Math.min(maxResults, 100)));

  if (params.jobTitles?.length > 0) {
    params.jobTitles.forEach(title => {
      queryParams.append('person_titles[]', title);
    });
  }

  if (params.locations?.length > 0) {
    params.locations.forEach(loc => {
      queryParams.append('person_locations[]', loc);
    });
  }

  if (params.seniorities && params.seniorities.length > 0) {
    mapSeniorities(params.seniorities).forEach(s => {
      queryParams.append('person_seniorities[]', s);
    });
  }

  if (params.employeeRanges && params.employeeRanges.length > 0) {
    params.employeeRanges.forEach(range => {
      queryParams.append('organization_num_employees_ranges[]', range);
    });
  }

  if (params.industries?.length > 0) {
    params.industries.forEach(industry => {
      queryParams.append('q_organization_keyword_tags[]', industry);
    });
  }

  const url = `${APOLLO_API_BASE}/api/v1/mixed_people/api_search?${queryParams.toString()}`;
  logger.info('Apollo FREE Search (api_search endpoint)');

  try {
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey, // lowercase as per Apollo docs
        'accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    logger.info('Apollo Response status', { metadata: { status: response.status } });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Apollo search failed: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = `Apollo API Error: ${errorJson.error}`;
        }
      } catch {
        errorMessage += ` - ${errorText.slice(0, 200)}`;
      }
      return { success: false, people: [], totalFound: 0, error: errorMessage };
    }

    const data = await response.json() as ApolloSearchResponse;

    logger.info(`Apollo FREE search returned ${data.people?.length || 0} results`, {
      metadata: { total: data.pagination?.total_entries }
    });

    if (data.people?.length > 0) {
      const withEmail = data.people.filter(p => p.has_email).length;
      logger.info(`People with email available: ${withEmail}`);
    }

    return {
      success: true,
      people: data.people || [],
      totalFound: data.pagination?.total_entries || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Check if it was a timeout
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Apollo FREE search timed out after 30 seconds');
      return { success: false, people: [], totalFound: 0, error: 'Apollo API request timed out' };
    }
    logger.error('Apollo FREE search error', { metadata: error });
    return { success: false, people: [], totalFound: 0, error: message };
  }
}

/**
 * Enrich people by ID to get their email addresses
 * Used with FREE plan search results
 */
async function enrichPeopleById(personIds: string[], apiKey: string): Promise<ApolloEnrichedPerson[]> {
  if (personIds.length === 0) return [];

  logger.info(`Enriching ${personIds.length} people to get emails...`);

  try {
    const response = await fetch(`${APOLLO_API_BASE}/v1/people/bulk_match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey, // lowercase as per Apollo docs
      },
      body: JSON.stringify({
        details: personIds.map(id => ({ id })),
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Bulk enrichment failed', { metadata: { status: response.status, body: errorText.slice(0, 200) } });
      return [];
    }

    const data = await response.json() as ApolloBulkMatchResponse;
    logSuccess(`Enriched ${data.matches?.length || 0} people with contact info`);

    return data.matches || [];
  } catch (error) {
    logger.error('Bulk enrichment error', { metadata: error });
    return [];
  }
}

// =============================================================================
// Main Search Function (Auto-Detects Plan)
// =============================================================================

/**
 * Main search function - automatically uses the best method for your plan:
 * - PAID: Single API call with emails included
 * - FREE: Two-step process (search + enrich)
 *
 * When you upgrade to a paid plan, this will automatically use the faster method.
 */
export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  logger.info('Searching Apollo.io for leads...', { metadata: params });

  if (!apolloConfig.apiKey) {
    logger.error('APOLLO_API_KEY not configured');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APOLLO_API_KEY environment variable not set. Please add your Apollo API key.',
    };
  }

  try {
    // If we haven't determined plan type yet, or we think we have a paid plan, try paid endpoint first
    if (hasPaidPlan === null || hasPaidPlan === true) {
      console.log('🔄 Trying PAID endpoint first...');
      const paidResult = await searchPeoplePaid(params, apolloConfig.apiKey);

      if (paidResult.success) {
        // Paid endpoint worked! Cache this for future calls
        if (hasPaidPlan === null) {
          console.log('✅ PAID plan detected - will use fast single-step search');
          hasPaidPlan = true;
        }

        const leads: CreateLead[] = [];
        for (const person of paidResult.people) {
          const lead = transformEnrichedPerson(person);
          if (lead?.email) {
            leads.push(lead);
          }
        }

        console.log(`✅ Final result: ${leads.length} leads with valid emails`);

        return {
          success: true,
          totalFound: paidResult.totalFound,
          leads,
        };
      }

      // Check if the error is due to plan restrictions
      if (paidResult.isPlanError) {
        console.log('📝 Free plan detected - switching to two-step method');
        hasPaidPlan = false;
        // Fall through to free method
      } else if (hasPaidPlan === true) {
        // We thought we had paid but got an error - return the error
        return {
          success: false,
          totalFound: 0,
          leads: [],
          error: paidResult.error,
        };
      }
      // If hasPaidPlan was null and we got a non-plan error, try free method
    }

    // Use FREE two-step method
    console.log('🔄 Using FREE two-step method (search + enrich)...');

    // Step 1: Search
    const searchResult = await searchPeopleFree(params, apolloConfig.apiKey);

    if (!searchResult.success) {
      return {
        success: false,
        totalFound: 0,
        leads: [],
        error: searchResult.error,
      };
    }

    if (searchResult.people.length === 0) {
      console.warn('⚠️ Apollo returned 0 results for search params');
      return {
        success: true,
        totalFound: 0,
        leads: [],
      };
    }

    // Step 2: Filter for people with emails and enrich
    const peopleWithEmail = searchResult.people.filter(p => p.has_email);
    console.log(`📧 ${peopleWithEmail.length}/${searchResult.people.length} people have emails available`);

    if (peopleWithEmail.length === 0) {
      console.warn('⚠️ No people with emails found in search results');
      return {
        success: true,
        totalFound: searchResult.totalFound,
        leads: [],
      };
    }

    // Enrich to get actual email addresses
    const personIds = peopleWithEmail.slice(0, params.maxResults || 50).map(p => p.id);
    const enrichedPeople = await enrichPeopleById(personIds, apolloConfig.apiKey);

    // Transform to leads
    const leads: CreateLead[] = [];
    for (const person of enrichedPeople) {
      const lead = transformEnrichedPerson(person);
      if (lead?.email) {
        leads.push(lead);
      }
    }

    logSuccess(`Discovery complete: Found ${leads.length} leads with valid emails`);
    metrics.increment('leadsDiscovered', leads.length);

    return {
      success: true,
      totalFound: searchResult.totalFound,
      leads,
    };
  } catch (error) {
    logger.error('Apollo search failed', { metadata: error });
    metrics.increment('errorsCaught');

    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: String(error),
    };
  }
}

/**
 * Enrich a single contact by email using Apollo
 * Note: This consumes credits on any plan
 */
export async function enrichContact(email: string): Promise<ApolloEnrichedPerson | null> {
  if (!apolloConfig.apiKey) {
    console.error('❌ APOLLO_API_KEY not configured');
    return null;
  }

  try {
    const response = await fetch(`${APOLLO_API_BASE}/v1/people/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apolloConfig.apiKey, // lowercase as per Apollo docs
      },
      body: JSON.stringify({
        email: email,
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    });

    if (!response.ok) {
      console.error(`❌ Apollo enrichment failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as { person?: ApolloEnrichedPerson };
    return data.person || null;
  } catch (error) {
    console.error('❌ Apollo enrichment error:', error);
    return null;
  }
}

/**
 * Validate and normalize search parameters
 */
export function normalizeSearchParams(params: ApolloSearchParams): ApolloSearchParams {
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

/**
 * Force reset the plan detection (useful for testing)
 */
export function resetPlanDetection(): void {
  hasPaidPlan = null;
}
