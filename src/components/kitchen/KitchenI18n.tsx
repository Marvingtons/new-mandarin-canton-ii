"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  KITCHEN_LANG_COOKIE,
  KITCHEN_LANG_STORAGE_KEY,
  isKitchenLang,
  kt,
  type KitchenLang,
  type KitchenT,
} from "@/lib/kitchen/i18n";

/**
 * Language for the staff area, per device.
 *
 * THE CHOICE LIVES IN localStorage, and is MIRRORED to a cookie. The server
 * reads the cookie (lib/kitchen/i18n.server) and renders in that language, so
 * server HTML, the first client render and the stored preference all agree:
 * no hydration mismatch and no flash of the wrong language. The mirror is
 * re-written on mount, so a tablet whose cookie was cleared but whose storage
 * survived converges on the stored choice and stays there.
 */

interface KitchenI18nValue {
  lang: KitchenLang;
  setLang: (lang: KitchenLang) => void;
  t: KitchenT;
}

const KitchenI18nContext = createContext<KitchenI18nValue | null>(null);

function writeCookie(lang: KitchenLang) {
  // A year, path-wide so every kitchen route sends it. Not httpOnly: it is a
  // display preference the client owns, not a credential.
  document.cookie = `${KITCHEN_LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export function KitchenI18nProvider({
  initialLang,
  children,
}: {
  initialLang: KitchenLang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<KitchenLang>(initialLang);

  // Converge on the stored preference after mount. In the normal case the
  // cookie already said the same thing and this changes nothing.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KITCHEN_LANG_STORAGE_KEY);
      if (isKitchenLang(stored)) {
        writeCookie(stored);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (stored !== initialLang) setLangState(stored);
      } else {
        localStorage.setItem(KITCHEN_LANG_STORAGE_KEY, initialLang);
        writeCookie(initialLang);
      }
    } catch {
      /* storage unavailable: the cookie alone still carries the choice */
    }
  }, [initialLang]);

  const setLang = useCallback((next: KitchenLang) => {
    setLangState(next);
    try {
      localStorage.setItem(KITCHEN_LANG_STORAGE_KEY, next);
    } catch {
      /* non-fatal */
    }
    writeCookie(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<KitchenI18nValue>(
    () => ({ lang, setLang, t: (key, vars) => kt(lang, key, vars) }),
    [lang, setLang],
  );

  return <KitchenI18nContext.Provider value={value}>{children}</KitchenI18nContext.Provider>;
}

export function useKitchenI18n(): KitchenI18nValue {
  const value = useContext(KitchenI18nContext);
  if (!value) throw new Error("useKitchenI18n must be used inside KitchenI18nProvider");
  return value;
}

/** The staff area's t(). */
export function useKT(): KitchenT {
  return useKitchenI18n().t;
}
