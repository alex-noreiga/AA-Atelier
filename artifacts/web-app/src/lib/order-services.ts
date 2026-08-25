// The intake service catalog, as the order form consumes it.
//
// The catalog itself lives in server code (`api-server/src/lib/service-catalog.ts`)
// and is served by `GET /services`, because the same entries gate `POST /orders`
// — a repair that the form stops asking measurements for is a repair the server
// stops requiring them from, and one definition is what keeps those in step.
// This module holds only what the *browser* has to decide: what to do while that
// list isn't there.

import type { Service } from "@workspace/api-client-react";

/**
 * How the form behaves when the catalog can't be read — while `GET /services`
 * is in flight, if it errors, or against a deployment that predates it.
 *
 * It is the bespoke commission's shape: the widest form, and exactly what every
 * order form asked for before services existed. `required: false` is the part
 * that matters — with no catalog there is nothing to pick from, so the picker is
 * hidden and the customer is never blocked behind a choice the page can't offer.
 * The server resolves an order with no `service` to a bespoke commission too, so
 * the degraded path is coherent end to end rather than merely non-fatal.
 */
export const SERVICE_FALLBACK: ServiceRules = {
  required: false,
  measurements: true,
  colors: true,
  detailsRequired: false,
  detailsLabel: "Description",
  detailsHelp:
    "Tell us about your vision: style, silhouette, special requirements...",
  // `true`, unlike the other flags, is NOT the widest option here — it is the
  // one that matches the server. An order with no `service` resolves to the
  // bespoke commission on the way in, so the capacity gate applies to it; a
  // fallback of `false` would show the intake form to someone whose order the
  // server would then refuse with a 409. The catalog failing to load is not a
  // reason to promise an order the studio can't take.
  capacityGated: true,
};

/** What the form needs to know about the chosen service to render + validate. */
export interface ServiceRules {
  /** Whether a service must be picked before the customer can continue. */
  required: boolean;
  measurements: boolean;
  colors: boolean;
  detailsRequired: boolean;
  detailsLabel: string;
  detailsHelp: string;
  /** Whether this service is paused when the studio's books are closed. */
  capacityGated: boolean;
}

/**
 * The rules in force: the picked service's, or the bespoke fallback when the
 * catalog is unavailable. A loaded catalog with nothing picked yet still reports
 * `required: true`, which is what makes the picker a gate rather than a default.
 */
export function serviceRules(
  services: Service[],
  picked: string | undefined,
): ServiceRules {
  if (services.length === 0) return SERVICE_FALLBACK;
  const match = services.find((service) => service.id === picked);
  // Nothing picked yet: `required: true` makes the picker a gate, and
  // `capacityGated: false` keeps the closed-books panel from appearing before
  // the customer has chosen anything — it is an answer about a service, and
  // there isn't one yet.
  if (!match)
    return { ...SERVICE_FALLBACK, required: true, capacityGated: false };
  return {
    required: true,
    measurements: match.measurements,
    colors: match.colors,
    detailsRequired: match.detailsRequired,
    detailsLabel: match.detailsLabel,
    detailsHelp: match.detailsHelp,
    capacityGated: match.capacityGated,
  };
}

/**
 * The service id a `/order?service=<id>` deep link asks for — the Services
 * page's per-card links, mirroring `/appointments?type=<id>`. Returns undefined
 * for a missing or unrecognized id, so a stale link lands on the picker rather
 * than on a silently wrong form.
 */
export function requestedServiceId(
  search: string,
  services: Service[],
): string | undefined {
  const requested = new URLSearchParams(search).get("service");
  if (!requested) return undefined;
  return services.find((service) => service.id === requested)?.id;
}
