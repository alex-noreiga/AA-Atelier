// One-time backfill of the `payments` ledger from Stripe.
//
// The ledger starts empty, and nothing else in the studio holds what it needs:
// the Notion invoice records THAT a stage was paid and never when, and a shop
// order carries a session id but no instant. So Stripe is not merely the most
// convenient source for the history — it is the ONLY place the dates exist. Run
// this once after `db:migrate` and every month before the deploy has real
// figures instead of a wall of zeroes.
//
// Two sweeps:
//   1. Checkout sessions → one `charge` row each, keyed on the session id. The
//      session metadata says which order (and, for a custom order, which stage)
//      it belonged to — the same metadata the live webhook path reads, so a
//      backfilled row is indistinguishable from one recorded live.
//   2. Refunds → one `refund` row each, keyed on the refund id, attributed via
//      the payment-intent → order map built during sweep 1. A refund against an
//      intent no sweep-1 session claimed is REPORTED, never guessed at.
//
// Idempotent by construction: every row carries the Stripe object's own id and
// the table's partial unique index on `external_id` makes a re-run a no-op. It
// is therefore also safe to run against a ledger the live path has already been
// writing to — the two can only agree.
//
// Runs OUT-OF-BAND against the DIRECT connection, and stays self-contained (no
// app-source imports, so it runs under `node --experimental-strip-types`):
//
//   STRIPE_SECRET_KEY=… POSTGRES_URL_NON_POOLING=… \
//     pnpm --filter @workspace/api-server db:backfill-payments [-- --dry-run] [-- --since=2026-01-01]
//
// NOTE it reads whichever Stripe MODE the key belongs to. Run it with the live
// key for real history; a test key backfills test payments and nothing else.

import path from "node:path";
import postgres from "postgres";
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const SINCE = process.argv
  .find((arg) => arg.startsWith("--since="))
  ?.slice("--since=".length);

/** The metadata kind the custom-order payment flow stamps on its sessions. */
const CUSTOM_PAYMENT_KIND = "custom_payment";

interface OrderRef {
  orderNumber: string;
  orderKind: "custom" | "shop";
  stage: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Which order a Checkout session belongs to, or null when it isn't one of ours.
 *
 * A session with no `orderNumber` metadata predates the minted numbers and has
 * nothing to attribute it to — skipped and counted, never filed under a guess.
 */
function orderRefOf(session: Stripe.Checkout.Session): OrderRef | null {
  const orderNumber = session.metadata?.orderNumber?.trim();
  if (!orderNumber) return null;

  if (session.metadata?.kind === CUSTOM_PAYMENT_KIND) {
    return {
      orderNumber,
      orderKind: "custom",
      stage: session.metadata?.stage?.trim() ?? "",
    };
  }
  return { orderNumber, orderKind: "shop", stage: "" };
}

/** The instant the money moved: the charge's, where the expanded intent gives
 * it, else the instant checkout was opened. Same rule as the live path. */
function chargePaidAt(session: Stripe.Checkout.Session): Date {
  const intent = session.payment_intent;
  const created =
    intent && typeof intent !== "string" && typeof intent.created === "number"
      ? intent.created
      : session.created;
  return new Date(created * 1000);
}

function intentIdOf(
  intent: string | Stripe.PaymentIntent | null | undefined,
): string {
  if (!intent) return "";
  return typeof intent === "string" ? intent : intent.id;
}

async function main(): Promise<void> {
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  const sql = postgres(requireEnv("POSTGRES_URL_NON_POOLING"), {
    prepare: false,
    max: 1,
  });

  const createdFilter = SINCE
    ? { created: { gte: Math.floor(new Date(SINCE).getTime() / 1000) } }
    : {};

  // payment intent id → the order its session belonged to, so sweep 2 can
  // attribute a refund without a second lookup per refund.
  const orderByIntent = new Map<string, OrderRef>();

  let chargesSeen = 0;
  let chargesWritten = 0;
  let chargesUnattributed = 0;
  let chargesUnpaid = 0;

  console.log(
    `Sweeping Checkout sessions${SINCE ? ` created on/after ${SINCE}` : ""}…`,
  );

  for await (const session of stripe.checkout.sessions.list({
    limit: 100,
    // Expanded so `paid_at` is the instant of the charge rather than of the
    // checkout being opened — the same precision the live shop path gets.
    expand: ["data.payment_intent"],
    ...createdFilter,
  })) {
    if (session.payment_status !== "paid") {
      chargesUnpaid += 1;
      continue;
    }
    chargesSeen += 1;

    const ref = orderRefOf(session);
    if (!ref) {
      chargesUnattributed += 1;
      console.warn(
        `  ! session ${session.id} is paid but carries no order number — skipped`,
      );
      continue;
    }

    const intentId = intentIdOf(session.payment_intent);
    if (intentId) orderByIntent.set(intentId, ref);

    const amount = session.amount_total ?? 0;
    if (amount <= 0) continue; // a fully-promo session captured nothing

    if (DRY_RUN) {
      chargesWritten += 1;
      continue;
    }

    const inserted = await sql`
      insert into payments (
        order_number, order_kind, stage, kind, amount_cents, currency,
        method, paid_at, external_id, payment_intent_id, note
      ) values (
        ${ref.orderNumber}, ${ref.orderKind}, ${ref.stage}, 'charge',
        ${amount}, ${session.currency ?? "usd"}, 'stripe',
        ${chargePaidAt(session).toISOString()}, ${session.id}, ${intentId},
        'backfilled from Stripe'
      )
      on conflict (external_id) where external_id <> '' do nothing
      returning id
    `;
    if (inserted.length > 0) chargesWritten += 1;
  }

  let refundsSeen = 0;
  let refundsWritten = 0;
  let refundsUnattributed = 0;

  console.log("Sweeping refunds…");

  for await (const refund of stripe.refunds.list({
    limit: 100,
    ...createdFilter,
  })) {
    refundsSeen += 1;
    const intentId = intentIdOf(refund.payment_intent);
    const ref = intentId ? orderByIntent.get(intentId) : undefined;

    if (!ref) {
      // Either the refund is older than `--since`, or its session carried no
      // order number. Say so rather than filing it under a guessed order — a
      // misattributed refund silently understates one order and overstates
      // another.
      refundsUnattributed += 1;
      console.warn(
        `  ! refund ${refund.id} (intent ${intentId || "none"}) matched no ` +
          `backfilled session — skipped, attribute it by hand if it matters`,
      );
      continue;
    }

    const amount = refund.amount ?? 0;
    if (amount <= 0) continue;
    if (DRY_RUN) {
      refundsWritten += 1;
      continue;
    }

    const inserted = await sql`
      insert into payments (
        order_number, order_kind, stage, kind, amount_cents, currency,
        method, paid_at, external_id, payment_intent_id, note
      ) values (
        ${ref.orderNumber}, ${ref.orderKind}, ${ref.stage}, 'refund',
        ${-amount}, ${refund.currency ?? "usd"}, 'stripe',
        ${new Date(refund.created * 1000).toISOString()}, ${refund.id},
        ${intentId}, 'backfilled from Stripe'
      )
      on conflict (external_id) where external_id <> '' do nothing
      returning id
    `;
    if (inserted.length > 0) refundsWritten += 1;
  }

  await sql.end({ timeout: 5 });

  console.log(
    [
      "",
      DRY_RUN ? "DRY RUN — nothing was written." : "Backfill complete.",
      `  paid sessions:        ${chargesSeen} (${chargesUnpaid} unpaid, skipped)`,
      `  charges recorded:     ${chargesWritten}`,
      `  sessions unattributed:${chargesUnattributed}`,
      `  refunds seen:         ${refundsSeen}`,
      `  refunds recorded:     ${refundsWritten}`,
      `  refunds unattributed: ${refundsUnattributed}`,
      "",
      "Rows already present were left alone (the ledger dedupes on the Stripe",
      "object id), so this is safe to re-run.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
