declare const supabase: {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<any>;
    signInWithOAuth(options: { provider: string; options?: any }): Promise<any>;
    signUp(credentials: { email: string; password: string; options?: any }): Promise<any>;
    resetPasswordForEmail(email: string, options?: any): Promise<any>;
    updateUser(attributes: any): Promise<any>;
    getSession(): Promise<any>;
    onAuthStateChange(callback: (event: string, session: any) => void): { data: any };
    getUser(): Promise<any>;
    signOut(): Promise<any>;
  };
  storage: {
    from(bucket: string): {
      upload(path: string, file: File, options?: any): Promise<any>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
  from(table: string): {
    select(columns?: string): any;
    insert(data: any): Promise<any>;
    update(data: any): any;
    delete(): any;
    eq(column: string, value: any): any;
    order(column: string, options?: { ascending?: boolean }): any;
  };
};

export { supabase }; 