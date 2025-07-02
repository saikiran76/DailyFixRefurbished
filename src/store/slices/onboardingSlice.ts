import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import api from '@/utils/api';
import logger from '@/utils/logger';
import { saveWhatsAppStatus, saveTelegramStatus, saveInstagramStatus, saveLinkedInStatus } from '@/utils/connectionStorage';
import { setWhatsAppConnectedDB, setTelegramConnectedDB } from '@/utils/connectionStorageDB';

// Define types for state interfaces
interface WhatsAppSetup {
  loading: boolean;
  error: any | null;
  qrCode: string | null;
  setupState: string;
  timeLeft: number;
  qrExpired: boolean;
  bridgeRoomId: string | null;
  phoneNumber: string | null;
  realTimeSetup: boolean;
}

interface TelegramSetup {
  loading: boolean;
  error: any | null;
  qrCode: string | null;
  setupState: string;
  timeLeft: number;
  qrExpired: boolean;
  bridgeRoomId: string | null;
  phoneNumber: string | null;
  realTimeSetup: boolean;
}

interface InstagramSetup {
  loading: boolean;
  error: any | null;
  setupState: string;
  bridgeRoomId: string | null;
  userName: string | null;
  instagramUserId: string | null;
  curlCommand: string | null;
}

interface LinkedInSetup {
  loading: boolean;
  error: any | null;
  setupState: string;
  bridgeRoomId: string | null;
  userName: string | null;
  linkedinUserId: string | null;
  curlCommand: string | null;
}

interface PlatformAccount {
  platform: string;
  status: string;
}

interface OnboardingState {
  currentStep: string;
  loading: boolean;
  error: any | null;
  matrixConnected: boolean;
  whatsappConnected: boolean;
  telegramConnected: boolean;
  instagramConnected: boolean;
  linkedinConnected: boolean;
  isComplete: boolean;
  connectedPlatforms: string[];
  accounts: PlatformAccount[];
  whatsappSetup: WhatsAppSetup;
  telegramSetup: TelegramSetup;
  instagramSetup: InstagramSetup;
  linkedinSetup: LinkedInSetup;
  isReloginFlow: boolean;
  onboardingComplete: boolean;
  tooltipStep: number;
}

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
  TELEGRAM: {
    id: 'telegram',
    protocol: PROTOCOLS.MATRIX,
    required: false
  },
  INSTAGRAM: {
    id: 'instagram',
    protocol: PROTOCOLS.MATRIX,
    required: false
  },
  LINKEDIN: {
    id: 'linkedin',
    protocol: PROTOCOLS.MATRIX,
    required: false
  }
  // DISCORD: {
  //   id: 'discord',
  //   protocol: PROTOCOLS.DIRECT_API,
  //   required: false
  // }
};

const initialState: OnboardingState = {
  currentStep: 'welcome',
  loading: false,
  error: null,
  matrixConnected: false,
  whatsappConnected: false,
  telegramConnected: false,
  instagramConnected: false,
  linkedinConnected: false,
  isComplete: false,
  connectedPlatforms: [],
  accounts: [],
  whatsappSetup: {
    loading: false,
    error: null,
    qrCode: null,
    setupState: 'preparing',
    timeLeft: 60,
    qrExpired: false,
    bridgeRoomId: null,
    phoneNumber: null,
    realTimeSetup: false
  },
  telegramSetup: {
    loading: false,
    error: null,
    qrCode: null,
    setupState: 'preparing',
    timeLeft: 60,
    qrExpired: false,
    bridgeRoomId: null,
    phoneNumber: null,
    realTimeSetup: false
  },
  instagramSetup: {
    loading: false,
    error: null,
    setupState: 'preparing',
    bridgeRoomId: null,
    userName: null,
    instagramUserId: null,
    curlCommand: null
  },
  linkedinSetup: {
    loading: false,
    error: null,
    setupState: 'preparing',
    bridgeRoomId: null,
    userName: null,
    linkedinUserId: null,
    curlCommand: null
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
    } catch (error: any) {
      return rejectWithValue(error.response?.data || error.message);
    }
  }
);

interface UpdateStepPayload {
  step: string;
  data?: Record<string, any>;
}

export const updateOnboardingStep = createAsyncThunk(
  'onboarding/updateStep',
  async ({ step, data = {} }: UpdateStepPayload, { rejectWithValue }) => {
    try {
      await api.post('/api/v1/users/onboarding/step', {
        step: step,
        ...data
      });
      return { step, data };
    } catch (error: any) {
      return rejectWithValue(error.response?.data || error.message);
    }
  }
);

export const setWhatsappPhoneNumber = createAction<string>('onboarding/setWhatsappPhoneNumber');
export const setTelegramPhoneNumber = createAction<string>('onboarding/setTelegramPhoneNumber');
export const setInstagramUserName = createAction<string>('onboarding/setInstagramUserName');
export const setInstagramUserId = createAction<string>('onboarding/setInstagramUserId');
export const setInstagramCurlCommand = createAction<string>('onboarding/setInstagramCurlCommand');
export const setLinkedInUserName = createAction<string>('onboarding/setLinkedInUserName');
export const setLinkedInUserId = createAction<string>('onboarding/setLinkedInUserId');
export const setLinkedInCurlCommand = createAction<string>('onboarding/setLinkedInCurlCommand');

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

// Add a similar function for Telegram relogin
export const initiateTelegramRelogin = createAsyncThunk(
  'onboarding/initiateTelegramRelogin',
  async (_, { dispatch }) => {
    try {
      dispatch(setReloginFlow(true));
      dispatch(setTelegramConnected(false));
      return true;
    } catch (error) {
      throw error;
    }
  }
);

// Add a similar function for Instagram relogin
export const initiateInstagramRelogin = createAsyncThunk(
  'onboarding/initiateInstagramRelogin',
  async (_, { dispatch }) => {
    try {
      dispatch(setReloginFlow(true));
      dispatch(setInstagramConnected(false));
      return true;
    } catch (error) {
      throw error;
    }
  }
);

// Add a similar function for LinkedIn relogin
export const initiateLinkedInRelogin = createAsyncThunk(
  'onboarding/initiateLinkedInRelogin',
  async (_, { dispatch }) => {
    try {
      dispatch(setReloginFlow(true));
      dispatch(setLinkedInConnected(false));
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
    setOnboardingError: (state, action: PayloadAction<any>) => {
      state.error = action.payload;
    },
    setCurrentStep: (state, action: PayloadAction<string>) => {
      state.currentStep = action.payload;
    },
    setIsComplete: (state, action: PayloadAction<boolean>) => {
      state.isComplete = action.payload;
    },
    setWhatsappConnected: (state, action: PayloadAction<boolean>) => {
      try {
        state.whatsappConnected = action.payload;

        // Save to IndexedDB and localStorage
        try {
          // Use the new IndexedDB storage
          setWhatsAppConnectedDB(action.payload, undefined);

          // Also update the old localStorage as a fallback
          saveWhatsAppStatus(action.payload);

          logger.info('[onboardingSlice] WhatsApp connection status updated:', action.payload);
        } catch (storageError) {
          logger.error('[onboardingSlice] Error saving WhatsApp connection status:', storageError);
        }

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
            const userDataStr = localStorage.getItem('dailyfix_auth');
            const userId = userDataStr ? JSON.parse(userDataStr)?.user?.id : undefined;
            
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
      } catch (error) {
        logger.error('[onboardingSlice] Error setting WhatsApp connection status:', error);
      }
    },
    setTelegramConnected: (state, action: PayloadAction<boolean>) => {
      try {
        state.telegramConnected = action.payload;

        // Save to localStorage
        try {
          // Use the IndexedDB storage if available
          setTelegramConnectedDB(action.payload, undefined);

          // Also update localStorage as a fallback
          saveTelegramStatus(action.payload);

          logger.info('[onboardingSlice] Telegram connection status updated:', action.payload);
        } catch (storageError) {
          logger.error('[onboardingSlice] Error saving Telegram connection status:', storageError);
        }
        
        if (action.payload === true) {
          // Add Telegram to connectedPlatforms if not already present
          if (!state.connectedPlatforms.includes('telegram')) {
            state.connectedPlatforms.push('telegram');
          }

          // Add Telegram to accounts array if not already present
          const telegramAccountExists = state.accounts.some(account => account.platform === 'telegram');
          if (!telegramAccountExists) {
            state.accounts.push({
              platform: 'telegram',
              status: 'active'
            });
          } else {
            // Update existing Telegram account status to active
            const telegramAccount = state.accounts.find(account => account.platform === 'telegram');
            if (telegramAccount) {
              telegramAccount.status = 'active';
            }
          }

          // Also save to localStorage for persistence
          try {
            // Save in connection storage
            const userDataStr = localStorage.getItem('dailyfix_auth');
            const userId = userDataStr ? JSON.parse(userDataStr)?.user?.id : undefined;
            
            if (userId) {
              // Get existing connection status
              let connectionStatus: Record<string, boolean> = {};
              const storedDataStr = localStorage.getItem('dailyfix_connection_status');
              if (storedDataStr) {
                try {
                  const storedData = JSON.parse(storedDataStr);
                  connectionStatus = storedData.status || {};
                } catch (e) {
                  console.error('Error parsing connection status:', e);
                }
              }
              
              // Update with telegram status
              connectionStatus.telegram = true;
              
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

                // Now safely add the telegramConnected property
                authData.telegramConnected = true;
                localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
              }
            } catch (authError) {
              console.error('Error updating auth data with Telegram connection:', authError);
            }
          } catch (error) {
            console.error('Error saving Telegram connection status to localStorage:', error);
          }
        }
      } catch (error) {
        logger.error('[onboardingSlice] Error setting Telegram connection status:', error);
      }
    },
    setInstagramConnected: (state, action: PayloadAction<boolean>) => {
      try {
        state.instagramConnected = action.payload;

        // Save to localStorage
        try {
          // Update localStorage as a fallback
          saveInstagramStatus(action.payload);

          logger.info('[onboardingSlice] Instagram connection status updated:', action.payload);
        } catch (storageError) {
          logger.error('[onboardingSlice] Error saving Instagram connection status:', storageError);
        }
        
        if (action.payload === true) {
          // Add Instagram to connectedPlatforms if not already present
          if (!state.connectedPlatforms.includes('instagram')) {
            state.connectedPlatforms.push('instagram');
          }

          // Add Instagram to accounts array if not already present
          const instagramAccountExists = state.accounts.some(account => account.platform === 'instagram');
          if (!instagramAccountExists) {
            state.accounts.push({
              platform: 'instagram',
              status: 'active'
            });
          } else {
            // Update existing Instagram account status to active
            const instagramAccount = state.accounts.find(account => account.platform === 'instagram');
            if (instagramAccount) {
              instagramAccount.status = 'active';
            }
          }

          // Also save to localStorage for persistence
          try {
            // Save in connection storage
            const userDataStr = localStorage.getItem('dailyfix_auth');
            const userId = userDataStr ? JSON.parse(userDataStr)?.user?.id : undefined;
            
            if (userId) {
              // Get existing connection status
              let connectionStatus: Record<string, boolean> = {};
              const storedDataStr = localStorage.getItem('dailyfix_connection_status');
              if (storedDataStr) {
                try {
                  const storedData = JSON.parse(storedDataStr);
                  connectionStatus = storedData.status || {};
                } catch (e) {
                  console.error('Error parsing connection status:', e);
                }
              }
              
              // Update with instagram status
              connectionStatus.instagram = true;
              
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

                // Now safely add the instagramConnected property
                authData.instagramConnected = true;
                localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
              }
            } catch (authError) {
              console.error('Error updating auth data with Instagram connection:', authError);
            }
          } catch (error) {
            console.error('Error saving Instagram connection status to localStorage:', error);
          }
        }
      } catch (error) {
        logger.error('[onboardingSlice] Error setting Instagram connection status:', error);
      }
    },
    setLinkedInConnected: (state, action: PayloadAction<boolean>) => {
      try {
        state.linkedinConnected = action.payload;

        // Save to localStorage
        try {
          // Update localStorage as a fallback
          saveLinkedInStatus(action.payload);

          logger.info('[onboardingSlice] LinkedIn connection status updated:', action.payload);
        } catch (storageError) {
          logger.error('[onboardingSlice] Error saving LinkedIn connection status:', storageError);
        }
        
        if (action.payload === true) {
          // Add LinkedIn to connectedPlatforms if not already present
          if (!state.connectedPlatforms.includes('linkedin')) {
            state.connectedPlatforms.push('linkedin');
          }

          // Add LinkedIn to accounts array if not already present
          const linkedinAccountExists = state.accounts.some(account => account.platform === 'linkedin');
          if (!linkedinAccountExists) {
            state.accounts.push({
              platform: 'linkedin',
              status: 'active'
            });
          } else {
            // Update existing LinkedIn account status to active
            const linkedinAccount = state.accounts.find(account => account.platform === 'linkedin');
            if (linkedinAccount) {
              linkedinAccount.status = 'active';
            }
          }

          // Also save to localStorage for persistence
          try {
            // Save in connection storage
            const userDataStr = localStorage.getItem('dailyfix_auth');
            const userId = userDataStr ? JSON.parse(userDataStr)?.user?.id : undefined;
            
            if (userId) {
              // Get existing connection status
              let connectionStatus: Record<string, boolean> = {};
              const storedDataStr = localStorage.getItem('dailyfix_connection_status');
              if (storedDataStr) {
                try {
                  const storedData = JSON.parse(storedDataStr);
                  connectionStatus = storedData.status || {};
                } catch (e) {
                  console.error('Error parsing connection status:', e);
                }
              }
              
              // Update with linkedin status
              connectionStatus.linkedin = true;
              
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

                // Now safely add the linkedinConnected property
                authData.linkedinConnected = true;
                localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
              }
            } catch (authError) {
              console.error('Error updating auth data with LinkedIn connection:', authError);
            }
          } catch (error) {
            console.error('Error saving LinkedIn connection status to localStorage:', error);
          }
        }
      } catch (error) {
        logger.error('[onboardingSlice] Error setting LinkedIn connection status:', error);
      }
    },
    setWhatsappQRCode: (state, action: PayloadAction<string | null>) => {
      state.whatsappSetup.qrCode = action.payload;
      state.whatsappSetup.timeLeft = 60;
      state.whatsappSetup.qrExpired = false;
      state.whatsappSetup.error = null;
      state.whatsappSetup.loading = false;
      // state.whatsappSetup.realTimeSetup = false;
      if (state.whatsappSetup.setupState === 'waiting_for_qr') {
        state.whatsappSetup.setupState = 'qr_ready';
      }
    },
    setTelegramQRCode: (state, action: PayloadAction<string | null>) => {
      state.telegramSetup.qrCode = action.payload;
      state.telegramSetup.timeLeft = 60;
      state.telegramSetup.qrExpired = false;
      state.telegramSetup.error = null;
      state.telegramSetup.loading = false;
      if (state.telegramSetup.setupState === 'waiting_for_qr') {
        state.telegramSetup.setupState = 'qr_ready';
      }
    },
    setWhatsappSetupState: (state, action: PayloadAction<string>) => {
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
    setTelegramSetupState: (state, action: PayloadAction<string>) => {
      state.telegramSetup.setupState = action.payload;
      // Update loading state based on setupState
      state.telegramSetup.loading = ['preparing', 'waiting_for_qr'].includes(action.payload);
      // Clear error when changing state (except for error state)
      if (action.payload !== 'error') {
        state.telegramSetup.error = null;
      }
      // Update main telegramConnected flag when setup is complete
      if (action.payload === 'connected') {
        state.telegramConnected = true;
        if (!state.connectedPlatforms.includes('telegram')) {
          state.connectedPlatforms.push('telegram');
        }

        // Add Telegram to accounts array if not already present
        const telegramAccountExists = state.accounts.some(account => account.platform === 'telegram');
        if (!telegramAccountExists) {
          state.accounts.push({
            platform: 'telegram',
            status: 'active'
          });
        } else {
          // Update existing Telegram account status to active
          const telegramAccount = state.accounts.find(account => account.platform === 'telegram');
          if (telegramAccount) {
            telegramAccount.status = 'active';
          }
        }
      }

      if (action.payload === 'puppet_sent') {
        state.telegramSetup.realTimeSetup = true;
      }
    },
    setInstagramSetupState: (state, action: PayloadAction<string>) => {
      state.instagramSetup.setupState = action.payload;
      // Update loading state based on setupState
      state.instagramSetup.loading = ['preparing', 'waiting_for_curl'].includes(action.payload);
      // Clear error when changing state (except for error state)
      if (action.payload !== 'error') {
        state.instagramSetup.error = null;
      }
      // Update main instagramConnected flag when setup is complete
      if (action.payload === 'connected') {
        state.instagramConnected = true;
        if (!state.connectedPlatforms.includes('instagram')) {
          state.connectedPlatforms.push('instagram');
        }

        // Add Instagram to accounts array if not already present
        const instagramAccountExists = state.accounts.some(account => account.platform === 'instagram');
        if (!instagramAccountExists) {
          state.accounts.push({
            platform: 'instagram',
            status: 'active'
          });
        } else {
          // Update existing Instagram account status to active
          const instagramAccount = state.accounts.find(account => account.platform === 'instagram');
          if (instagramAccount) {
            instagramAccount.status = 'active';
          }
        }
      }
    },
    setLinkedInSetupState: (state, action: PayloadAction<string>) => {
      state.linkedinSetup.setupState = action.payload;
      // Update loading state based on setupState
      state.linkedinSetup.loading = ['preparing', 'waiting_for_curl'].includes(action.payload);
      // Clear error when changing state (except for error state)
      if (action.payload !== 'error') {
        state.linkedinSetup.error = null;
      }
      // Update main linkedinConnected flag when setup is complete
      if (action.payload === 'connected') {
        state.linkedinConnected = true;
        if (!state.connectedPlatforms.includes('linkedin')) {
          state.connectedPlatforms.push('linkedin');
        }

        // Add LinkedIn to accounts array if not already present
        const linkedinAccountExists = state.accounts.some(account => account.platform === 'linkedin');
        if (!linkedinAccountExists) {
          state.accounts.push({
            platform: 'linkedin',
            status: 'active'
          });
        } else {
          // Update existing LinkedIn account status to active
          const linkedinAccount = state.accounts.find(account => account.platform === 'linkedin');
          if (linkedinAccount) {
            linkedinAccount.status = 'active';
          }
        }
      }
    },
    setWhatsappTimeLeft: (state, action: PayloadAction<number>) => {
      state.whatsappSetup.timeLeft = action.payload;
      if (action.payload <= 0) {
        state.whatsappSetup.qrExpired = true;
        state.whatsappSetup.setupState = 'error';
        state.whatsappSetup.error = { message: 'QR Code expired. Please try again.' };
      }
    },
    setTelegramTimeLeft: (state, action: PayloadAction<number>) => {
      state.telegramSetup.timeLeft = action.payload;
      if (action.payload <= 0) {
        state.telegramSetup.qrExpired = true;
        state.telegramSetup.setupState = 'error';
        state.telegramSetup.error = { message: 'QR Code expired. Please try again.' };
      }
    },
    setWhatsappError: (state, action: PayloadAction<any>) => {
      state.whatsappSetup.error = action.payload;
      state.whatsappSetup.setupState = 'error';
    },
    setTelegramError: (state, action: PayloadAction<any>) => {
      state.telegramSetup.error = action.payload;
      state.telegramSetup.setupState = 'error';
    },
    setInstagramError: (state, action: PayloadAction<any>) => {
      state.instagramSetup.error = action.payload;
      state.instagramSetup.setupState = 'error';
    },
    setLinkedInError: (state, action: PayloadAction<any>) => {
      state.linkedinSetup.error = action.payload;
      state.linkedinSetup.setupState = 'error';
    },
    setBridgeRoomId: (state, action: PayloadAction<string | null>) => {
      state.whatsappSetup.bridgeRoomId = action.payload;
    },
    setTelegramBridgeRoomId: (state, action: PayloadAction<string | null>) => {
      state.telegramSetup.bridgeRoomId = action.payload;
    },
    setInstagramBridgeRoomId: (state, action: PayloadAction<string | null>) => {
      state.instagramSetup.bridgeRoomId = action.payload;
    },
    setLinkedInBridgeRoomId: (state, action: PayloadAction<string | null>) => {
      state.linkedinSetup.bridgeRoomId = action.payload;
    },
    resetWhatsappSetup: (state) => {
      state.whatsappSetup = {
        ...initialState.whatsappSetup,
        setupState: 'initial'
      };
    },
    resetTelegramSetup: (state) => {
      state.telegramSetup = {
        ...initialState.telegramSetup,
        setupState: 'initial'
      };
    },
    resetInstagramSetup: (state) => {
      state.instagramSetup = {
        ...initialState.instagramSetup,
        setupState: 'initial'
      };
    },
    resetLinkedInSetup: (state) => {
      state.linkedinSetup = {
        ...initialState.linkedinSetup,
        setupState: 'initial'
      };
    },
    setReloginFlow: (state, action: PayloadAction<boolean>) => {
      state.isReloginFlow = action.payload;
    },
    setOnboardingComplete: (state, action: PayloadAction<boolean>) => {
      state.onboardingComplete = action.payload;
    },
    setTooltipStep: (state, action: PayloadAction<number>) => {
      state.tooltipStep = action.payload;
    },
    updateAccounts: (state, action: PayloadAction<PlatformAccount[]>) => {
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
        state.telegramConnected = responseData.telegram_connected || responseData.telegramConnected;
        state.instagramConnected = responseData.instagram_connected || responseData.instagramConnected;
        state.linkedinConnected = responseData.linkedin_connected || responseData.linkedinConnected;
        state.isComplete = responseData.is_complete || responseData.isComplete;
        state.connectedPlatforms = responseData.connected_platforms || responseData.connectedPlatforms || [];
        state.accounts = responseData.accounts || [];

        // Log the onboarding status for debugging
        logger.info('[onboardingSlice] Updated state from API response:', {
          currentStep: state.currentStep,
          isComplete: state.isComplete,
          whatsappConnected: state.whatsappConnected,
          telegramConnected: state.telegramConnected,
          instagramConnected: state.instagramConnected,
          linkedinConnected: state.linkedinConnected,
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

        // Do the same for Telegram
        if (state.isComplete === true && state.telegramConnected === true) {
          const hasTelegramAccount = state.accounts.some(account =>
            account.platform === 'telegram' && (account.status === 'active' || account.status === 'pending')
          );

          if (!hasTelegramAccount) {
            logger.info('[onboardingSlice] Adding missing Telegram account');
            state.accounts.push({
              platform: 'telegram',
              status: 'active'
            });
          }
        }

        // Do the same for Instagram
        if (state.isComplete === true && state.instagramConnected === true) {
          const hasInstagramAccount = state.accounts.some(account =>
            account.platform === 'instagram' && (account.status === 'active' || account.status === 'pending')
          );

          if (!hasInstagramAccount) {
            logger.info('[onboardingSlice] Adding missing Instagram account');
            state.accounts.push({
              platform: 'instagram',
              status: 'active'
            });
          }
        }

        // Do the same for LinkedIn
        if (state.isComplete === true && state.linkedinConnected === true) {
          const hasLinkedInAccount = state.accounts.some(account =>
            account.platform === 'linkedin' && (account.status === 'active' || account.status === 'pending')
          );

          if (!hasLinkedInAccount) {
            logger.info('[onboardingSlice] Adding missing LinkedIn account');
            state.accounts.push({
              platform: 'linkedin',
              status: 'active'
            });
          }
        }
      })
      .addCase(fetchOnboardingStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || action.error.message;
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
          if (data.telegramConnected !== undefined) {
            state.telegramConnected = data.telegramConnected;
          }
          if (data.instagramConnected !== undefined) {
            state.instagramConnected = data.instagramConnected;
          }
          if (data.linkedinConnected !== undefined) {
            state.linkedinConnected = data.linkedinConnected;
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
        state.error = action.payload || action.error.message;
      })
      .addCase(setWhatsappPhoneNumber, (state, action) => {
        state.whatsappSetup.phoneNumber = action.payload;
      })
      .addCase(setTelegramPhoneNumber, (state, action) => {
        state.telegramSetup.phoneNumber = action.payload;
      })
      .addCase(setInstagramUserName, (state, action) => {
        state.instagramSetup.userName = action.payload;
      })
      .addCase(setInstagramUserId, (state, action) => {
        state.instagramSetup.instagramUserId = action.payload;
      })
      .addCase(setInstagramCurlCommand, (state, action) => {
        state.instagramSetup.curlCommand = action.payload;
      })
      .addCase(setLinkedInUserName, (state, action) => {
        state.linkedinSetup.userName = action.payload;
      })
      .addCase(setLinkedInUserId, (state, action) => {
        state.linkedinSetup.linkedinUserId = action.payload;
      })
      .addCase(setLinkedInCurlCommand, (state, action) => {
        state.linkedinSetup.curlCommand = action.payload;
      })
      .addCase(setWhatsappConnected, (state, action) => {
        state.whatsappConnected = action.payload;
        if (action.payload === true && !state.connectedPlatforms.includes('whatsapp')) {
          state.connectedPlatforms.push('whatsapp');
        }
      })
      .addCase(setTelegramConnected, (state, action) => {
        state.telegramConnected = action.payload;
        if (action.payload === true && !state.connectedPlatforms.includes('telegram')) {
          state.connectedPlatforms.push('telegram');
        }
      })
      .addCase(setInstagramConnected, (state, action) => {
        state.instagramConnected = action.payload;
        if (action.payload === true && !state.connectedPlatforms.includes('instagram')) {
          state.connectedPlatforms.push('instagram');
        }
      })
      .addCase(setLinkedInConnected, (state, action) => {
        state.linkedinConnected = action.payload;
        if (action.payload === true && !state.connectedPlatforms.includes('linkedin')) {
          state.connectedPlatforms.push('linkedin');
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
  setTelegramConnected,
  setInstagramConnected,
  setLinkedInConnected,
  setWhatsappQRCode,
  setTelegramQRCode,
  setWhatsappSetupState,
  setTelegramSetupState,
  setInstagramSetupState,
  setLinkedInSetupState,
  setWhatsappTimeLeft,
  setTelegramTimeLeft,
  setWhatsappError,
  setTelegramError,
  setInstagramError,
  setLinkedInError,
  setBridgeRoomId,
  setTelegramBridgeRoomId,
  setInstagramBridgeRoomId,
  setLinkedInBridgeRoomId,
  resetWhatsappSetup,
  resetTelegramSetup,
  resetInstagramSetup,
  resetLinkedInSetup,
  setReloginFlow,
  updateAccounts,
  setOnboardingComplete,
  setTooltipStep
} = onboardingSlice.actions;

// Selectors
export const selectOnboardingState = (state: { onboarding: OnboardingState }) => state.onboarding;
export const selectWhatsappSetup = (state: { onboarding: OnboardingState }) => state.onboarding.whatsappSetup;
export const selectTelegramSetup = (state: { onboarding: OnboardingState }) => state.onboarding.telegramSetup;
export const selectInstagramSetup = (state: { onboarding: OnboardingState }) => state.onboarding.instagramSetup;
export const selectLinkedInSetup = (state: { onboarding: OnboardingState }) => state.onboarding.linkedinSetup;

export default onboardingSlice.reducer;
