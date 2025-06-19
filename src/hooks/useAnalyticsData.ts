import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import analyticsService from '@/services/analyticsService';
import type { AnalyticsStatsResponse, DailySummaryResponse } from '@/services/analyticsService';
import logger from '@/utils/logger';

interface AnalyticsData {
  stats: AnalyticsStatsResponse | null;
  dailySummaries: DailySummaryResponse[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

// FIXED: Add caching mechanism - Fix for issue D
const CACHE_KEY = 'dashboard_analytics_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

interface CachedAnalyticsData {
  data: AnalyticsStatsResponse;
  timestamp: number;
  userId: string;
}

const getCachedData = (userId: string): AnalyticsStatsResponse | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const parsedCache: CachedAnalyticsData = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is valid (not expired and for the same user)
    if (
      parsedCache.userId === userId &&
      (now - parsedCache.timestamp) < CACHE_DURATION
    ) {
      logger.info('[useAnalyticsData] Using cached analytics data');
      return parsedCache.data;
    }
    
    // Cache expired or different user, remove it
    localStorage.removeItem(CACHE_KEY);
    return null;
  } catch (error) {
    logger.error('[useAnalyticsData] Error reading cache:', error);
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
};

const setCachedData = (data: AnalyticsStatsResponse, userId: string): void => {
  try {
    const cacheData: CachedAnalyticsData = {
      data,
      timestamp: Date.now(),
      userId
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    logger.info('[useAnalyticsData] Analytics data cached');
  } catch (error) {
    logger.error('[useAnalyticsData] Error caching data:', error);
  }
};

/**
 * Custom hook to fetch and manage analytics data
 * FIXED: Added caching mechanism to prevent unnecessary reloads
 */
export const useAnalyticsData = (): AnalyticsData => {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData>({
    stats: null,
    dailySummaries: [],
    isLoading: true,
    error: null,
    lastUpdated: null
  });

  // Get current user from auth state
  const currentUser = useSelector((state: any) => state.auth.session?.user);

  const fetchAnalyticsData = useCallback(async (forceRefresh = false) => {
    if (!currentUser?.id) {
      logger.warn('[useAnalyticsData] No user ID available');
      setAnalyticsData(prev => ({
        ...prev,
        isLoading: false,
        error: 'No user authentication'
      }));
      return;
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedStats = getCachedData(currentUser.id);
      if (cachedStats) {
        setAnalyticsData({
          stats: cachedStats,
          dailySummaries: [],
          isLoading: false,
          error: null,
          lastUpdated: new Date()
        });
        return;
      }
    }

    try {
      logger.info('[useAnalyticsData] Fetching analytics data from server');
      setAnalyticsData(prev => ({ ...prev, isLoading: true, error: null }));

      // Fetch analytics stats
      const stats = await analyticsService.getAnalyticsStats(currentUser.id);

      if (stats) {
        // Cache the successful result
        setCachedData(stats, currentUser.id);
      }

      setAnalyticsData({
        stats,
        dailySummaries: [],
        isLoading: false,
        error: stats === null ? 'Analytics data not available' : null,
        lastUpdated: new Date()
      });

      logger.info('[useAnalyticsData] Analytics data fetched successfully:', {
        hasStats: !!stats,
        cached: !forceRefresh
      });

    } catch (error: any) {
      logger.error('[useAnalyticsData] Error fetching analytics data:', error);
      setAnalyticsData(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Failed to fetch analytics data'
      }));
    }
  }, [currentUser?.id]);

  // Initial fetch ONLY - check cache first
  useEffect(() => {
    fetchAnalyticsData(false);
  }, [fetchAnalyticsData]);

  // FIXED: Return fetchAnalyticsData function to allow manual refresh
  return {
    ...analyticsData,
    refresh: () => fetchAnalyticsData(true)
  } as AnalyticsData & { refresh: () => void };
}; 