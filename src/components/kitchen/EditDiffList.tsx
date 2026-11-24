"use client";

import type { OrderLine } from "@/lib/orders/types";
import type { ChangedLine, OrderLinesDiff } from "@/lib/orders/revisionDiff";
import { useKT } from "@/components/kitchen/KitchenI18n";

/**
 * A 改單 diff in the words the change ticket prints: + / - / 改 blocks, each
 * only when it has lines, then "其餘不變 N". Shared by the POS confirm sheet
 * and the History card's edit history, so the screen and the paper read the
 * same way. 中文 first on every dish, as everywhere on the staff screens.
 */

function dishName(line: OrderLine): { zh: string | null; en: string } {
  return { zh: line.nameZh, en: line.nameEn };
}

function sizeName(line: OrderLine): string {
  return line.sizeLabelZh ?? line.sizeLabel;
}

function optionNames(line: OrderLine): string {
  return line.modifiers.map((m) => m.nameZh ?? m.nameEn).join(" ") || "-";
}

/** "2 → 3", "餐盤 → 半盤", "白飯 → 炒飯", "備註 加辣 → 走辣". */
export function changeMoves(ch: ChangedLine, noteLabel: string): string[] {
  const moves: string[] = [];
  for (const field of ch.fields) {
    if (field === "quantity") moves.push(`${ch.before.quantity} → ${ch.after.quantity}`);
    if (field === "size") moves.push(`${sizeName(ch.before)} → ${sizeName(ch.after)}`);
    if (field === "modifiers") moves.push(`${optionNames(ch.before)} → ${optionNames(ch.after)}`);
    if (field === "note") {
      moves.push(
        `${noteLabel} ${(ch.before.specialInstructions ?? "").trim() || "-"} → ${(ch.after.specialInstructions ?? "").trim() || "-"}`,
      );
    }
  }
  return moves;
}

function Row({ line, strike, moves }: { line: OrderLine; strike?: boolean; moves?: string[] }) {
  const name = dishName(line);
  return (
    <li className="flex items-start gap-3 border-t border-staff-line py-2.5 first:border-t-0">
      <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-staff-tag bg-staff-ink px-2 text-staff-body font-bold text-staff-panel">
        ×{line.quantity}
      </span>
      <span className="min-w-0 flex-1">
        <span lang={name.zh ? "zh-Hant" : "en"} className={`block text-staff-title leading-snug font-semibold ${strike ? "line-through decoration-[3px]" : ""}`}>
          {name.zh ?? name.en}
        </span>
        {name.zh && (
          <span lang="en" className="block text-staff-caption text-staff-soft">
            {name.en}
          </span>
        )}
        {moves?.map((move) => (
          <span key={move} className="mt-1 mr-2 inline-block rounded-staff-tag px-2.5 py-0.5 text-staff-body font-bold shadow-[inset_0_0_0_2px_var(--color-staff-ink)]">
            {move}
          </span>
        ))}
      </span>
    </li>
  );
}

export default function EditDiffList({ diff, compact = false }: { diff: OrderLinesDiff; compact?: boolean }) {
  const t = useKT();
  const head = `${compact ? "mt-2" : "mt-4"} mb-1 border-b border-staff-line pb-1 text-staff-body font-bold`;
  return (
    <div data-edit-diff>
      {diff.added.length > 0 && (
        <section data-block="added">
          <h3 className={head}>{t("edit.confirm.added")}</h3>
          <ul>
            {diff.added.map((line, i) => (
              <Row key={`a${i}`} line={line} />
            ))}
          </ul>
        </section>
      )}
      {diff.removed.length > 0 && (
        <section data-block="removed">
          <h3 className={head}>{t("edit.confirm.removed")}</h3>
          <ul>
            {diff.removed.map((line, i) => (
              <Row key={`r${i}`} line={line} strike />
            ))}
          </ul>
        </section>
      )}
      {diff.changed.length > 0 && (
        <section data-block="changed">
          <h3 className={head}>{t("edit.confirm.changed")}</h3>
          <ul>
            {diff.changed.map((ch, i) => (
              <Row key={`c${i}`} line={ch.after} moves={changeMoves(ch, t("edit.confirm.note"))} />
            ))}
          </ul>
        </section>
      )}
      <p className="mt-3 text-staff-caption text-staff-soft">{t("edit.confirm.unchanged", { n: diff.unchangedCount })}</p>
    </div>
  );
}
