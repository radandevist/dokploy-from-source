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
 *   await upload({ path: './dist', appId: 'my-app-id' });
 */

import {
    configure as configureApi,
    getConfig,
    resetConfig,
    getServer,
    setAuth,
    loadConfig,
    getAppConfig,
} from './core/config.js';
import { upload as doUpload, uploadWithConfig } from './core/upload.js';
import {
    DfsError,
    ConfigError,
    AuthError,
    UploadError,
} from './core/errors.js';

// Re-export types
export type { UploadResult } from './core/upload.js';
export type { Config, AppConfig, Auth, ConfigOverrides } from './core/config.js';

// ConfigureOptions interface for the public API
export interface ConfigureOptions {
    /** Dokploy server URL (e.g., https://dokploy.example.com) */
    server?: string;
    /** API token for authentication */
    token?: string;
}

// UploadOptions interface for the public API
export interface UploadOptions {
    /**
     * Local path to upload (file or directory)
     * Required unless appName is provided with localPath in config
     */
    path?: string;
    /**
     * Application name to look up from dfs.config.cjs
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

// Re-export error types
export { DfsError, ConfigError, AuthError, UploadError } from './core/errors.js';

/**
 * Configure programmatic overrides
 *
 * Values passed here take precedence over dfs.config.cjs and auth.json
 */
export function configure(options: ConfigureOptions): void {
    configureApi(options);
}

/**
 * Get current configuration overrides
 */
export function getConfigOverrides(): ConfigureOptions {
    return getConfig();
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
export async function upload(options: UploadOptions): Promise<{ success: boolean; message: string }> {
    const { path, appId, localPath, buildPath, token, server, appName } = options;

    // If appName provided, look up config
    if (appName) {
        const appConfig = await getAppConfig(appName);
        if (!appConfig) {
            throw new ConfigError(
                `App "${appName}" not found in dfs.config.cjs`,
                'APP_NOT_FOUND'
            );
        }

        return uploadWithConfig(appName, {
            path: localPath || appConfig.localPath,
            app: appId || appConfig.appId,
            buildPath: buildPath || appConfig.serverBuildPath,
            token,
            server,
        });
    }

    const resolvedPath = localPath || path;
    if (!resolvedPath) {
        throw new UploadError('path or localPath is required', 400, undefined, 'MISSING_PATH');
    }

    if (!appId) {
        throw new UploadError('appId is required', 400, undefined, 'MISSING_APP_ID');
    }

    return doUpload({
        path: resolvedPath,
        app: appId,
        buildPath,
        token,
        server,
    });
}

// Re-export config functions
export { getServer, setAuth, loadConfig, getAppConfig };
