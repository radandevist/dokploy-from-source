/**
 * Auth CLI command
 *
 * Stores and validates the API token.
 * Uses x-api-key header for consistency with upload.
 */

import { setAuth, getServer, normalizeServerUrl } from '../../core/config.js';
import { fetchWithTimeout } from '../../core/http.js';
import { success, log, error, warning } from '../output.js';
import { runCli } from '../run.js';

export interface AuthCliArgs {
    token?: string;
    server?: string;
}

/**
 * Validate token with the server
 */
async function validateToken(token: string, server: string): Promise<boolean> {
    try {
        const response = await fetchWithTimeout(
            `${server}/api/trpc/user.me`,
            {
                method: 'POST',
                headers: {
                    'x-api-key': token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ json: {} }),
                timeout: 10000,
            }
        );

        if (response.ok) {
            return true;
        }

        // 400 often means valid token but wrong payload format
        if (response.status === 400) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Ask for token interactively
 */
async function askForToken(): Promise<string> {
    const readline = await import('readline');
    const rl = readline.default.createInterface({
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

/**
 * Run the auth command
 */
export async function runAuth(args: AuthCliArgs): Promise<void> {
    let { token, server: serverArg } = args;

    // If no token provided, ask interactively
    if (!token) {
        log('🔐 Setting up Dokploy authentication');
        log('');
        log('To get your API token:');
        log('1. Go to your Dokploy dashboard');
        log('2. Navigate to Settings → Profile');
        log('3. Click "Generate" to create a token');
        log('');
        log('Usage:');
        log('  dfs auth YOUR_TOKEN');
        log('  dfs auth YOUR_TOKEN --server https://dokploy.example.com');
        log('  # or');
        log('  dfs auth            # to enter interactively');
        error('Token is required');
        throw new Error('Token is required');
    }

    // Use server from args, or try to get from config
    let server: string | null = serverArg || null;
    if (!server) {
        try {
            server = await getServer();
        } catch {
            // Server not configured - will be handled by setAuth
        }
    }

    log('Testing token...');

    if (server) {
        const normalizedServer = normalizeServerUrl(server);
        const isValid = await validateToken(token, normalizedServer);
        if (!isValid) {
            warning('Token validation failed - still saving token');
            log('The token may be invalid or expired.');
            log('Generate a new one from your Dokploy dashboard.');
        } else {
            success('Token is valid!');
        }
    } else if (!serverArg) {
        warning('No server configured in dfs.config.cjs - skipping validation');
        log('Run "dfs init" first or pass --server to dfs auth.');
    }

    // Save the token (pass server for per-server storage)
    await setAuth(token, server || undefined);

    if (server) {
        success(`Authentication configured for ${normalizeServerUrl(server)}!`);
    } else {
        success('Authentication configured!');
    }
}

/**
 * Auth command entry point with error handling
 */
export async function authCommand(args: AuthCliArgs): Promise<number> {
    const result = await runCli(() => runAuth(args));
    return result.exitCode;
}
