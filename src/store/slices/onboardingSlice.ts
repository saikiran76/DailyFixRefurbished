import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit';
import api from '../../utils/api';
import logger from '../../utils/logger';
import { saveWhatsAppStatus } from '../../utils/connectionStorage';
import { setWhatsAppConnectedDB } from '../../utils/connectionStorageDB';

// CRITICAL UPDATE: Simplified onboarding routes for new flow
export const ONBOARDING_ROUTES = {
  WELCOME: '/onboarding/welcome',
  // Removed intermediate steps
  // PROTOCOL_SELECTION: '/onboarding/protocol_selection',
  // MATRIX: '/onboarding/matrix',
  // WHATSAPP: '/onboarding/whatsapp',
  COMPLETE: '/onboarding/complete'
};

// CRITICAL UPDATE: Simplified onboarding steps for new flow
export const ONBOARDING_STEPS = {
  WELCOME: 'welcome',
  // Removed intermediate steps
  // PROTOCOL_SELECTION: 'protocol_selection',
  // MATRIX: 'matrix',
  // WHATSAPP: 'whatsapp',
  COMPLETE: 'complete'
};

const PROTOCOLS = {
  MATRIX: 'matrix',
  // DIRECT_API: 'direct_api'
};

export const PLATFORMS = {
  MATRIX: {
    id: 'matrix',
    protocol: PROTOCOLS.MATRIX,
    required: true
  },
  WHATSAPP: {
    id: 'whatsapp',
    protocol: PROTOCOLS.MATRIX,
    required: true
  },
  // DISCORD: {
  //   id: 'discord',
  //   protocol: PROTOCOLS.DIRECT_API,
  //   required: false
  // }
};

const initialState = {
  currentStep: 'welcome',
  loading: false,
  error: null,
  matrixConnected: false,
  whatsappConnected: false,
  isComplete: false,
  connectedPlatforms: [],
  accounts: [],
  whatsappSetup: {
    loading: false,
    error: null,
    qrCode: null,
    setupState: 'preparing',
    timeLeft: 300,
    qrExpired: false,
    bridgeRoomId: null,
    phoneNumber: null,
    realTimeSetup: false
  },
  isReloginFlow: false,
  onboardingComplete: false,
  tooltipStep: 0,
};

// Async thunks
export const fetchOnboardingStatus = createAsyncThunk(
  'onboarding/fetchStatus',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/api/v1/users/onboarding/status');
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || error.message);
    }
  }
);

export const updateOnboardingStep = createAsyncThunk(
  'onboarding/updateStep',
  async ({ step, data = {} }, { rejectWithValue }) => {
    try {
      await api.post('/api/v1/users/onboarding/step', {
        step: step,
        ...data
      });
      return { step, data };
    } catch (error) {
      return rejectWithValue(error.response?.data || error.message);
    }
  }
);

export const setWhatsappPhoneNumber = createAction('onboarding/setWhatsappPhoneNumber');

// CRITICAL UPDATE: Modified to work with new simplified flow
export const initiateWhatsAppRelogin = createAsyncThunk(
  'onboarding/initiateWhatsAppRelogin',
  async (_, { dispatch }) => {
    try {
      // In the new flow, we don't need to update the onboarding step
      // Just set the relogin flag in the state
      dispatch(setReloginFlow(true));
      dispatch(setWhatsappConnected(false));
      return true;
    } catch (error) {
      throw error;
    }
  }
);

const onboardingSlice = createSlice({
  name: 'onboarding',
  initialState,
  reducers: {
    setOnboardingError: (state, action) => {
      state.error = action.payload;
    },
    setCurrentStep: (state, action) => {
      state.currentStep = action.payload;
    },
    setIsComplete: (state, action) => {
      state.isComplete = action.payload;
    },
    setWhatsappConnected: (state, action) => {
      try {
        state.whatsappConnected = action.payload;

        // Save to IndexedDB and localStorage
        try {
          // Use the new IndexedDB storage
          setWhatsAppConnectedDB(action.payload);

          // Also update the old localStorage as a fallback
          saveWhatsAppStatus(action.payload);

          logger.info('[onboardingSlice] WhatsApp connection status updated:', action.payload);
        } catch (storageError) {
          logger.error('[onboardingSlice] Error saving WhatsApp connection status:', storageError);
        }
      } catch (error) {
        logger.error('[onboardingSlice] Error setting WhatsApp connection status:', error);
      }
    },
    setWhatsappQRCode: (state, action) => {
      state.whatsappSetup.qrCode = action.payload;
      state.whatsappSetup.timeLeft = 300;
      state.whatsappSetup.qrExpired = false;
      state.whatsappSetup.error = null;
      state.whatsappSetup.loading = false;
      // state.whatsappSetup.realTimeSetup = false;
      if (state.whatsappSetup.setupState === 'waiting_for_qr') {
        state.whatsappSetup.setupState = 'qr_ready';
      }
    },
    setWhatsappSetupState: (state, action) => {
      state.whatsappSetup.setupState = action.payload;
      // Update loading state based on setupState
      state.whatsappSetup.loading = ['preparing', 'waiting_for_qr'].includes(action.payload);
      // Clear error when changing state (except for error state)
      if (action.payload !== 'error') {
        state.whatsappSetup.error = null;
      }
      // Update main whatsappConnected flag when setup is complete
      if (action.payload === 'connected') {
        state.whatsappConnected = true;
        if (!state.connectedPlatforms.includes('whatsapp')) {
          state.connectedPlatforms.push('whatsapp');
        }

        // Add WhatsApp to accounts array if not already present
        const whatsappAccountExists = state.accounts.some(account => account.platform === 'whatsapp');
        if (!whatsappAccountExists) {
          state.accounts.push({
            platform: 'whatsapp',
            status: 'active'
          });
        } else {
          // Update existing WhatsApp account status to active
          const whatsappAccount = state.accounts.find(account => account.platform === 'whatsapp');
          if (whatsappAccount) {
            whatsappAccount.status = 'active';
          }
        }
      }

      if (action.payload === 'puppet_sent') {
        state.whatsappSetup.realTimeSetup = true;
      }
    },
    setWhatsappTimeLeft: (state, action) => {
      state.whatsappSetup.timeLeft = action.payload;
      if (action.payload <= 0) {
        state.whatsappSetup.qrExpired = true;
        state.whatsappSetup.setupState = 'error';
        state.whatsappSetup.error = { message: 'QR Code expired. Please try again.' };
      }
    },
    setWhatsappError: (state, action) => {
      state.whatsappSetup.error = action.payload;
      state.whatsappSetup.setupState = 'error';
    },
    setBridgeRoomId: (state, action) => {
      state.whatsappSetup.bridgeRoomId = action.payload;
    },
    resetWhatsappSetup: (state) => {
      state.whatsappSetup = {
        ...initialState.whatsappSetup,
        setupState: 'initial'
      };
    },
    setReloginFlow: (state, action) => {
      state.isReloginFlow = action.payload;
    },
    setOnboardingComplete: (state, action) => {
      state.onboardingComplete = action.payload;
    },
    setTooltipStep: (state, action) => {
      state.tooltipStep = action.payload;
    },
    setWhatsappConnected: (state, action) => {
      state.whatsappConnected = action.payload;

      if (action.payload === true) {
        // Add WhatsApp to connectedPlatforms if not already present
        if (!state.connectedPlatforms.includes('whatsapp')) {
          state.connectedPlatforms.push('whatsapp');
        }

        // Add WhatsApp to accounts array if not already present
        const whatsappAccountExists = state.accounts.some(account => account.platform === 'whatsapp');
        if (!whatsappAccountExists) {
          state.accounts.push({
            platform: 'whatsapp',
            status: 'active'
          });
        } else {
          // Update existing WhatsApp account status to active
          const whatsappAccount = state.accounts.find(account => account.platform === 'whatsapp');
          if (whatsappAccount) {
            whatsappAccount.status = 'active';
          }
        }

        // Also save to localStorage for persistence
        try {
          // Save in connection storage
          const userId = JSON.parse(localStorage.getItem('dailyfix_auth'))?.user?.id;
          if (userId) {
            const connectionStatus = { whatsapp: true };
            const storageData = {
              userId,
              timestamp: Date.now(),
              status: connectionStatus
            };
            localStorage.setItem('dailyfix_connection_status', JSON.stringify(storageData));
          }

          // Also update auth data
          try {
            const authDataStr = localStorage.getItem('dailyfix_auth');
            if (authDataStr) {
              // Make sure we're working with an object, not a string
              let authData;
              try {
                authData = JSON.parse(authDataStr);
                // Check if authData is actually an object
                if (typeof authData !== 'object' || authData === null) {
                  throw new Error('Auth data is not an object');
                }
              } catch (parseError) {
                // If parsing fails or it's not an object, create a new object
                console.error('Error parsing auth data, creating new object:', parseError);
                authData = {};
              }

              // Now safely add the whatsappConnected property
              authData.whatsappConnected = true;
              localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
            }
          } catch (authError) {
            console.error('Error updating auth data with WhatsApp connection:', authError);
          }
        } catch (error) {
          console.error('Error saving WhatsApp connection status to localStorage:', error);
        }
      }
    },
    updateAccounts: (state, action) => {
      state.accounts = action.payload;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOnboardingStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOnboardingStatus.fulfilled, (state, action) => {
        state.loading = false;

        // Extract the data from the nested structure
        const responseData = action.payload.data || action.payload;

        // Map API response fields to state
        state.currentStep = responseData.current_step || responseData.currentStep;
        state.matrixConnected = responseData.matrix_connected || responseData.matrixConnected;
        state.whatsappConnected = responseData.whatsapp_connected || responseData.whatsappConnected;
        state.isComplete = responseData.is_complete || responseData.isComplete;
        state.connectedPlatforms = responseData.connected_platforms || responseData.connectedPlatforms || [];
        state.accounts = responseData.accounts || [];

        // Log the onboarding status for debugging
        logger.info('[onboardingSlice] Updated state from API response:', {
          currentStep: state.currentStep,
          isComplete: state.isComplete,
          whatsappConnected: state.whatsappConnected,
          accounts: state.accounts,
          connectedPlatforms: state.connectedPlatforms
        });

        // CRITICAL FIX: If onboarding is complete and whatsappConnected is true, ensure there's a WhatsApp account
        if (state.isComplete === true && state.whatsappConnected === true) {
          const hasWhatsappAccount = state.accounts.some(account =>
            account.platform === 'whatsapp' && (account.status === 'active' || account.status === 'pending')
          );

          if (!hasWhatsappAccount) {
            logger.info('[onboardingSlice] Adding missing WhatsApp account');
            state.accounts.push({
              platform: 'whatsapp',
              status: 'active'
            });
          }
        }
      })
      .addCase(fetchOnboardingStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(updateOnboardingStep.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateOnboardingStep.fulfilled, (state, action) => {
        state.loading = false;
        state.currentStep = action.payload.step;

        // Update connection states if provided
        if (action.payload.data) {
          const { data } = action.payload;
          if (data.matrixConnected !== undefined) {
            state.matrixConnected = data.matrixConnected;
          }
          if (data.whatsappConnected !== undefined) {
            state.whatsappConnected = data.whatsappConnected;
          }
          if (data.isComplete !== undefined) {
            state.isComplete = data.isComplete;
          }
          if (data.connectedPlatforms) {
            state.connectedPlatforms = data.connectedPlatforms;
          }
        }
      })
      .addCase(updateOnboardingStep.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(setWhatsappPhoneNumber, (state, action) => {
        state.whatsappSetup.phoneNumber = action.payload;
      })
      .addCase(setWhatsappConnected, (state, action) => {
        state.whatsappConnected = action.payload;
        if (action.payload === true && !state.connectedPlatforms.includes('whatsapp')) {
          state.connectedPlatforms.push('whatsapp');
        }
      });
  }
});

// Export all actions individually for clarity
export const {
  setOnboardingError,
  setCurrentStep,
  setIsComplete,
  setWhatsappConnected,
  setWhatsappQRCode,
  setWhatsappSetupState,
  setWhatsappTimeLeft,
  setWhatsappError,
  setBridgeRoomId,
  resetWhatsappSetup,
  setReloginFlow,
  updateAccounts,
  setOnboardingComplete,
  setTooltipStep
} = onboardingSlice.actions;

// Selectors
export const selectOnboardingState = (state) => state.onboarding;
export const selectWhatsappSetup = (state) => state.onboarding.whatsappSetup;

export default onboardingSlice.reducer;
