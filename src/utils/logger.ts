// Browser-compatible logger utility
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// In Vite, we use import.meta.env instead of process.env
const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
const currentLevel = isDevelopment ? LOG_LEVELS.debug : LOG_LEVELS.warn;

// Simple timestamp formatter
const getTimestamp = () => new Date().toISOString();

const logger = {
  debug: (...args) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
    }
  },
  
  info: (...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.info(`[${getTimestamp()}] [INFO]`, ...args);
    }
  },
  
  warn: (...args) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(`[${getTimestamp()}] [WARN]`, ...args);
    }
  },
  
  error: (...args) => {
    // Always log errors
    console.error(`[${getTimestamp()}] [ERROR]`, ...args);
  }
};

// Force enable debug logs in development
if (isDevelopment) {
  console.log('[Logger] Debug mode enabled');
  
  // Add a test log to verify logger is working
  logger.info('Logger initialized in development mode');
  logger.info('Log levels:', LOG_LEVELS);
}

export default logger; 