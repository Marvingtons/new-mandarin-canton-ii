"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { restaurant, telHref } from "@/data/restaurant";

/**
 * Clover hosted-iframe payment fields. Card data is entered inside Clover's
 * cross-origin iframes and never touches our page or server — we only receive
 * a clv_ token from createToken().
 *
 * CVV is mandatory (Clover requires it to tokenize). If the SDK can't load or
 * the public key is missing/invalid, we render an error plus a tel: fallback
 * and never a hand-rolled card form.
 */

export interface CloverPaymentHandle {
  /** Tokenize the entered card. Resolves to a clv_ token or throws. */
  tokenize: () => Promise<string>;
  ready: boolean;
}

interface CloverPaymentProps {
  sdkUrl: string;
  publicToken: string | null;
  merchantId: string | null;
}

type FieldKey = "CARD_NUMBER" | "CARD_DATE" | "CARD_CVV" | "CARD_POSTAL_CODE";

const FIELDS: { key: FieldKey; mount: string; label: string }[] = [
  { key: "CARD_NUMBER", mount: "card-number", label: "Card number" },
  { key: "CARD_DATE", mount: "card-date", label: "Expiry" },
  { key: "CARD_CVV", mount: "card-cvv", label: "CVV" },
  { key: "CARD_POSTAL_CODE", mount: "card-postal", label: "ZIP" },
];

// Style object for the iframe inputs — the iframe cannot inherit page CSS, so
// we hand it colors/typography that match the lacquer/gold/ivory system.
const ELEMENT_STYLES = {
  body: { fontFamily: "Georgia, 'Times New Roman', serif" },
  input: {
    fontSize: "16px",
    color: "#1e150f",
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
  "input::placeholder": { color: "#1e150f80" },
};

interface CloverElement {
  mount: (selector: string) => void;
  addEventListener: (evt: string, cb: (e: unknown) => void) => void;
}
interface CloverElements {
  create: (type: string, styles: unknown) => CloverElement;
}
interface CloverInstance {
  elements: () => CloverElements;
  createToken: () => Promise<{
    token?: string;
    errors?: Record<string, unknown>;
  }>;
}
type CloverCtor = new (
  token: string,
  opts?: { merchantId?: string },
) => CloverInstance;

function loadSdk(url: string): Promise<CloverCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Clover?: CloverCtor };
    if (w.Clover) return resolve(w.Clover);
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-clover-sdk]`,
    );
    const onLoad = () => {
      if (w.Clover) resolve(w.Clover);
      else reject(new Error("Clover SDK loaded but global missing"));
    };
    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", () =>
        reject(new Error("Clover SDK failed to load")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.cloverSdk = "true";
    script.addEventListener("load", onLoad);
    script.addEventListener("error", () =>
      reject(new Error("Clover SDK failed to load")),
    );
    document.head.appendChild(script);
  });
}

const CloverPayment = forwardRef<CloverPaymentHandle, CloverPaymentProps>(
  function CloverPayment({ sdkUrl, publicToken, merchantId }, ref) {
    const cloverRef = useRef<CloverInstance | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    );
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const misconfigured = !publicToken || !merchantId;

    useEffect(() => {
      if (misconfigured) {
        setStatus("error");
        return;
      }
      let cancelled = false;
      loadSdk(sdkUrl)
        .then((Clover) => {
          if (cancelled) return;
          const clover = new Clover(publicToken as string, {
            merchantId: merchantId as string,
          });
          const elements = clover.elements();
          for (const f of FIELDS) {
            const el = elements.create(f.key, ELEMENT_STYLES);
            el.mount(`#${f.mount}`);
            el.addEventListener("change", (e: unknown) => {
              const evt = e as { error?: string };
              setFieldErrors((prev) => ({ ...prev, [f.key]: evt?.error ?? "" }));
            });
          }
          cloverRef.current = clover;
          setStatus("ready");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
      return () => {
        cancelled = true;
      };
    }, [sdkUrl, publicToken, merchantId, misconfigured]);

    useImperativeHandle(
      ref,
      () => ({
        ready: status === "ready",
        tokenize: async () => {
          const clover = cloverRef.current;
          if (!clover) throw new Error("Payment form is not ready.");
          const result = await clover.createToken();
          if (result.errors && Object.keys(result.errors).length > 0) {
            const errs: Record<string, string> = {};
            for (const [k, v] of Object.entries(result.errors)) {
              const val = v as { error?: string } | string;
              errs[k] = typeof val === "string" ? val : val?.error ?? "Invalid";
            }
            setFieldErrors(errs);
            throw new Error("Please correct your card details.");
          }
          if (!result.token) throw new Error("Card could not be verified.");
          return result.token;
        },
      }),
      [status],
    );

    if (status === "error") {
      return (
        <div className="border border-lacquer/40 bg-lacquer/5 px-4 py-4 text-sm">
          <p className="font-semibold text-lacquer">
            Online payment isn&apos;t available right now.
          </p>
          <p className="mt-1 text-ink/75">
            {misconfigured
              ? "The payment form isn't configured yet."
              : "We couldn't load the secure payment form."}{" "}
            Please call us to place your pickup order:
          </p>
          <a
            href={telHref}
            className="mt-2 inline-block font-semibold text-lacquer underline underline-offset-2"
          >
            Call {restaurant.phone}
          </a>
        </div>
      );
    }

    return (
      <div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div
              key={f.key}
              className={f.key === "CARD_NUMBER" ? "sm:col-span-2" : ""}
            >
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                {f.label}
              </label>
              <div
                id={f.mount}
                className="min-h-12 border border-gold/50 bg-ivory px-3 py-3"
              />
              {fieldErrors[f.key] && (
                <p className="mt-1 text-xs text-lacquer">{fieldErrors[f.key]}</p>
              )}
            </div>
          ))}
        </div>
        {status === "loading" && (
          <p className="mt-2 text-sm text-ink/55">Loading secure payment…</p>
        )}
      </div>
    );
  },
);

export default CloverPayment;
