/**
 * renasce — PWA & Push Notification Controller
 * Manages Service Worker registration, Web Push / FCM device token acquisition,
 * and permissions management.
 */

// Default VAPID public key (uncompressed P-256 EC public key for Web Push)
const DEFAULT_VAPID_PUBLIC_KEY = 'BKvq9lC_Ukx5azbd0iuBTL81BrWSx4oDiE3LsV2n3FHAZm2hOCtI0FIvrw0z2rB9MEES3v54A2kOYG6n6e99QgQ';

// Helper: Convert base64 VAPID key to Uint8Array for PushManager
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Extracts the push device token from a PushSubscription
 */
function getSubscriptionToken(sub) {
  if (!sub) return null;
  if (sub.endpoint) {
    const parts = sub.endpoint.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 20) {
      return lastPart;
    }
  }
  return JSON.stringify(sub);
}

/**
 * Registers the PWA service worker
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service Worker not supported in this browser.');
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[PWA] Service Worker registered successfully with scope:', reg.scope);
    return reg;
  } catch (err) {
    console.warn('[PWA] Service Worker registration failed:', err);
    return null;
  }
}

/**
 * Gets current notification permission status
 */
export function getNotificationPermission() {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Requests Notification permission and subscribes device for push notifications
 */
export async function subscribeToPush(storageController) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('Push notifications are not supported on this browser or device.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications blocked in browser settings. Please enable them to receive routine nudges.'
      : 'Notification permission was dismissed.');
  }

  const reg = await navigator.serviceWorker.ready;
  if (!reg || !reg.pushManager) {
    throw new Error('PushManager not available on service worker.');
  }

  // Look for existing subscription first
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || import.meta.env.VITE_FIREBASE_VAPID_KEY || DEFAULT_VAPID_PUBLIC_KEY;
    const options = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
    };

    try {
      sub = await reg.pushManager.subscribe(options);
    } catch (subErr) {
      console.warn('[Push] Primary subscribe error:', subErr);
      // Fallback subscribe
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
      } catch (fallbackErr) {
        console.error('[Push] Fallback subscribe error:', fallbackErr);
        throw subErr;
      }
    }
  }

  if (sub && storageController) {
    const tokenStr = getSubscriptionToken(sub);
    if (tokenStr) {
      await storageController.savePushSubscription(tokenStr);
    }
  }

  return sub;
}

/**
 * Checks and syncs existing subscription with Supabase on app start
 */
export async function syncExistingPushSubscription(storageController) {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.pushManager) {
      const sub = await reg.pushManager.getSubscription();
      if (sub && storageController) {
        const tokenStr = getSubscriptionToken(sub);
        if (tokenStr) {
          await storageController.savePushSubscription(tokenStr);
        }
      }
    }
  } catch (err) {
    console.warn('[Push] Error syncing existing subscription:', err);
  }
}
