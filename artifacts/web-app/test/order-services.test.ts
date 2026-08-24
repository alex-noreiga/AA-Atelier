import { describe, it, expect } from "vitest";
import { serviceList } from "@workspace/test-fixtures";
import {
  requestedServiceId,
  serviceRules,
  SERVICE_FALLBACK,
} from "@/lib/order-services";

const services = serviceList().services;

describe("serviceRules", () => {
  it("falls back to the bespoke shape, un-gated, when the catalog is empty", () => {
    // The degraded path: nothing to pick from, so nothing may be required.
    expect(serviceRules([], "repairs")).toEqual(SERVICE_FALLBACK);
    expect(serviceRules([], undefined).required).toBe(false);
  });

  it("requires a pick once the catalog has loaded but none is chosen", () => {
    const rules = serviceRules(services, undefined);
    expect(rules.required).toBe(true);
    // Until they choose, the form still shows the widest set of fields.
    expect(rules.measurements).toBe(true);
  });

  it("takes the chosen service's rules", () => {
    expect(serviceRules(services, "repairs")).toEqual({
      required: true,
      measurements: false,
      colors: false,
      detailsRequired: true,
      detailsLabel: "The piece and what needs repairing",
      detailsHelp: "Tell us what's happened to it...",
      // A repair is worked on a piece the customer already owns, so it keeps
      // taking orders when the commission book is full.
      capacityGated: false,
    });
  });

  it("treats an unknown id as no choice at all, not as a service", () => {
    // A stale deep link must not silently pick a shape for the customer.
    expect(serviceRules(services, "embroidery").required).toBe(true);
    expect(serviceRules(services, "embroidery").measurements).toBe(true);
  });
});

describe("requestedServiceId", () => {
  it("reads a known service from the query string", () => {
    expect(requestedServiceId("?service=repairs", services)).toBe("repairs");
    expect(requestedServiceId("service=bespoke", services)).toBe("bespoke");
  });

  it("ignores a missing or unrecognized service", () => {
    expect(requestedServiceId("", services)).toBeUndefined();
    expect(requestedServiceId("?type=fitting", services)).toBeUndefined();
    expect(requestedServiceId("?service=embroidery", services)).toBeUndefined();
  });
});
