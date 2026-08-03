# /about — content removed from display, kept in the repo

Two blocks came off the About page. Neither was deleted: the strings are
untouched in `src/lib/i18n/dictionary.ts` in both locales, and this file
records what was on the page, why it came off, and what putting it back
involves.

Nothing here is a decision the family has been asked about and answered.
It is a decision made ON THEIR BEHALF, which is exactly why it is written
down rather than absorbed into a diff.

---

## 1. The 中文 story

Three paragraphs of Traditional Chinese sat directly under the English
story, set quieter, with no rule or label between them — the same
bilingual pattern the notices use, at the length of a story.

**Keys, still present:** `about.storyP1Zh`, `about.storyP2LeadZh`,
`about.storyP2Zh`, `about.storyP3Zh` (identical in the `en` and `es`
tables — the Chinese never moves, only the half beside it does).

**Markup, as it stood:**

```tsx
<div
  lang="zh-Hant"
  className="mt-9 space-y-4 font-chinese leading-loose text-ink/60"
>
  <p>{t("about.storyP1Zh")}</p>
  <p>
    {yearsZh && t("about.storyP2LeadZh", { years: yearsZh })}
    {t("about.storyP2Zh")}
  </p>
  <p>{t("about.storyP3Zh")}</p>
</div>
```

`yearsZh` came from `yearsInChinese(yearsOpen())` in `@/lib/years` — that
import and the local were removed with the block and come back with it.
`leading-loose` was not decoration: Noto Serif TC at that size needs more
air between lines than Lora does, and a wall of 漢字 at `leading-relaxed`
reads as one block rather than as paragraphs.

**Why it came off:** the English story is the story. The Chinese was a
Simplified → Traditional conversion of what the family wrote, and it had
been sitting on the page with an open review flag against it.

**What this closed:** the `TODO(confirm): Traditional conversion pending
family review` flag, in both places it appeared — the block comment in
`src/app/about/page.tsx` and the `ABOUT PAGE` comment in the dictionary.
It is retired, not answered: nothing is waiting on that review while
nothing renders. It comes back with the block.

**Still open, and not ours to close:** `story.threeGenerationsZh` — the
signature line's 中文 half in the About pull-quote — still renders, and
still carries `TODO(confirm): Traditional wording`. It is now the only
Chinese on the page, which contradicts the rule under which it was
allowed there ("a line of it alone on a page with no other Chinese would
be an ornament"). Flagged in the source; the family's call.

---

## 2. The memorial paragraph

Behind a `border-t border-gold/30` rule, separated from the family's text
on purpose so that nothing there read as something they wrote.

**Key, still present:** `about.memorial`, in both locales. No 中文 half,
deliberately — inventing Chinese for unapproved English would make it
harder, not easier, for them to say no.

**English, verbatim:**

> A restaurant open this long outlives some of the people who built it.
> When one of the original owners passed away, someone who had worked
> here since the early days became an owner and kept it open. The kitchen
> carried on as it was.

**Spanish, verbatim:** see `about.memorial` in the `es` table.

**Markup, as it stood:**

```tsx
<div className="mt-12 border-t border-gold/30 pt-8">
  <p className="leading-relaxed text-ink/70">{t("about.memorial")}</p>
</div>
```

**Why it came off:** it was never theirs. It was drafted before their
history arrived, kept "because it may well be true", and carried the open
question *story alone, or story + memorial*. A paragraph about somebody's
death, written by a stranger and never approved by the people it is
about, does not get to sit on their About page while a question mark
hangs over it.

**What this closed:** `TODO(confirm): family to choose — story alone, or
story + memorial`, in both places it appeared (the page and the
dictionary). Closed **with an answer**: story alone.

---

## Putting either back

1. Uncomment or re-paste the markup above into `src/app/about/page.tsx`,
   at the marker comment that replaced them.
2. For the 中文 block only: restore `yearsInChinese` to the import from
   `@/lib/years` and the `yearsZh` local beside `spelled`.
3. Reopen the matching flag. The 中文 block's Traditional conversion has
   still never been reviewed by the family; the Simplified original they
   actually wrote is preserved verbatim in the block comment at the top
   of `src/app/about/page.tsx`, and that is what a reviewer diffs against.
