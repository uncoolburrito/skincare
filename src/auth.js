/**
 * renasce — Authentication & Invite Management
 * Uses Supabase Auth with passwordless email magic links.
 */

import { createClient } from '@supabase/supabase-js';

export function sanitizeAnonKey(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^["']+|["']+$/g, '');
  if (str.includes('\n') || str.includes('\r')) {
    const lines = str.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    str = lines[0] || '';
  }
  if (str.includes(' ')) {
    str = str.split(/\s+/)[0].trim();
  }
  const parts = str.split('.');
  if (parts.length >= 3) {
    str = parts.slice(0, 3).join('.');
  }
  return str.trim();
}

export function sanitizeUrl(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^["']+|["']+$/g, '');
  if (str.includes('\n') || str.includes('\r')) {
    str = str.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  }
  if (str.includes(' ')) {
    str = str.split(/\s+/)[0].trim();
  }
  return str.replace(/\/+$/, '');
}

const FALLBACK_URL = 'https://whekrgnecterjouoyxer.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoZWtyZ25lY3RlcmpvdW95eGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTI3NTQsImV4cCI6MjEwNTAyODc1NH0.qrER44GUSzigfvurBV68x42gjREn2wOooY-RvzuCC2o';

export const SUPABASE_URL = sanitizeUrl(import.meta.env.VITE_SUPABASE_URL) || FALLBACK_URL;
export const SUPABASE_ANON_KEY = sanitizeAnonKey(import.meta.env.VITE_SUPABASE_ANON_KEY) || FALLBACK_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const PENDING_INVITE_KEY = 'skinstreak_pending_invite_token';

/**
 * Extracts invite token from URL if current route is /join/<token> or #/join/<token>
 */
export function extractInviteTokenFromUrl() {
  // Check hash e.g. #/join/<token> or #join/<token>
  const hash = window.location.hash || '';
  const hashMatch = hash.match(/#\/?join\/([^/?#&]+)/i);
  if (hashMatch && hashMatch[1]) {
    const token = hashMatch[1].trim();
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
    return token;
  }

  // Check pathname e.g. /join/<token>
  const path = window.location.pathname || '';
  const pathMatch = path.match(/\/join\/([^/?#&]+)/i);
  if (pathMatch && pathMatch[1]) {
    const token = pathMatch[1].trim();
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
    return token;
  }

  // Check search param ?join=<token>
  const params = new URLSearchParams(window.location.search);
  const paramToken = params.get('join');
  if (paramToken) {
    const token = paramToken.trim();
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
    return token;
  }

  return sessionStorage.getItem(PENDING_INVITE_KEY);
}

export function clearPendingInviteToken() {
  sessionStorage.removeItem(PENDING_INVITE_KEY);
}

/**
 * Sends a passwordless email magic link
 */
export async function sendMagicLink(email) {
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const origin = window.location.origin;
  const path = window.location.pathname.replace(/\/+$/, '') || '';
  const redirectUrl = `${origin}${path}/`;

  try {
    const { data, error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectUrl
      }
    });

    if (error) {
      if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
        throw new Error('Email rate limit reached (free tier limit is ~3 emails/hr). Please wait a few minutes before trying again.');
      }
      if (error.code === 'email_address_invalid') {
        throw new Error('This email address format was rejected by the server. Please check for typos.');
      }
      throw new Error(error.message || 'Failed to send magic link.');
    }

    return data;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('failed to execute') && err.message.toLowerCase().includes('fetch')) {
      throw new Error('Connection error communicating with Supabase. Please check your network or credentials.');
    }
    throw err;
  }
}

/**
 * Signs in with email and password (instant, bypasses email rate limits)
 */
export async function signInWithPassword(email, password) {
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password) {
    throw new Error('Please enter your password.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password
  });

  if (error) {
    throw new Error(error.message || 'Failed to sign in with password.');
  }

  return data;
}

/**
 * Signs up with email and password
 */
export async function signUpWithPassword(email, password) {
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password
  });

  if (error) {
    throw new Error(error.message || 'Failed to create account.');
  }

  return data;
}

/**
 * Gets the current active session
 */
export async function getSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[Auth] Error getting session:', error);
      return null;
    }
    return session;
  } catch (e) {
    console.error('[Auth] Session retrieval exception:', e);
    return null;
  }
}

/**
 * Gets current authenticated user
 */
export async function getCurrentUser() {
  const session = await getSession();
  return session ? session.user : null;
}

/**
 * Signs out
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[Auth] Error signing out:', error);
    }
  } catch (e) {
    console.error('[Auth] Sign out exception:', e);
  }
  clearPendingInviteToken();
}

/**
 * Listens to auth state changes
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

/**
 * Redeems an invite token for the currently authenticated user
 */
export async function redeemInvite(inviteToken) {
  if (!inviteToken) {
    return { success: false, error: 'No invite token provided' };
  }

  try {
    const { data, error } = await supabase.rpc('redeem_partner_invite', {
      invite_token: inviteToken.trim()
    });

    if (error) {
      console.error('[Auth] Error redeeming invite:', error);
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      clearPendingInviteToken();
    }

    return data;
  } catch (e) {
    return { success: false, error: e.message };
  }
}
