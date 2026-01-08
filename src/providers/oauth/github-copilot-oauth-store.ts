// src/providers/oauth/github-copilot-oauth-store.ts
// Zustand store for GitHub Copilot OAuth state management
// Uses Device Code Flow with frontend polling (no callback server needed)

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import {
  type GitHubCopilotOAuthTokens,
  getCopilotApiToken,
  isCopilotTokenExpired,
  pollForAccessToken,
  refreshAccessToken,
  startDeviceCodeFlow,
} from './github-copilot-oauth-service';

// Storage keys for OAuth tokens in settings database
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'github_copilot_oauth_access_token',
  COPILOT_TOKEN: 'github_copilot_oauth_copilot_token',
  EXPIRES_AT: 'github_copilot_oauth_expires_at',
  ENTERPRISE_URL: 'github_copilot_oauth_enterprise_url',
} as const;

interface GitHubCopilotOAuthState {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  isPolling: boolean;
  error: string | null;

  // Tokens
  accessToken: string | null;
  copilotToken: string | null;
  expiresAt: number | null;
  enterpriseUrl: string | null;

  // OAuth flow state
  deviceCode: string | null;
  userCode: string | null;
  verificationUri: string | null;

  // Initialization
  isInitialized: boolean;
}

interface GitHubCopilotOAuthActions {
  // Initialize from storage
  initialize: () => Promise<void>;

  // OAuth flow - Device Code Flow with frontend polling
  startOAuth: (enterpriseUrl?: string) => Promise<{ userCode: string; verificationUri: string }>;
  pollForToken: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Token management
  getValidCopilotToken: () => Promise<string | null>;
  refreshTokenIfNeeded: () => Promise<boolean>;
}

type GitHubCopilotOAuthStore = GitHubCopilotOAuthState & GitHubCopilotOAuthActions;

// Helper to get settings database
async function getSettingsDb() {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();
  return settingsDb;
}

export const useGitHubCopilotOAuthStore = create<GitHubCopilotOAuthStore>((set, get) => ({
  // Initial state
  isConnected: false,
  isLoading: false,
  isPolling: false,
  error: null,
  accessToken: null,
  copilotToken: null,
  expiresAt: null,
  enterpriseUrl: null,
  deviceCode: null,
  userCode: null,
  verificationUri: null,
  isInitialized: false,

  // Initialize from storage
  initialize: async () => {
    const { isInitialized, isLoading } = get();
    if (isInitialized || isLoading) return;

    set({ isLoading: true, error: null });

    try {
      logger.info('[GitHubCopilotOAuth] Initializing store');
      const db = await getSettingsDb();

      const values = await db.getBatch([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.COPILOT_TOKEN,
        STORAGE_KEYS.EXPIRES_AT,
        STORAGE_KEYS.ENTERPRISE_URL,
      ]);

      const accessToken = values[STORAGE_KEYS.ACCESS_TOKEN] || null;
      const copilotToken = values[STORAGE_KEYS.COPILOT_TOKEN] || null;
      const expiresAtStr = values[STORAGE_KEYS.EXPIRES_AT];
      // Check for empty string or invalid number
      const expiresAt =
        expiresAtStr && expiresAtStr.trim() ? Number.parseInt(expiresAtStr, 10) || null : null;
      const enterpriseUrl = values[STORAGE_KEYS.ENTERPRISE_URL] || null;

      const isConnected = !!(accessToken && copilotToken && expiresAt);

      logger.info('[GitHubCopilotOAuth] Initialized', { isConnected });

      set({
        accessToken,
        copilotToken,
        expiresAt,
        enterpriseUrl,
        isConnected,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Initialization error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize',
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  // Start OAuth flow - Device Code Flow with frontend polling
  // GitHub OAuth Device Code Flow doesn't use HTTP callbacks, so we poll directly
  startOAuth: async (enterpriseUrl?: string) => {
    set({ isLoading: true, error: null, isPolling: false });

    try {
      const result = await startDeviceCodeFlow(enterpriseUrl);

      set({
        deviceCode: result.deviceCode,
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        enterpriseUrl: enterpriseUrl || null,
        isLoading: false,
        isPolling: true,
      });

      logger.info('[GitHubCopilotOAuth] OAuth flow started, starting polling...');

      // Start polling in the background
      // The UI will show polling state, user can also manually trigger polling
      return {
        userCode: result.userCode,
        verificationUri: result.verificationUri,
      };
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to start OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
        isLoading: false,
        isPolling: false,
      });
      throw error;
    }
  },

  // Poll for token using Device Code Flow
  pollForToken: async () => {
    const { deviceCode, enterpriseUrl } = get();

    if (!deviceCode) {
      throw new Error('No device code found. Please start OAuth flow first.');
    }

    set({ isPolling: true, error: null });

    try {
      const result = await pollForAccessToken(
        deviceCode,
        enterpriseUrl || undefined,
        (status, message) => {
          logger.info('[GitHubCopilotOAuth] Polling status:', status, message);
          set({ isPolling: status === 'pending' });
        }
      );

      if (result.type === 'success' && result.tokens) {
        // Save tokens to database
        const { accessToken, copilotToken, expiresAt } = result.tokens;
        const db = await getSettingsDb();
        await db.setBatch({
          [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
          [STORAGE_KEYS.COPILOT_TOKEN]: copilotToken,
          [STORAGE_KEYS.EXPIRES_AT]: expiresAt.toString(),
          [STORAGE_KEYS.ENTERPRISE_URL]: enterpriseUrl || '',
        });

        logger.info('[GitHubCopilotOAuth] OAuth completed successfully');

        set({
          accessToken,
          copilotToken,
          expiresAt,
          enterpriseUrl: enterpriseUrl || null,
          isConnected: true,
          deviceCode: null,
          userCode: null,
          verificationUri: null,
          isLoading: false,
          isPolling: false,
        });
      } else {
        throw new Error(result.error || 'Token exchange failed');
      }
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to poll for token:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to complete OAuth',
        isLoading: false,
        isPolling: false,
      });
      throw error;
    }
  },

  // Disconnect and clear tokens
  disconnect: async () => {
    set({ isLoading: true, error: null });

    try {
      const db = await getSettingsDb();
      await db.setBatch({
        [STORAGE_KEYS.ACCESS_TOKEN]: '',
        [STORAGE_KEYS.COPILOT_TOKEN]: '',
        [STORAGE_KEYS.EXPIRES_AT]: '',
        [STORAGE_KEYS.ENTERPRISE_URL]: '',
      });

      logger.info('[GitHubCopilotOAuth] Disconnected');

      set({
        accessToken: null,
        copilotToken: null,
        expiresAt: null,
        enterpriseUrl: null,
        isConnected: false,
        deviceCode: null,
        userCode: null,
        verificationUri: null,
        isLoading: false,
        isPolling: false,
      });
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Failed to disconnect:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to disconnect',
        isLoading: false,
      });
      throw error;
    }
  },

  // Get a valid Copilot token (refresh if needed)
  getValidCopilotToken: async () => {
    const state = get();

    if (!state.isConnected || !state.accessToken) {
      logger.warn('[GitHubCopilotOAuth] Not connected or no access token');
      return null;
    }

    // Check if token is expired
    if (state.expiresAt && isCopilotTokenExpired(state.expiresAt)) {
      logger.info('[GitHubCopilotOAuth] Token expired, refreshing...');
      const success = await get().refreshTokenIfNeeded();
      if (!success) {
        logger.error('[GitHubCopilotOAuth] Token refresh failed, keeping existing token');
        // Don't call disconnect() - keep the existing token and let the API fail naturally
        // This allows users to continue using until they can re-authenticate
        return state.copilotToken;
      }
    }

    return get().copilotToken;
  },

  // Refresh token if needed
  // Note: GitHub OAuth device code flow doesn't provide refresh token.
  // We directly use the OAuth access token to get a new Copilot API token.
  refreshTokenIfNeeded: async () => {
    const { accessToken, expiresAt, enterpriseUrl } = get();

    if (!accessToken) {
      return false;
    }

    // Only refresh if expired
    if (expiresAt && !isCopilotTokenExpired(expiresAt)) {
      return true;
    }

    try {
      // Directly use OAuth access token to get new Copilot API token
      const copilotResult = await getCopilotApiToken(accessToken, enterpriseUrl || undefined);

      if (copilotResult.type === 'failed' || !copilotResult.tokens) {
        const errorMessage = 'error' in copilotResult ? copilotResult.error : 'Unknown error';
        logger.error('[GitHubCopilotOAuth] Copilot token refresh failed:', errorMessage);
        // Don't disconnect - let the existing token be used and fail naturally on API call
        return false;
      }

      const { copilotToken, expiresAt: newExpiresAt } = copilotResult.tokens;

      // Save to database
      const db = await getSettingsDb();
      await db.setBatch({
        [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
        [STORAGE_KEYS.COPILOT_TOKEN]: copilotToken,
        [STORAGE_KEYS.EXPIRES_AT]: newExpiresAt.toString(),
        [STORAGE_KEYS.ENTERPRISE_URL]: enterpriseUrl || '',
      });

      logger.info('[GitHubCopilotOAuth] Token refreshed successfully');

      set({
        copilotToken,
        expiresAt: newExpiresAt,
      });

      return true;
    } catch (error) {
      logger.error('[GitHubCopilotOAuth] Token refresh error:', error);
      return false;
    }
  },
}));

// Selector for connection status
export const selectIsGitHubCopilotOAuthConnected = (state: GitHubCopilotOAuthStore) =>
  state.isConnected;

// Export async helper for checking OAuth status
export async function isGitHubCopilotOAuthConnected(): Promise<boolean> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useGitHubCopilotOAuthStore.getState().isConnected;
}

// Export async helper for getting valid Copilot token
export async function getGitHubCopilotOAuthToken(): Promise<string | null> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return store.getValidCopilotToken();
}

// Export async helper for getting tokens
export async function getGitHubCopilotOAuthTokens(): Promise<{
  accessToken: string | null;
  copilotToken: string | null;
  enterpriseUrl: string | null;
} | null> {
  const store = useGitHubCopilotOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  const state = useGitHubCopilotOAuthStore.getState();
  if (!state.isConnected) {
    return null;
  }
  return {
    accessToken: state.accessToken,
    copilotToken: state.copilotToken,
    enterpriseUrl: state.enterpriseUrl,
  };
}
