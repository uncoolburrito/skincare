/**
 * Skin Streak v3 — Authentication & Invite Management
 * Uses Supabase Auth with passwordless email magic links.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://whekrgnecterjouoyxer.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoZWtyZ25lY3RlcmpvdW95eGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTI3NTQsImV4cCI6MjEwNTAyODc1NH0.qrER44GUSzigfvurBV68x42gjREn2wOooY-RvzuCC2o';

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
  const redirectUrl = window.location.origin + window.location.pathname;

  const { data, error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      emailRedirectTo: redirectUrl
    }
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Gets the current active session
 */
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[Auth] Error getting session:', error);
    return null;
  }
  return session;
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
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('[Auth] Error signing out:', error);
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
}
