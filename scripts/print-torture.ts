/**
 * Hammer the CloudPRNT poll endpoint the way the printer does, only harder.
 *
 *   npm run torture:print -- http://127.0.0.1:8787/api/print/<CLOUDPRNT_SECRET>
 *
 * WHAT THIS CATCHES
 *
 * A `pg` Pool parked in module scope hands the next request an idle socket that
 * was opened during a PREVIOUS request. Workers forbids that — "Cannot perform
 * I/O on behalf of a different request" — and the query issued on such a socket
 * never settles, so the client is never released. With max: 1 the pool is empty
 * from that moment on and every later acquisition fails at
 * connectionTimeoutMillis with "timeout exceeded when trying to connect".
 *
 * That failure needs REPEAT requests against a WARM isolate to show up: the
 * first poll of a cold isolate always passes, which is why this hits the same
 * endpoint 30 times in a row rather than once. The concurrent phase covers the
 * other half — several requests contending for a single-connection pool.
 *
 * The printer polls every 10s against an idleTimeoutMillis of 10s, which is the
 * resonance that made this fire on essentially every poll in production. This
 * script does not wait 10s between requests; it does not need to. Reuse of a
 * pooled socket across requests is what breaks, and back-to-back requests reuse
 * it far more reliably than spaced ones do.
 *
 * REQUIREMENTS: a running worker (`wrangler dev` or a real deployment) with a
 * reachable database. A poll answers `{"jobReady":...}` either way — an empty
 * queue is a pass, since this measures connection health, not job flow.
 */

const POLL_BODY = JSON.stringify({
  status: "10 0 0",
  printerMAC: "00:11:62:00:00:00",
  statusCode: "200 OK",
  clientAction: [{ request: "GetPollInterval", result: "10" }],
});

const SEQUENTIAL = 30;
const CONCURRENT = 10;

interface Attempt {
  n: number;
  phase: "sequential" | "concurrent";
  ok: boolean;
  status: number | null;
  ms: number;
  body: string;
  error?: string;
}

async function poll(url: string, n: number, phase: Attempt["phase"]): Promise<Attempt> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: POLL_BODY,
    });
    const body = (await res.text()).slice(0, 200);
    return { n, phase, ok: res.ok, status: res.status, ms: Date.now() - started, body };
  } catch (err) {
    return {
      n,
      phase,
      ok: false,
      status: null,
      ms: Date.now() - started,
      body: "",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * A poll that returns 200 but took longer than the pool's own
 * connectionTimeoutMillis is a connection failure wearing a success code: the
 * route catches the timeout and answers NO_JOB. Treat it as a failure.
 */
const CONNECT_TIMEOUT_MS = 10_000;

function verdict(a: Attempt): { pass: boolean; why: string } {
  if (a.error) return { pass: false, why: `transport: ${a.error}` };
  if (a.status !== 200) return { pass: false, why: `HTTP ${a.status}` };
  if (a.ms >= CONNECT_TIMEOUT_MS) {
    return { pass: false, why: `${a.ms}ms — at or past connectionTimeoutMillis` };
  }
  return { pass: true, why: "" };
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: npm run torture:print -- <poll URL>\n" +
        "  e.g. http://127.0.0.1:8787/api/print/$CLOUDPRNT_SECRET\n\n" +
        "Start a worker first (`npx wrangler dev`) with a reachable database.",
    );
    process.exit(1);
  }

  const results: Attempt[] = [];

  console.log(`sequential x${SEQUENTIAL} (warm-isolate reuse) …`);
  for (let i = 1; i <= SEQUENTIAL; i++) {
    const a = await poll(url, i, "sequential");
    results.push(a);
    const v = verdict(a);
    if (!v.pass) console.log(`  #${String(i).padStart(2)} FAIL  ${v.why}`);
  }

  console.log(`concurrent x${CONCURRENT} (single-connection contention) …`);
  const burst = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, i) => poll(url, i + 1, "concurrent")),
  );
  results.push(...burst);
  for (const a of burst) {
    const v = verdict(a);
    if (!v.pass) console.log(`  #${String(a.n).padStart(2)} FAIL  ${v.why}`);
  }

  const failures = results.filter((a) => !verdict(a).pass);
  const times = results.map((a) => a.ms).sort((x, y) => x - y);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const slowest = times[times.length - 1];

  // The exact string the route logs when the pool is exhausted. Its absence is
  // not proof on its own (the log lives in the worker, not here), but a body
  // carrying it definitely is a failure.
  const leaked = results.filter((a) => /timeout exceeded when trying to connect/i.test(a.body));

  console.log(
    `\n${results.length - failures.length}/${results.length} passed  ` +
      `p50 ${p50}ms  p95 ${p95}ms  slowest ${slowest}ms`,
  );
  if (leaked.length > 0) {
    console.log(`${leaked.length} response(s) reported a connect timeout`);
  }

  if (failures.length > 0) {
    console.error(
      `\nFAILED: ${failures.length}/${results.length} polls did not complete cleanly.`,
    );
    process.exit(1);
  }
  console.log("all polls completed with no connect timeouts ✓");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
