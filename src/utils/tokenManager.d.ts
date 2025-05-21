export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  [key: string]: any;
}

export interface TokenManager {
  getToken: () => Promise<TokenData | null>;
  setToken: (data: TokenData) => Promise<void>;
  clearToken: () => Promise<void>;
  isTokenExpired: (expiresAt?: number) => boolean;
  shouldRefreshToken: (expiresAt?: number) => boolean;
}

export const tokenManager: TokenManager;

export default tokenManager; 