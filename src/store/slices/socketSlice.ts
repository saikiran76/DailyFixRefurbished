import { createSlice } from '@reduxjs/toolkit';
import logger from '../../utils/logger';
import socketManager from '../../utils/socket';

const initialState = {
  connected: false,
  authenticated: false,
  health: {
    isHealthy: false,
    lastChecked: null,
    metrics: null
  },
  error: null,
  reconnecting: false,
  rooms: [],
  pendingOperations: []
};

const socketSlice = createSlice({
  name: 'socket',
  initialState,
  reducers: {
    setConnected: (state, action) => {
      state.connected = action.payload;
      if (!action.payload) {
        state.authenticated = false;
      }
    },
    setAuthenticated: (state, action) => {
      state.authenticated = action.payload;
    },
    setSocketHealth: (state, action) => {
      const metrics = action.payload.metrics ? {
        ...action.payload.metrics,
        rooms: Array.isArray(action.payload.metrics.rooms) 
          ? action.payload.metrics.rooms 
          : Array.from(action.payload.metrics.rooms || []),
        pendingOperations: Array.isArray(action.payload.metrics.pendingOperations)
          ? action.payload.metrics.pendingOperations
          : Array.from(action.payload.metrics.pendingOperations || [])
      } : null;

      state.health = {
        ...action.payload,
        metrics
      };
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
    setReconnecting: (state, action) => {
      state.reconnecting = action.payload;
    },
    addRoom: (state, action) => {
      if (!state.rooms.includes(action.payload)) {
        state.rooms.push(action.payload);
      }
    },
    removeRoom: (state, action) => {
      state.rooms = state.rooms.filter(room => room !== action.payload);
    },
    setRooms: (state, action) => {
      state.rooms = Array.isArray(action.payload) 
        ? action.payload 
        : Array.from(action.payload);
    },
    addPendingOperation: (state, action) => {
      if (!state.pendingOperations.includes(action.payload)) {
        state.pendingOperations.push(action.payload);
      }
    },
    removePendingOperation: (state, action) => {
      state.pendingOperations = state.pendingOperations.filter(op => op !== action.payload);
    },
    setPendingOperations: (state, action) => {
      state.pendingOperations = Array.isArray(action.payload)
        ? action.payload
        : Array.from(action.payload);
    },
    resetSocketState: () => initialState
  }
});

// Export actions
export const {
  setConnected,
  setAuthenticated,
  setSocketHealth,
  setError,
  setReconnecting,
  addRoom,
  removeRoom,
  setRooms,
  addPendingOperation,
  removePendingOperation,
  setPendingOperations,
  resetSocketState
} = socketSlice.actions;

// Thunk action for connecting socket
export const connect = () => async (dispatch) => {
  try {
    dispatch(setReconnecting(true));
    const socket = await socketManager.connect();
    
    logger.info('Socket connection successful');
    dispatch(setConnected(true));

    if (socket.rooms) {
      dispatch(setRooms(Array.from(socket.rooms)));
    }
    if (socket.pendingOperations) {
      dispatch(setPendingOperations(Array.from(socket.pendingOperations)));
    }

    return socket;
  } catch (error) {
    logger.error('Socket connection failed:', error);
    dispatch(setError(error.message));
    dispatch(setConnected(false));
    throw error;
  } finally {
    dispatch(setReconnecting(false));
  }
};

// Thunk action for disconnecting socket
export const disconnect = () => async (dispatch) => {
  try {
    await socketManager.disconnect();
    dispatch(setConnected(false));
    dispatch(resetSocketState());
  } catch (error) {
    logger.error('Socket disconnect failed:', error);
    dispatch(setError(error.message));
  }
};

// Selectors
export const selectSocketConnected = (state) => state.socket.connected;
export const selectSocketAuthenticated = (state) => state.socket.authenticated;
export const selectSocketHealth = (state) => state.socket.health;
export const selectSocketError = (state) => state.socket.error;
export const selectSocketReconnecting = (state) => state.socket.reconnecting;
export const selectSocketRooms = (state) => state.socket.rooms;
export const selectSocketPendingOperations = (state) => state.socket.pendingOperations;
export const selectIsSocketHealthy = (state) => state.socket.health.isHealthy;

export default socketSlice.reducer; 