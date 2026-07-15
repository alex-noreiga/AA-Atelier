import { formatPrice } from "@/lib/format";

/**
 * A label/amount row for receipts and invoices (shop-success + invoice pages).
 * Amount is in dollars and rendered through `formatPrice`.
 */
export function ReceiptRow({
  label,
  amount,
}: {
  label: string;
  amount: number;
}) {
  return (
    <div className="flex justify-between text-sm text-muted-foreground">
      <span>{label}</span>
      <span>{formatPrice(amount)}</span>
    </div>
  );
}
