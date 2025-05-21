/**
 * A hook for consistent logging across the application
 * In production, this could integrate with a logging service
 */
export function useLogger() {
  const isDev = import.meta.env.DEV;

  const logTypes = {
    info: (message: string, ...args: any[]) => {
      if (isDev) {
        console.info(`ℹ️ ${message}`, ...args);
      }
      // In production, you could send logs to a service
    },
    warn: (message: string, ...args: any[]) => {
      if (isDev) {
        console.warn(`⚠️ ${message}`, ...args);
      }
      // In production, you could send logs to a service
    },
    error: (message: string, ...args: any[]) => {
      if (isDev) {
        console.error(`🔴 ${message}`, ...args);
      }
      // In production, you could send logs to a service
    },
    debug: (message: string, ...args: any[]) => {
      if (isDev) {
        console.debug(`🔍 ${message}`, ...args);
      }
      // In production, you could send logs to a service
    },
  };

  return logTypes;
}

export default useLogger; 