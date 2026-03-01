/**
 * Configuration management for dfs
 *
 * Configuration is loaded from dfs.config.cjs file in current directory.
 * Auth is stored in ~/.config/dfs/auth.json
 * Programmatic overrides can be set via configure()
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ConfigError, AuthError } from './errors.js';
import { fetchWithTimeout, throwUploadError } from './http.js';

export interface Config {
    server: string;
    apps: Record<string, AppConfig>;
}

export type BuildType = 'dockerfile' | 'heroku_buildpacks' | 'paketo_buildpacks' | 'nixpacks' | 'static' | 'railpack';

const BUILD_TYPES: readonly BuildType[] = [
    'dockerfile',
    'heroku_buildpacks',
    'paketo_buildpacks',
    'nixpacks',
    'static',
    'railpack',
] as const;

// Allowed keys per build type - used for validation and payload shaping
const BUILD_TYPE_KEYS: Record<BuildType, readonly string[]> = {
    dockerfile: ['dockerfile', 'dockerContextPath', 'dockerBuildStage'],
    heroku_buildpacks: ['herokuVersion'],
    paketo_buildpacks: [],
    nixpacks: ['publishDirectory'],
    static: ['publishDirectory', 'isStaticSpa'],
    railpack: ['railpackVersion'],
};

function isBuildType(value: unknown): value is BuildType {
    return typeof value === 'string' && (BUILD_TYPES as readonly string[]).includes(value);
}

// Discriminated union for build options - each build type has its own config
// buildType is REQUIRED when build object is present
export type AppConfigBuildOptions =
    | {
          buildType: 'dockerfile';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
          dockerfile?: string;
          dockerContextPath?: string;
          dockerBuildStage?: string | null;
      }
    | {
          buildType: 'heroku_buildpacks';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
          herokuVersion?: string;
      }
    | {
          buildType: 'paketo_buildpacks';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
      }
    | {
          buildType: 'nixpacks';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
          publishDirectory?: string | null;
      }
    | {
          buildType: 'static';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
          publishDirectory?: string | null;
          isStaticSpa?: boolean;
      }
    | {
          buildType: 'railpack';
          /** Escape hatch for forward compatibility if Dokploy adds new fields */
          allowUnknownOptions?: boolean;
          railpackVersion?: string;
      };

export interface AppConfig {
    appId: string;
    localPath: string;
    serverBuildPath?: string;
    build?: AppConfigBuildOptions;
}

export interface Auth {
    token: string;
}

/**
 * Per-server token storage
 * Format: { "servers": { "https://server.com": "token", ... } }
 */
export interface AuthStore {
    servers: Record<string, string>;
}

export interface ConfigOverrides {
    server?: string;
    token?: string;
}

const CONFIG_DIR = join(homedir(), '.config', 'dfs');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');

let configOverrides: ConfigOverrides = {};
// Cache config by absolute path of config file
const configCache = new Map<string, Config>();

async function ensureConfigDir(): Promise<void> {
    try {
        await access(CONFIG_DIR);
    } catch {
        await mkdir(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Set programmatic configuration overrides
 * These take precedence over dfs.config.cjs and auth.json
 */
export function configure(options: ConfigOverrides): void {
    configOverrides = { ...configOverrides, ...options };
    configCache.clear(); // Clear cache when overrides change
}

/**
 * Get current configuration overrides
 */
export function getConfig(): ConfigOverrides {
    return { ...configOverrides };
}

/**
 * Clear configuration overrides
 */
export function resetConfig(): void {
    configOverrides = {};
    configCache.clear();
}

/**
 * Normalize server URL - remove trailing slashes
 */
export function normalizeServerUrl(server: string): string {
    return server.replace(/\/+$/, '');
}

/**
 * Get server URL with proper normalization
 *
 * @throws {ConfigError} If server is not configured
 */
export async function getServer(override?: string): Promise<string> {
    if (override || configOverrides.server) {
        return normalizeServerUrl(override || configOverrides.server!);
    }

    const config = await loadConfig();
    if (!config?.server) {
        throw new ConfigError(
            'Server not configured. Add your Dokploy server URL to dfs.config.cjs',
            'NO_SERVER'
        );
    }
    return normalizeServerUrl(config.server);
}

/**
 * Load configuration from dfs.config.cjs
 *
 * @throws {ConfigError} If config file exists but cannot be loaded
 */
export async function loadConfig(): Promise<Config | null> {
    const cwd = process.cwd();
    const absoluteCwd = resolve(cwd);

    // Try .cjs first (CommonJS - works with require)
    const cjsPath = join(cwd, 'dfs.config.cjs');
    const jsPath = join(cwd, 'dfs.config.js');

    // Check cache first
    const cachedCjs = configCache.get(resolve(cjsPath));
    if (cachedCjs) {
        return cachedCjs;
    }
    const cachedJs = configCache.get(resolve(jsPath));
    if (cachedJs) {
        return cachedJs;
    }

    // Check for .cjs file first
    if (existsSync(cjsPath)) {
        try {
            const require = createRequire(cjsPath);
            const config = require(cjsPath);
            const resolvedConfig = config.default || config;
            configCache.set(resolve(cjsPath), resolvedConfig);
            return resolvedConfig;
        } catch (error) {
            throw new ConfigError(
                `Failed to load config from ${cjsPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'CONFIG_LOAD_FAILED'
            );
        }
    }

    // Fall back to .js with dynamic import for ESM support
    if (existsSync(jsPath)) {
        try {
            // Use file:// URL for cross-platform compatibility (Windows)
            const configUrl = pathToFileURL(jsPath).href;
            const config = await import(configUrl);
            const resolvedConfig = config.default || config;
            configCache.set(resolve(jsPath), resolvedConfig);
            return resolvedConfig;
        } catch (error) {
            throw new ConfigError(
                `Failed to load config from ${jsPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'CONFIG_LOAD_FAILED'
            );
        }
    }

    return null;
}

/**
 * Get authentication token
 *
 * @param override - Optional token override
 * @param server - Server URL to look up token for (required for per-server storage)
 * @throws {AuthError} If token is required but not found
 */
export async function getAuth(override?: string, server?: string): Promise<Auth> {
    // Override takes precedence
    if (override || configOverrides.token) {
        return { token: override || configOverrides.token! };
    }

    // Per-server storage requires a server key for lookup
    if (!server) {
        throw new AuthError(
            'No server configured. Add server to dfs.config.cjs, pass --server, or provide token via --token.',
            'NO_SERVER'
        );
    }

    await ensureConfigDir();

    try {
        const content = await readFile(AUTH_FILE, 'utf-8');
        const parsed = JSON.parse(content);

        // Validate parsed shape: must be a non-null object with servers
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AuthError(
                'Invalid auth.json format. Run "dfs auth YOUR_TOKEN" to recreate.',
                'INVALID_AUTH_STORE'
            );
        }

        const store = parsed as AuthStore;

        // Normalize server URL for consistent lookup
        const normalizedServer = normalizeServerUrl(server);

        // Look up token by server URL - validate servers is an object, not an array
        if (!store.servers || typeof store.servers !== 'object' || Array.isArray(store.servers)) {
            throw new AuthError(
                'Invalid auth.json format (servers is not an object). Run "dfs auth YOUR_TOKEN" to recreate.',
                'INVALID_AUTH_STORE'
            );
        }
        const servers = store.servers;
        let token = servers[normalizedServer];
        if (!token) {
            for (const [storedServer, storedToken] of Object.entries(servers)) {
                if (normalizeServerUrl(storedServer) === normalizedServer) {
                    token = storedToken;
                    break;
                }
            }
        }
        if (!token) {
            throw new AuthError(
                `No token found for server "${normalizedServer}". Run "dfs auth YOUR_TOKEN --server ${normalizedServer}" or run "dfs auth YOUR_TOKEN" from a project with dfs.config.cjs.`,
                'NO_TOKEN'
            );
        }

        return { token };
    } catch (err) {
        if (err instanceof AuthError) {
            throw err;
        }
        const serverInfo = server ? ` for server "${normalizeServerUrl(server)}"` : '';
        throw new AuthError(
            `No authentication token found${serverInfo}. Run "dfs auth YOUR_TOKEN --server ${normalizeServerUrl(server)}" or provide a token via --token.`,
            'NO_TOKEN'
        );
    }
}

/**
 * Save authentication token for a specific server
 *
 * @param token - The API token to save
 * @param server - Server URL to associate with the token (will be read from config if not provided)
 */
export async function setAuth(token: string, server?: string): Promise<void> {
    await ensureConfigDir();

    // Require server - either from parameter or from config
    let targetServer = server;
    if (!targetServer) {
        try {
            targetServer = await getServer();
        } catch {
            throw new AuthError(
                'No server configured. Add server to dfs.config.cjs or pass --server to dfs auth.',
                'NO_SERVER'
            );
        }
    }

    // Normalize server URL for consistent lookup
    targetServer = normalizeServerUrl(targetServer);

    // Load existing store or create new one
    let store: AuthStore = { servers: {} };
    try {
        const content = await readFile(AUTH_FILE, 'utf-8');
        const parsed = JSON.parse(content);

        // Validate parsed shape: must be a non-null object
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            store = parsed as AuthStore;
        }
        // If invalid shape (null, array, primitive), fall back to empty store
    } catch {
        // File doesn't exist yet, use empty store
    }

    // Ensure servers object exists (must be a plain object, not an array)
    if (!store.servers || typeof store.servers !== 'object' || Array.isArray(store.servers)) {
        store.servers = {};
    }

    // Save token for this server (rewrite file cleanly without unknown keys)
    store.servers[targetServer] = token;

    const canonicalStore: AuthStore = { servers: store.servers };
    await writeFile(AUTH_FILE, JSON.stringify(canonicalStore, null, 2));
}

/**
 * Get app configuration by name
 */
export async function getAppConfig(appName: string): Promise<AppConfig | null> {
    const config = await loadConfig();
    if (!config?.apps) {
        return null;
    }

    return config.apps[appName] || null;
}

/**
 * Save build type and build-related settings to Dokploy
 *
 * @param appId - The application ID
 * @param build - Build configuration options (buildType is required)
 * @param server - Server URL
 * @param token - API token
 */
export async function saveBuildType(
    appId: string,
    build: AppConfigBuildOptions,
    server: string,
    token: string
): Promise<void> {
    // Validate appId
    if (!appId || typeof appId !== 'string' || appId.trim() === '') {
        throw new ConfigError('appId must be a non-empty string', 'INVALID_APP_ID');
    }

    // Validate build config at runtime (dfs.config.cjs is untyped)
    if (!build || typeof build !== 'object') {
        throw new ConfigError('build must be an object', 'INVALID_BUILD_CONFIG');
    }

    const rawBuild = build as Record<string, unknown>;

    // Validate buildType first (needed for per-type validation)
    const rawBuildType = (build as unknown as { buildType?: unknown }).buildType;
    if (!rawBuildType) {
        throw new ConfigError('build.buildType is required when build is configured', 'MISSING_BUILD_TYPE');
    }
    if (!isBuildType(rawBuildType)) {
        throw new ConfigError(
            `Invalid build.buildType: "${String(rawBuildType)}". Expected one of: ${BUILD_TYPES.join(', ')}`,
            'INVALID_BUILD_TYPE'
        );
    }
    const buildType = rawBuildType;

    // Check for unknown/irrelevant keys per build type
    const allowUnknownOptionsRaw = rawBuild.allowUnknownOptions;
    if (allowUnknownOptionsRaw !== undefined && typeof allowUnknownOptionsRaw !== 'boolean') {
        throw new ConfigError('build.allowUnknownOptions must be a boolean', 'INVALID_BUILD_CONFIG');
    }
    const allowUnknownOptions = allowUnknownOptionsRaw === true;

    const allowedKeys = new Set([...BUILD_TYPE_KEYS[buildType], 'buildType', 'allowUnknownOptions']);
    const unknownKeys = Object.keys(rawBuild).filter((key) => !allowedKeys.has(key));
    if (!allowUnknownOptions && unknownKeys.length > 0) {
        const validOptions = [...BUILD_TYPE_KEYS[buildType], 'buildType', 'allowUnknownOptions'].join(', ');
        throw new ConfigError(
            `Invalid option(s) for ${buildType}: ${unknownKeys.join(', ')}. Valid options: ${validOptions}`,
            'INVALID_BUILD_CONFIG'
        );
    }

    // Build payload dynamically per build type - only include fields when explicitly provided
    // Let Dokploy apply its own defaults for omitted fields
    const json: Record<string, unknown> = {
        applicationId: appId,
        buildType,
    };

    // Type-safe extraction based on discriminated union
    // Only include fields when explicitly provided by user
    // Guard against exotic inputs (Proxy/getter returning different values)
    if ((build as unknown as { buildType?: unknown }).buildType !== buildType) {
        throw new ConfigError('build.buildType changed during validation', 'INVALID_BUILD_CONFIG');
    }

    // Use build.buildType for TypeScript narrowing (validated above to equal buildType)
    switch (build.buildType) {
        case 'dockerfile':
            // Read fields once to guard against exotic inputs changing values between checks
            const dockerfile = build.dockerfile;
            const dockerContextPath = build.dockerContextPath;
            const dockerBuildStage = build.dockerBuildStage;
            if (dockerfile !== undefined && typeof dockerfile !== 'string') {
                throw new ConfigError('build.dockerfile must be a string', 'INVALID_BUILD_CONFIG');
            }
            if (dockerContextPath !== undefined && typeof dockerContextPath !== 'string') {
                throw new ConfigError('build.dockerContextPath must be a string', 'INVALID_BUILD_CONFIG');
            }
            if (
                dockerBuildStage !== undefined &&
                dockerBuildStage !== null &&
                typeof dockerBuildStage !== 'string'
            ) {
                throw new ConfigError('build.dockerBuildStage must be a string or null', 'INVALID_BUILD_CONFIG');
            }
            if (dockerfile !== undefined) {
                json.dockerfile = dockerfile;
            }
            if (dockerContextPath !== undefined) {
                json.dockerContextPath = dockerContextPath;
            }
            if (dockerBuildStage !== undefined) {
                json.dockerBuildStage = dockerBuildStage;
            }
            break;
        case 'heroku_buildpacks':
            const herokuVersion = build.herokuVersion;
            if (herokuVersion !== undefined && typeof herokuVersion !== 'string') {
                throw new ConfigError('build.herokuVersion must be a string', 'INVALID_BUILD_CONFIG');
            }
            if (herokuVersion !== undefined) {
                json.herokuVersion = herokuVersion;
            }
            break;
        case 'railpack':
            const railpackVersion = build.railpackVersion;
            if (railpackVersion !== undefined && typeof railpackVersion !== 'string') {
                throw new ConfigError('build.railpackVersion must be a string', 'INVALID_BUILD_CONFIG');
            }
            if (railpackVersion !== undefined) {
                json.railpackVersion = railpackVersion;
            }
            break;
        case 'nixpacks':
            const publishDirectoryNixpacks = build.publishDirectory;
            if (
                publishDirectoryNixpacks !== undefined &&
                publishDirectoryNixpacks !== null &&
                typeof publishDirectoryNixpacks !== 'string'
            ) {
                throw new ConfigError('build.publishDirectory must be a string or null', 'INVALID_BUILD_CONFIG');
            }
            if (publishDirectoryNixpacks !== undefined) {
                json.publishDirectory = publishDirectoryNixpacks;
            }
            break;
        case 'static':
            const publishDirectoryStatic = build.publishDirectory;
            const isStaticSpa = build.isStaticSpa;
            if (
                publishDirectoryStatic !== undefined &&
                publishDirectoryStatic !== null &&
                typeof publishDirectoryStatic !== 'string'
            ) {
                throw new ConfigError('build.publishDirectory must be a string or null', 'INVALID_BUILD_CONFIG');
            }
            if (isStaticSpa !== undefined && typeof isStaticSpa !== 'boolean') {
                throw new ConfigError('build.isStaticSpa must be a boolean', 'INVALID_BUILD_CONFIG');
            }
            if (publishDirectoryStatic !== undefined) {
                json.publishDirectory = publishDirectoryStatic;
            }
            if (isStaticSpa !== undefined) {
                json.isStaticSpa = isStaticSpa;
            }
            break;
        case 'paketo_buildpacks':
            // No additional options
            break;
    }

    const response = await fetchWithTimeout(
        `${server}/api/trpc/application.saveBuildType`,
        {
            method: 'POST',
            headers: {
                'x-api-key': token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ json }),
            timeout: 30000,
        }
    );

    if (!response.ok) {
        await throwUploadError(response, 'Failed to save build type');
    }
}
