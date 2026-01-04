/**
 * Apollo.io API Integration
 *
 * Uses the Apollo.io API directly to search for leads based on ICP criteria.
 * Requires an APOLLO_API_KEY environment variable.
 *
 * Apollo API Documentation: https://apolloio.github.io/apollo-api-docs/
 */

import { apolloConfig } from '../config/index.js';
import type { CreateLead } from '../types/index.js';

const APOLLO_API_BASE = 'https://api.apollo.io/v1';

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

interface ApolloPerson {
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
  organization: {
    id: string;
    name: string;
    website_url: string;
    primary_phone: {
      number: string;
      sanitized_number: string;
    };
    industry: string;
    estimated_num_employees: number;
  };
}

interface ApolloSearchResponse {
  people: ApolloPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
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
 * Transform Apollo API response to CreateLead format
 */
function transformApolloPerson(person: ApolloPerson): CreateLead | null {
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

// =============================================================================
// Apollo API Functions
// =============================================================================

/**
 * Search for people using Apollo's People Search API
 */
export async function scrapeApollo(params: ApolloSearchParams): Promise<ApolloScraperResult> {
  const maxResults = params.maxResults ?? 50;

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
    // Build the search request body (API key goes in header, not body)
    const searchBody: Record<string, any> = {
      page: 1,
      per_page: Math.min(maxResults, 100), // Apollo max is 100 per page
    };

    // Add person titles (job titles)
    if (params.jobTitles && params.jobTitles.length > 0) {
      searchBody.person_titles = params.jobTitles;
    }

    // Add person locations
    if (params.locations && params.locations.length > 0) {
      searchBody.person_locations = params.locations;
    }

    // Add organization industries (use keyword search which accepts string names)
    if (params.industries && params.industries.length > 0) {
      searchBody.q_organization_keyword_tags = params.industries;
    }

    // Add seniorities if provided
    // Apollo expects: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern
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
      searchBody.person_seniorities = params.seniorities
        .map(s => seniorityMap[s.toLowerCase()] || s.toLowerCase())
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
    }

    // Add employee ranges if provided
    if (params.employeeRanges && params.employeeRanges.length > 0) {
      searchBody.organization_num_employees_ranges = params.employeeRanges;
    }

    // Only get contacts with emails
    searchBody.contact_email_status = ['verified', 'guessed', 'likely'];

    console.log('📤 Apollo API request:', JSON.stringify(searchBody, null, 2));

    const response = await fetch(`${APOLLO_API_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloConfig.apiKey,
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Apollo API request failed: ${response.status}`;

      // Parse common Apollo errors
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = `Apollo API Error: ${errorJson.error}`;
        }
      } catch {
        errorMessage += ` - ${errorText.slice(0, 200)}`;
      }

      throw new Error(errorMessage);
    }

    const data: ApolloSearchResponse = await response.json();

    // Debug log
    console.log(`📊 Apollo returned ${data.people?.length || 0} results`);
    console.log(`   Total available: ${data.pagination?.total_entries || 0}`);

    // Log detailed params when 0 results for debugging
    if (!data.people || data.people.length === 0) {
      console.warn('⚠️ Apollo returned 0 results. Request params:', JSON.stringify({
        person_titles: searchBody.person_titles,
        person_locations: searchBody.person_locations,
        person_seniorities: searchBody.person_seniorities,
        organization_num_employees_ranges: searchBody.organization_num_employees_ranges,
        q_organization_keyword_tags: searchBody.q_organization_keyword_tags,
      }, null, 2));
    }

    if (data.people && data.people.length > 0) {
      console.log('📄 First result sample:', JSON.stringify(data.people[0], null, 2));
    }

    // Transform results
    const leads: CreateLead[] = [];

    for (const person of data.people || []) {
      const lead = transformApolloPerson(person);
      if (lead) {
        leads.push(lead);
      }
    }

    console.log(`✅ Found ${data.pagination?.total_entries || 0} total, ${leads.length} with valid emails`);

    return {
      success: true,
      totalFound: data.pagination?.total_entries || leads.length,
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
 */
export async function enrichContact(email: string): Promise<ApolloPerson | null> {
  if (!apolloConfig.apiKey) {
    console.error('❌ APOLLO_API_KEY not configured');
    return null;
  }

  try {
    const response = await fetch(`${APOLLO_API_BASE}/people/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloConfig.apiKey,
      },
      body: JSON.stringify({
        email: email,
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
