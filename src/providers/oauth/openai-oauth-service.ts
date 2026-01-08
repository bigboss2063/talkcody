// src/providers/oauth/openai-oauth-service.ts
// Core OAuth service for OpenAI ChatGPT Plus/Pro authentication
// Reference: opencode-openai-codex-auth project

import { createOpenAI } from '@ai-sdk/openai';
import { logger } from '@/lib/logger';
import { simpleFetch, streamFetch } from '@/lib/tauri-fetch';
import { type CodexRequestBody, transformRequestBody } from '@/services/openai-codex-transformer';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OAUTH_SCOPES = 'openid profile email offline_access';

// ChatGPT backend API base URL
export const CHATGPT_API_BASE_URL = 'https://chatgpt.com/backend-api';

export interface OpenAIOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  accountId?: string; // ChatGPT account ID extracted from JWT
}

export interface OAuthFlowResult {
  url: string;
  verifier: string;
  state: string;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed';
  tokens?: OpenAIOAuthTokens;
  error?: string;
}

export interface ParsedAuthInput {
  code?: string;
  state?: string;
}

export interface JWTPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  'https://api.openai.com/auth'?: {
    user_id?: string;
  };
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
 * Generate a random state value for OAuth flow (CSRF protection)
 */
function generateState(): string {
  const randomValues = new Uint8Array(16);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map((v) => v.toString(16).padStart(2, '0'))
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
 * Decode a JWT token to extract payload
 */
function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payloadPart = parts[1];
    const decoded = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Extract ChatGPT account ID from access token
 */
function extractAccountId(accessToken: string): string | undefined {
  const payload = decodeJWT(accessToken);
  if (!payload) return undefined;

  // Try to get account ID from the custom claim
  const authClaim = payload?.['https://api.openai.com/auth'];
  return authClaim?.user_id || payload?.sub;
}

/**
 * Start OAuth flow - generates authorization URL
 */
export async function startOAuthFlow(): Promise<OAuthFlowResult> {
  const pkce = await generatePKCE();
  const state = generateState();

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // Additional parameters for Codex CLI compatibility
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'codex_cli_rs');

  logger.info('[OpenAIOAuth] Started OAuth flow');

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state,
  };
}

/**
 * Parse authorization code and state from user input
 * Supports multiple formats:
 * - Full URL: http://localhost:1455/auth/callback?code=xxx&state=yyy
 * - Code#State: xxx#yyy
 * - Query string: code=xxx&state=yyy
 * - Just code: xxx
 */
export function parseAuthorizationInput(input: string): ParsedAuthInput {
  const value = (input || '').trim();
  if (!value) return {};

  // Try to parse as URL
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Not a URL, continue with other formats
  }

  // Try code#state format
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }

  // Try query string format
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  // Assume it's just the code
  return { code: value };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  expectedState?: string
): Promise<TokenExchangeResult> {
  try {
    // Parse the input to handle different formats
    const parsed = parseAuthorizationInput(code);
    const authCode = parsed.code || code;

    // Validate state if expected
    if (expectedState && parsed.state && parsed.state !== expectedState) {
      logger.error('[OpenAIOAuth] State mismatch');
      return {
        type: 'failed',
        error: 'State mismatch - possible CSRF attack',
      };
    }

    logger.info('[OpenAIOAuth] Exchanging code for tokens');

    const response = await simpleFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: authCode,
        code_verifier: verifier,
        redirect_uri: OAUTH_REDIRECT_URI,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[OpenAIOAuth] Token exchange failed:', response.status, errorText);
      return {
        type: 'failed',
        error: `Token exchange failed: ${response.status}`,
      };
    }

    const json = await response.json();

    if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
      logger.error('[OpenAIOAuth] Token response missing fields:', json);
      return {
        type: 'failed',
        error: 'Invalid token response from OpenAI',
      };
    }

    const accessToken = json.access_token;
    const accountId = extractAccountId(accessToken);

    logger.info('[OpenAIOAuth] Token exchange successful');

    return {
      type: 'success',
      tokens: {
        accessToken,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        accountId,
      },
    };
  } catch (error) {
    logger.error('[OpenAIOAuth] Token exchange error:', error);
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
    logger.info('[OpenAIOAuth] Refreshing access token');

    const response = await simpleFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[OpenAIOAuth] Token refresh failed:', response.status, errorText);
      return {
        type: 'failed',
        error: `Token refresh failed: ${response.status}`,
      };
    }

    const json = await response.json();

    if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
      logger.error('[OpenAIOAuth] Token refresh response missing fields:', json);
      return {
        type: 'failed',
        error: 'Invalid token response from OpenAI',
      };
    }

    const accessToken = json.access_token;
    const accountId = extractAccountId(accessToken);

    logger.info('[OpenAIOAuth] Token refresh successful');

    return {
      type: 'success',
      tokens: {
        accessToken,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        accountId,
      },
    };
  } catch (error) {
    logger.error('[OpenAIOAuth] Token refresh error:', error);
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
 * Get redirect URI (for display purposes)
 */
export function getRedirectUri(): string {
  return OAUTH_REDIRECT_URI;
}

/**
 * Create a custom fetch function for OpenAI ChatGPT OAuth that:
 * 1. Dynamically gets the latest access token and account ID (with auto-refresh)
 * 2. Uses ChatGPT backend API base URL
 * 3. Adds Authorization: Bearer header
 * 4. Adds required headers for Codex API
 * 5. Transforms request body with Codex instructions
 */
function createOpenAIOAuthFetch(): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Dynamically get the latest access token and account ID (with auto-refresh)
    // Using dynamic import to avoid circular dependencies
    const { getOpenAIOAuthAccessToken, getOpenAIOAuthAccountId } = await import(
      './openai-oauth-store'
    );
    const accessToken = await getOpenAIOAuthAccessToken();
    const accountId = await getOpenAIOAuthAccountId();

    if (!accessToken) {
      throw new Error(
        'OpenAI OAuth access token not available. Please connect your OpenAI account in settings.'
      );
    }

    const headers = new Headers(init?.headers);

    // Add Bearer token authorization
    headers.set('Authorization', `Bearer ${accessToken}`);

    // Add required headers for ChatGPT backend API
    headers.set('OpenAI-Beta', 'responses=experimental');
    headers.set('originator', 'codex_cli_rs');

    // Add account ID if available
    if (accountId) {
      headers.set('chatgpt-account-id', accountId);
    }

    // Add SSE stream support
    headers.set('accept', 'text/event-stream');

    // Transform the URL to use ChatGPT backend API
    let url = typeof input === 'string' ? input : input.toString();

    // Replace standard OpenAI API paths with ChatGPT backend paths
    if (url.includes('/v1/chat/completions')) {
      url = url.replace(
        /https:\/\/api\.openai\.com\/v1\/chat\/completions/,
        'https://chatgpt.com/backend-api/codex/responses'
      );
    } else if (url.includes('/v1/responses')) {
      url = url.replace(
        /https:\/\/api\.openai\.com\/v1\/responses/,
        'https://chatgpt.com/backend-api/codex/responses'
      );
    }

    // Transform request body for Codex API
    let transformedInit = init;
    if (init?.body && typeof init.body === 'string') {
      try {
        const originalBody = JSON.parse(init.body) as CodexRequestBody;
        const transformedBody = await transformRequestBody(originalBody);
        transformedInit = {
          ...init,
          body: JSON.stringify(transformedBody),
        };
        logger.info('[OpenAIOAuthFetch] Request body transformed for Codex API', {
          transformedBody,
        });
      } catch (error) {
        logger.error('[OpenAIOAuthFetch] Failed to transform request body:', error);
        // Continue with original body if transformation fails
      }
    }

    return streamFetch(url, { ...transformedInit, headers });
  };
}

/**
 * Create an OpenAI provider that uses ChatGPT OAuth authentication
 * The provider will automatically refresh tokens on each request
 */
export function createOpenAIOAuthProvider() {
  return createOpenAI({
    apiKey: 'oauth-placeholder', // SDK requires this but we override with Bearer token
    fetch: createOpenAIOAuthFetch() as typeof fetch,
  });
}
