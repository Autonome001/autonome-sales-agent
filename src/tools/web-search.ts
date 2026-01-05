import { apifyConfig } from '../config/index.js';

// Multiple actor options for Google Search - try in order
// 1. naz_dev~google-search-light - Free, lightweight (try first)
// 2. apify~google-search-scraper - Official but may require paid plan
const GOOGLE_SEARCH_ACTORS = [
    'naz_dev~google-search-light',
    'apify~google-search-scraper',
];
const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface SearchResult {
    title: string;
    description: string;
    url: string;
}

export async function googleSearch(query: string, maxResults: number = 3): Promise<SearchResult[]> {
    console.log(`🔍 Searching Google for: "${query}"`);

    // Try each actor until one works
    for (const actorId of GOOGLE_SEARCH_ACTORS) {
        try {
            const results = await tryGoogleSearchActor(actorId, query, maxResults);
            if (results.length > 0) {
                return results;
            }
        } catch (error) {
            console.log(`   ⚠️ Actor ${actorId} failed, trying next...`);
        }
    }

    // All actors failed - return empty results (research will continue without web enrichment)
    console.log('   ⚠️ All Google Search actors failed - continuing without web search');
    return [];
}

async function tryGoogleSearchActor(actorId: string, query: string, maxResults: number): Promise<SearchResult[]> {
    // Build input based on actor type
    let input: Record<string, any>;

    if (actorId.includes('google-search-light')) {
        // naz_dev~google-search-light uses different input format
        input = {
            query: query,
            maxResults: maxResults,
        };
    } else {
        // apify~google-search-scraper format
        input = {
            queries: [query],
            resultsPerPage: maxResults,
            maxPagesPerQuery: 1,
        };
    }

    const response = await fetch(
        `${APIFY_BASE_URL}/acts/${actorId}/run-sync-get-dataset-items?token=${apifyConfig.apiToken}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Apify ${actorId} failed: ${response.status} - ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    const results: SearchResult[] = [];

    if (Array.isArray(data)) {
        data.forEach((item: any) => {
            // Handle different output formats from different actors

            // Format 1: naz_dev~google-search-light returns flat array of results
            if (item.title && item.link) {
                results.push({
                    title: item.title,
                    description: item.description || item.snippet || '',
                    url: item.link || item.url,
                });
            }
            // Format 2: apify~google-search-scraper returns pages with organicResults
            else if (item.organicResults) {
                const organic = item.organicResults || [];
                organic.forEach((result: any) => {
                    results.push({
                        title: result.title,
                        description: result.description || result.snippet || '',
                        url: result.url || result.link,
                    });
                });
            }
            // Format 3: Other actors might use different field names
            else if (item.url || item.link) {
                results.push({
                    title: item.title || 'No title',
                    description: item.description || item.snippet || '',
                    url: item.url || item.link,
                });
            }
        });
    }

    if (results.length > 0) {
        console.log(`   ✅ Found ${results.length} results via ${actorId}`);
    }

    return results.slice(0, maxResults);
}
