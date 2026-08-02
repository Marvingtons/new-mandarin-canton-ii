import type { Metadata } from "next";
import LegalSection from "@/components/LegalSection";
import PhoneLinks from "@/components/PhoneLinks";
import SectionHeading from "@/components/SectionHeading";
import { fullAddress, restaurant } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";

/**
 * ⚠️ TEMPLATE DRAFTED FROM ACTUAL DATA PRACTICES. NOT LEGAL ADVICE. The
 * owner should have counsel review this before, or shortly after, launch.
 *
 * Short on purpose. This is a takeout restaurant that takes no money
 * online, so most of what a standard terms page covers does not exist
 * here: there is no account to terminate, no subscription, no refund
 * policy, no shipping, no digital goods, no user-generated content. Every
 * clause below corresponds to something that can actually happen at this
 * counter. Padding it out with inapplicable boilerplate would make the
 * parts that DO apply harder to find.
 *
 * TODO(family): 中文 body copy — see the note on /privacy.
 */

export const metadata: Metadata = {
  title: "Terms",
  alternates: { canonical: "/terms" },
  description:
    "The terms for ordering pickup from New Mandarin Canton II: orders are requests, you pay at the counter, and pickup times are estimates.",
};

/** Update by hand when the terms actually change. Never a live date. */
const LAST_UPDATED = "31 July 2026";

export default async function TermsPage() {
  const t = await getT();

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <SectionHeading as="h1" en={t("legal.terms")} />
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-ink/50">
        {t("legal.lastUpdated", { date: LAST_UPDATED })}
      </p>

      <p className="mt-8 leading-relaxed text-ink/80">
        These terms cover ordering pickup from {restaurant.name} through this
        website. They are short because the arrangement is simple: you tell us
        what you would like, we cook it, you collect it and pay at the counter.
      </p>

      <LegalSection en="An order is a request" zh="訂單屬於預訂">
        <p>
          Placing an order here is a request to the kitchen, not a completed
          sale. The sale happens at the counter when you collect the food and
          pay for it. Until then either side can call it off, and if we cannot
          make something we will call you on the number you verified.
        </p>
      </LegalSection>

      <LegalSection en="You pay at the counter" zh="到店付款">
        <p>
          We do not take payment online. Nothing on this website charges you,
          and no card details are collected at any point. You pay when you
          collect, by cash or card, at the restaurant.
        </p>
      </LegalSection>

      <LegalSection en="Prices and the menu" zh="價格與菜單">
        <p>
          Prices are as shown when you order, and tax is added at the counter
          where it applies. Dishes and prices can change, and something can run
          out during service. If a price or a dish has changed by the time you
          collect, we will tell you before you pay.
        </p>
      </LegalSection>

      <LegalSection en="Pickup times are estimates" zh="取餐時間僅供參考">
        <p>
          The time we quote is our honest estimate, not a guarantee. Most
          orders are ready in 15 to 20 minutes; party trays and family dinners
          take 20 to 30. A busy service can push either. We cook to order, so
          the food is made when the order lands rather than held under a lamp.
        </p>
      </LegalSection>

      <LegalSection en="Orders that are not collected" zh="未取餐的訂單">
        <p>
          We hold cooked food for a reasonable time and will try the number on
          the order. Food that is never collected has to be thrown away, for
          the obvious reason. Nothing was charged, so there is nothing to
          refund. If it keeps happening from the same number we may ask that
          future orders be placed by phone instead.
        </p>
      </LegalSection>

      <LegalSection en="Verifying your number" zh="電話驗證">
        <p>
          Every online order needs a working mobile number, confirmed by a code
          we text you. Standard message rates from your carrier may apply. If
          you would rather not receive a text, call the restaurant and order
          that way instead.
        </p>
      </LegalSection>

      <LegalSection en="Allergies" zh="食物過敏">
        <p>
          <strong className="font-semibold text-ink">
            Please call us before ordering if anyone eating has a food allergy.
          </strong>{" "}
          Do not rely on the special-instructions box for this. It is a note to
          the kitchen, not a safety check, and it does not reach anyone until
          the ticket prints. We cook many dishes in shared woks and shared oil,
          so we cannot promise any dish is free of a given ingredient. Speaking
          to someone is the only way to get a straight answer.
        </p>
      </LegalSection>

      <LegalSection en="Using this site" zh="網站使用規範">
        <p>
          Please use the site to order food you intend to collect. Do not place
          orders you do not mean to pick up, do not try to get around the phone
          verification or the ordering limits, and do not attempt to break into
          or disrupt the site. We may refuse or cancel an order, and may
          decline to take further orders from a number, if any of that happens.
        </p>
      </LegalSection>

      <LegalSection en="What we are responsible for" zh="責任範圍">
        <p>
          We stand behind the food we cook and serve. What we cannot take on is
          indirect loss beyond that: a website outage, a text that does not
          arrive, or an order that runs late is not something we can compensate
          beyond the food itself. Where the law gives you rights that cannot be
          signed away, this paragraph does not touch them.
        </p>
      </LegalSection>

      <LegalSection en="Governing law" zh="適用法律">
        <p>
          These terms are governed by the laws of the State of California, and
          the restaurant operates in San Diego County.
        </p>
      </LegalSection>

      <LegalSection en="Questions" zh="有疑問請聯絡">
        <p>Call the restaurant and speak to someone.</p>
        <p className="font-semibold text-lacquer">
          <PhoneLinks
            separator={` ${t("ui.or")} `}
            className="underline underline-offset-2"
          />
        </p>
        <p className="text-sm text-ink/60">{fullAddress}</p>
      </LegalSection>
    </div>
  );
}
