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
          <a href={href} className={className}>
            {phone}
          </a>
        </span>
      ))}
    </>
  );
}
