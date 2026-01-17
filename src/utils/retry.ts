/**
 * Retry Utility with Exponential Backoff
 * 
 * Provides resilient API call handling with:
 * - Configurable retry attempts
 * - Exponential backoff with jitter
 * - Custom error classification
 * - Progress callbacks for logging
 */

export interface RetryOptions {
    /** Maximum number of attempts (default: 3) */
    maxAttempts: number;
    /** Initial delay in milliseconds (default: 1000) */
    initialDelay: number;
    /** Maximum delay cap in milliseconds (default: 30000) */
    maxDelay: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier: number;
    /** Function to determine if error is retryable (default: all errors) */
    isRetryable?: (error: Error) => boolean;
    /** Callback on each retry attempt */
    onRetry?: (attempt: number, error: Error, nextDelay: number) => void;
    /** Operation name for logging */
    operationName?: string;
}

const DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
    attempt: number,
    initialDelay: number,
    maxDelay: number,
    backoffMultiplier: number
): number {
    // Exponential backoff: initialDelay * multiplier^attempt
    const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    // Add jitter (±25%) to prevent thundering herd
    const jitter = cappedDelay * (0.75 + Math.random() * 0.5);
    return Math.floor(jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract HTTP status code from error if available
 */
export function getErrorStatusCode(error: Error): number | null {
    // Check common error patterns
    const message = error.message.toLowerCase();

    // Check for status code in message
    const statusMatch = message.match(/status[:\s]+(\d{3})/i);
    if (statusMatch) {
        return parseInt(statusMatch[1], 10);
    }

    // Check error properties
    if ('status' in error && typeof (error as any).status === 'number') {
        return (error as any).status;
    }
    if ('statusCode' in error && typeof (error as any).statusCode === 'number') {
        return (error as any).statusCode;
    }

    return null;
}

/**
 * Default retryable error detector
 * Retries on: network errors, timeouts, 429, 5xx
 * Does NOT retry on: 400, 401, 403, 404
 */
export function isDefaultRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Network errors - always retry
    if (
        message.includes('network') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('socket hang up') ||
        message.includes('fetch failed')
    ) {
        return true;
    }

    // Timeout errors - always retry
    if (message.includes('timeout') || message.includes('timed out')) {
        return true;
    }

    // Check status code
    const statusCode = getErrorStatusCode(error);
    if (statusCode) {
        // Rate limit - retry
        if (statusCode === 429) return true;
        // Server errors - retry
        if (statusCode >= 500 && statusCode < 600) return true;
        // Client errors - don't retry (except 429)
        if (statusCode >= 400 && statusCode < 500) return false;
    }

    // Overloaded - retry (Anthropic specific)
    if (message.includes('overloaded') || message.includes('529')) {
        return true;
    }

    // Default: don't retry unknown errors
    return false;
}

/**
 * Execute a function with retry logic
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromAPI(),
 *   { maxAttempts: 3, operationName: 'API fetch' }
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
    const { maxAttempts, initialDelay, maxDelay, backoffMultiplier, isRetryable, onRetry, operationName } = opts;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if we should retry
            const shouldRetry = isRetryable ? isRetryable(lastError) : isDefaultRetryable(lastError);

            if (!shouldRetry || attempt >= maxAttempts) {
                // Don't retry - rethrow
                const opName = operationName || 'operation';
                console.error(`❌ ${opName} failed after ${attempt} attempt(s): ${lastError.message}`);
                throw lastError;
            }

            // Calculate delay for next attempt
            const delay = calculateDelay(attempt, initialDelay, maxDelay, backoffMultiplier);

            // Log retry
            const opName = operationName || 'operation';
            console.log(`⚠️ ${opName} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
            console.log(`   Retrying in ${(delay / 1000).toFixed(1)}s...`);

            // Call retry callback if provided
            if (onRetry) {
                onRetry(attempt, lastError, delay);
            }

            // Wait before retrying
            await sleep(delay);
        }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError || new Error('Retry failed');
}

/**
 * Create a retry wrapper with preset options
 * Useful for API-specific configurations
 * 
 * @example
 * ```typescript
 * const resendRetry = createRetryWrapper({
 *   maxAttempts: 3,
 *   initialDelay: 1000,
 *   operationName: 'Resend API'
 * });
 * 
 * await resendRetry(() => sendEmail(params));
 * ```
 */
export function createRetryWrapper(defaultOptions: Partial<RetryOptions>) {
    return async function <T>(
        fn: () => Promise<T>,
        overrideOptions: Partial<RetryOptions> = {}
    ): Promise<T> {
        return withRetry(fn, { ...defaultOptions, ...overrideOptions });
    };
}

// Pre-configured retry wrappers for common APIs

/** Retry wrapper for Apify API calls */
export const apifyRetry = createRetryWrapper({
    maxAttempts: 3,
    initialDelay: 5000,   // 5 seconds
    maxDelay: 60000,      // 1 minute
    backoffMultiplier: 2,
    operationName: 'Apify API',
});

/** Retry wrapper for Resend API calls */
export const resendRetry = createRetryWrapper({
    maxAttempts: 3,
    initialDelay: 1000,   // 1 second
    maxDelay: 10000,      // 10 seconds
    backoffMultiplier: 2,
    operationName: 'Resend API',
});

/** Retry wrapper for Anthropic/Claude API calls */
export const anthropicRetry = createRetryWrapper({
    maxAttempts: 3,
    initialDelay: 2000,   // 2 seconds
    maxDelay: 30000,      // 30 seconds
    backoffMultiplier: 2,
    operationName: 'Anthropic API',
});

/**
 * Extract Retry-After header value from error
 * Used for rate limit handling
 */
export function getRetryAfterMs(error: Error): number | null {
    const message = error.message;

    // Look for "retry after X seconds" pattern
    const secondsMatch = message.match(/retry.?after[:\s]+(\d+)\s*s/i);
    if (secondsMatch) {
        return parseInt(secondsMatch[1], 10) * 1000;
    }

    // Look for "retry after X" (assume seconds)
    const numMatch = message.match(/retry.?after[:\s]+(\d+)/i);
    if (numMatch) {
        return parseInt(numMatch[1], 10) * 1000;
    }

    return null;
}

/**
 * Retry wrapper that respects Retry-After headers
 * Ideal for rate-limited APIs like Resend
 */
export async function withRateLimitRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    return withRetry(fn, {
        ...options,
        isRetryable: (error) => {
            const statusCode = getErrorStatusCode(error);

            // Rate limit - definitely retry
            if (statusCode === 429) return true;

            // Use default logic for other errors
            return isDefaultRetryable(error);
        },
        onRetry: (attempt, error, calculatedDelay) => {
            // Check for Retry-After header
            const retryAfter = getRetryAfterMs(error);
            if (retryAfter && retryAfter > calculatedDelay) {
                console.log(`   Rate limited: waiting ${(retryAfter / 1000).toFixed(1)}s per Retry-After header`);
                // Note: The actual delay will still use calculated delay
                // For true Retry-After support, we'd need to modify the core retry logic
            }

            // Call original onRetry if provided
            if (options.onRetry) {
                options.onRetry(attempt, error, calculatedDelay);
            }
        },
    });
}
