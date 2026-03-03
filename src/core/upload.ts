/**
 * Upload module - core upload logic
 *
 * API: POST /trpc/application.dropDeployment
 * Body: multipart/form-data with:
 *   - zip: File (binary)
 *   - applicationId: string
 *   - dropBuildPath: string (optional)
 *
 * Uses streaming multipart to avoid double-buffering large files.
 */

import { access, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createZipStream, cleanupZip } from './archive.js';
import { fetchWithTimeout, throwUploadError } from './http.js';
import { getConfig, loadConfig, getServer, getAuth, getAppConfig, saveBuildType } from './config.js';
import { UploadError } from './errors.js';
import type { AppConfigBuildOptions } from './config.js';

export interface UploadArgs {
    /** Local path to upload (file or directory) */
    path: string;
    /** Dokploy application ID */
    app: string;
    /** Server build path */
    buildPath?: string;
    /** Override token */
    token?: string;
    /** Override server URL */
    server?: string;
    /** Build type and related settings to sync to Dokploy */
    build?: AppConfigBuildOptions;
    /** Request timeout in milliseconds */
    timeoutMs?: number;
    /** Max attempts for retryable failures */
    maxAttempts?: number;
    /** Base retry delay in milliseconds (multiplied by attempt) */
    retryDelayMs?: number;
}

export interface UploadResult {
    success: boolean;
    message: string;
}

/**
 * Validate that a path exists
 */
async function validatePath(path: string): Promise<void> {
    try {
        await access(path);
    } catch {
        // Local validation error - no statusCode since it's not an HTTP response
        throw new UploadError(`Path does not exist: ${path}`, undefined, undefined, 'PATH_NOT_FOUND', false);
    }
}

/**
 * Escape special characters in filename for multipart Content-Disposition header
 * Prevents header injection by escaping quotes and line breaks
 */
function escapeFilename(name: string): string {
    // Remove quotes and backslashes to prevent header injection
    return name
        .replace(/"/g, '')
        .replace(/\\/g, '')
        .replace(/[\r\n]/g, '');
}

/**
 * Sanitize form field values to prevent header injection
 * Removes carriage returns and newlines that could break multipart parsing
 */
function sanitizeFormValue(value: string): string {
    return value.replace(/[\r\n]/g, '');
}

/**
 * Validate and sanitize upload parameters
 * Throws UploadError if values contain unsafe characters
 */
function validateUploadParams(appId: string, serverBuildPath?: string): void {
    // Check for newline characters in appId
    if (/[\r\n]/.test(appId)) {
        throw new UploadError(
            'Invalid application ID: contains unsafe characters',
            undefined,
            undefined,
            'INVALID_APP_ID',
            false
        );
    }

    // Check for newline characters in serverBuildPath
    if (serverBuildPath && /[\r\n]/.test(serverBuildPath)) {
        throw new UploadError(
            'Invalid build path: contains unsafe characters',
            undefined,
            undefined,
            'INVALID_BUILD_PATH',
            false
        );
    }
}

function isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toPositiveIntOrFallback(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const v = Math.floor(value);
    return v > 0 ? v : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function getUploadDefaults(): Promise<{
    timeoutMs: number;
    maxAttempts: number;
    retryDelayMs: number;
}> {
    const overrides = getConfig();
    const config = await loadConfig();

    const timeoutFromOverrides = overrides.uploadTimeoutMs;
    const timeoutFromConfig = config?.upload?.timeoutMs;

    const maxAttemptsFromOverrides = overrides.uploadMaxAttempts;
    const maxAttemptsFromConfig = config?.upload?.maxAttempts;

    const retryDelayFromOverrides = overrides.uploadRetryDelayMs;
    const retryDelayFromConfig = config?.upload?.retryDelayMs;

    return {
        timeoutMs: isPositiveFiniteNumber(timeoutFromOverrides)
            ? timeoutFromOverrides
            : isPositiveFiniteNumber(timeoutFromConfig)
              ? timeoutFromConfig
              : 900000, // 15 minutes
        maxAttempts: toPositiveIntOrFallback(
            maxAttemptsFromOverrides ?? maxAttemptsFromConfig,
            3
        ),
        retryDelayMs: toPositiveIntOrFallback(
            retryDelayFromOverrides ?? retryDelayFromConfig,
            2000
        ),
    };
}

function isRetryableUploadError(err: unknown): boolean {
    const anyErr = err as any;

    const statusCode: number | undefined =
        typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : undefined;

    const code: string =
        typeof anyErr?.code === 'string' ? anyErr.code : '';

    const message: string =
        typeof anyErr?.message === 'string' ? anyErr.message : '';

    // 499 is commonly emitted by proxies when requests are closed/time out upstream.
    // TIMEOUT is thrown by fetchWithTimeout.
    // Treat common transient gateway statuses as retryable.
    return (
        statusCode === 499 ||
        statusCode === 502 ||
        statusCode === 503 ||
        statusCode === 504 ||
        code === 'TIMEOUT' ||
        /timed out/i.test(message)
    );
}

/**
 * Create a streaming multipart body
 *
 * Uses async generator to stream the file content without buffering
 * the entire file in memory. This avoids double-buffering for large files.
 */
function createMultipartStream(
    appId: string,
    filePath: string,
    serverBuildPath?: string
): { boundary: string; body: ReadableStream<Uint8Array> } {
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    // Sanitize filename to prevent header injection
    const fileName = escapeFilename(basename(filePath));
    // Sanitize form values to prevent header injection
    const safeAppId = sanitizeFormValue(appId);
    const safeBuildPath = serverBuildPath ? sanitizeFormValue(serverBuildPath) : undefined;

    // Declare fileStream outside the generator for cleanup access
    let fileStream: ReturnType<typeof createReadStream> | null = null;

    async function* parts(): AsyncGenerator<Uint8Array> {
        // Add applicationId field
        yield Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="applicationId"\r\n\r\n` +
            `${safeAppId}\r\n`
        );

        // Add dropBuildPath field if provided
        if (safeBuildPath) {
            yield Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="dropBuildPath"\r\n\r\n` +
                `${safeBuildPath}\r\n`
            );
        }

        // Add zip file header
        yield Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="zip"; filename="${fileName}"\r\n` +
            `Content-Type: application/zip\r\n\r\n`
        );

        // Stream the file content with proper cleanup
        fileStream = createReadStream(filePath);
        try {
            for await (const chunk of fileStream) {
                yield chunk;
            }
        } finally {
            // Ensure file descriptor is closed whether stream completes or is cancelled
            if (fileStream) {
                fileStream.destroy();
            }
        }

        // Close boundary
        yield Buffer.from(`\r\n--${boundary}--\r\n`);
    }

    // Convert Node.js Readable to Web ReadableStream
    const nodeStream = Readable.toWeb(Readable.from(parts()));

    return {
        boundary,
        body: nodeStream,
    };
}

/**
 * Upload a build to Dokploy
 *
 * @param args - Upload arguments
 * @returns Upload result
 * @throws {UploadError} If upload fails
 * @throws {AuthError} If authentication is missing
 * @throws {ConfigError} If server is not configured
 */
export async function upload(args: UploadArgs): Promise<UploadResult> {
    const {
        path: localPath,
        app: appId,
        buildPath: serverBuildPath,
        token,
        server,
    } = args;

    // Validate and sanitize upload parameters
    validateUploadParams(appId, serverBuildPath);

    // Get server URL first (needed for token lookup)
    const serverUrl = await getServer(server);

    // Get authentication (pass server URL for per-server token lookup)
    const auth = await getAuth(token, serverUrl);

    // Validate path
    await validatePath(localPath);

    // Determine if we need to create an archive
    const pathStat = await stat(localPath);
    const isDirectory = pathStat.isDirectory();

    let zipPath: string | null = null;

    try {
        let filePath = localPath;

        // Create ZIP if path is a directory
        if (isDirectory) {
            const baseName = appId || 'app';
            zipPath = await createZipStream(localPath, baseName);
            filePath = zipPath;
        }

        const defaults = await getUploadDefaults();
        const timeoutMs = isPositiveFiniteNumber(args.timeoutMs)
            ? args.timeoutMs
            : defaults.timeoutMs;
        const maxAttempts = toPositiveIntOrFallback(args.maxAttempts, defaults.maxAttempts);
        const retryDelayMs = toPositiveIntOrFallback(args.retryDelayMs, defaults.retryDelayMs);

        let lastError: unknown = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Create streaming multipart form data (must be recreated per attempt)
                const { boundary, body } = createMultipartStream(
                    appId,
                    filePath,
                    serverBuildPath
                );

                // Make the request with streaming body
                // duplex: 'half' is required for streaming request bodies in Node.js
                const response = await fetchWithTimeout(
                    `${serverUrl}/api/trpc/application.dropDeployment`,
                    {
                        method: 'POST',
                        headers: {
                            'x-api-key': auth.token,
                            'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        },
                        body,
                        duplex: 'half',
                        timeout: timeoutMs,
                    }
                );

                if (!response.ok) {
                    await throwUploadError(response, 'Upload failed');
                }

                lastError = null;
                break;
            } catch (err) {
                lastError = err;

                const shouldRetry =
                    attempt < maxAttempts && isRetryableUploadError(err);

                if (!shouldRetry) {
                    throw err;
                }

                await sleep(retryDelayMs * attempt);
            }
        }

        if (lastError) {
            throw lastError;
        }

        return {
            success: true,
            message: 'Upload successful! Deployment triggered.',
        };
    } finally {
        // Clean up temporary ZIP if created
        if (zipPath) {
            await cleanupZip(zipPath);
        }
    }
}

/**
 * Upload with app name lookup from config
 *
 * @param pathOrAppName - Either a local path or app name from config
 * @param args - Additional upload arguments
 * @returns Upload result
 */
export async function uploadWithConfig(
    pathOrAppName: string,
    args: Partial<UploadArgs> = {}
): Promise<UploadResult> {
    const { path: overridePath, app: overrideAppId, buildPath, token, server, build: overrideBuild } = args;

    // Try to find app config by name (treat pathOrAppName as app name)
    const appConfig = await getAppConfig(pathOrAppName);

    let resolvedPath: string;
    let appId: string;
    let resolvedBuildPath: string | undefined;
    let resolvedBuild;

    if (appConfig) {
        // Found config by name
        resolvedPath = overridePath || appConfig.localPath;
        appId = overrideAppId || appConfig.appId;
        resolvedBuildPath = buildPath || appConfig.serverBuildPath;
        resolvedBuild = overrideBuild || appConfig.build;
    } else {
        // Treat as direct path
        if (!overridePath && !pathOrAppName) {
            throw new UploadError('path is required', 400, undefined, 'MISSING_PATH');
        }
        resolvedPath = overridePath || pathOrAppName;
        appId = overrideAppId || '';

        if (!appId) {
            throw new UploadError('app ID is required (provide app name in config or --app argument)', 400, undefined, 'MISSING_APP_ID');
        }
        resolvedBuild = overrideBuild;
    }
 
    // Sync build type to Dokploy if configured
    if (resolvedBuild) {
        const serverUrl = await getServer(server);
        const auth = await getAuth(token, serverUrl);
        await saveBuildType(appId, resolvedBuild, serverUrl, auth.token);
    }

    return upload({
        path: resolvedPath,
        app: appId,
        buildPath: resolvedBuildPath,
        token,
        server,
        build: resolvedBuild,
    });
}
