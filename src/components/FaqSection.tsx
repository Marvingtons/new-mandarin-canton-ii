import JsonLd from "@/components/JsonLd";
import SectionHeading from "@/components/SectionHeading";
import { sharedLastOnlineOrder } from "@/data/restaurant";
import type { TranslationKey } from "@/lib/i18n/dictionary";
import { getT } from "@/lib/i18n/server";
import { faqNode, graph } from "@/lib/schema";

/**
 * The questions, as key PAIRS.
 *
 * ⚠️ ONE LIST, TWO OUTPUTS. The visible <dl> and the FAQPage schema are
 * both built from this array in the same render, which is what makes
 * "the markup matches the visible text" a property of the code rather
 * than a thing somebody has to remember. Google requires that match and
 * penalises the absence of it; a second hand-written copy of these
 * answers would drift the first time one was reworded.
 *
 * Order is deliberate: the question that costs a customer a wasted drive
 * (do you deliver) is first, and the one that matters most when the
 * answer is wrong (allergies) is last, where it is the thing left on the
 * screen.
 */
const QUESTIONS: { q: TranslationKey; a: TranslationKey }[] = [
  { q: "faq.q.delivery", a: "faq.a.delivery" },
  { q: "faq.q.howLong", a: "faq.a.howLong" },
  { q: "faq.q.phone", a: "faq.a.phone" },
  { q: "faq.q.pay", a: "faq.a.pay" },
  { q: "faq.q.onlineCutoff", a: "faq.a.onlineCutoff" },
  { q: "faq.q.food", a: "faq.a.food" },
  { q: "faq.q.where", a: "faq.a.where" },
  { q: "faq.q.allergies", a: "faq.a.allergies" },
];

/**
 * Plain questions, plainly answered — for the guest who wants one fact
 * without reading the site, and for the answer engine that will only
 * ever read text.
 *
 * A <dl> rather than a heading stack: these are eight term/definition
 * pairs, which is the one thing a definition list is for, and it keeps
 * the page's heading outline at h1 → h2 instead of adding eight h3s that
 * mean nothing in an outline.
 *
 * No accordion. Collapsed answers are answers a crawler may not count as
 * visible, and eight short paragraphs do not need hiding.
 */
export default async function FaqSection({
  className = "",
}: {
  className?: string;
}) {
  const t = await getT();

  /* The cutoff question is dropped entirely when the days stop agreeing
     on one time, rather than printing one number over a week that has
     two. Same discipline as the footer line it restates — see
     sharedLastOnlineOrder. */
  const entries = QUESTIONS.filter(
    (item) => item.q !== "faq.q.onlineCutoff" || sharedLastOnlineOrder,
  ).map((item) => ({
    question: t(item.q),
    answer: t(item.a, { time: sharedLastOnlineOrder ?? "" }),
  }));

  return (
    <section className={className}>
      <SectionHeading en={t("faq.title")} />
      {/* Same graph envelope as everywhere else. It carries only the
          FAQPage node: the business and the site are already stated once
          in the root layout, and repeating them here would be two
          descriptions of one restaurant on one page. */}
      <JsonLd data={graph(faqNode(entries))} />
      <dl className="mt-8 space-y-7">
        {entries.map((entry) => (
          <div key={entry.question}>
            <dt className="font-display text-lg text-lacquer">
              {entry.question}
            </dt>
            <dd className="mt-2 max-w-2xl leading-relaxed text-ink/75">
              {entry.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
