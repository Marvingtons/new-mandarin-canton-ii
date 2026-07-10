/**
 * Bridge between the homepage's hero ScrollTrigger and the Header:
 * the choreography flips this when the hero exits, so the header's
 * transparent→solid switch rides the same trigger instead of its own
 * threshold. (The header keeps a plain scroll fallback for
 * reduced-motion visitors, where no triggers exist.)
 */
let solid = false;
const subscribers = new Set<() => void>();

export function setHeaderSolid(value: boolean): void {
  if (value === solid) return;
  solid = value;
  subscribers.forEach((cb) => cb());
}

export function subscribeHeaderSolid(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getHeaderSolid(): boolean {
  return solid;
}
