import api from './api';

export const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

export const validateSession = async () => {
  try {
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (!authDataStr) {
      return { valid: false, error: 'No session found' };
    }

    try {
      const authData = JSON.parse(authDataStr);
      if (!authData?.access_token) {
        return { valid: false, error: 'Invalid session format' };
      }

      // Check for Matrix session
      const matrixSession = localStorage.getItem('mx_user_id');
      const matrixAccessToken = localStorage.getItem('mx_access_token');
      
      if (!matrixSession || !matrixAccessToken) {
        return { valid: false, error: 'Matrix session not found' };
      }
    } catch (e) {
      return { valid: false, error: 'Invalid session data' };
    }

    const lastActivity = localStorage.getItem('last_activity');
    if (lastActivity && Date.now() - parseInt(lastActivity) > SESSION_TIMEOUT) {
      return { valid: false, error: 'Session expired' };
    }

    // Verify token with backend
    const response = await api.get('/auth/verify');
    if (!response.data.valid) {
      return { valid: false, error: 'Invalid session' };
    }

    // Check WhatsApp status
    // try {
    //   const whatsappStatus = await api.get('/matrix/whatsapp/status');
    //   if (whatsappStatus.data.status === 'active' && whatsappStatus.data.bridgeRoomId) {
    //     localStorage.setItem('whatsapp_bridge_room_id', whatsappStatus.data.bridgeRoomId);
    //   }
    // } catch (error) {
    //   console.warn('WhatsApp status check failed:', error);
    //   // Don't invalidate session for WhatsApp errors
    // }

    // Update last activity
    localStorage.setItem('last_activity', Date.now().toString());
    return { valid: true };
  } catch (error) {
    console.error('Session validation error:', error);
    return { valid: false, error: error.message };
  }
};

export const clearSession = () => {
  localStorage.removeItem('dailyfix_auth');
  localStorage.removeItem('last_activity');
  localStorage.removeItem('matrix_credentials');
}; 