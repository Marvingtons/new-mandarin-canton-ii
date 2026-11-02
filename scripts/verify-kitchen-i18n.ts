/**
 * The staff area speaks through t(), and only through t().
 *
 *   npm run verify:kitchen-i18n
 *
 * Fails when:
 *   1. a raw, human-readable string reaches the UI in src/components/kitchen/**
 *      or src/app/[kitchenSlug]/** (the kitchen routes; the board lives at a
 *      configured slug, /kitchen by default). "Reaches the UI" means:
 *        - JSX text containing any letter (Latin or 中文);
 *        - a string or template literal with letters in a UI-bearing attribute
 *          (aria-label, title, placeholder, alt, …);
 *        - a string or template literal with letters RENDERED as a JSX child,
 *          directly or through ?:, &&, ||, ?? (not as an argument to a call:
 *          t("pos.print") is a key, not copy);
 *        - a literal with letters passed to setError / setNotice / setMessage;
 *        - any Han character in a string literal at all: 中文 belongs in the
 *          dictionary (dish names come from menu data, never from a literal).
 *   2. the two dictionaries do not have exactly the same keys;
 *   3. any dictionary value contains an em dash.
 *
 * Self-testing: before scanning the real tree it scans a known-bad fixture and
 * fails if the fixture is NOT flagged, so this check cannot quietly rot into a
 * check that passes everything.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { KITCHEN_DICTIONARIES } from "../src/lib/kitchen/i18n";

const ROOTS = [
  join(process.cwd(), "src", "components", "kitchen"),
  join(process.cwd(), "src", "app", "[kitchenSlug]"),
];

/** Attributes whose value a person reads or hears. */
const UI_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);

/** Setters whose argument is shown to staff. */
const UI_SETTERS = /^set(Error|Notice|Message|Status)$/;

const HAS_LETTER = /\p{L}/u;
const HAS_HAN = /\p{Script=Han}/u;

interface Finding {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("");
  }
  return null;
}

/**
 * Where does this literal END UP? Walk up through value-passing wrappers only
 * (?:, &&, ||, ??, +, parentheses, template spans). Reaching a JSX expression
 * means the literal IS what renders: as a child, or as an attribute's value.
 * A call, property access or comparison on the way means it is an input to
 * something else (t("pos.print") is a key, not copy), and returns null.
 */
function renderedAs(node: ts.Node): "child" | ts.JsxAttribute | null {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p; child = p, p = p.parent) {
    if (ts.isJsxAttribute(p)) return p;
    if (ts.isJsxExpression(p)) {
      if (p.parent && ts.isJsxAttribute(p.parent)) return p.parent;
      return p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent)) ? "child" : null;
    }
    if (ts.isParenthesizedExpression(p)) continue;
    if (ts.isConditionalExpression(p)) {
      if (child === p.condition) return null;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.PlusToken
      ) {
        continue;
      }
      return null;
    }
    if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) continue;
    return null;
  }
  return null;
}

function attributeName(attr: ts.JsxAttribute): string {
  return attr.name.getText();
}

export function scanSource(fileName: string, source: string): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const add = (node: ts.Node, text: string, rule: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: fileName, line: line + 1, text: text.trim().slice(0, 80), rule });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf);
      if (HAS_LETTER.test(text)) add(node, text, "raw JSX text");
    }

    const text = literalText(node);
    if (text !== null && !ts.isTemplateSpan(node.parent)) {
      if (HAS_HAN.test(text)) {
        add(node, text, "中文 in a string literal (use the dictionary)");
      } else if (HAS_LETTER.test(text)) {
        const target = renderedAs(node);
        if (target === "child") {
          add(node, text, "raw string rendered as a JSX child");
        } else if (target) {
          if (UI_ATTRIBUTES.has(attributeName(target))) add(node, text, `raw string in ${attributeName(target)}`);
        } else if (
          ts.isCallExpression(node.parent) &&
          ts.isIdentifier(node.parent.expression) &&
          UI_SETTERS.test(node.parent.expression.text)
        ) {
          add(node, text, `raw string passed to ${node.parent.expression.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(path);
  }
  return out;
}

/* ---------------------------------------------------------- self-test -- */

const BAD_FIXTURE = `
export function Bad({ on, t }: { on: boolean; t: (k: string) => string }) {
  const [, setError] = useState("");
  setError("Lost connection");
  return (
    <div className="flex" aria-label="Close">
      Hello there
      {on ? "Muted" : t("board.soundOn")}
      {\`\${3} orders\`}
      <input placeholder={"Search"} type="search" />
      <span>{"已取消"}</span>
    </div>
  );
}
`;

const GOOD_FIXTURE = `
export function Good({ n, t }: { n: number; t: (k: string, v?: object) => string }) {
  return (
    <div className="flex gap-2" id={\`pos-cat-\${n}\`} lang="zh-Hant">
      {t("pos.print")}
      {n > 0 ? t("board.footer", { n }) : null}
      ×{n} · {"#"}{n}
      <input type="tel" inputMode="tel" autoComplete="off" aria-label={t("pos.phone")} />
      <img alt={t("card.ticketAlt", { number: "A-001" })} src={\`/api/\${n}\`} />
    </div>
  );
}
`;

function selfTest(): boolean {
  const bad = scanSource("fixture-bad.tsx", BAD_FIXTURE);
  const good = scanSource("fixture-good.tsx", GOOD_FIXTURE);
  const expected = 7; // setError, aria-label, JSX text, "Muted", template, placeholder, 已取消
  const okBad = bad.length === expected;
  const okGood = good.length === 0;
  console.log(`self-test: known-bad fixture flagged ${bad.length}/${expected} ${okBad ? "✓" : "✗"}`);
  if (!okBad) for (const f of bad) console.log(`   ${f.line}: [${f.rule}] ${f.text}`);
  console.log(`self-test: known-good fixture flagged ${good.length}/0 ${okGood ? "✓" : "✗"}`);
  if (!okGood) for (const f of good) console.log(`   ${f.line}: [${f.rule}] ${f.text}`);
  return okBad && okGood;
}

/* --------------------------------------------------------------- main -- */

function main(): void {
  let failed = !selfTest();

  // 1. Raw strings in the kitchen area.
  const files = ROOTS.flatMap((root) => walk(root));
  const findings = files.flatMap((file) =>
    scanSource(relative(process.cwd(), file), readFileSync(file, "utf8")),
  );
  console.log(`\nscanned ${files.length} files under components/kitchen and app/[kitchenSlug]`);
  if (findings.length > 0) {
    failed = true;
    console.log(`✗ ${findings.length} raw UI string(s):`);
    for (const f of findings) console.log(`   ${f.file}:${f.line}  [${f.rule}]  ${JSON.stringify(f.text)}`);
  } else {
    console.log("✓ every UI string goes through t()");
  }

  // 2. Same keys in both languages.
  const [zhKeys, enKeys] = [
    Object.keys(KITCHEN_DICTIONARIES["zh-Hant"]),
    Object.keys(KITCHEN_DICTIONARIES.en),
  ];
  const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
  const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
  if (onlyZh.length || onlyEn.length) {
    failed = true;
    console.log(`✗ dictionaries disagree. only zh-Hant: ${onlyZh.join(", ")}; only en: ${onlyEn.join(", ")}`);
  } else {
    console.log(`✓ both dictionaries have the same ${zhKeys.length} keys`);
  }

  // 3. No em dashes, no empty values.
  for (const [lang, dict] of Object.entries(KITCHEN_DICTIONARIES)) {
    for (const [key, value] of Object.entries(dict)) {
      if (value.includes("—")) {
        failed = true;
        console.log(`✗ em dash in ${lang} ${key}: ${value}`);
      }
      if (value.trim() === "") {
        failed = true;
        console.log(`✗ empty value in ${lang} ${key}`);
      }
    }
  }
  if (!failed) console.log("✓ no em dashes in either dictionary");

  if (failed) {
    console.log("\nKITCHEN I18N CHECK FAILED");
    process.exit(1);
  }
  console.log("\nkitchen i18n: every string through t(), both languages complete ✓");
}

main();
