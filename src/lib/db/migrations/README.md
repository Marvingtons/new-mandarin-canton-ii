# Migrations

Numbered SQL files, applied by hand in order against the production database
(`001` … `017`; `016` is the 日結 daily report, PR #14; `017` the 改單 edit history, PR #15). `down_*` files are the verified way back for the step they
name. `../schema.sql` is the shape a fresh database gets in one go, meant to
equal every migration applied in order.

## Unused since dine-in was retired (2026-11-14)

The POS no longer takes seated dine-in orders. That commit changed code only:
**no migration was written and nothing was dropped or altered.** These are
now unused by the application and can be dropped in a later migration once
nobody needs the historical rows' table data:

| Object | Added in | What it held |
| --- | --- | --- |
| `orders.table_label` | `010_dine_in.sql` | The table, "4" or "4+5" |
| `orders.guest_count` | `010_dine_in.sql` | Party size |
| `orders.is_addon` | `010_dine_in.sql` | A later round for a seated party (加菜) |
| `orders.table_cleared_at` | `010_dine_in.sql` | When staff cleared the table (清台) |
| `orders_guest_count_check` | `010_dine_in.sql` | `guest_count >= 1` |
| `orders_open_tables_idx` | `010_dine_in.sql` | Partial index for the floor plan's open tables |
| `'dine_in'` in `orders_channel_check` | `010_dine_in.sql` | The channel value |

Nothing reads or writes the four columns any more: `createOrder` no longer
inserts them (they take their defaults, NULL / false) and the order read path
no longer selects them.

**`'dine_in'` must stay in `orders_channel_check` for as long as any row
carries it.** Historical dine-in orders are still read and shown: the code
keeps `dine_in` as a valid `OrderChannel` (see `src/lib/orders/types.ts`), maps
it to the store printer, and renders it in History and on the board as a plain
store order under the name it was stored with ("Table 4"). Removing the value
from the constraint first requires deleting or re-labelling those rows.

When the drop is written, it is one migration plus its `down_` file, and
`schema.sql` loses the same lines.
