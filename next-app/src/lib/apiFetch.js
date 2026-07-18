// Thin fetch wrapper that retries a GET once on a transient failure — a network/
// timeout error or a 502/503/504 — so a Neon cold-start (the DB waking from
// auto-suspend) surfaces as a slightly slower load instead of "couldn't load".
//
// Only GET is retried: retrying a POST/PUT/DELETE could double-submit (a second
// check-in, a duplicate approval). Non-GET requests pass straight through. The
// full `init` is forwarded untouched (Authorization, Content-Type,
// cache:'no-store'), and the raw Response is returned, so existing
// `const json = await res.json(); if (!res.ok) throw …` handling keeps working.

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetch(url, init = {}, { retries = 1, backoffMs = 1200 } = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const canRetry = method === 'GET';
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, init);
      if (canRetry && attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }
      return res;
    } catch (err) {
      if (canRetry && attempt < retries) {
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }
}

export default apiFetch;
