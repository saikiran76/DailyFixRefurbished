import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '@/hooks/useReduxActions';
import { useLogger } from '@/hooks/useLogger';
import { setCurrentStep, setIsComplete } from '@/store/slices/onboardingSlice';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarTrigger,
  SidebarInset,
  useSidebar
} from '@/components/ui/sidebar';
import MainLayout from '@/components/layout/MainLayout';
import { toast } from 'react-hot-toast';
import CentralLoader from '@/components/ui/CentralLoader';
import TutorialCarousel from '@/components/ui/TutorialCarousel';

// Icons
import { 
  LayoutDashboard, 
  MessageSquare, 
  Settings, 
  Users, 
  BarChart, 
  HelpCircle,
  User,
  Bell,
  LogOut
} from 'lucide-react';

// Define TypeScript interfaces for auth state
interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthSession {
  user: User;
  token?: string;
}

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
}

/**
 * Dashboard component with controlled sidebar
 */
const Dashboard = () => {
  const logger = useLogger();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { session } = useAppSelector((state) => state.auth as AuthState);
  const { isComplete, currentStep } = useAppSelector((state) => state.onboarding);
  
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const initAttemptCountRef = useRef(0);
  
  // Tutorial state
  const [showTutorial, setShowTutorial] = useState(false);
  
  // Add a timeout to handle potential infinite loading
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isInitialized) {
        logger.warn('[Dashboard] Dashboard initialization timed out, forcing initialization');
        setIsInitialized(true);
      }
    }, 2000);
    
    return () => clearTimeout(timeout);
  }, [isInitialized, logger]);
  
  // Check if user should see tutorial
  useEffect(() => {
    if (isInitialized && session) {
      // Check localStorage to see if user has completed tutorial
      const tutorialCompleted = localStorage.getItem('dailyfix_tutorial_completed');
      
      if (!tutorialCompleted) {
        logger.info('[Dashboard] First-time user detected, showing tutorial');
        setShowTutorial(true);
      } else {
        logger.info('[Dashboard] Returning user, tutorial already completed');
      }
    }
  }, [isInitialized, session, logger]);
  
  // Navigation items
  const mainNavItems = [
    { 
      title: 'Dashboard', 
      icon: LayoutDashboard, 
      url: '/dashboard',
      isActive: true 
    },
    { 
      title: 'Messages', 
      icon: MessageSquare, 
      url: '/messages',
      badge: '3'
    },
    { 
      title: 'Analytics', 
      icon: BarChart, 
      url: '/analytics'
    },
    { 
      title: 'Team', 
      icon: Users, 
      url: '/team'
    },
  ];
  
  const secondaryNavItems = [
    { 
      title: 'Settings', 
      icon: Settings, 
      url: '/settings'
    },
    { 
      title: 'Help & Support', 
      icon: HelpCircle, 
      url: '/help'
    }
  ];
  
  useEffect(() => {
    initAttemptCountRef.current += 1;
    logger.info('[Dashboard] Initialization attempt:', initAttemptCountRef.current);
    
    try {
      // Verify session on mount
      if (!session) {
        logger.warn('[Dashboard] No session found, redirecting to login');
        window.location.href = '/login';
        return;
      } 
      
      // CRITICAL FIX: Don't force onboarding to complete, which disrupts WhatsApp setup
      /* Commenting out this block to prevent premature onboarding completion
      if (initAttemptCountRef.current >= 3) {
        logger.warn('[Dashboard] Multiple initialization attempts, forcing onboarding complete state');
        dispatch(setCurrentStep('complete'));
        dispatch(setIsComplete(true));
        // toast.success('Dashboard initialized successfully');
        setIsInitialized(true);
        return;
      }
      */
      // Instead, just log the multiple attempts but don't interfere with onboarding
      if (initAttemptCountRef.current >= 3) {
        logger.warn('[Dashboard] Multiple initialization attempts detected, but allowing onboarding to continue naturally');
      }
      
      // Check if onboarding is complete
      if (!isComplete && currentStep !== 'complete') {
        logger.warn('[Dashboard] Onboarding not complete, redirecting to onboarding');
        window.location.href = '/onboarding';
        return;
      }
      
      logger.info('[Dashboard] Dashboard mounted with valid session and completed onboarding');
      setIsInitialized(true);
    } catch (error) {
      logger.error('[Dashboard] Error during initialization:', error);
      // Force initialization to prevent infinite loading
      setIsInitialized(true);
    }
  }, [session, navigate, logger, isComplete, currentStep, dispatch]);

  // Handle tutorial completion
  const handleTutorialComplete = () => {
    logger.info('[Dashboard] Tutorial completed');
    setShowTutorial(false);
    toast.success('Welcome to DailyFix!', {
      duration: 3000,
    });
  };
  
  // Handle tutorial skip
  const handleTutorialSkip = () => {
    logger.info('[Dashboard] Tutorial skipped');
    setShowTutorial(false);
  };

  // If not initialized yet, show loading
  if (!isInitialized) {
    return (
      <CentralLoader
        message="Loading your dashboard"
        subMessage="Preparing your personalized workspace"
      />
    );
  }

  // Handle navigation
  const handleNavigation = (url: string) => {
    navigate(url);
  };

  // Handle logout
  const handleLogout = () => {
    logger.info('[Dashboard] User initiated logout');
    window.location.href = '/login';
  };

  // Handle sidebar toggle
  const handleSidebarToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className='w-full h-full'>
      <MainLayout />
      
      {/* Tutorial overlay for first-time users */}
      {showTutorial && (
        <TutorialCarousel 
          onComplete={handleTutorialComplete}
          onSkip={handleTutorialSkip}
        />
      )}
    </div>
  );
};

export default Dashboard; 