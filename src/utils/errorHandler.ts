// Error types enum
export const ErrorTypes = {
  AUTH: 'auth',
  NETWORK: 'network',
  PLATFORM: 'platform',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown'
};

// Custom error class
export class AppError extends Error {
  constructor(type, message, details = {}) {
    super(message);
    this.type = type;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// Error handler function
export const handleError = (error, context = {}) => {
  const errorLog = {
    message: error.message,
    type: error instanceof AppError ? error.type : ErrorTypes.UNKNOWN,
    timestamp: new Date().toISOString(),
    context,
    stack: error.stack
  };

  // Log error (we can integrate with logging service later)
  console.error('Error:', errorLog);

  // Return user-friendly message
  return getUserFriendlyMessage(errorLog);
};

// Get user-friendly error message
const getUserFriendlyMessage = (errorLog) => {
  switch (errorLog.type) {
    case ErrorTypes.AUTH:
      return 'Authentication failed. Please try again.';
    case ErrorTypes.NETWORK:
      return 'Network error. Please check your connection.';
    case ErrorTypes.PLATFORM:
      return 'Platform connection failed. Please try again.';
    case ErrorTypes.VALIDATION:
      return 'Invalid input. Please check your details.';
    default:
      return 'Something went wrong. Please try again later.';
  }
}; 