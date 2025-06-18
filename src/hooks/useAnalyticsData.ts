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

/**
 * Custom hook to fetch and manage analytics data
 * FIXED: Removed infinite loop causes
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

  const fetchAnalyticsData = useCallback(async () => {
    if (!currentUser?.id) {
      logger.warn('[useAnalyticsData] No user ID available');
      setAnalyticsData(prev => ({
        ...prev,
        isLoading: false,
        error: 'No user authentication'
      }));
      return;
    }

    try {
      logger.info('[useAnalyticsData] Fetching analytics data');
      setAnalyticsData(prev => ({ ...prev, isLoading: true, error: null }));

      // Fetch analytics stats only
      const stats = await analyticsService.getAnalyticsStats(currentUser.id);

      setAnalyticsData({
        stats,
        dailySummaries: [], // Simplified - no bulk fetching for now
        isLoading: false,
        error: stats === null ? 'Analytics data not available' : null,
        lastUpdated: new Date()
      });

      logger.info('[useAnalyticsData] Analytics data fetched successfully:', {
        hasStats: !!stats
      });

    } catch (error: any) {
      logger.error('[useAnalyticsData] Error fetching analytics data:', error);
      setAnalyticsData(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Failed to fetch analytics data'
      }));
    }
  }, [currentUser?.id]); // Only depend on user ID

  // Initial fetch ONLY - no intervals or event listeners
  useEffect(() => {
    fetchAnalyticsData();
  }, [fetchAnalyticsData]);

  return analyticsData;
}; 