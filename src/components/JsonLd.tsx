/**
 * One JSON-LD block, server-rendered.
 *
 * A server component so the markup is in the HTML a crawler receives on
 * the first byte — an answer engine will not run this site's JavaScript,
 * and structured data injected after hydration is structured data that
 * does not exist.
 *
 * `dangerouslySetInnerHTML` is required and is safe here: the content is
 * `JSON.stringify` output, never a template of interpolated strings, and
 * every value in it originates in this repo's own typed data files
 * rather than in user input. The `<` escape is belt and braces — a `<`
 * inside a JSON string value would otherwise be read by the HTML parser
 * as the start of a tag and could close the script early.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
