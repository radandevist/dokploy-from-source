/**
 * Error classes for dokploy-from-source
 *
 * All errors thrown by the library extend from DfsError.
 * This allows programmatic users to catch and handle errors appropriately.
 */

export interface ErrorOptions {
    cause?: unknown;
}

export class DfsError extends Error {
    public readonly code?: string;

    constructor(message: string, code?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'DfsError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ConfigError extends DfsError {
    constructor(message: string, code?: string, options?: ErrorOptions) {
        super(message, code, options);
        this.name = 'ConfigError';
    }
}

export class AuthError extends DfsError {
    constructor(message: string, code?: string, options?: ErrorOptions) {
        super(message, code, options);
        this.name = 'AuthError';
    }
}

export class UploadError extends DfsError {
    public readonly statusCode?: number;
    public readonly responseBody?: string;
    /** Whether this error came from an HTTP response (vs local validation) */
    public readonly isHttp: boolean;

    constructor(
        message: string,
        statusCode?: number,
        responseBody?: string,
        code?: string,
        isHttp: boolean = false,
        options?: ErrorOptions
    ) {
        super(message, code, options);
        this.name = 'UploadError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.isHttp = isHttp;
    }
}
