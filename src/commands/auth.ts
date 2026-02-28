/**
 * Auth command - stores and validates the API token
 */

import { setAuth, getAuth, loadConfig } from '../lib/config.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'dfs');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');

function readTokenFromFile(filePath: string): string | null {
    if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8').trim();
    }
    return null;
}

async function testToken(token: string, server: string): Promise<boolean> {
    try {
        const response = await fetch(`${server}/api/trpc/user.me`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ json: {} }),
        });

        if (response.ok) {
            return true;
        }

        // Also try with empty body for some APIs
        if (response.status === 400) {
            return true; // 400 often means valid token but wrong payload
        }

        return false;
    } catch {
        return false;
    }
}

async function askForToken(): Promise<string> {
    // Use readline for interactive input
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question('Enter your Dokploy API token: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

export async function auth(args: string[]): Promise<void> {
    let token = args[0] || '';

    // If no token provided, check for environment variable
    if (!token) {
        token = process.env.DOKPLOY_TOKEN || '';
    }

    // If still no token, try to read from common dokploy config locations
    if (!token) {
        const tokenFileLocations = [
            join(homedir(), '.config', 'dokploy', 'token'),
            join(homedir(), '.dokploy', 'token'),
            join(homedir(), '.config', 'dokploy', 'config.json'),
        ];

        for (const loc of tokenFileLocations) {
            if (existsSync(loc)) {
                if (loc.endsWith('token')) {
                    const fileToken = readTokenFromFile(loc);
                    if (fileToken) {
                        token = fileToken;
                        break;
                    }
                } else if (loc.endsWith('config.json')) {
                    try {
                        const config = JSON.parse(readFileSync(loc, 'utf-8'));
                        token = config.token || config.apiToken || '';
                        if (token) break;
                    } catch {
                        // Ignore parse errors
                    }
                }
            }
        }
    }

    // If still no token, ask interactively
    if (!token) {
        token = await askForToken();
    }

    if (!token) {
        console.log('🔐 Setting up Dokploy authentication');
        console.log('');
        console.log('To get your API token:');
        console.log('1. Go to your Dokploy dashboard');
        console.log('2. Navigate to Settings → Profile');
        console.log('3. Click "Generate" to create a token');
        console.log('');
        console.log('Usage:');
        console.log('  dfs auth YOUR_TOKEN');
        console.log('  # or');
        console.log('  dfs auth            # to enter interactively');
        process.exit(1);
    }

    // Get server from config to test the token
    const config = await loadConfig();
    const server = config?.server;

    console.log('🔐 Testing token...');

    if (server) {
        const isValid = await testToken(token, server);
        if (!isValid) {
            console.log('❌ Token validation failed');
            console.log('   The token may be invalid or expired.');
            console.log('   Generate a new one from your Dokploy dashboard.');
            process.exit(1);
        }
        console.log('✅ Token is valid!');
    } else {
        console.log('⚠️  No server configured in config.js - skipping validation');
        console.log('   Run "dfs init" first to configure your server.');
    }

    // Save the token
    setAuth(token);
    console.log('');
    console.log('✅ Authentication configured!');
    console.log('');
    console.log('Next step:');
    console.log('  dfs upload myapp');
}
