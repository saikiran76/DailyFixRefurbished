import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { LabelList, RadialBar, RadialBarChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { priorityService, type PriorityStats } from '@/services/priorityService';

// FIXED: Add caching for priority stats - Part of issue D fix
const PRIORITY_CACHE_KEY = 'priority_stats_cache';
const PRIORITY_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache

interface CachedPriorityStats {
  stats: PriorityStats;
  timestamp: number;
}

const getCachedPriorityStats = (): PriorityStats | null => {
  try {
    const cached = localStorage.getItem(PRIORITY_CACHE_KEY);
    if (!cached) return null;
    
    const parsedCache: CachedPriorityStats = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is still valid
    if ((now - parsedCache.timestamp) < PRIORITY_CACHE_DURATION) {
      return parsedCache.stats;
    }
    
    // Cache expired, remove it
    localStorage.removeItem(PRIORITY_CACHE_KEY);
    return null;
  } catch (error) {
    console.error('Error reading priority stats cache:', error);
    localStorage.removeItem(PRIORITY_CACHE_KEY);
    return null;
  }
};

const setCachedPriorityStats = (stats: PriorityStats): void => {
  try {
    const cacheData: CachedPriorityStats = {
      stats,
      timestamp: Date.now()
    };
    localStorage.setItem(PRIORITY_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error caching priority stats:', error);
  }
};

const chartConfig = {
  contacts: {
    label: "Contacts",
  },
  high: {
    label: "High Priority",
    color: "#EF4444", // Red
  },
  medium: {
    label: "Medium Priority", 
    color: "#F97316", // Orange
  },
  low: {
    label: "Low Priority",
    color: "#22C55E", // Green
  },
} satisfies ChartConfig;

const PriorityStatsCard: React.FC = () => {
  const [stats, setStats] = useState<PriorityStats>({ high: 0, medium: 0, low: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // FIXED: Load priority stats with caching
  useEffect(() => {
    const loadStats = () => {
      try {
        // Check cache first
        const cachedStats = getCachedPriorityStats();
        if (cachedStats) {
          setStats(cachedStats);
          setIsLoading(false);
          return;
        }
        
        // If no cache, load from service
        const priorityStats = priorityService.getPriorityStats();
        setStats(priorityStats);
        setIsLoading(false);
        
        // Cache the result
        setCachedPriorityStats(priorityStats);
      } catch (error) {
        console.error('Error loading priority stats:', error);
        setIsLoading(false);
      }
    };

    loadStats();

    // Listen for priority changes to update stats and invalidate cache
    const handlePriorityChange = () => {
      // Clear cache when priorities change
      localStorage.removeItem(PRIORITY_CACHE_KEY);
      loadStats();
    };

    window.addEventListener('priority-changed', handlePriorityChange);
    return () => {
      window.removeEventListener('priority-changed', handlePriorityChange);
    };
  }, []);

  // Prepare chart data using the same structure as your radialChart.tsx
  const chartData = [
    { priority: "high", contacts: stats.high, fill: chartConfig.high.color },
    { priority: "medium", contacts: stats.medium, fill: chartConfig.medium.color },
    { priority: "low", contacts: stats.low, fill: chartConfig.low.color },
  ].filter(item => item.contacts > 0); // Only show priorities that have contacts

  const getHighestPriority = () => {
    if (stats.high > stats.medium && stats.high > stats.low) return 'high';
    if (stats.medium > stats.low) return 'medium';
    return 'low';
  };

  const getTrendingInfo = () => {
    const highest = getHighestPriority();
    const percentage = stats.total > 0 ? Math.round((stats[highest] / stats.total) * 100) : 0;
    
    const labels = {
      high: 'High priority contacts need attention',
      medium: 'Moderate priority distribution',
      low: 'Most contacts are low priority'
    };

    const icons = {
      high: <AlertTriangle className="h-4 w-4 text-red-500" />,
      medium: <Clock className="h-4 w-4 text-orange-500" />,
      low: <CheckCircle className="h-4 w-4 text-green-500" />
    };

    return {
      label: labels[highest],
      percentage,
      icon: icons[highest]
    };
  };

  if (isLoading) {
    return (
      <Card className="flex flex-col">
        <CardHeader className="items-center pb-0">
          <CardTitle>Contact Priorities</CardTitle>
          <CardDescription>Loading priority distribution...</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-0">
          <div className="animate-pulse">
            <div className="mx-auto aspect-square max-h-[250px] bg-muted rounded-full"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stats.total === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader className="items-center pb-0">
          <CardTitle>Contact Priorities</CardTitle>
          <CardDescription>No contacts with priorities set</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-0 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Start setting priorities for your contacts</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const trendInfo = getTrendingInfo();

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>Contact Priorities</CardTitle>
        {/* <CardDescription>Priority distribution across {stats.total} contacts</CardDescription> */}
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <RadialBarChart
            data={chartData}
            startAngle={-90}
            endAngle={380}
            innerRadius={30}
            outerRadius={110}
          >
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel nameKey="priority" />}
            />
            <RadialBar dataKey="contacts" background>
              <LabelList
                position="insideStart"
                dataKey="contacts"
                className="fill-white capitalize mix-blend-luminosity"
                fontSize={11}
              />
            </RadialBar>
          </RadialBarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 leading-none font-medium">
          {trendInfo.icon}
          {trendInfo.label}
        </div>
        <div className="text-muted-foreground leading-none text-center">
          <div className="grid grid-cols-3 gap-4 mt-2">
            <div className="text-center">
              <div className="text-lg font-semibold text-red-500">{stats.high}</div>
              <div className="text-xs">High</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-orange-500">{stats.medium}</div>
              <div className="text-xs">Medium</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-green-500">{stats.low}</div>
              <div className="text-xs">Low</div>
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
};

export default PriorityStatsCard; 