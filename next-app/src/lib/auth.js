import jwt from 'jsonwebtoken';

// LexDesk session auth. We keep LexDesk's own JWT (frontend uses it via
// localStorage + Bearer), but passwords now live in Firebase Auth (the shared
// project). Login verifies the password against Firebase's REST endpoint and
// reads the role from the Firestore user doc; this module just signs/verifies
// the session token. No local user store anymore.

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// AttendDesk stores roles uppercase (its data); the LexDesk frontend uses
// lowercase. SUPER_ADMIN maps to 'superadmin'.
export function roleToLexdesk(role) {
  const map = { ADMIN: 'admin', EMPLOYEE: 'employee', SUPER_ADMIN: 'superadmin', IT_TEAM: 'it_team', DEV: 'dev' };
  return map[String(role || '').toUpperCase()] || 'employee';
}

// Verify an email+password against Firebase Auth via the Identity Toolkit REST
// endpoint (the only server-side way to check a password with the Admin SDK
// stack). Returns { uid, email } on success, null on bad credentials.
export async function verifyFirebasePassword(email, password) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(email).toLowerCase(), password, returnSecureToken: true }),
      cache: 'no-store',
    },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.localId) return null;
  return { uid: data.localId, email: data.email };
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatar: user.avatar,
      employeeId: user.employeeId ?? null,
      orgId: user.orgId ?? null,
    },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '8h' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

export function getUserFromRequest(request) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return verifyToken(auth.slice(7));
  } catch {
    return null;
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    employeeId: user.employeeId ?? null,
    orgId: user.orgId ?? null,
  };
}
