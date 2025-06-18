import logger from '@/utils/logger';

export type Priority = 'low' | 'medium' | 'high';

export interface PriorityStats {
  high: number;
  medium: number;
  low: number;
  total: number;
}

class PriorityService {
  private storageKey = 'contact_priorities';
  private priorities: Map<string, Priority> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load priorities from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.priorities = new Map(Object.entries(parsed));
        logger.info('[PriorityService] Loaded priorities from storage:', this.priorities.size);
      }
    } catch (error) {
      logger.error('[PriorityService] Error loading priorities from storage:', error);
      this.priorities = new Map();
    }
  }

  /**
   * Save priorities to localStorage
   */
  private saveToStorage(): void {
    try {
      const obj = Object.fromEntries(this.priorities);
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
      logger.debug('[PriorityService] Saved priorities to storage');
    } catch (error) {
      logger.error('[PriorityService] Error saving priorities to storage:', error);
    }
  }

  /**
   * Set priority for a contact
   */
  setPriority(contactId: string | number, priority: Priority): void {
    const key = String(contactId);
    this.priorities.set(key, priority);
    this.saveToStorage();
    
    // Dispatch custom event for UI updates
    window.dispatchEvent(new CustomEvent('priority-changed', {
      detail: { contactId: key, priority }
    }));
    
    logger.info(`[PriorityService] Set priority for contact ${key}:`, priority);
  }

  /**
   * Get priority for a contact
   */
  getPriority(contactId: string | number): Priority {
    const key = String(contactId);
    return this.priorities.get(key) || 'medium';
  }

  /**
   * Remove priority for a contact
   */
  removePriority(contactId: string | number): void {
    const key = String(contactId);
    this.priorities.delete(key);
    this.saveToStorage();
    logger.info(`[PriorityService] Removed priority for contact ${key}`);
  }

  /**
   * Get all priorities
   */
  getAllPriorities(): Record<string, Priority> {
    return Object.fromEntries(this.priorities);
  }

  /**
   * Get priority statistics
   */
  getPriorityStats(): PriorityStats {
    const stats = { high: 0, medium: 0, low: 0, total: 0 };
    
    for (const priority of this.priorities.values()) {
      stats[priority]++;
      stats.total++;
    }
    
    return stats;
  }

  /**
   * Get priority color
   */
  getPriorityColor(priority: Priority): string {
    switch (priority) {
      case 'high':
        return '#EF4444'; // Red
      case 'medium':
        return '#F97316'; // Orange
      case 'low':
        return '#22C55E'; // Green
      default:
        return '#6B7280'; // Gray
    }
  }

  /**
   * Get priority background color
   */
  getPriorityBgColor(priority: Priority): string {
    switch (priority) {
      case 'high':
        return 'bg-red-500';
      case 'medium':
        return 'bg-orange-500';
      case 'low':
        return 'bg-green-500';
      default:
        return 'bg-gray-400';
    }
  }

  /**
   * Get priority text color
   */
  getPriorityTextColor(priority: Priority): string {
    return 'text-white';
  }

  /**
   * Get priority label
   */
  getPriorityLabel(priority: Priority): string {
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  }

  /**
   * Cycle to next priority
   */
  getNextPriority(currentPriority: Priority): Priority {
    switch (currentPriority) {
      case 'low':
        return 'medium';
      case 'medium':
        return 'high';
      case 'high':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Clear all priorities
   */
  clearAll(): void {
    this.priorities.clear();
    this.saveToStorage();
    logger.info('[PriorityService] Cleared all priorities');
  }

  /**
   * Import priorities from object
   */
  importPriorities(priorities: Record<string, Priority>): void {
    this.priorities = new Map(Object.entries(priorities));
    this.saveToStorage();
    logger.info('[PriorityService] Imported priorities:', Object.keys(priorities).length);
  }
}

// Export singleton instance
export const priorityService = new PriorityService();
export default priorityService; 