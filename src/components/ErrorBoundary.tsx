import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertOctagon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component to catch JavaScript errors in children components
 * and display a fallback UI instead of crashing the whole app
 */
class ErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to an error reporting service
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <Card className="w-full max-w-md mx-auto mt-8 border-red-200">
          <CardHeader className="bg-red-50 text-red-900">
            <CardTitle className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5" /> 
              Something went wrong
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button 
              onClick={this.resetErrorBoundary}
              className="w-full"
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Auth-specific ErrorBoundary with navigation to login page
 */
export const AuthErrorBoundary: React.FC<Props> = ({ children }) => {
  const navigate = useNavigate();
  
  const handleReset = () => {
    navigate('/login', { replace: true });
  };
  
  return (
    <ErrorBoundaryClass onReset={handleReset}>
      {children}
    </ErrorBoundaryClass>
  );
};

export default ErrorBoundaryClass; 