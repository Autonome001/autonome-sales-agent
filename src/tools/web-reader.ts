export async function readUrlContent(url: string): Promise<string> {
    console.log(`📖 Reading content from: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AutonomeBot/1.0; +http://autonome.us)'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }

        const html = await response.text();
        return extractTextFromHtml(html);
    } catch (error) {
        console.warn(`   ⚠️ Failed to read ${url}:`, error);
        return '';
    }
}

function extractTextFromHtml(html: string): string {
    // 1. Remove script and style tags
    let text = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, " ");
    text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, " ");

    // 2. Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // 3. Decode entities (basic)
    text = text.replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');

    // 4. Collapse whitespace
    text = text.replace(/\s+/g, " ").trim();

    // 5. Limit length to avoid token limits
    return text.substring(0, 15000);
}
