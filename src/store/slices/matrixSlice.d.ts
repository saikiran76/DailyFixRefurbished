import { AsyncThunk, Slice } from '@reduxjs/toolkit';

// Define types for credentials
export interface MatrixCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserver: string;
  password?: string;
  expires_at?: number;
}

// Define types for state
export interface MatrixState {
  credentials: MatrixCredentials | null;
  clientInitialized: boolean;
  syncState: 'INITIAL' | 'SYNCING' | 'PREPARED' | 'ERROR';
  loading: boolean;
  error: string | null;
}

// Define return types for async thunks
export interface FetchMatrixCredentialsReturn extends MatrixCredentials {}
export interface RegisterMatrixAccountReturn extends MatrixCredentials {}
export interface RefreshMatrixTokenReturn extends MatrixCredentials {}

// Define the type for the fetchMatrixCredentials thunk
export const fetchMatrixCredentials: AsyncThunk<
  FetchMatrixCredentialsReturn,
  string,
  {
    rejectValue: string;
  }
>;

// Define the type for the registerMatrixAccount thunk
export const registerMatrixAccount: AsyncThunk<
  RegisterMatrixAccountReturn,
  string,
  {
    rejectValue: string;
  }
>;

// Define the type for the refreshMatrixToken thunk
export const refreshMatrixToken: AsyncThunk<
  RefreshMatrixTokenReturn,
  MatrixCredentials,
  {
    rejectValue: string;
  }
>;

// Define action types
export const setClientInitialized: (isInitialized: boolean) => { payload: boolean; type: string };
export const setSyncState: (syncState: MatrixState['syncState']) => { payload: string; type: string };
export const clearMatrixState: () => { type: string };
export const reset: () => { type: string };

// Export the reducer
declare const reducer: Slice['reducer'];
export default reducer; 