import { createSlice } from '@reduxjs/toolkit';
import logger from '../../utils/logger';

const initialState = {
  loadingStates: {},
  errors: {},
  progress: {}
};

const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    setLoading: (state, action) => {
      const { key, isLoading } = action.payload;
      state.loadingStates[key] = isLoading;
      // Clear any existing error for this key when starting a new operation
      delete state.errors[key];
      logger.info(`Loading state for ${key}: ${isLoading}`);
    },
    setError: (state, action) => {
      const { key, error } = action.payload;
      state.errors[key] = error;
      // Clear loading state when an error occurs
      delete state.loadingStates[key];
      logger.info(`Error for ${key}:`, error);
    },
    setProgress: (state, action) => {
      const { key, value } = action.payload;
      state.progress[key] = value;
      logger.info(`Progress for ${key}: ${value}`);
    },
    clearProgress: (state, action) => {
      const key = action.payload;
      delete state.loadingStates[key];
      delete state.errors[key];
      delete state.progress[key];
      logger.info(`Cleared progress for ${key}`);
    },
    resetProgress: (state) => {
      state.loadingStates = {};
      state.errors = {};
      state.progress = {};
    }
  }
});

export const {
  setLoading,
  setError,
  setProgress,
  clearProgress,
  resetProgress
} = progressSlice.actions;

export const progressReducer = progressSlice.reducer;

// Selectors
export const selectIsLoading = (state: any, key: string) => Boolean(state.progress.loadingStates[key]);
export const selectProgress = (state: any, key: string) => state.progress.progress[key];
export const selectError = (state: any, key: string) => state.progress.errors[key]; 