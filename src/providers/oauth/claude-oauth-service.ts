// src/providers/oauth/claude-oauth-service.ts
// Core OAuth service for Claude Pro/Max authentication

import { createAnthropic } from '@ai-sdk/anthropic';
import { logger } from '@/lib/logger';
import { simpleFetch, streamFetch } from '@/lib/tauri-fetch';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference';

// Beta headers required for OAuth
export const CLAUDE_OAUTH_BETA_HEADERS =
  'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';

export interface ClaudeOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

export interface OAuthFlowResult {
  url: string;
  verifier: string;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed';
  tokens?: ClaudeOAuthTokens;
  error?: string;
}

/**
 * Generate a cryptographically secure random string for PKCE verifier
 */
function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map((v) => charset[v % charset.length])
    .join('');
}

/**
 * Base64 URL encode a buffer (for PKCE challenge)
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate PKCE verifier and challenge
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

/**
 * Start OAuth flow - generates authorization URL
 */
export async function startOAuthFlow(): Promise<OAuthFlowResult> {
  const pkce = await generatePKCE();

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', pkce.verifier);

  logger.info('[ClaudeOAuth] Started OAuth flow');

  return {
    url: url.toString(),
    verifier: pkce.verifier,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(code: string, verifier: string): Promise<TokenExchangeResult> {
  try {
    // The code format from Claude is: "code#state"
    const splits = code.split('#');
    const authCode = splits[0];
    const state = splits[1];

    logger.info('[ClaudeOAuth] Exchanging code for tokens');

    const response = await simpleFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        state: state,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[ClaudeOAuth] Token exchange failed:', response.status, errorText);
      return {
        type: 'failed',
        error: `Token exchange failed: ${response.status}`,
      };
    }

    const json = await response.json();

    logger.info('[ClaudeOAuth] Token exchange successful');

    return {
      type: 'success',
      tokens: {
        refreshToken: json.refresh_token,
        accessToken: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      },
    };
  } catch (error) {
    logger.error('[ClaudeOAuth] Token exchange error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
  try {
    logger.info('[ClaudeOAuth] Refreshing access token');

    const response = await simpleFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[ClaudeOAuth] Token refresh failed:', response.status, errorText);
      return {
        type: 'failed',
        error: `Token refresh failed: ${response.status}`,
      };
    }

    const json = await response.json();

    logger.info('[ClaudeOAuth] Token refresh successful');

    return {
      type: 'success',
      tokens: {
        refreshToken: json.refresh_token,
        accessToken: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      },
    };
  } catch (error) {
    logger.error('[ClaudeOAuth] Token refresh error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 */
export function isTokenExpired(expiresAt: number): boolean {
  const bufferMs = 60 * 1000; // 1 minute buffer
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Get OAuth client ID (for display purposes)
 */
export function getClientId(): string {
  return CLIENT_ID;
}

/**
 * Create a custom fetch function for Claude OAuth that:
 * 1. Dynamically gets the latest access token (with auto-refresh)
 * 2. Adds Authorization: Bearer header
 * 3. Removes x-api-key header
 * 4. Adds OAuth beta headers
 * 5. Adds Claude Code User-Agent header (required for OAuth)
 */
function createClaudeOAuthFetch(): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Dynamically get the latest access token (with auto-refresh)
    // Using dynamic import to avoid circular dependencies
    const { getClaudeOAuthAccessToken } = await import('./claude-oauth-store');
    const accessToken = await getClaudeOAuthAccessToken();

    if (!accessToken) {
      throw new Error(
        'Claude OAuth access token not available. Please connect your Claude account in settings.'
      );
    }

    const headers = new Headers(init?.headers);

    // Remove x-api-key header (SDK adds this automatically)
    headers.delete('x-api-key');

    // Add Bearer token authorization
    headers.set('Authorization', `Bearer ${accessToken}`);

    // Merge beta headers
    const existingBeta = headers.get('anthropic-beta') || '';
    const existingBetaList = existingBeta
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    const oauthBetaList = CLAUDE_OAUTH_BETA_HEADERS.split(',').map((b) => b.trim());
    const mergedBetas = [...new Set([...oauthBetaList, ...existingBetaList])].join(',');
    headers.set('anthropic-beta', mergedBetas);

    return streamFetch(input, { ...init, headers });
  };
}

/**
 * Create an Anthropic provider that uses OAuth authentication
 * The provider will automatically refresh tokens on each request
 */
export function createAnthropicOAuthProvider() {
  return createAnthropic({
    apiKey: 'oauth-placeholder', // SDK requires this but we override with Bearer token
    fetch: createClaudeOAuthFetch() as typeof fetch,
  });
}
