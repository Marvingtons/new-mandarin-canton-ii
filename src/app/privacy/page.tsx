import type { Metadata } from "next";
import LegalSection from "@/components/LegalSection";
import PhoneLinks from "@/components/PhoneLinks";
import SectionHeading from "@/components/SectionHeading";
import { fullAddress } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";

/**
 * ⚠️ TEMPLATE DRAFTED FROM ACTUAL DATA PRACTICES. NOT LEGAL ADVICE. The
 * owner should have counsel review this before, or shortly after, launch.
 *
 * Every claim below was read out of the code rather than borrowed from a
 * boilerplate policy, and the sources are named inline so the next person
 * can re-check them. That is the whole point: a policy describing
 * practices this site does not have is worse than none, because it is a
 * published statement that happens to be false.
 *
 * WHEN THE CODE CHANGES, THIS PAGE IS PART OF THE CHANGE. In particular:
 * adding any analytics or ad script, an email field, a payment step, a
 * marketing SMS, or a retention/purge job all falsify a sentence here.
 *
 * TODO(family): 中文 body copy. The headers are bilingual; the body is
 * English only until someone in the family reviews a translation. A
 * machine-translated privacy policy is not a translation anyone should
 * rely on.
 */

export const metadata: Metadata = {
  title: "Privacy",
  alternates: { canonical: "/privacy" },
  description:
    "What New Mandarin Canton II collects when you order pickup online, who else sees it, and how long it is kept.",
};

/** Update by hand when the policy actually changes. Never a live date. */
const LAST_UPDATED = "31 July 2026";

export default async function PrivacyPage() {
  const t = await getT();

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <SectionHeading as="h1" en={t("legal.privacy")} />
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-ink/50">
        {t("legal.lastUpdated", { date: LAST_UPDATED })}
      </p>

      <p className="mt-8 leading-relaxed text-ink/80">
        This is a small family restaurant, and this website does one thing:
        it takes pickup orders. We collect what the kitchen needs to cook
        your food and hand it to the right person, and nothing else. There
        is no advertising on this site, no analytics, and nothing here is
        sold or shared for marketing.
      </p>

      <LegalSection en="What we collect" zh="我們收集的資料">
        <p>When you place an order, we collect:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold text-ink">Your name.</strong> So
            we know whose bag is whose at the counter.
          </li>
          <li>
            <strong className="font-semibold text-ink">
              Your mobile number.
            </strong>{" "}
            We text you a code to confirm the number works. Because there is
            no payment online, a verified number is the only thing that makes
            an order real, and it is how the kitchen reaches you if there is a
            question. We also use it to limit how many orders one number can
            place in a day.
          </li>
          <li>
            <strong className="font-semibold text-ink">
              The code you type back.
            </strong>{" "}
            It goes straight to our SMS provider to be checked. We never store
            it.
          </li>
          <li>
            <strong className="font-semibold text-ink">Your order.</strong>{" "}
            Dishes, sizes, options, quantities, your chosen pickup time, and
            the total.
          </li>
          <li>
            <strong className="font-semibold text-ink">
              Anything you type into special instructions.
            </strong>{" "}
            That box is free text and it is stored and printed exactly as you
            wrote it, so please do not put anything in it you would not want
            printed on a ticket in a kitchen.
          </li>
        </ul>
      </LegalSection>

      <LegalSection en="What we never collect" zh="我們不會收集的資料">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold text-ink">
              No payment details, ever.
            </strong>{" "}
            You pay at the counter when you collect. This website has no card
            field and no payment processor connected to it. We could not take
            a card number if you tried to give us one.
          </li>
          <li>No email addresses. There is no email field anywhere.</li>
          <li>
            No accounts and no passwords. You never make an account to order.
          </li>
          <li>
            No delivery address and no location data. Pickup only, so we never
            ask where you are.
          </li>
          <li>
            No analytics, no advertising scripts, no tracking pixels, and no
            third-party cookies. There is no Google Analytics, no Meta pixel,
            and no tag manager on this site.
          </li>
          <li>No marketing texts and no mailing list.</li>
        </ul>
      </LegalSection>

      <LegalSection en="Who else sees it" zh="哪些第三方會接觸到">
        <p>
          A few services are needed to run the site. Each one gets only the
          piece it needs:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold text-ink">Twilio</strong> sends
            and checks the verification code, and sends the text that says
            your order is ready. It receives your phone number. It does not
            receive your name or what you ordered.
          </li>
          <li>
            <strong className="font-semibold text-ink">Cloudflare</strong>{" "}
            hosts the site, so all traffic to it passes through Cloudflare.
          </li>
          <li>
            <strong className="font-semibold text-ink">Supabase</strong> is the
            database where order records are stored.
          </li>
          <li>
            <strong className="font-semibold text-ink">
              The kitchen&apos;s receipt printer.
            </strong>{" "}
            Your ticket carries your name, your number and your order. The
            printer collects it from private storage at an address that cannot
            be guessed, and the file is deleted as soon as the ticket prints,
            and automatically within 24 hours in any case.
          </li>
          <li>
            <strong className="font-semibold text-ink">Google Maps.</strong>{" "}
            The map on our contact page and in the footer is embedded from
            Google, so when it loads, your browser talks to Google directly and
            Google can see your IP address and which page you are on. Nothing
            about your order is sent to it. The map only loads when you scroll
            to it.
          </li>
        </ul>
        <p>
          Our page fonts are served from our own site, so loading a page here
          does not contact a font service.
        </p>
      </LegalSection>

      <LegalSection en="Cookies" zh="Cookie">
        <p>
          Every cookie this site sets is strictly functional, first-party,
          and cannot be read by JavaScript in your browser. There is no
          cookie banner because there is nothing optional to agree to.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            One that records that this browser just verified this phone
            number, so the order can be filed under a number we know is real.
            It lasts 15 minutes.
          </li>
          <li>
            One that remembers this browser has already proved this number, so
            you can skip the text message next time. It lasts up to 90 days.
          </li>
          <li>
            Two staff-only cookies, for the kitchen screen and for testing.
            These are never set for a customer.
          </li>
        </ul>
      </LegalSection>

      <LegalSection en="Addresses and logs" zh="網路位址與紀錄">
        <p>
          Your IP address is held briefly, in memory only, to limit how many
          verification codes can be requested at once. It is never written to
          our database, never written to a log, and never shared. It
          disappears on its own.
        </p>
        <p>
          Our hosting keeps server logs for diagnosing problems, mainly with
          the kitchen printer. Those logs record things like order numbers and
          error codes. Customer names and phone numbers are deliberately kept
          out of them.
        </p>
      </LegalSection>

      <LegalSection en="How long we keep it" zh="保存期限">
        <p>
          Order records are kept as business records, and at present they are
          not deleted automatically. Print files are the exception and are
          removed within a day. If you would like your order history removed,
          call us and ask. We will need to confirm the phone number the orders
          were placed under, because that number is the only thing tying them
          to you.
        </p>
      </LegalSection>

      <LegalSection en="Contact us" zh="聯絡我們">
        <p>
          There is no privacy form and no ticketing system. Call the
          restaurant and speak to someone.
        </p>
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
