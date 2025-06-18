import api from '@/utils/api';
import logger from '@/utils/logger';

// TypeScript interfaces for API responses
export interface PlatformStats {
  total_contacts: number;
  total_messages_week: number;
}

export interface AnalyticsStatsResponse {
  total_contacts: number;
  total_messages_week: number;
  platform_stats: {
    whatsapp: PlatformStats;
    telegram: PlatformStats;
  };
}

export interface DailySummaryResponse {
  contact_id: number;
  platform: string;
  summary: string;
  generated_at: string;
}

class AnalyticsService {
  /**
   * Get analytics statistics for a user
   * @param userId - User ID to get stats for
   * @returns Promise<AnalyticsStatsResponse | null>
   */
  async getAnalyticsStats(userId: string): Promise<AnalyticsStatsResponse | null> {
    try {
      logger.info(`[AnalyticsService] Fetching analytics stats for user: ${userId}`);
      
      const response = await api.get(`/api/v1/analytics/stats/${userId}`, {
        timeout: 10000 // 10 second timeout
      });

      if (response.data) {
        logger.info('[AnalyticsService] Successfully fetched analytics stats:', response.data);
        return response.data;
      }

      logger.warn('[AnalyticsService] No data received from analytics stats API');
      return null;
    } catch (error: any) {
      logger.error('[AnalyticsService] Error fetching analytics stats:', error);
      
      // Return null instead of throwing to allow graceful fallback
      if (error.response?.status === 404) {
        logger.info('[AnalyticsService] Analytics stats not found for user - this may be normal for new users');
      }
      
      return null;
    }
  }

  /**
   * Get daily summary for a specific contact
   * @param userId - User ID
   * @param contactId - Contact ID
   * @param platform - Platform (whatsapp | telegram)
   * @returns Promise<DailySummaryResponse | null>
   */
  async getDailySummary(userId: string, contactId: number, platform: 'whatsapp' | 'telegram'): Promise<DailySummaryResponse | null> {
    try {
      logger.info(`[AnalyticsService] Fetching daily summary for user: ${userId}, contact: ${contactId}, platform: ${platform}`);
      
      // Note: The curl example shows port 8000, but I'll use the standard API base
      // If the port is different, this can be configured later
      const response = await api.get(`/api/v1/analytics/summary/${userId}/${contactId}`, {
        params: { platform },
        timeout: 15000, // 15 second timeout for AI processing
        headers: {
          // Using Proxy-Authorization as shown in the curl example
          'Proxy-Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });

      if (response.data) {
        logger.info('[AnalyticsService] Successfully fetched daily summary:', response.data);
        return response.data;
      }

      logger.warn('[AnalyticsService] No data received from daily summary API');
      return null;
    } catch (error: any) {
      logger.error('[AnalyticsService] Error fetching daily summary:', error);
      
      // Return null for graceful fallback
      if (error.response?.status === 404) {
        logger.info('[AnalyticsService] Daily summary not found - this may be normal if no recent activity');
      }
      
      return null;
    }
  }

  /**
   * Get multiple daily summaries for active contacts
   * @param userId - User ID  
   * @param contacts - Array of {id, platform} objects
   * @returns Promise<DailySummaryResponse[]>
   */
  async getBulkDailySummaries(userId: string, contacts: Array<{id: number, platform: 'whatsapp' | 'telegram'}>): Promise<DailySummaryResponse[]> {
    try {
      logger.info(`[AnalyticsService] Fetching bulk daily summaries for ${contacts.length} contacts`);
      
      // Make parallel requests for better performance
      const summaryPromises = contacts.map(contact => 
        this.getDailySummary(userId, contact.id, contact.platform)
      );
      
      const results = await Promise.allSettled(summaryPromises);
      
      const successfulSummaries = results
        .filter((result): result is PromiseFulfilledResult<DailySummaryResponse | null> => 
          result.status === 'fulfilled' && result.value !== null
        )
        .map(result => result.value!);
      
      logger.info(`[AnalyticsService] Successfully fetched ${successfulSummaries.length} summaries out of ${contacts.length} requests`);
      
      return successfulSummaries;
    } catch (error) {
      logger.error('[AnalyticsService] Error fetching bulk daily summaries:', error);
      return [];
    }
  }

  /**
   * Check if analytics are available for a user
   * @param userId - User ID to check
   * @returns Promise<boolean>
   */
  async isAnalyticsAvailable(userId: string): Promise<boolean> {
    try {
      const stats = await this.getAnalyticsStats(userId);
      return stats !== null;
    } catch (error) {
      logger.error('[AnalyticsService] Error checking analytics availability:', error);
      return false;
    }
  }
}

// Create singleton instance
const analyticsService = new AnalyticsService();

export default analyticsService; 