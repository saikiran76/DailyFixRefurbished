# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```

# DailyFix Google Authentication Fix

This project implements fixes for the Google OAuth authentication flow to ensure consistent token management and client initialization.

## Key Changes

1. **Singleton Supabase Client**
   - Replaced direct imports of `supabase` with `getSupabaseClient()` across all files
   - Ensures only one Supabase client instance exists in the application, preventing "Multiple GoTrueClient instances" warnings

2. **Authentication Flow Improvements**
   - Updated `googleAuth.ts` to use authorization code flow (PKCE) for better security and refresh token support
   - Fixed response_type to be 'code' rather than 'token' to work with access_type: 'offline'
   - Improved error handling in auth callback components

3. **Token Management**
   - Enhanced token refresh mechanics in `authSecurityHelpers.ts`
   - Fixed type issues with token refresh timer setup
   - Added proper token expiry checks and refresh functionality

4. **Authentication Components**
   - Updated `DirectAuthCallback` and `SimpleAuthCallback` to handle null sessions properly
   - Improved error handling and visual feedback during authentication
   - Fixed typing issues throughout authentication components

5. **UI Improvements**
   - Used `LavaLamp` component for loading states during authentication
   - Improved styling and UI feedback during auth processes
   - Consistent UI styling across Login, Signup, and authentication components

## Usage

When implementing Google authentication in your components:

```typescript
// Always use getSupabaseClient instead of direct import
import { getSupabaseClient } from '@/utils/supabase';

// Initialize client
const supabase = getSupabaseClient();
if (!supabase) {
  throw new Error('Authentication service is not available');
}

// Use the client for authentication
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: callbackUrl,
    skipBrowserRedirect: false,
    scopes: 'email profile',
    queryParams: {
      access_type: 'offline',
      prompt: 'select_account',
      response_type: 'code'  // Use code flow, not token flow
    }
  }
});
```

## Auth Flow

The application now follows this authentication flow:

1. User initiates Google sign-in
2. Application redirects to Google OAuth using authorization code flow (PKCE)
3. Google redirects back to `/auth/callback` with an authorization code
4. The callback component exchanges the code for a session with refresh token
5. Session data is stored in Redux and localStorage
6. User is redirected to the appropriate page based on onboarding status

## Notes

- The `access_type: 'offline'` parameter requires `response_type: 'code'` (not 'token') to work correctly
- If you encounter "Token not present" errors, make sure you're using `getSupabaseClient()` consistently
- For debugging, check localStorage for token data and browser console for detailed logs
