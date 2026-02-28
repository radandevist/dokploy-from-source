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
function normalizeServerUrl(server: string): string {
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
 * @throws {AuthError} If token is required but not found
 */
export async function getAuth(override?: string): Promise<Auth> {
    // Override takes precedence
    if (override || configOverrides.token) {
        return { token: override || configOverrides.token! };
    }

    await ensureConfigDir();

    try {
        const content = await readFile(AUTH_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        throw new AuthError(
            'No authentication token found. Run "dfs auth YOUR_TOKEN" or provide a token.',
            'NO_TOKEN'
        );
    }
}

/**
 * Save authentication token
 */
export async function setAuth(token: string): Promise<void> {
    await ensureConfigDir();

    const auth: Auth = { token };
    await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2));
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
