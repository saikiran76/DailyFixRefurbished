import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  setCurrentStep,
  setIsComplete,
  ONBOARDING_STEPS
} from '@/store/slices/onboardingSlice';
import { useLogger } from '@/hooks/useLogger';
// import { toast } from 'react-hot-toast';
import { FiArrowRight, FiCheck, FiLock, FiShield } from 'react-icons/fi';
import { FaRocket, FaRobot, FaChartBar, FaUserShield } from 'react-icons/fa';
import onb1 from '@/images/onb1.gif';
import onb2 from '@/images/onb2.gif';
import onb3 from '@/images/onb3.gif';
import DFLogo from '@/images/DF.png';

// Import shadcn UI components
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, X } from "lucide-react";

const bgImage = "https://searchengineland.com/wp-content/seloads/2023/12/The-top-5-social-media-platforms-you-should-focus-on.png";
const leftColumnBgImage = "https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?fm=jpg&q=60&w=3000&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Z3JhZGllbnQlMjBiYWNrZ3JvdW5kfGVufDB8fDB8fHww";

// Define types
interface RootState {
  auth: {
    session: any;
  };
  onboarding: {
    currentStep: string;
    isComplete: boolean;
  };
}

interface StepProps {
  title: string;
  description: string;
  icon: JSX.Element;
  image?: string;
  isTerms?: boolean;
}

/**
 * Completely redesigned onboarding flow with a simplified 3-step timeline tutorial
 * instead of the complex protocol_selection/matrix/whatsapp flow.
 */
const NewOnboarding = () => {
  const logger = useLogger();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { session } = useSelector((state: RootState) => state.auth);
  const { currentStep, isComplete } = useSelector((state: RootState) => state.onboarding);

  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initializationComplete, setInitializationComplete] = useState(false);
  const initializedRef = useRef(false);
  const initializationAttemptsRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Alert state
  const [alert, setAlert] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
    visible: boolean;
  }>({ type: null, message: '', visible: false });

  // Log the initial state on component mount
  useEffect(() => {
    logger.info('[NewOnboarding] Component mounted with session:', !!session);
    logger.info('[NewOnboarding] Initial onboarding state:', { currentStep, isComplete });
    
    // Log if we've been redirected from auth callback
    if (document.referrer.includes('/auth/callback')) {
      logger.info('[NewOnboarding] Redirected from auth callback');
    }
    
    return () => {
      logger.info('[NewOnboarding] Component unmounting after', Date.now() - mountTimeRef.current, 'ms');
    };
  }, [session, currentStep, isComplete, logger]);

  // CRITICAL FIX: Enhanced mechanism to escape the loading state
  useEffect(() => {
    // Clear any existing timeout to prevent duplicates
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    // Set a short timeout (2 seconds) to check if we're still initializing
    loadingTimeoutRef.current = setTimeout(() => {
      if (!initializationComplete) {
        const elapsedTime = Date.now() - mountTimeRef.current;
        logger.warn(`[NewOnboarding] Initial timeout check after ${elapsedTime}ms. Still initializing.`);
        
        // Set up a final escape hatch with a longer timeout
        setTimeout(() => {
          if (!initializationComplete) {
            const totalElapsedTime = Date.now() - mountTimeRef.current;
            logger.warn(`[NewOnboarding] Force initialization after extended timeout (${totalElapsedTime}ms)`);
            
            // If we have a session but initialization is stuck, force it to complete
            if (session) {
              // Ensure onboarding state is initialized
              logger.info('[NewOnboarding] Forcing onboarding state to welcome');
              dispatch(setCurrentStep('welcome'));
              dispatch(setIsComplete(false));
              
              // Also update localStorage directly for persistence
              try {
                const onboardingData = localStorage.getItem('persist:onboarding');
                if (onboardingData) {
                  const parsedData = JSON.parse(onboardingData);
                  parsedData.currentStep = JSON.stringify('welcome');
                  parsedData.isComplete = JSON.stringify(false);
                  localStorage.setItem('persist:onboarding', JSON.stringify(parsedData));
                }
              } catch (storageError) {
                logger.error('[NewOnboarding] Error updating localStorage:', storageError);
              }
              
              setInitializationComplete(true);
            } else {
              // No session available, redirect to login
              logger.warn('[NewOnboarding] No session in force initialization, redirecting to login');
              window.location.href = '/login';
            }
          }
        }, 1500); // Additional 1.5 seconds after the initial check
      }
    }, 2000);
    
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [initializationComplete, session, dispatch, logger]);

  useEffect(() => {
    // Prevent multiple initialization calls
    if (initializedRef.current) {
      return;
    }

    const initializeOnboarding = async () => {
      try {
        initializedRef.current = true;
        initializationAttemptsRef.current += 1;
        logger.info('[NewOnboarding] Initializing with step:', currentStep, 'Attempt:', initializationAttemptsRef.current);
      
        // If user is not logged in, redirect to login
        if (!session) {
          logger.warn('[NewOnboarding] No session found, redirecting to login');
          // Use window.location for more reliable redirect
          window.location.href = '/login';
          return;
        }
      
        // Ensure we're in the right onboarding state
        if (currentStep === ONBOARDING_STEPS.COMPLETE && isComplete) {
          logger.info('[NewOnboarding] Onboarding already complete, redirecting to dashboard');
          // Use window.location for more reliable redirect
          window.location.href = '/dashboard';
      return;
    }

        // CRITICAL FIX: Always mark initialization as complete if we have a session
        // This ensures the component doesn't get stuck in loading
        setInitializationComplete(true);
        logger.info('[NewOnboarding] Initialization complete, ready to render onboarding flow');
        
        // Force the onboarding state to welcome/not complete if not already set (non-blocking)
        if (currentStep !== 'welcome' && !isComplete) {
          logger.info('[NewOnboarding] Setting initial onboarding state to welcome');
          dispatch(setCurrentStep('welcome'));
          
          // Also update localStorage directly for persistence
          try {
            const onboardingData = localStorage.getItem('persist:onboarding');
            if (onboardingData) {
              const parsedData = JSON.parse(onboardingData);
              parsedData.currentStep = JSON.stringify('welcome');
              parsedData.isComplete = JSON.stringify(false);
              localStorage.setItem('persist:onboarding', JSON.stringify(parsedData));
            }
          } catch (storageError) {
            logger.error('[NewOnboarding] Error updating localStorage:', storageError);
          }
        }
      } catch (error) {
        logger.error('[NewOnboarding] Error during initialization:', error);
        // CRITICAL FIX: Still mark as complete to escape loading state even on error
        setInitializationComplete(true);
      }
    };
    
    // CRITICAL FIX: Add a small timeout to ensure store is fully ready
    setTimeout(() => {
      initializeOnboarding();
    }, 100);
  }, [session, currentStep, isComplete, navigate, dispatch, logger]);

  // CRITICAL FIX: Directly check loading state duration and force render after timeout
  useEffect(() => {
    const directTimeout = setTimeout(() => {
      // If still not initialized after 3 seconds, force initialize
      if (!initializationComplete && session) {
        logger.warn('[NewOnboarding] Force rendering onboarding UI after timeout');
        
        // Force render even if other conditions are not met
        setInitializationComplete(true);
      }
    }, 3000);
    
    return () => clearTimeout(directTimeout);
  }, [initializationComplete, session, logger]);

  // State for terms and conditions checkboxes
  const [termsAccepted, setTermsAccepted] = useState({
    security: false,
    privacy: false
  });

  // Tutorial steps content
  const steps: StepProps[] = [
    {
      title: "Welcome to DailyFix",
      description: "Connect to multiple platforms in one place. Your messages are end-to-end encrypted, ensuring security across all connected platforms.",
      icon: <FaRocket className="text-4xl text-primary" />,
      image: onb1
    },
    {
      title: "AI-Powered Assistance",
      description: "Meet DailyUniAI, your personalized AI assistant that helps you quickly understand and manage your messages across platforms.",
      icon: <FaRobot className="text-4xl text-blue-500" />,
      image: onb2
    },
    {
      title: "Powerful Analytics",
      description: "Get insights about your messaging patterns and communication habits with our analytics dashboard.",
      icon: <FaChartBar className="text-4xl text-green-500" />,
      image: onb3
    },
    {
      title: "Your Privacy & Security",
      description: "Please review and accept our terms regarding your data security and privacy.",
      icon: <FaUserShield className="text-4xl text-primary" />,
      isTerms: true
    }
  ];

  // Handle next step
  const handleNext = () => {
    // If we're on the terms step, check if both terms are accepted
    if (activeStep === steps.length - 2 && steps[activeStep + 1].isTerms) {
      setActiveStep(activeStep + 1);
    } else if (activeStep === steps.length - 1 && steps[activeStep].isTerms) {
      // Check if both terms are accepted before completing
      if (termsAccepted.security && termsAccepted.privacy) {
        handleComplete();
      } else {
        // toast.error('Please accept both terms to continue');
        setAlert({
          type: 'error',
          message: 'Please accept both terms to continue',
          visible: true
        });
        // Auto-hide after 4 seconds
        setTimeout(() => setAlert(prev => ({ ...prev, visible: false })), 4000);
      }
    } else if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    } else {
      handleComplete();
    }
  };

  // Handle previous step
  const handlePrevious = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  // Handle completion of tutorial
  const handleComplete = async () => {
    setLoading(true);
    try {
      logger.info('[NewOnboarding] Completing onboarding tutorial');

      // CRITICAL FIX: Directly update Redux state without API call
      dispatch(setCurrentStep(ONBOARDING_STEPS.COMPLETE)); // Use constant for consistency
      dispatch(setIsComplete(true));

      // Also update localStorage for persistence
      try {
        const onboardingData = localStorage.getItem('persist:onboarding');
        if (onboardingData) {
          const parsedData = JSON.parse(onboardingData);
          parsedData.currentStep = JSON.stringify(ONBOARDING_STEPS.COMPLETE);
          parsedData.isComplete = JSON.stringify(true);
          localStorage.setItem('persist:onboarding', JSON.stringify(parsedData));
        } else {
          // Create the persist:onboarding item if it doesn't exist
          const newData = {
            currentStep: JSON.stringify(ONBOARDING_STEPS.COMPLETE),
            isComplete: JSON.stringify(true),
          };
          localStorage.setItem('persist:onboarding', JSON.stringify(newData));
        }
        
        logger.info('[NewOnboarding] Local storage updated successfully');
      } catch (storageError) {
        logger.error('[NewOnboarding] Error updating localStorage:', storageError);
      }

      logger.info('[NewOnboarding] Onboarding completed successfully');
      // toast.success('Onboarding completed successfully!');
      setAlert({
        type: 'success',
        message: 'Onboarding completed successfully!',
        visible: true
      });
      
      // CRITICAL FIX: Use direct window.location.href for more reliable navigation
      logger.info('[NewOnboarding] Navigating to dashboard via window.location');
      
      // Short delay before navigation to ensure state changes are processed
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } catch (error) {
      logger.error('[NewOnboarding] Error completing onboarding:', error);
      // toast.error('Failed to complete onboarding. Please try again.');
      setAlert({
        type: 'error',
        message: 'Failed to complete onboarding. Please try again.',
        visible: true
      });
      
      // Even with an error, try to navigate to dashboard after a delay
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 2500);
    } finally {
      setLoading(false);
    }
  };

  // If not fully initialized yet, show loading state
  if (!initializationComplete) {
  return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-xl font-medium">Loading onboarding...</p>
            <p className="text-sm text-muted-foreground mt-2">Please wait while we set up your experience</p>
            
            {/* CRITICAL FIX: Show continue button immediately to give users a way out */}
            <button 
              onClick={() => {
                logger.info('[NewOnboarding] Manual continue button clicked');
                setInitializationComplete(true);
                // Also try to ensure onboarding state is correct
                dispatch(setCurrentStep('welcome'));
                dispatch(setIsComplete(false));
              }}
              className="mt-6 py-2 px-4 bg-primary text-white font-medium rounded-md hover:bg-primary-hover transition-colors"
            >
              Continue Manually
            </button>
          </div>
        </div>
                  </div>
    );
  }

  // Progress indicator for steps (only used in the right column)
  const ProgressIndicator = () => (
    <div className="flex space-x-2 mb-8">
      {steps.filter(step => !step.isTerms).map((_, index) => (
                    <div
          key={index}
          className={`w-2 h-2 rounded-full transition-all cursor-pointer hover:scale-125 ${
            index <= (activeStep < steps.length - 1 ? activeStep : activeStep - 1)
              ? 'bg-white'
              : 'bg-gray-600'
                      }`}
          onClick={() => {
            // Only navigate to non-terms steps directly
            if (!steps[index].isTerms) {
              setActiveStep(index);
              logger.info(`[NewOnboarding] Navigated to step ${index + 1} via indicator dot`);
            }
          }}
          title={`Go to step ${index + 1}`}
        />
              ))}
            </div>
  );

  // Render specific step content based on active step
  const renderStepContent = () => {
    const currentStep = steps[activeStep];
    
    if (currentStep.isTerms) {
      return (
        <div className="space-y-6 w-full">
                          {/* Security Terms Card */}
          <Card className="hover:shadow-md transition-all duration-300 border border-zinc-700 bg-zinc-900">
                            <CardContent className="p-4 flex items-start space-x-3">
                              <div className="flex-shrink-0 mt-0.5">
                                <Checkbox 
                                  id="security-term"
                                  checked={termsAccepted.security}
                                  onCheckedChange={(checked) => 
                                    setTermsAccepted({...termsAccepted, security: checked as boolean})
                                  }
    
                                />
                              </div>
                              <div className="text-left">
                <label htmlFor="security-term" className="font-medium text-white flex items-center cursor-pointer">
                                  <FiLock className="mr-2 text-primary" /> Secure Messaging
                                </label>
                <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                                  I understand that my connected accounts are secure with DailyFix, and all messages are end-to-end encrypted.
                                </p>
                              </div>
                            </CardContent>
                          </Card>

                          {/* Privacy Terms Card */}
          <Card className="hover:shadow-md transition-all duration-300 border border-zinc-700 bg-zinc-900">
                            <CardContent className="p-4 flex items-start space-x-3">
                              <div className="flex-shrink-0 mt-0.5">
                                <Checkbox 
                                  id="privacy-term"
                                  checked={termsAccepted.privacy}
                                  onCheckedChange={(checked) => 
                                    setTermsAccepted({...termsAccepted, privacy: checked as boolean})
                                  }
                                  className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                                />
                              </div>
                              <div className="text-left">
                <label htmlFor="privacy-term" className="font-medium text-white flex items-center cursor-pointer">
                                  <FiShield className="mr-2 text-primary" /> AI Privacy
                                </label>
                <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                                  I understand that DailyFix AI that interacts with my conversations is completely secure, abides by the rules of privacy, and doesn&apos;t leak any kind of data.
                                </p>
                              </div>
                            </CardContent>
                          </Card>

          <Separator className="my-4 bg-zinc-700" />

          <div className="bg-zinc-800/50 p-4 rounded-lg">
            <p className="text-sm text-gray-300 leading-relaxed">
                                At DailyFix, we prioritize your privacy and security above all else. Your data remains yours, and our AI systems are designed with privacy-first principles.
                              </p>
          </div>

                          <div className="flex justify-center">
                            {termsAccepted.security && termsAccepted.privacy ? (
                              <div className="text-green-500 text-sm font-medium flex items-center">
                                <FiCheck className="mr-1" /> Ready to continue
                              </div>
                            ) : (
              <div className="text-gray-400 text-sm font-medium">
                                Please accept both terms to continue
                              </div>
                            )}
                          </div>
        </div>
      );
    }
    
    return (
      <div className="space-y-6 w-full">
        <h2 className="text-3xl font-bold mb-3">{currentStep.title}</h2>
        <p className="text-gray-400 text-lg mb-8 leading-relaxed">{currentStep.description}</p>
      </div>
    );
  };

  // New layout with two columns
  return (
    <div className="min-h-screen flex flex-row bg-black text-white w-full">
      {/* Left column - Logo, Steps & Images - Hidden on mobile */}
      <div 
        className="hidden md:flex md:w-2/5 lg:w-1/2 flex-col justify-between p-6 lg:p-12 border-r border-gray-800 relative" 
      >
        {/* Background image with opacity */}
        <div 
          className="absolute inset-0 opacity-30 z-0" 
          style={{
            backgroundImage: `url(${leftColumnBgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        ></div>
        
        {/* Logo at top-left */}
        <div className="relative z-10 mb-6 lg:mb-12">
          <img src={DFLogo} alt="DailyFix Logo" className="h-8 lg:h-12" />
        </div>
        
        {/* Step image in the center */}
        <div className="flex-1 flex items-center justify-center relative z-10">
          {!steps[activeStep].isTerms ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              key={`image-${activeStep}`}
              transition={{ duration: 0.5 }}
              className="w-[90%] lg:w-[80%] h-auto"
            >
                        <img
                          src={steps[activeStep].image}
                          alt={steps[activeStep].title}
                className="w-full h-auto object-contain rounded-lg shadow-xl"
                        />
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              key="terms-image"
              transition={{ duration: 0.5 }}
              className="flex items-center justify-center w-full"
            >
              <div className="rounded-full bg-zinc-800 p-6 lg:p-12">
                <FaUserShield className="text-6xl lg:text-9xl text-primary" />
                      </div>
            </motion.div>
                    )}
                  </div>
        
        {/* Step numbers at the bottom */}
        <div className="flex justify-center mt-4 lg:mt-8 space-x-4 lg:space-x-8 relative z-10">
          {steps.filter(step => !step.isTerms).map((_, index) => (
            <div 
              key={index} 
              className={`w-8 h-8 lg:w-12 lg:h-12 rounded-full flex items-center justify-center border-2 transition-all
                ${index <= (activeStep < steps.length - 1 ? activeStep : activeStep - 1)
                  ? 'border-primary text-primary font-bold'
                  : 'border-gray-600 text-gray-500'
                }`}
            >
              {index + 1}
            </div>
          ))}
        </div>
      </div>
      
      {/* Right column - Content & Navigation - Full width on mobile */}
      <div className="w-full md:w-3/5 lg:w-1/2 flex flex-col justify-center p-6 md:p-8 lg:p-12 relative">
        {/* Logo on mobile only */}
        <div className="md:hidden flex justify-center mb-8">
          <img src={DFLogo} alt="DailyFix Logo" className="h-10" />
        </div>
        
        {/* Background image with opacity */}
        <div 
          className="absolute inset-0 opacity-25 z-0" 
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        ></div>
        
        <div className="relative z-10 w-full">
          {/* Alert component */}
          <AnimatePresence>
            {alert.visible && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="mb-4"
              >
                <Alert 
                  variant={alert.type === 'error' ? "destructive" : "default"}
                  className={alert.type === 'success' 
                    ? "bg-green-900/20 border border-green-600 text-green-500" 
                    : undefined}
                >
                  {alert.type === 'success' && (
                    <CheckCircle className="h-5 w-5" />
                  )}
                  {alert.type === 'error' && (
                    <AlertCircle className="h-5 w-5" />
                  )}
                  <AlertDescription className="ml-3 flex-1">
                    {alert.message}
                  </AlertDescription>
                  <button 
                    onClick={() => setAlert(prev => ({ ...prev, visible: false }))}
                    className="ml-auto p-1 rounded-full hover:bg-black/20"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Progress Indicator dots */}
          <ProgressIndicator />
          
          {/* Step Content */}
          <div className="min-h-[250px] md:min-h-[300px] w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={`step-${activeStep}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="w-full"
              >
                {renderStepContent()}
                </motion.div>
              </AnimatePresence>
            </div>

          {/* Mobile-only images (only shown when left column is hidden) */}
          <div className="md:hidden mb-8 mt-4">
            {!steps[activeStep].isTerms ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                key={`mobile-image-${activeStep}`}
                transition={{ duration: 0.5 }}
                className="w-full max-w-[250px] mx-auto"
              >
                <img 
                  src={steps[activeStep].image} 
                  alt={steps[activeStep].title} 
                  className="w-full h-auto object-contain rounded-lg shadow-lg"
                />
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                key="mobile-terms-image"
                transition={{ duration: 0.5 }}
                className="flex items-center justify-center"
              >
                <div className="rounded-full bg-zinc-800 p-6 mx-auto">
                  <FaUserShield className="text-6xl text-primary" />
                </div>
              </motion.div>
            )}
          </div>
          
          {/* Mobile step numbers */}
          <div className="md:hidden flex justify-center mt-2 mb-6 space-x-4 relative z-10">
            {steps.filter(step => !step.isTerms).map((_, index) => (
              <div 
                key={index} 
                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all cursor-pointer
                  ${index <= (activeStep < steps.length - 1 ? activeStep : activeStep - 1)
                    ? 'border-primary text-primary font-bold'
                    : 'border-gray-600 text-gray-500'
                  }`}
                onClick={() => {
                  if (!steps[index].isTerms) {
                    setActiveStep(index);
                    logger.info(`[NewOnboarding] Navigated to step ${index + 1} via mobile step number`);
                  }
                }}
              >
                {index + 1}
              </div>
            ))}
          </div>
          
          {/* Navigation Buttons */}
          <div className="flex justify-between mt-6 lg:mt-12">
              <Button
                onClick={handlePrevious}
                disabled={activeStep === 0}
                variant={activeStep === 0 ? "ghost" : "outline"}
              className={`border-white text-white ${activeStep === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10'}`}
              >
                Previous
              </Button>

              <Button
                onClick={handleNext}
                disabled={loading || (steps[activeStep].isTerms && (!termsAccepted.security || !termsAccepted.privacy))}
                variant="default"
              className={`bg-white text-black hover:bg-gray-200 ${loading || (steps[activeStep].isTerms && (!termsAccepted.security || !termsAccepted.privacy))
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                }`}
              >
                {activeStep === steps.length - 1 ? (
                  loading ? 'Completing...' : (steps[activeStep].isTerms ? 'I Accept & Continue' : 'Get Started')
                ) : (
                  <>
                    Next
                    <FiArrowRight className="ml-2" />
                  </>
                )}
              </Button>
            </div>
        </div>

      {/* Footer */}
        <div className="mt-auto text-center relative z-10 text-xs md:text-sm pt-4">
          <p className="text-gray-400">© {new Date().getFullYear()} DailyFix. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default NewOnboarding; 