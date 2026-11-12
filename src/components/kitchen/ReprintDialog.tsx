"use client";

import { useState } from "react";
import { STATIONS, type Station } from "@/config/stations";
import type { Order } from "@/lib/orders/types";
import Icon from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import Segmented from "@/components/kitchen/ui/Segmented";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * 重印, with the printer chosen. The order's current station is preselected,
 * so the everyday reprint is still one tap on "Reprint"; picking the other
 * printer is how staff route around one that is out of paper.
 */
export default function ReprintDialog({
  order,
  onReprint,
  onClose,
}: {
  order: Pick<Order, "orderNumber" | "station">;
  onReprint: (station: Station) => void;
  onClose: () => void;
}) {
  const t = useKT();
  const [station, setStation] = useState<Station>(order.station);

  return (
    <Dialog title={t("reprint.title", { number: order.orderNumber })} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onReprint(station);
        }}
      >
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
