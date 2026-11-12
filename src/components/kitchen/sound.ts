/**
 * THE STAFF APP'S ONE AUDIO CONTEXT, and the rules iPad Safari makes us follow.
 *
 * Safari (and every iPadOS browser, which are all WebKit) will not start audio
 * until the page has had a user gesture: an AudioContext made earlier is born
 * "suspended", and resume() outside a gesture is quietly refused. It also drops
 * a running context to "suspended" / "interrupted" when the tablet sleeps, the
 * tab goes to the background, or another app takes the audio session. So:
 *
 *   unlockAudio()        call INSIDE a tap (the "Enable sound" button, the
 *                        bell, the M key). Creates the context, resumes it,
 *                        and plays one silent sample, which is what older
 *                        WebKit needs before it will play anything else.
 *   resumeOnNextTap()    installed once by the shell: every tap or key press
 *                        that finds the context not running resumes it, so a
 *                        context the iPad suspended comes back with the next
 *                        touch of the screen instead of staying silent.
 *   playChime()          the three-note arrival chime. Asks to resume first;
 *                        harmless if that is refused.
 *
 * iPadOS 17+ also mutes Web Audio with the silent switch / Control Centre bell
 * unless the page declares itself playback audio (navigator.audioSession), so
 * that is set when available: an order chime is not a notification sound to
 * be silenced.
 *
 * Client-only. Nothing here runs on the server.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function ctor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = ctor();
  if (!Ctor) return null;
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch {
    /* older iPadOS: the silent switch may mute the chime; nothing to do */
  }
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** True when this browser can make sound at all. */
export function audioSupported(): boolean {
  return ctor() !== null;
}

/**
 * Unlock audio. MUST be called synchronously from a user gesture handler:
 * the context is created and resumed, and the silent sample started, before
 * the first await, which is what WebKit checks.
 */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  const resumed = c.state === "running" ? Promise.resolve() : c.resume();
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0);
  } catch {
    /* the resume alone is enough on current WebKit */
  }
  try {
    await resumed;
  } catch {
    return false;
  }
  return c.state === "running";
}

/**
 * Resume a suspended context on the next tap or key press. Returns the
 * cleanup. Capture phase, passive: it never interferes with the tap itself.
 */
export function resumeOnNextTap(): () => void {
  const wake = () => {
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      void ctx.resume().catch(() => {
        /* refused: the next tap tries again */
      });
    }
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const events = ["pointerdown", "touchend", "keydown"] as const;
  for (const e of events) window.addEventListener(e, wake, opts);
  return () => {
    for (const e of events) window.removeEventListener(e, wake, opts);
  };
}

/** The arrival chime: three rising sine notes, nothing to download. */
export function playChime(): void {
  const c = context();
  if (!c) return;
  try {
    if (c.state !== "running") {
      void c.resume().catch(() => {
        /* no gesture yet: resumeOnNextTap brings it back */
      });
    }
    for (const [index, freq] of [880, 1320, 1760].entries()) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = c.currentTime + index * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    }
  } catch {
    /* audio unavailable: the toast and the highlight still fire */
  }
}
