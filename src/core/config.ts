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

export interface Config {
    server: string;
    apps: Record<string, AppConfig>;
}

export interface AppConfig {
    appId: string;
    localPath: string;
    serverBuildPath?: string;
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

        // If no server provided, require explicit token or fail
        if (!server) {
            throw new AuthError(
                'No server configured. Add server to dfs.config.cjs, pass --server, or provide token via --token.',
                'NO_SERVER'
            );
        }

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
        const token = servers[normalizedServer];
        if (!token) {
            throw new AuthError(
                `No token found for server "${normalizedServer}". Run "dfs auth YOUR_TOKEN" from your project directory.`,
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
            `No authentication token found${serverInfo}. Run "dfs auth YOUR_TOKEN" or provide a token.`,
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

    await writeFile(AUTH_FILE, JSON.stringify(store, null, 2));
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
