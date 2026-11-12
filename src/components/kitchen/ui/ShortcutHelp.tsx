"use client";

import type { KitchenKey } from "@/lib/kitchen/i18n";
import { useKT } from "@/components/kitchen/KitchenI18n";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import Button from "@/components/kitchen/ui/Button";
import ui from "@/components/kitchen/ui/ui.module.css";

/** Every shortcut in the staff app, in one list. The board's work only on the board. */
const GROUPS: { keys: string[]; label: KitchenKey }[][] = [
  [
    { keys: ["J", "↓"], label: "shortcuts.next" },
    { keys: ["K", "↑"], label: "shortcuts.prev" },
    { keys: ["A"], label: "card.accept" },
    { keys: ["C"], label: "card.complete" },
    { keys: ["P"], label: "card.reprint" },
    { keys: ["X"], label: "card.cancel" },
    { keys: ["1", "2", "3"], label: "shortcuts.station" },
    { keys: ["/"], label: "shortcuts.search" },
  ],
  [
    { keys: ["N"], label: "shortcuts.newOrder" },
    { keys: ["B"], label: "shortcuts.board" },
    { keys: ["H"], label: "shortcuts.history" },
    { keys: ["M"], label: "shortcuts.mute" },
    { keys: ["?"], label: "shortcuts.help" },
  ],
];

export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useKT();
  return (
    <Dialog title={t("shortcuts.title")} onClose={onClose}>
      <p className={ui.dialogText}>{t("shortcuts.focusNote")}</p>
      {GROUPS.map((group) => (
        <dl key={group[0].label} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          {group.map((row) => (
            <div key={row.label} className="contents">
              <dt className="flex gap-1">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-9 min-w-9 items-center justify-center rounded-staff-tag bg-staff-sunken px-2 text-staff-body font-semibold"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-staff-body">{t(row.label)}</dd>
            </div>
          ))}
        </dl>
      ))}
      <div className={ui.dialogActions}>
        <Button variant="primary" onClick={onClose}>
          {t("shortcuts.close")}
        </Button>
      </div>
    </Dialog>
  );
}
