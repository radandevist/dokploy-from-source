/**
 * Public API for dokploy-from-source
 *
 * Use this API in your IaC pipelines for programmatic deployments.
 *
 * Usage:
 *   import { configure, upload } from 'dokploy-from-source';
 *
 *   // Optional: override config file settings
 *   configure({ server: 'https://dokploy.example.com', token: 'xxx' });
 *
 *   // Upload build
 *   await upload({ path: './dist', appName: 'myapp' });
 */

import { configure as configureApi, getConfig, resetConfig } from './lib/config.js';
import { upload as doUpload } from './commands/upload.js';
import { getAppConfig } from './lib/config.js';

// ============================================================================
// Types
// ============================================================================

export interface ConfigureOptions {
    /** Dokploy server URL (e.g., https://dokploy.example.com) */
    server?: string;
    /** API token for authentication */
    token?: string;
}

export interface UploadOptions {
    /**
     * Local path to upload (file or directory)
     * Required unless appName is provided with localPath in config
     */
    path?: string;
    /**
     * Application name to look up from dfs.config.js
     * When provided, appId and localPath are read from config
     */
    appName?: string;
    /** Dokploy application ID (required if not using appName) */
    appId?: string;
    /**
     * Local build folder path (from config when using appName)
     * Overrides config if provided directly
     */
    localPath?: string;
    /** Server build path (where app is served on server) */
    buildPath?: string;
    /**
     * Direct token override (bypasses config file and auth.json)
     */
    token?: string;
    /**
     * Direct server URL override
     */
    server?: string;
}

export interface UploadResult {
    success: boolean;
    message: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Configure programmatic overrides
 *
 * Values passed here take precedence over dfs.config.js and auth.json
 */
export function configure(options: ConfigureOptions): void {
    configureApi(options);
}

/**
 * Get current configuration overrides
 */
export function getConfigOverrides(): ConfigureOptions {
    return getConfig() as ConfigureOptions;
}

/**
 * Reset configuration overrides to defaults
 */
export function resetConfigure(): void {
    resetConfig();
}

/**
 * Upload a build to Dokploy
 *
 * @param options - Upload configuration
 * @returns Upload result
 */
export async function upload(options: UploadOptions): Promise<UploadResult> {
    let { path, appId, localPath, buildPath, token, server } = options;
    const appName = options.appName;

    // If appName provided, look up config
    if (appName) {
        const appConfig = await getAppConfig(appName);
        if (!appConfig) {
            throw new Error(`App "${appName}" not found in dfs.config.js`);
        }
        appId = appConfig.appId;
        localPath = localPath || appConfig.localPath;
        buildPath = buildPath || appConfig.serverBuildPath;
    }

    if (!localPath && !path) {
        throw new Error('path or localPath is required');
    }

    // Use path if localPath not set
    const resolvedPath = localPath || path;

    if (!resolvedPath) {
        throw new Error('path is required');
    }

    await doUpload({
        path: resolvedPath,
        app: appId,
        buildPath,
        token,
        server,
    });

    return {
        success: true,
        message: 'Upload successful! Deployment triggered.',
    };
}
