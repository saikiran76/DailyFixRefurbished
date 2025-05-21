import { supabase } from '../utils/supabase';
import { tokenManager } from '../utils/tokenManager';
import api from '../utils/api';
import logger from '../utils/logger';
import { debounce } from 'lodash';
import { executeAtomically } from '../utils/atomicOperations';

// State configuration with metadata and hooks
const STATE_CONFIG = {
  'welcome': {
    allowedTransitions: ['protocol_selection'],
    validationRules: [],
    onEnter: async () => {
      logger.info('[OnboardingService] Entering welcome state');
    },
    onExit: async () => {
      logger.info('[OnboardingService] Exiting welcome state');
    }
  },
  'protocol_selection': {
    allowedTransitions: ['matrix'],
    validationRules: [],
    onEnter: async () => {
      logger.info('[OnboardingService] Entering protocol selection');
    },
    onExit: async () => {
      logger.info('[OnboardingService] Exiting protocol selection');
    }
  },
  'whatsapp': {
    allowedTransitions: ['matrix', 'complete'],
    validationRules: ['validateWhatsAppConnection'],
    onEnter: async () => {
      logger.info('[OnboardingService] Entering WhatsApp setup');
    },
    onExit: async (context) => {
      logger.info('[OnboardingService] Exiting WhatsApp setup');
      await context.validateWhatsAppConnection();
    }
  },
  'matrix': {
    allowedTransitions: ['whatsapp', 'complete'],
    validationRules: ['validateMatrixConnection'],
    onEnter: async () => {
      logger.info('[OnboardingService] Entering Matrix setup');
    },
    onExit: async (context) => {
      logger.info('[OnboardingService] Exiting Matrix setup');
      await context.validateMatrixConnection();
    }
  },
  'complete': {
    allowedTransitions: [],
    validationRules: ['validateAllConnections'],
    onEnter: async (context) => {
      logger.info('[OnboardingService] Completing onboarding');
      await context.validateAllConnections();
    },
    onExit: () => {
      throw new Error('Cannot transition from complete state');
    }
  }
};

class OnboardingService {
  constructor() {
    this.cache = new Map();
    this.pendingChecks = new Map();
    this.updateLocks = new Map();
    this.transitionLocks = new Map();
    this.CACHE_TTL = 30000; // 30 seconds
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 1000;
    
    // Debounced status check
    this.debouncedCheckStatus = debounce(this._checkStatus.bind(this), 100, {
      leading: true,
      trailing: true
    });

    // Add validation rules
    this.validationRules = {
      validateWhatsAppConnection: async () => {
        const status = await this._checkStatus();
        if (!status.whatsappConnected) {
          throw new Error('WhatsApp connection required');
        }
      },
      validateMatrixConnection: async () => {
        const status = await this._checkStatus();
        if (!status.matrixConnected) {
          throw new Error('Matrix connection required');
        }
      },
      validateAllConnections: async () => {
        const status = await this._checkStatus();
        const missing = this._checkRequiredPlatforms(status);
        if (missing.length > 0) {
          throw new Error(`Missing connections: ${missing.join(', ')}`);
        }
      }
    };
  }

  async getOnboardingStatus(forceRefresh = false) {
    try {
      // If there's an update in progress, wait for it
      const updateLock = this.updateLocks.get('current');
      if (updateLock) {
        await updateLock;
        forceRefresh = true; // Force refresh after update
      }

      // Check cache if not forcing refresh
      if (!forceRefresh) {
        const cached = this._getCachedStatus();
        if (cached) {
          logger.info('[OnboardingService] Using cached status:', cached);
          return cached;
        }
      }

      // Check if there's a pending request
      const pending = this.pendingChecks.get('current');
      if (pending) {
        logger.info('[OnboardingService] Using pending request');
        return pending;
      }

      // Create new request promise
      const promise = this.debouncedCheckStatus();
      this.pendingChecks.set('current', promise);

      try {
        const result = await promise;
        logger.info('[OnboardingService] Got fresh status:', result);
        return result;
      } finally {
        this.pendingChecks.delete('current');
      }
    } catch (error) {
      logger.info('[OnboardingService] Error getting status:', error);
      throw error;
    }
  }

  async _checkStatus() {
    try {
      logger.debug('[OnboardingService] Making API request to /api/v1/users/onboarding/status');
      
      // Use the api instance which already has token handling
      try {
        const response = await api.get('/api/v1/users/onboarding/status');
        logger.debug('[OnboardingService] Received success response:', response.data);
        
        // Ensure we copy ALL fields from the backend response
        const status = {
          ...response.data,
          lastChecked: Date.now()
        };
  
        // Update cache with complete status
        this.cache.set('current', status);
        return status;
      } catch (apiError) {
        logger.debug('[OnboardingService] API instance failed, trying direct fetch:', apiError);
        
        // Get auth token from localStorage
        let token = null;
        try {
          const authData = localStorage.getItem('dailyfix_auth');
          if (authData) {
            const parsed = JSON.parse(authData);
            token = parsed.access_token;
          }
        } catch (e) {
          logger.error('[OnboardingService] Error parsing auth data:', e);
        }
        
        // Try direct fetch without credentials as fallback
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
        const fetchResponse = await fetch(`${apiUrl}/api/v1/users/onboarding/status`, {
          method: 'GET',
          // Remove credentials mode
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          }
        });
        
        if (!fetchResponse.ok) {
          throw new Error(`HTTP error! Status: ${fetchResponse.status}`);
        }
        
        const data = await fetchResponse.json();
        
        logger.debug('[OnboardingService] Received direct fetch response:', data);
        
        // Ensure we copy ALL fields from the backend response
        const status = {
          ...data,
          lastChecked: Date.now()
        };
  
        // Update cache with complete status
        this.cache.set('current', status);
        return status;
      }
    } catch (error) {
      logger.info('[OnboardingService] Status check failed:', error);
      throw error;
    }
  }

  _getCachedStatus() {
    const cached = this.cache.get('current');
    if (!cached) return null;

    // Check if cache is still valid
    if (Date.now() - cached.lastChecked < this.CACHE_TTL) {
      return cached;
    }

    this.cache.delete('current');
    return null;
  }

  async _validateStepTransition(currentStep, nextStep, isComplete = false) {
    // If onboarding is complete, prevent any changes
    if (isComplete) {
      logger.info('[OnboardingService] Preventing step change - onboarding complete');
      throw new Error('Cannot modify completed onboarding');
    }

    // Get state config
    const currentState = STATE_CONFIG[currentStep];
    if (!currentState) {
      const validInitialSteps = ['welcome', 'protocol_selection', 'whatsapp', 'matrix'];
      const isValid = validInitialSteps.includes(nextStep);
      logger.debug('[OnboardingService] Validating initial step:', { nextStep, isValid });
      return isValid;
    }

    // Validate transition
    const isValid = currentState.allowedTransitions.includes(nextStep);
    logger.debug('[OnboardingService] Validating step transition:', {
      from: currentStep,
      to: nextStep,
      isValid
    });

    if (!isValid) {
      throw new Error(`Invalid transition from ${currentStep} to ${nextStep}`);
    }

    // Run validation rules
    const nextStateConfig = STATE_CONFIG[nextStep];
    if (nextStateConfig?.validationRules) {
      for (const rule of nextStateConfig.validationRules) {
        await this.validationRules[rule]();
      }
    }

    return true;
  }

  async _acquireTransitionLock(userId) {
    const lockKey = `transition_${userId}`;
    if (this.transitionLocks.has(lockKey)) {
      throw new Error('State transition already in progress');
    }
    const lock = new Promise((resolve) => resolve());
    this.transitionLocks.set(lockKey, lock);
    return lock;
  }

  async _releaseTransitionLock(userId) {
    const lockKey = `transition_${userId}`;
    this.transitionLocks.delete(lockKey);
  }

  async _executeWithRetry(operation, retryCount = 0) {
    try {
      return await operation();
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * Math.pow(2, retryCount)));
        return this._executeWithRetry(operation, retryCount + 1);
      }
      throw error;
    }
  }

  async updateOnboardingStep(step, userId) {
    return executeAtomically(`onboarding:${userId}`, async () => {
      let currentStatus;
      let transactionId;
      
      try {
        // Get current status first
        currentStatus = await this.getOnboardingStatus(true);
        logger.debug('[OnboardingService] Current status before update:', currentStatus);
        
        // Validate transition
        await this._validateStepTransition(currentStatus.currentStep, step, currentStatus.isComplete);

        // Start transaction
        transactionId = crypto.randomUUID();
        
        const result = await this._executeWithRetry(async () => {
          // Run exit hooks for current state
          const currentState = STATE_CONFIG[currentStatus.currentStep];
          if (currentState?.onExit) {
            await currentState.onExit(this);
          }

          // Execute update
          const { data, error } = await api.post('/api/v1/users/onboarding/step', { 
            currentStep: step,
            transactionId,
            previousStep: currentStatus.currentStep
          });
          
          if (error) {
            // Handle duplicate transaction
            if (error.status === 409) {
              logger.info('[OnboardingService] Transaction already processed:', transactionId);
              return data;
            }
            throw error;
          }

          // Run enter hooks for new state
          const nextState = STATE_CONFIG[step];
          if (nextState?.onEnter) {
            await nextState.onEnter(this);
          }

          return data;
        });

        // Clear cache to force refresh
        this.cache.delete('current');

        return result;

      } catch (error) {
        logger.error('[OnboardingService] Update failed:', error);

        if (currentStatus) {
          // Attempt rollback
          try {
            logger.info('[OnboardingService] Attempting rollback to:', currentStatus.currentStep);
            await this._executeWithRetry(async () => {
              await api.post('/api/v1/users/onboarding/step', {
                currentStep: currentStatus.currentStep,
                transactionId: `${transactionId}_rollback`,
                previousStep: step,
                isRollback: true
              });
            });
            logger.info('[OnboardingService] Rollback successful');
          } catch (rollbackError) {
            logger.error('[OnboardingService] Rollback failed:', rollbackError);
            throw new Error(`Update failed and rollback failed. Original error: ${error.message}. Rollback error: ${rollbackError.message}`);
          }
        }

        throw error;
      }
    });
  }

  _emitStateChange(fromState, toState) {
    logger.info('[OnboardingService] State transition:', {
      from: fromState,
      to: toState,
      timestamp: new Date().toISOString()
    });

    // Could integrate with analytics or monitoring here
    if (window.analytics) {
      window.analytics.track('Onboarding State Change', {
        fromState,
        toState,
        timestamp: new Date().toISOString()
      });
    }
  }

  _checkRequiredPlatforms(status) {
    const required = ['whatsapp', 'matrix'];
    const missing = [];
    
    if (!status.whatsappConnected) missing.push('whatsapp');
    if (!status.matrixConnected) missing.push('matrix');
    
    return missing;
  }
}

export const onboardingService = new OnboardingService(); 