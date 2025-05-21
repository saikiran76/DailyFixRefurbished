import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-hot-toast';
import { FcGoogle } from 'react-icons/fc';
import { Eye, EyeOff } from "lucide-react";
import { useLogger } from '@/hooks/useLogger';
import { signUp, signInWithGoogle, resetPassword } from '@/store/slices/authSlice';
import { getSupabaseClient } from '@/utils/supabase';
import LavaLamp from '@/components/ui/Loader/LavaLamp';
import type { AppDispatch } from '@/store/store';

// Shadcn UI components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, X } from "lucide-react";

// Background image
const bgImage = "https://images.rawpixel.com/image_800/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvdjEwNzItMDM3LWMta3ZoaDA4bXAuanBn.jpg";

// Define RootState type
interface RootState {
  auth: {
    googleAuthPending: boolean;
  };
}

// Helper for getting URL with correct origin
const getURL = () => {
  let url =
    import.meta.env.VITE_SITE_URL ??
    import.meta.env.VITE_VERCEL_URL ??
    'http://localhost:5173/';
  
  // Make sure to include `https://` when not localhost
  url = url.includes('http') ? url : `https://${url}`;
  
  // Make sure to include trailing `/`
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`;
  
  return url;
};

// Type the dispatch
const useAppDispatch = () => useDispatch<AppDispatch>();

const Signup = () => {
  const logger = useLogger();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { googleAuthPending } = useSelector((state: RootState) => state.auth);

  const validateForm = () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleGoogleSignIn = async () => {
    try {
      setError('');
      await dispatch(signInWithGoogle());
      // The page will be redirected by the Google OAuth flow
    } catch (error: any) {
      logger.error('[Signup] Google sign-in error:', error);
      setError(error.message || 'Failed to sign in with Google');
      toast.error(error.message || 'Failed to sign in with Google');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerificationRequired(false);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      logger.info('[Signup] Attempting signup with email:', email);

      // Sign up with Supabase
      if (!getSupabaseClient()) {
        throw new Error('Supabase client not initialized');
      }
      
      const { data, error: signUpError } = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getURL()}login`
        }
      });

      logger.info('[Signup] Supabase response:', {
        hasData: !!data,
        hasUser: !!data?.user,
        hasSession: !!data?.session,
        error: signUpError
      });

      if (signUpError) throw signUpError;

      // Check if email confirmation is required
      if (data?.user?.identities?.length === 0) {
        logger.info('[Signup] Email confirmation required');
        toast.success('Email verification required! Please check your inbox.');
        setVerificationRequired(true);
        setTimeout(() => {
          navigate('/login');
        }, 5500);
        return;
      }

      if (data?.user && data?.session) {
        logger.info('[Signup] Signup successful, storing session');

        // Store complete session in Redux
        dispatch(signUp({ session: data.session }));

        // Store auth data in localStorage
        const authData = {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at
        };
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));

        logger.info('[Signup] Session stored, navigating to onboarding');
        navigate('/onboarding');
      } else {
        logger.error('[Signup] Missing session data:', {
          user: data?.user,
          session: data?.session,
          identities: data?.user?.identities
        });
        throw new Error('Signup successful but waiting for email confirmation. Please check your email.');
      }
    } catch (error: any) {
      logger.error('[Signup] Error during signup:', error);
      if (error.message.includes('email confirmation')) {
        setVerificationRequired(true);
      } else {
        setError(error.message || 'Signup failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-row bg-black text-white">
      {/* Left column - Brand and testimonial - Hidden on mobile */}
      <div 
        className="hidden md:flex md:w-2/5 lg:w-1/2 flex-col justify-between p-6 lg:p-12 border-r border-gray-800 relative" 
        style={{
          background: 'linear-gradient(to right, #3a6073, #3a7bd5)'
        }}
      >
        {/* Background image with opacity */}
        <div 
          className="absolute inset-0 opacity-40 z-0" 
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        ></div>
        
        <div className="mt-6 lg:mt-12 relative z-10">
          <h1 className="text-2xl lg:text-3xl font-bold">DailyFix</h1>
        </div>
        
        <div className="mb-12 lg:mb-24 relative z-10">
          <blockquote className="text-lg lg:text-xl leading-relaxed">
            "This library has saved me countless hours of work and helped me deliver stunning designs to my clients faster than ever before."
          </blockquote>
          <div className="mt-4">
            <p className="text-gray-400">Sofia Davis</p>
          </div>
        </div>
      </div>
      
      {/* Right column - Authentication - Full width on mobile */}
      <div className="w-full md:w-3/5 lg:w-1/2 flex items-center justify-center p-6 md:p-8">
        {/* Logo on mobile only */}
        <div className="md:hidden flex justify-center w-full mb-8">
          <h1 className="text-2xl font-bold">DailyFix</h1>
        </div>
      
        <div className="w-full max-w-md px-4 sm:px-8">
          <div className="flex justify-end mb-6">
            <Link to="/login" className="text-sm">Login</Link>
          </div>
          
          <div className="mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-semibold mb-2">Create an account</h2>
            <p className="text-gray-400">Enter your email below to create your account</p>
          </div>
          
          {verificationRequired ? (
            <Alert className="mb-6 bg-green-900/20 border border-green-600 text-green-500">
              <div className="flex items-center space-x-3">
                <div>
                  <p className="font-medium">Verification email sent!</p>
                  <p className="text-sm">Please check your email inbox to verify your account.</p>
                  <p className="text-sm">You can directly login after confirmation.</p>
                </div>
              </div>
            </Alert>
          ) : error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-5 w-5" />
              <AlertDescription className="text-sm">
                {error}
              </AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm text-gray-400">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border-gray-700 rounded-md"
                required
              />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm text-gray-400">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  className="w-full bg-gray-900 border-gray-700 rounded-md"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="absolute bg-transparent right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm text-gray-400">
                Confirm Password
              </label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                  className="w-full bg-gray-900 border-gray-700 rounded-md"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="absolute bg-transparent right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            
            <Button
              type="submit"
              disabled={isLoading || googleAuthPending}
              className="w-full h-10 mt-2 bg-white text-black hover:bg-gray-200"
              variant="default"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <LavaLamp className="w-[20px] h-[40px] mr-3" />
                  <span>Signing up...</span>
                </div>
              ) : 'Sign up with Email'}
            </Button>
          </form>
          
          <div className="my-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full border-gray-800" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-black px-2 text-xs text-gray-500 uppercase">OR CONTINUE WITH</span>
              </div>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading || googleAuthPending}
            variant="outline"
            className="w-full h-10 border border-gray-800 text-gray-300 hover:bg-gray-900"
          >
            {googleAuthPending ? (
              <div className="flex items-center justify-center">
                <LavaLamp className="w-[20px] h-[40px] mr-3" />
                <span>Connecting...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <FcGoogle className="h-5 w-5 mr-2" />
                <span>Google</span>
              </div>
            )}
          </Button>
          
          <p className="mt-6 text-center text-sm text-gray-500">
            By clicking continue, you agree to our{" "}
            <Link to="#" className="text-blue-600 hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="#" className="text-blue-600 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          
          <p className="mt-8 text-center text-sm text-gray-400">
            Already have an account?{" "}
            <Link to="/login" className="text-blue-600 hover:underline">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export const ForgotPassword = () => {
  const logger = useLogger();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      if (!getSupabaseClient()) {
        throw new Error('Supabase client not initialized');
      }
      
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${getURL()}reset-password`,
      });

      if (error) throw error;

      setMessage('Check your email for the password reset link');
      toast.success('Password reset email sent! Please check your inbox.');

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (error: any) {
      logger.error('[ForgotPassword] Error:', error);
      setMessage(error.message || 'Failed to send reset email');
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-row bg-black text-white">
      {/* Left column - Brand and testimonial - Hidden on mobile */}
      <div 
        className="hidden md:flex md:w-2/5 lg:w-1/2 flex-col justify-between p-6 lg:p-12 border-r border-gray-800 relative" 
        style={{
          background: 'linear-gradient(to right, #3a6073, #3a7bd5)'
        }}
      >
        {/* Background image with opacity */}
        <div 
          className="absolute inset-0 opacity-40 z-0" 
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        ></div>
        
        <div className="mt-6 lg:mt-12 relative z-10">
          <h1 className="text-2xl font-bold">DailyFix</h1>
        </div>
        
        <div className="mb-12 lg:mb-24 relative z-10">
          <blockquote className="text-lg lg:text-xl leading-relaxed">
            "This library has saved me countless hours of work and helped me deliver stunning designs to my clients faster than ever before."
          </blockquote>
          <div className="mt-4">
            <p className="text-gray-400">Sofia Davis</p>
          </div>
        </div>
      </div>
      
      {/* Right column - Authentication - Full width on mobile */}
      <div className="w-full md:w-3/5 lg:w-1/2 flex items-center justify-center p-6 md:p-8">
        {/* Logo on mobile only */}
        <div className="md:hidden flex justify-center w-full mb-8">
          <h1 className="text-2xl font-bold">DailyFix</h1>
        </div>
        
        <div className="w-full max-w-md px-4 sm:px-8">
          <div className="flex justify-end mb-6">
            <Link to="/login" className="text-sm">Login</Link>
          </div>
          
          <div className="mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-semibold mb-2">Reset Password</h2>
            <p className="text-gray-400">Enter your email below to receive a password reset link</p>
          </div>
          
          {message && (
            <Alert 
              variant={message.includes('Check your email') ? "default" : "destructive"}
              className={message.includes('Check your email') 
                ? "mb-6 bg-green-900/20 border border-green-600 text-green-500" 
                : "mb-6"}
            >
              <AlertDescription className="text-sm">{message}</AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm text-gray-400">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border-gray-700 rounded-md"
                required
              />
            </div>
            
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 mt-2 bg-white text-black hover:bg-gray-200"
              variant="default"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <LavaLamp className="w-[20px] h-[40px] mr-3" />
                  <span>Sending...</span>
                </div>
              ) : 'Send Reset Link'}
            </Button>
            
            <p className="mt-4 text-center text-sm text-gray-400">
              Remember your password?{" "}
              <Link to="/login" className="text-blue-600 hover:underline">Login</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Signup; 