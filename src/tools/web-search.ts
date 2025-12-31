import { apifyConfig } from '../config/index.js';

const GOOGLE_SEARCH_ACTOR = 'apify/google-search-scraper';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface SearchResult {
    title: string;
    description: string;
    url: string;
}

export async function googleSearch(query: string, maxResults: number = 3): Promise<SearchResult[]> {
    console.log(`🔍 Searching Google for: "${query}"`);

    try {
        const response = await fetch(
            `${APIFY_BASE_URL}/acts/${GOOGLE_SEARCH_ACTOR}/run-sync-get-dataset-items?token=${apifyConfig.apiToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    queries: [query],
                    resultsPerPage: maxResults,
                    maxPagesPerQuery: 1,
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`Apify Google Search failed: ${response.status}`);
        }

        const data = await response.json();

        // Parse Apify Google Search structure
        // The output format varies, but usually:
        // [{ organicResults: [ { title, url, description }, ... ] }]
        // We need to flatten this.

        // Note: run-sync-get-dataset-items returns the array of items in the dataset.
        // For google-search-scraper, each item is a page of results.

        const results: SearchResult[] = [];

        if (Array.isArray(data)) {
            data.forEach((page: any) => {
                const organic = page.organicResults || [];
                organic.forEach((result: any) => {
                    results.push({
                        title: result.title,
                        description: result.description,
                        url: result.url
                    });
                });
            });
        }

        console.log(`   ✅ Found ${results.length} results`);
        return results.slice(0, maxResults);

    } catch (error) {
        console.error('❌ Web search failed:', error);
        return [];
    }
}
