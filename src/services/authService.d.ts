declare const authService: {
  signIn: (credentials: { email: string; password: string }) => Promise<any>;
  signUp: (credentials: { email: string; password: string; firstName: string; lastName: string }) => Promise<any>;
  signOut: () => Promise<any>;
  resetPassword: (email: string) => Promise<any>;
  updatePassword: (password: string) => Promise<any>;
  getCurrentUser: () => Promise<any>;
  refreshSession: () => Promise<any>;
  getSession: () => Promise<any>;
};

export default authService; 