import { phoneLinks } from "@/data/restaurant";

interface PhoneLinksProps {
  /** Class applied to each `tel:` link. */
  className?: string;
  /** Separator between numbers. */
  separator?: string;
  /** Prefix the first number, e.g. "Call ". */
  prefix?: string;
}

/**
 * Both restaurant numbers, each a tappable `tel:` link, in the order the
 * printed menu lists them.
 *
 * Both lines are staffed. A customer who cannot get through on the first
 * should be able to see and tap the second without hunting, so every "call
 * us" surface renders the whole list rather than just the primary.
 *
 * `tap` is added to every link here rather than at the five call sites,
 * because the reason is the same at all of them: these are 21px-tall
 * links inside running prose (/privacy, /terms, /404, the confirmation
 * and the checkout), and a phone number is the one thing on a legal page
 * somebody actually reaches for. The target becomes 44px tall; the text
 * does not move. Verified at 390 that the pair renders on ONE line at
 * every call site, which is the condition .tap requires — see the
 * warning in globals.css.
 */
export default function PhoneLinks({
  className = "",
  separator = " · ",
  prefix,
}: PhoneLinksProps) {
  return (
    <>
      {prefix}
      {phoneLinks.map(({ phone, href }, i) => (
        <span key={phone}>
          {i > 0 && <span aria-hidden="true">{separator}</span>}
          <a href={href} className={`tap ${className}`}>
            {phone}
          </a>
        </span>
      ))}
    </>
  );
}
