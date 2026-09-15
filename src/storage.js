/**
 * Skin Streak — Storage & Real-Time Synchronization Engine
 * Supports Supabase Realtime for instant multi-device sync,
 * with resilient fallback to localStorage and BroadcastChannel.
 */

import { createClient } from '@supabase/supabase-js';

const STORAGE_KEY_PREFIX = 'skinstreak_data_';
const SLUG_STORAGE_KEY = 'skinstreak_last_slug';
const SUPABASE_URL_KEY = 'skinstreak_supabase_url';
const SUPABASE_ANON_KEY = 'skinstreak_supabase_anon_key';

let supabaseClient = null;
let realtimeChannel = null;
let broadcastChannel = null;
let currentSlug = null;
let pollingInterval = null;

// Default initial state
export const DEFAULT_SETTINGS = {
  friendName: '',
  friendPhone: '',
  amTime: '08:00',
  pmTime: '22:00',
  routineStartDate: ''
};

/**
 * Extracts or generates the unguessable tracker slug from the current URL.
 */
export function getOrCreateTrackerSlug() {
  // Check path /t/<slug>
  const pathMatch = window.location.pathname.match(/\/t\/([^/?#]+)/);
  if (pathMatch && pathMatch[1]) {
    currentSlug = pathMatch[1];
    localStorage.setItem(SLUG_STORAGE_KEY, currentSlug);
    return currentSlug;
  }

  // Check hash #/t/<slug> or #<slug>
  const hashMatch = window.location.hash.match(/(?:#\/t\/|#t=|^#)([^/?&]+)/);
  if (hashMatch && hashMatch[1] && hashMatch[1] !== '/') {
    currentSlug = hashMatch[1].replace(/^#/, '');
    localStorage.setItem(SLUG_STORAGE_KEY, currentSlug);
    return currentSlug;
  }

  // Check search param ?t=<slug>
  const params = new URLSearchParams(window.location.search);
  const paramSlug = params.get('t');
  if (paramSlug) {
    currentSlug = paramSlug;
    localStorage.setItem(SLUG_STORAGE_KEY, currentSlug);
    return currentSlug;
  }

  // Check saved slug in localStorage
  const savedSlug = localStorage.getItem(SLUG_STORAGE_KEY);
  if (savedSlug) {
    currentSlug = savedSlug;
  } else {
    // Generate an unguessable 16-character random hex slug
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    currentSlug = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SLUG_STORAGE_KEY, currentSlug);
  }

  // Update hash in URL so the user can easily share/copy it
  const newHash = `#/t/${currentSlug}`;
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, '', newHash);
  }

  return currentSlug;
}

/**
 * Returns full shareable URL for the friend
 */
export function getShareableUrl(slug = currentSlug) {
  const origin = window.location.origin;
  const path = window.location.pathname.replace(/\/t\/[^/?#]+/, '');
  return `${origin}${path}#/t/${slug}`;
}

/**
 * Get active Supabase credentials (from localStorage or environment variables)
 */
export function getSupabaseCredentials() {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL;
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  const localUrl = localStorage.getItem(SUPABASE_URL_KEY);
  const localKey = localStorage.getItem(SUPABASE_ANON_KEY);

  return {
    url: (envUrl || localUrl || '').trim(),
    anonKey: (envKey || localKey || '').trim(),
    isFromEnv: !!(envUrl && envKey)
  };
}

export function getCallMeBotCredentials() {
  const envPhone = import.meta.env?.VITE_CALLMEBOT_PHONE;
  const envKey = import.meta.env?.VITE_CALLMEBOT_API_KEY;
  const localPhone = localStorage.getItem('skinstreak_callmebot_phone');
  const localKey = localStorage.getItem('skinstreak_callmebot_key');

  return {
    phone: (envPhone || localPhone || '').trim(),
    apiKey: (envKey || localKey || '').trim()
  };
}

export function saveSupabaseCredentials(url, key) {
  if (url) {
    localStorage.setItem(SUPABASE_URL_KEY, url.trim());
  } else {
    localStorage.removeItem(SUPABASE_URL_KEY);
  }

  if (key) {
    localStorage.setItem(SUPABASE_ANON_KEY, key.trim());
  } else {
    localStorage.removeItem(SUPABASE_ANON_KEY);
  }

  // Reset client so it reconnects with new credentials
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }
  supabaseClient = null;
}

/**
 * Load local data cache for this slug
 */
function loadLocalData(slug) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      entries: parsed.entries || {},
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
    };
  } catch (e) {
    return null;
  }
}

/**
 * Save data to local cache
 */
function saveLocalData(slug, data) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + slug, JSON.stringify(data));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }
}

/**
 * Storage Controller initialization
 */
export class StorageController {
  constructor(slug, onDataChanged, onStatusChanged) {
    this.slug = slug || getOrCreateTrackerSlug();
    this.onDataChanged = onDataChanged || (() => {});
    this.onStatusChanged = onStatusChanged || (() => {});
    this.currentData = loadLocalData(this.slug) || {
      entries: {},
      settings: { ...DEFAULT_SETTINGS }
    };

    this.setupBroadcastChannel();
    this.initSupabase();
    this.setupVisibilityListener();
  }

  setupBroadcastChannel() {
    try {
      if ('BroadcastChannel' in window) {
        broadcastChannel = new BroadcastChannel(`skinstreak_${this.slug}`);
        broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'SYNC') {
            this.currentData = event.data.payload;
            saveLocalData(this.slug, this.currentData);
            this.onDataChanged(this.currentData, { source: 'broadcast' });
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel setup error:', e);
    }
  }

  setupVisibilityListener() {
    // When user returns to tab, refresh from Supabase or local storage
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.fetchRemoteData(false);
      }
    });
  }

  initSupabase() {
    const { url, anonKey } = getSupabaseCredentials();

    if (!url || !anonKey) {
      this.onStatusChanged({
        status: 'local',
        provider: 'local',
        message: 'Local offline sync (tabs synced). Connect Supabase in Settings for live multi-device sync.'
      });
      return;
    }

    try {
      supabaseClient = createClient(url, anonKey, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });

      this.onStatusChanged({
        status: 'connecting',
        provider: 'supabase',
        message: 'Connecting to Supabase Realtime…'
      });

      this.setupRealtimeSubscription();
      this.fetchRemoteData(true);

      // Start periodic poll (every 15s) as a resilient safety net
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = setInterval(() => this.fetchRemoteData(false), 15000);
    } catch (err) {
      console.error('Supabase init failed:', err);
      this.onStatusChanged({
        status: 'error',
        provider: 'supabase',
        message: 'Failed to connect to Supabase. Using local storage.'
      });
    }
  }

  setupRealtimeSubscription() {
    if (!supabaseClient) return;

    if (realtimeChannel) {
      realtimeChannel.unsubscribe();
      realtimeChannel = null;
    }

    try {
      realtimeChannel = supabaseClient
        .channel(`skin_streak_${this.slug}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'skin_streak_logs',
            filter: `id=eq.${this.slug}`
          },
          (payload) => {
            if (payload.new && payload.new.entries) {
              const remoteEntries = payload.new.entries || {};
              const remoteSettings = { ...DEFAULT_SETTINGS, ...(payload.new.settings || {}) };
              
              this.currentData = {
                entries: remoteEntries,
                settings: remoteSettings
              };

              saveLocalData(this.slug, this.currentData);
              this.onDataChanged(this.currentData, { source: 'supabase-realtime' });
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.onStatusChanged({
              status: 'online',
              provider: 'supabase',
              message: 'Live Multi-Device Sync Active'
            });
          } else if (status === 'CHANNEL_ERROR') {
            this.onStatusChanged({
              status: 'warning',
              provider: 'supabase',
              message: 'Realtime channel error — polling fallback active'
            });
          }
        });
    } catch (e) {
      console.warn('Realtime subscription error:', e);
    }
  }

  async fetchRemoteData(isInitial = false) {
    if (!supabaseClient) return;

    try {
      const { data, error } = await supabaseClient
        .from('skin_streak_logs')
        .select('*')
        .eq('id', this.slug)
        .maybeSingle();

      if (error) {
        console.warn('Supabase fetch error:', error);
        return;
      }

      if (data) {
        const remoteEntries = data.entries || {};
        const remoteSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

        this.currentData = {
          entries: remoteEntries,
          settings: remoteSettings
        };

        saveLocalData(this.slug, this.currentData);
        this.onDataChanged(this.currentData, { source: 'supabase-fetch' });
      } else if (isInitial) {
        // Record doesn't exist yet for this slug; push initial local state
        await this.pushRemoteData(this.currentData);
      }
    } catch (e) {
      console.warn('Remote sync fetch failed:', e);
    }
  }

  async pushRemoteData(data) {
    if (!supabaseClient) return;

    try {
      const { error } = await supabaseClient
        .from('skin_streak_logs')
        .upsert({
          id: this.slug,
          entries: data.entries || {},
          settings: data.settings || {},
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.warn('Supabase upsert error:', error);
      }
    } catch (e) {
      console.warn('Supabase push failed:', e);
    }
  }

  async save(entries, settings) {
    this.currentData = {
      entries: entries || {},
      settings: settings || { ...DEFAULT_SETTINGS }
    };

    // 1. Immediately save to localStorage (0ms latency)
    saveLocalData(this.slug, this.currentData);

    // 2. Broadcast to other open tabs
    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage({
          type: 'SYNC',
          payload: this.currentData
        });
      } catch (e) {
        // ignore
      }
    }

    // 3. Trigger local UI callback
    this.onDataChanged(this.currentData, { source: 'local-save' });

    // 4. Push to Supabase if connected
    if (supabaseClient) {
      await this.pushRemoteData(this.currentData);
    }
  }

  destroy() {
    if (pollingInterval) clearInterval(pollingInterval);
    if (realtimeChannel) realtimeChannel.unsubscribe();
    if (broadcastChannel) broadcastChannel.close();
  }
}
