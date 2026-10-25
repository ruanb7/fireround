// A global rate limiter for Firecrawl calls, so a sweep fits inside the plan's per-minute and
// concurrency limits instead of tripping them. Firecrawl's limits (pricing page, 2026-10-25):
// Free 10 requests a minute and 2 concurrent browsers; Hobby 100 a minute and 5 concurrent;
// Standard 500 a minute and 25 concurrent. Fireround's stages run 4 to 10 calls at once, which
// on the free plan ends a sweep with "Rate limit exceeded" after a dozen pages.
//
// Off unless configured: FIRECRAWL_RPM caps calls per sliding minute, FIRECRAWL_CONCURRENCY caps
// calls in flight. A call that still comes back rate-limited waits a minute and retries, up to
// FIRECRAWL_RATE_LIMIT_RETRIES times (default 3), before the error reaches the workflow.

const RPM = Number(process.env.FIRECRAWL_RPM ?? 0) || 0;
const CONCURRENCY = Number(process.env.FIRECRAWL_CONCURRENCY ?? 0) || 0;
const RETRIES = Number(process.env.FIRECRAWL_RATE_LIMIT_RETRIES ?? 3) || 0;
const WINDOW_MS = 60_000;

const starts: number[] = [];
let inFlight = 0;
const waiters: Array<() => void> = [];

function wake() {
  const next = waiters.shift();
  if (next) next();
}

async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] >= WINDOW_MS) starts.shift();
    const rpmOk = !RPM || starts.length < RPM;
    const concOk = !CONCURRENCY || inFlight < CONCURRENCY;
    if (rpmOk && concOk) {
      starts.push(now);
      inFlight++;
      return;
    }
    const waitMs = rpmOk ? 250 : Math.max(250, WINDOW_MS - (now - starts[0]) + 50);
    await new Promise<void>((resolve) => {
      const wakeup = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        const i = waiters.indexOf(wakeup);
        if (i >= 0) waiters.splice(i, 1);
        resolve();
      }, waitMs);
      waiters.push(wakeup);
    });
  }
}

/** Exactly one release per acquire. */
function release() {
  inFlight = Math.max(0, inFlight - 1);
  wake();
}

function isRateLimited(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string } | undefined;
  if (!e) return false;
  if (e.status === 429 || e.statusCode === 429) return true;
  return /rate limit/i.test(String(e.message ?? ""));
}

export function limiterEnabled(): boolean {
  return RPM > 0 || CONCURRENCY > 0;
}

export function describeLimiter(): string {
  return limiterEnabled()
    ? `firecrawl limiter: ${RPM || "unlimited"} rpm, ${CONCURRENCY || "unlimited"} concurrent, ${RETRIES} retries on 429`
    : "firecrawl limiter: off (set FIRECRAWL_RPM and FIRECRAWL_CONCURRENCY to match the plan)";
}

/** Run one Firecrawl call under the global limits, retrying after a rate-limit response. */
export async function limitedCall<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await acquire();
    let out: T;
    try {
      out = await fn();
    } catch (err) {
      release();
      if (isRateLimited(err) && attempt < RETRIES) {
        console.warn(`firecrawl: rate limited, waiting ${WINDOW_MS / 1000}s (retry ${attempt + 1}/${RETRIES})`);
        await new Promise((r) => setTimeout(r, WINDOW_MS + 1000));
        continue;
      }
      throw err;
    }
    release();
    return out;
  }
}
