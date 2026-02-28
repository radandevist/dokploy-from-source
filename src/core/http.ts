/**
 * HTTP client module
 *
 * Provides typed HTTP operations with timeout support
 * and proper error handling.
 */

import { UploadError } from './errors.js';

export interface HttpOptions {
    /** Request timeout in milliseconds */
    timeout?: number;
    /** Additional headers */
    headers?: Record<string, string>;
    /** Enable streaming mode for request body */
    duplex?: 'half';
}

export interface HttpResponse {
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
    json<T>(): Promise<T>;
}

/**
 * Create a fetch request with timeout support
 *
 * @param url - URL to fetch
 * @param options - Fetch options including timeout
 * @returns Response object
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit & HttpOptions = {}
): Promise<HttpResponse> {
    const { timeout = 60000, ...fetchOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
        });

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            text: () => response.text(),
            json: <T>() => response.json() as Promise<T>,
        };
    } catch (error) {
        if (error instanceof Error) {
            // AbortError means timeout
            if (error.name === 'AbortError') {
                throw new UploadError(
                    `Request timed out after ${timeout}ms`,
                    undefined,
                    undefined,
                    'TIMEOUT',
                    false, // not an HTTP response
                    { cause: error }
                );
            }
            // Network errors (DNS, connection refused, etc.) - these have generic message
            if (error.message === 'fetch failed' || error.cause) {
                const cause = error.cause as Error | undefined;
                throw new UploadError(
                    `Network error: ${cause?.message || error.message}`,
                    undefined,
                    undefined,
                    'NETWORK_ERROR',
                    false, // not an HTTP response
                    { cause: error }
                );
            }
            // Other errors
            throw new UploadError(
                `Request failed: ${error.message}`,
                undefined,
                undefined,
                'REQUEST_FAILED',
                false,
                { cause: error }
            );
        }
        // Unknown error
        throw new UploadError(
            `Unknown error: ${String(error)}`,
            undefined,
            undefined,
            'UNKNOWN_ERROR',
            false,
            { cause: error }
        );
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check if response indicates a server error
 */
export function isServerError(response: HttpResponse): boolean {
    return !response.ok;
}

/**
 * Throw an UploadError from a failed response
 */
export async function throwUploadError(
    response: HttpResponse,
    context?: string
): Promise<never> {
    const body = await response.text();
    throw new UploadError(
        context
            ? `${context}: ${response.status} ${response.statusText}`
            : `Upload failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
        'UPLOAD_FAILED',
        true // isHttp = true since this is from an HTTP response
    );
}
