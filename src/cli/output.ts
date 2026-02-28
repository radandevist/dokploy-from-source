/**
 * CLI output utilities
 *
 * Centralized formatting for CLI output.
 * Provides consistent styling and cross-platform path display.
 */

import { relative, isAbsolute } from 'node:path';
import { cwd } from 'node:process';

/**
 * Format a path for display (relative to current working directory)
 */
export function formatPath(path: string): string {
    if (isAbsolute(path)) {
        return relative(cwd(), path);
    }
    return path;
}

/**
 * Format success message
 */
export function success(message: string): void {
    console.log(`✅ ${message}`);
}

/**
 * Format error message
 */
export function error(message: string): void {
    console.error(`❌ Error: ${message}`);
}

/**
 * Format info message
 */
export function info(message: string): void {
    console.log(`ℹ️  ${message}`);
}

/**
 * Format warning message
 */
export function warning(message: string): void {
    console.log(`⚠️  Warning: ${message}`);
}

/**
 * Format log message with indentation
 */
export function log(message: string): void {
    console.log(`   ${message}`);
}

/**
 * Format section header
 */
export function section(title: string): void {
    console.log(`\n${title}`);
}

/**
 * Format a key-value pair
 */
export function keyValue(key: string, value: string): void {
    console.log(`   ${key}: ${value}`);
}
