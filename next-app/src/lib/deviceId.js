// Stable per-browser device id for the 2-device login cap. A random UUID kept in
// localStorage; clearing site storage rotates it (which then counts as a new
// device — recover with an admin "reset devices"). Client-only.

export function getOrCreateWebDeviceId() {
  if (typeof window === 'undefined') return null;
  try {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('deviceId', id);
    }
    return id;
  } catch {
    return null;
  }
}

// A short human label for the device list in the admin UI.
export function webDeviceName() {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  return ua ? ua.slice(0, 160) : null;
}
