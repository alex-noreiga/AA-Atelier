// The hand-off from a customer request to the tool that actions it.
//
// The request queue and the tools are two panels on one page, and the whole
// point of the queue is that a request carries its own order number to the tool
// rather than the atelier re-typing it. So the request panel doesn't RUN
// anything: it fills the matching tool card and leaves the press — and, for the
// two refunds, the confirmation step with the number echoed back — exactly where
// it already lived. One place moves money, and it still asks first.
//
// The `nonce` is what makes the hand-off repeatable. Pressing the same
// request's action twice, or two requests naming the same order, would
// otherwise be an identical object that the tool card has no way to tell from
// the one it already applied — so the card would not re-scroll, and worse,
// would not re-arm a confirmation the atelier had dismissed.

/** One request handing its own argument to a tool card. */
export interface ToolHandoff {
  /** The `StudioTool` name, as the server derived it from the request kind. */
  tool: string;
  /** For the order-scoped tools. */
  orderNumber?: string;
  /** For the back-in-stock sweep. */
  item?: string;
  /** Distinguishes one hand-off from the next; see the header. */
  nonce: number;
}

let counter = 0;

/** Stamp a hand-off so each press is distinguishable from the last. */
export function toolHandoff(handoff: Omit<ToolHandoff, "nonce">): ToolHandoff {
  counter += 1;
  return { ...handoff, nonce: counter };
}
