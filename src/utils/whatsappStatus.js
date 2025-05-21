import { useEffect, useState } from 'react';
import { useSocket } from './socket';

const STATUS_CACHE_KEY = 'whatsapp_status_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export class WhatsAppStatusManager {
  constructor() {
    this.cache = new Map();
    this.pendingChecks = new Map();
  }

  async getStatus(userId) {
    // Check memory cache first
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.status;
    }

    // Check if there's a pending check for this user
    if (this.pendingChecks.has(userId)) {
      return this.pendingChecks.get(userId);
    }

    // Create new check promise
    const checkPromise = this._fetchStatus(userId);
    this.pendingChecks.set(userId, checkPromise);

    try {
      const status = await checkPromise;
      return status;
    } finally {
      this.pendingChecks.delete(userId);
    }
  }

  // async _fetchStatus(userId) {
  //   try {
  //     const response = await fetch('/api/matrix/whatsapp/status', {
  //       headers: {
  //         'Authorization': `Bearer ${localStorage.getItem('access_token')}`
  //       }
  //     });

  //     if (!response.ok) throw new Error('Failed to fetch status');

  //     const status = await response.json();
      
  //     // Update cache
  //     this.cache.set(userId, {
  //       status,
  //       timestamp: Date.now()
  //     });

  //     return status;
  //   } catch (error) {
  //     console.error('Error fetching WhatsApp status:', error);
  //     throw error;
  //   }
  // }

  updateCache(userId, status) {
    this.cache.set(userId, {
      status,
      timestamp: Date.now()
    });
  }

  clearCache(userId) {
    this.cache.delete(userId);
  }
}

const statusManager = new WhatsAppStatusManager();

function useWhatsAppStatus(userId) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { socket } = useSocket();

  useEffect(() => {
    let mounted = true;

    const checkStatus = async () => {
      try {
        setLoading(true);
        const result = await statusManager.getStatus(userId);
        if (mounted) {
          setStatus(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    checkStatus();

    if (socket) {
      socket.on('whatsapp_status', (newStatus) => {
        if (mounted && newStatus.userId === userId) {
          statusManager.updateCache(userId, newStatus);
          setStatus(newStatus);
        }
      });

      socket.on('connect', checkStatus);
    }

    return () => {
      mounted = false;
      if (socket) {
        socket.off('whatsapp_status');
        socket.off('connect');
      }
    };
  }, [userId, socket]);

  return { 
    status, 
    loading, 
    error, 
    refetch: () => {
      statusManager.clearCache(userId);
      return checkStatus();
    }
  };
}

export default statusManager;
export { useWhatsAppStatus }; 