// Client-IP helpers for the web check-in office-IP check.

// Best-effort client IP behind Vercel. Vercel sets `x-real-ip` to the connecting
// client's IP and includes it in `x-forwarded-for`; we prefer `x-real-ip`, else
// the left-most `x-forwarded-for` entry. Note: this is the office's PUBLIC IP
// (all devices behind one NAT share it) — never a 192.168.x.x LAN address. Not
// fully spoof-proof, but adequate as an attendance deterrent + audit signal.
export function clientIpFromHeaders(headers) {
  // Soundness depends on a trusted proxy (Vercel) setting `x-real-ip` to the
  // real connecting IP — clients can't override it. We do NOT trust the
  // left-most `x-forwarded-for` entry (that's the client-supplied, spoofable
  // value); if we must fall back to XFF, take the right-most (trust-boundary)
  // entry. The IP is a deterrent/audit signal, not an authentication factor.
  const realIp = headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return '';
}

// Validate an allowlist entry: an exact IPv4, an IPv4 CIDR (/1../32), or a
// loose exact IPv6. Rejects junk and match-all forms ("", "x/", "x/0") so a
// typo is dropped at write time rather than silently widening the gate.
export function isValidIpEntry(entry) {
  const s = String(entry || '').trim();
  if (!s) return false;
  if (s.includes('/')) {
    const [range, bitsStr] = s.split('/');
    if (!/^\d{1,2}$/.test((bitsStr ?? '').trim())) return false;
    const bits = Number(bitsStr.trim());
    if (bits < 1 || bits > 32) return false;
    return ipv4ToInt(range) !== null;
  }
  if (ipv4ToInt(s) !== null) return true;
  return s.includes(':') && /^[0-9a-fA-F:]+$/.test(s); // loose IPv6 exact
}

// True if `ip` matches any allowlist entry. Entries may be an exact IP (v4 or v6)
// or an IPv4 CIDR range like "203.0.113.0/24". IPv6 is exact-match only.
export function ipInAllowlist(ip, allowedIps) {
  const addr = String(ip || '').trim();
  if (!addr) return false;
  for (const raw of allowedIps || []) {
    const entry = String(raw || '').trim();
    if (!entry) continue;
    if (entry.includes('/')) {
      if (ipv4InCidr(addr, entry)) return true;
    } else if (entry === addr) {
      return true;
    }
  }
  return false;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o; // 0..4294967295, a safe integer
  }
  return n;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  // Reject empty/non-numeric prefix ("10.0.0.0/") and /0 — a match-all entry is
  // meaningless for an office allowlist, so a typo must fail CLOSED, not open.
  if (bitsStr === undefined || !/^\d{1,2}$/.test(bitsStr.trim())) return false;
  const bits = Number(bitsStr.trim());
  if (bits < 1 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((rangeInt & mask) >>> 0);
}
