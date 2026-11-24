"use client";

import { useEffect, useState } from "react";
import { STATIONS, type Station } from "@/config/stations";
import type { Order } from "@/lib/orders/types";
import Icon from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import Segmented from "@/components/kitchen/ui/Segmented";
import ui from "@/components/kitchen/ui/ui.module.css";

interface ChangeTicketChoice {
  id: string;
  toRevision: number;
  printedAt: string | null;
  failedAt: string | null;
}

/**
 * 重印, with the printer chosen. The order's current station is preselected,
 * so the everyday reprint is still one tap on "Reprint"; picking the other
 * printer is how staff route around one that is out of paper.
 *
 * 改單: an order that has had change tickets also offers each of them (newest
 * first): the stored ticket prints again, byte for byte. The full ticket stays
 * preselected, so the everyday reprint is unchanged.
 */
export default function ReprintDialog({
  order,
  onReprint,
  onClose,
}: {
  order: Pick<Order, "orderNumber" | "station"> & Partial<Pick<Order, "id" | "changeCount" | "revision">>;
  onReprint: (station: Station, changeTicketId?: string) => void;
  onClose: () => void;
}) {
  const t = useKT();
  const [station, setStation] = useState<Station>(order.station);
  const [what, setWhat] = useState<string>("full");
  const [changes, setChanges] = useState<ChangeTicketChoice[]>([]);
  // The board counts change tickets; History only knows the order was edited.
  const hasChanges = ((order.changeCount ?? 0) > 0 || (order.revision ?? 0) > 0) && order.id !== undefined;
  useEffect(() => {
    if (!hasChanges) return;
    const controller = new AbortController();
    fetch(`/api/kitchen/orders/${order.id}/revisions`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { changeTickets?: ChangeTicketChoice[] } | null) => {
        // Only a ticket that printed or gave up can be printed again; a waiting one is still on its way.
        setChanges((data?.changeTickets ?? []).filter((c) => c.printedAt || c.failedAt).slice(0, 3));
      })
      .catch(() => {
        /* the full ticket is still offered */
      });
    return () => controller.abort();
  }, [hasChanges, order.id]);

  return (
    <Dialog title={t("reprint.title", { number: order.orderNumber })} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onReprint(station, what === "full" ? undefined : what);
        }}
      >
        {changes.length > 0 && (
          <fieldset className="flex flex-col gap-2" data-reprint-what>
            <legend className="mb-2 text-staff-body font-semibold">{t("reprint.what")}</legend>
            <Segmented
              label={t("reprint.what")}
              value={what}
              onChange={setWhat}
              options={[
                { value: "full", label: t("reprint.full") },
                ...changes.map((c) => ({ value: c.id, label: t("reprint.change", { n: c.toRevision }) })),
              ]}
            />
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-staff-body font-semibold">{t("reprint.which")}</legend>
          <Segmented
            label={t("reprint.which")}
            value={station}
            onChange={setStation}
            options={STATIONS.map((s) => ({
              value: s,
              label: (
                <>
                  <Icon name={s === "online" ? "globe" : "store"} size={20} />
                  {t("station.printer", { station: t(`station.${s}`) })}
                  {s === order.station && <span className={ui.count}>{t("reprint.current")}</span>}
                </>
              ),
            }))}
          />
        </fieldset>
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {t("confirm.keep")}
          </Button>
          <Button type="submit" variant="primary" icon="printer">
            {t("reprint.send")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
