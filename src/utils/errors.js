export const ErrorTypes = {
  AUTH: 'auth',
  API: 'api',
  NETWORK: 'network',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown'
};

export class AppError extends Error {
  constructor(type, message, originalError = null) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.originalError = originalError;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toString() {
    return `${this.name}[${this.type}]: ${this.message}`;
  }
}

export default {
  ErrorTypes,
  AppError
}; 