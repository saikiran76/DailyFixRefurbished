import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useLogger } from '@/hooks/useLogger';
import { getSupabaseClient } from '@/utils/supabase';

// Shadcn UI components
import { Button } from '@/components/ui/button';

/**
 * ResetPassword component
 * Allows users to reset their password using a reset token
 */
const ResetPassword = () => {
  const logger = useLogger();
  const navigate = useNavigate();
  const location = useLocation();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Parse token from URL
  const query = new URLSearchParams(location.search);
  const token = query.get('token');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Reset token is missing. Please use the link from your email.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      logger.info('[ResetPassword] Attempting to reset password');
      
      // Get the Supabase client
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Authentication service is not available');
      }
      
      // Use Supabase to update the user password
      // We don't need to use resetPasswordForEmail here as we already have a token
      // and are setting a new password directly
      const { error: resetError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (resetError) {
        throw resetError;
      }

      setSuccess(true);
      toast.success('Password has been reset successfully! Please log in with your new password.');
      
      // Redirect to login after a short delay
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 2000);
    } catch (err: any) {
      logger.error('[ResetPassword] Error resetting password:', err);
      setError(err.message || 'Failed to reset password. Please try again or request a new reset link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-8 bg-card rounded-lg shadow-lg">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground">Reset Password</h2>
          <p className="mt-2 text-muted-foreground">Enter your new password below</p>
        </div>

        {error && (
          <div className="p-3 bg-destructive/20 border border-destructive/50 rounded-md text-destructive">
            {error}
          </div>
        )}

        {success ? (
          <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-md text-green-700">
            Password reset successful! Redirecting to login...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                New Password
              </label>
              <input
                type="password"
                id="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 block w-full px-3 py-2 bg-background border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                required
                minLength={6}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
                Confirm New Password
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 block w-full px-3 py-2 bg-background border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                required
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
              variant="default"
              size="default"
            >
              {isSubmitting ? 'Resetting...' : 'Reset Password'}
            </Button>

            <div className="text-center">
              <a href="/login" className="text-primary hover:underline text-sm">
                Back to Login
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword; 