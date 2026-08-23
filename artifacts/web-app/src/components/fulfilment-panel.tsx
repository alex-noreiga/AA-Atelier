import type { OrderFulfilment } from "@workspace/api-client-react";
import { ArrowRight, MapPin } from "lucide-react";
import { formatDate } from "@/lib/format";
import { formatPickupWhen, fulfilmentStateNote } from "@/lib/fulfilment-format";

/**
 * "Where is my order?", answered on the tracking page — for a custom order and a
 * shop order alike, since both carry the same `OrderFulfilment`.
 *
 * Two shapes, and which one shows is the whole point. A **shipped** order gets
 * its carrier tracking number (linked when the atelier gave a URL), or, until it
 * goes out, the date it's expected to ship by. A **local pickup** — the skater
 * collecting at the studio or the rink — gets their collection time and place
 * instead. That order has no tracking number and never will, so a tracking panel
 * sitting permanently empty would read as the site being broken rather than as
 * "there is nothing to track".
 *
 * The server decides whether there's anything worth saying and omits the whole
 * object when there isn't, so this renders nothing rather than an empty state.
 */
export function FulfilmentPanel({
  fulfilment,
}: {
  fulfilment?: OrderFulfilment;
}) {
  if (!fulfilment) return null;

  const isPickup = fulfilment.method === "pickup";
  const stateNote = fulfilmentStateNote(
    fulfilment.state,
    isPickup ? "pickup" : "ship",
  );

  return isPickup ? (
    <PickupPanel fulfilment={fulfilment} stateNote={stateNote} />
  ) : (
    <ShippingPanel fulfilment={fulfilment} stateNote={stateNote} />
  );
}

/** The shell both variants share — the same card the deposit / invoice callouts
 * on this page use, so the panel reads as part of the set. */
function Panel({
  testId,
  label,
  children,
  notes,
}: {
  testId: string;
  label: string;
  children: React.ReactNode;
  notes: Array<React.ReactNode>;
}) {
  return (
    <div
      className="mt-12 rounded-2xl border border-border/60 p-6 text-center"
      data-testid={testId}
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {children}
      {notes.filter(Boolean).map((note, index) => (
        <p
          key={index}
          className="mt-2 text-sm font-light text-muted-foreground"
        >
          {note}
        </p>
      ))}
    </div>
  );
}

function ShippingPanel({
  fulfilment,
  stateNote,
}: {
  fulfilment: OrderFulfilment;
  stateNote: string;
}) {
  const { tracking, shipBy } = fulfilment;

  // Kept as `tracking-details` / `tracking-link` / `tracking-number`: this is
  // the same panel the shop orders have always shown, now shared.
  if (tracking) {
    return (
      <Panel
        testId="tracking-details"
        label={tracking.carrier ? `Tracking · ${tracking.carrier}` : "Tracking"}
        notes={[stateNote]}
      >
        {tracking.url ? (
          <a
            href={tracking.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-2 font-serif text-2xl text-primary hover:underline"
            data-testid="tracking-link"
          >
            <span>{tracking.number}</span>
            <ArrowRight className="w-4 h-4" />
          </a>
        ) : (
          <p className="mt-1 font-serif text-2xl" data-testid="tracking-number">
            {tracking.number}
          </p>
        )}
      </Panel>
    );
  }

  if (shipBy) {
    return (
      <Panel
        testId="ship-by-details"
        label="Expected to ship by"
        notes={[stateNote]}
      >
        <p className="mt-1 font-serif text-2xl" data-testid="ship-by-date">
          {formatDate(shipBy)}
        </p>
      </Panel>
    );
  }

  // Nothing but the atelier's own handoff state — the server wouldn't have sent
  // the object at all otherwise, so this always has something to say.
  return (
    <Panel testId="shipping-details" label="Shipping" notes={[]}>
      <p className="mt-1 font-serif text-2xl" data-testid="shipping-note">
        {stateNote}
      </p>
    </Panel>
  );
}

function PickupPanel({
  fulfilment,
  stateNote,
}: {
  fulfilment: OrderFulfilment;
  stateNote: string;
}) {
  const when = formatPickupWhen(
    fulfilment.pickup?.at,
    fulfilment.pickup?.timezone,
  );
  const location = fulfilment.pickup?.location;

  return (
    <Panel
      testId="pickup-details"
      label="Local pickup"
      notes={[
        location && (
          <span
            className="inline-flex items-center gap-2"
            data-testid="pickup-location"
          >
            <MapPin className="w-4 h-4" />
            {location}
          </span>
        ),
        stateNote,
        // Said once, plainly, because "why haven't I got a tracking number?" is
        // the question this panel exists to answer.
        "This order is being collected in person, so there's no tracking number to follow.",
      ]}
    >
      <p className="mt-1 font-serif text-2xl" data-testid="pickup-time">
        {when || "We'll arrange a pickup time with you"}
      </p>
    </Panel>
  );
}
