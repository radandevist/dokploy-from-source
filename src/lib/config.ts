/**
 * Configuration management for dfs
 *
 * Configuration is loaded from config.js file in current directory.
 * Auth is stored in ~/.config/dfs/auth.json
 * Programmatic overrides can be set via configure()
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

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

function ensureConfigDir() {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Set programmatic configuration overrides
 * These take precedence over dfs.config.js and auth.json
 */
export function configure(options: ConfigOverrides): void {
    configOverrides = { ...configOverrides, ...options };
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
}

export async function getServer(override?: string): Promise<string> {
    if (override || configOverrides.server) {
        return override || configOverrides.server!;
    }
    const config = await loadConfig();
    if (!config?.server) {
        console.error('❌ Error: server not configured in config.js');
        console.log('   Add your Dokploy server URL to config.js');
        process.exit(1);
    }
    return config.server;
}

export async function loadConfig(): Promise<Config | null> {
    const cwd = process.cwd();

    const configPaths = [
        join(cwd, 'dfs.config.js'),
    ];

    for (const configPath of configPaths) {
        if (existsSync(configPath)) {
            try {
                const require = createRequire(configPath);
                const config = require(configPath);
                return config.default || config;
            } catch {
                // Ignore errors
            }
        }
    }

    return null;
}

export function getAuth(override?: string): Auth | null {
    // Override takes precedence
    if (override || configOverrides.token) {
        return { token: override || configOverrides.token! };
    }

    ensureConfigDir();

    if (existsSync(AUTH_FILE)) {
        try {
            const content = readFileSync(AUTH_FILE, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    return null;
}

export function setAuth(token: string): void {
    ensureConfigDir();

    const auth: Auth = { token };
    writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));

    console.log('✅ Auth token saved to ~/.config/dfs/auth.json');
}

export async function getAppConfig(appName: string): Promise<AppConfig | null> {
    const config = await loadConfig();
    if (!config?.apps) {
        return null;
    }

    return config.apps[appName] || null;
}
