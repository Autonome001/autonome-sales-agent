/**
 * Apollo.io API Integration
 *
 * Uses the Apollo.io API directly to search for leads based on ICP criteria.
 * Requires an APOLLO_API_KEY environment variable.
 *
 * IMPORTANT: Uses the FREE api_search endpoint which does not consume credits.
 * The paid mixed_people/search endpoint is NOT accessible on free plans.
 *
 * Two-step process:
 * 1. Search with /api/v1/mixed_people/api_search (FREE - returns person IDs)
 * 2. Enrich with /v1/people/bulk_match for email/phone (uses credits)
 *
 * Apollo API Documentation: https://docs.apollo.io/
 */

import { apolloConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';

// Use the correct API base - note the /api prefix for the free endpoint
const APOLLO_API_BASE = 'https://api.apollo.io';

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
  // These flags indicate if data is available for enrichment
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

// Person from enrichment endpoint (full data)
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

interface ApolloBulkMatchResponse {
  matches: ApolloEnrichedPerson[];
}

// =============================================================================
// Apollo Employee Range Mapping
// =============================================================================

/**
 * Apollo uses specific employee range codes
 * These map to the employee count ranges in our ICP
 */
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

/**
 * Get Apollo employee range codes for a min/max range
 */
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

/**
 * Transform enriched Apollo person to CreateLead format
 */
function transformEnrichedPerson(person: ApolloEnrichedPerson): CreateLead | null {
  // Skip if no email or email is not verified
  if (!person.email) return null;

  // Skip bounced/invalid emails
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

/**
 * Transform search result person (without email) to CreateLead format
 * Used as fallback when enrichment is not available
 */
function transformSearchPerson(person: ApolloSearchPerson): CreateLead | null {
  // For search results without enrichment, we can only create partial leads
  // This is useful for tracking but they won't have emails
  return {
    first_name: person.first_name || null,
    last_name: person.last_name || null,
    email: '', // Will be empty - need enrichment for email
    phone: null,
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
// Apollo API Functions
// =============================================================================

/**
 * Step 1: Search for people using the FREE api_search endpoint
 * This endpoint does NOT consume credits but doesn't return emails
 */
async function searchPeople(params: ApolloSearchParams, apiKey: string): Promise<{
  success: boolean;
  people: ApolloSearchPerson[];
  totalFound: number;
  error?: string;
}> {
  const maxResults = params.maxResults ?? 50;

  // Build query parameters for the free endpoint
  // Note: The free endpoint uses query params, not body
  const queryParams = new URLSearchParams();
  queryParams.append('per_page', String(Math.min(maxResults, 100)));

  // Add person titles
  if (params.jobTitles && params.jobTitles.length > 0) {
    params.jobTitles.forEach(title => {
      queryParams.append('person_titles[]', title);
    });
  }

  // Add person locations
  if (params.locations && params.locations.length > 0) {
    params.locations.forEach(loc => {
      queryParams.append('person_locations[]', loc);
    });
  }

  // Add seniorities
  if (params.seniorities && params.seniorities.length > 0) {
    const seniorityMap: Record<string, string> = {
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
    params.seniorities.forEach(s => {
      const mapped = seniorityMap[s.toLowerCase()] || s.toLowerCase();
      queryParams.append('person_seniorities[]', mapped);
    });
  }

  // Add employee ranges
  if (params.employeeRanges && params.employeeRanges.length > 0) {
    params.employeeRanges.forEach(range => {
      queryParams.append('organization_num_employees_ranges[]', range);
    });
  }

  // Add industries as keywords
  if (params.industries && params.industries.length > 0) {
    params.industries.forEach(industry => {
      queryParams.append('q_organization_keyword_tags[]', industry);
    });
  }

  const url = `${APOLLO_API_BASE}/api/v1/mixed_people/api_search?${queryParams.toString()}`;
  console.log('📤 Apollo FREE Search URL:', url.replace(apiKey, '[REDACTED]'));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
        'accept': 'application/json',
      },
    });

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

    const data: ApolloSearchResponse = await response.json();

    console.log(`📊 Apollo FREE search returned ${data.people?.length || 0} results`);
    console.log(`   Total available: ${data.pagination?.total_entries || 0}`);

    if (data.people && data.people.length > 0) {
      const withEmail = data.people.filter(p => p.has_email).length;
      console.log(`   People with email available: ${withEmail}`);
    }

    return {
      success: true,
      people: data.people || [],
      totalFound: data.pagination?.total_entries || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, people: [], totalFound: 0, error: message };
  }
}

/**
 * Step 2: Enrich people by ID to get their email addresses
 * This endpoint DOES consume credits
 */
async function enrichPeopleById(personIds: string[], apiKey: string): Promise<ApolloEnrichedPerson[]> {
  if (personIds.length === 0) return [];

  console.log(`🔍 Enriching ${personIds.length} people to get emails...`);

  try {
    // Use bulk match endpoint with person IDs
    const response = await fetch(`${APOLLO_API_BASE}/v1/people/bulk_match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        details: personIds.map(id => ({ id })),
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Bulk enrichment failed: ${response.status} - ${errorText.slice(0, 200)}`);
      return [];
    }

    const data: ApolloBulkMatchResponse = await response.json();
    console.log(`✅ Enriched ${data.matches?.length || 0} people with contact info`);

    return data.matches || [];
  } catch (error) {
    console.error('❌ Bulk enrichment error:', error);
    return [];
  }
}

/**
 * Main search function - uses two-step process:
 * 1. FREE search to find people matching criteria
 * 2. PAID enrichment to get email addresses (only for people with has_email=true)
 */
export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  console.log('🔍 Searching Apollo.io for leads...');
  console.log(`   Params: ${JSON.stringify(params, null, 2)}`);

  // Validate API key
  if (!apolloConfig.apiKey) {
    console.error('❌ APOLLO_API_KEY not configured');
    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: 'APOLLO_API_KEY environment variable not set. Please add your Apollo API key.',
    };
  }

  try {
    // Step 1: Search using the FREE endpoint
    const searchResult = await searchPeople(params, apolloConfig.apiKey);

    if (!searchResult.success) {
      return {
        success: false,
        totalFound: 0,
        leads: [],
        error: searchResult.error,
      };
    }

    if (searchResult.people.length === 0) {
      console.warn('⚠️ Apollo returned 0 results for search params:', JSON.stringify(params, null, 2));
      return {
        success: true,
        totalFound: 0,
        leads: [],
      };
    }

    // Step 2: Filter for people who have emails and enrich them
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
      if (lead && lead.email) {
        leads.push(lead);
      }
    }

    console.log(`✅ Final result: ${leads.length} leads with valid emails`);

    return {
      success: true,
      totalFound: searchResult.totalFound,
      leads,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Apollo search failed:', message);

    return {
      success: false,
      totalFound: 0,
      leads: [],
      error: message,
    };
  }
}

/**
 * Enrich a single contact by email using Apollo
 * Note: This consumes credits
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
        'X-Api-Key': apolloConfig.apiKey,
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

    const data = await response.json();
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
    maxResults: Math.min(params.maxResults ?? 50, 100), // Cap at 100 (Apollo's limit)
  };
}

/**
 * Helper to build employee range parameter from ICP config
 */
export function buildEmployeeRanges(min: number, max: number): string[] {
  return getEmployeeRangeCodes(min, max);
}
