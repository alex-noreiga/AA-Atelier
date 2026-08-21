import { describe, it, expect } from "vitest";
import {
  DEFAULT_SERVICE_ID,
  ORDER_SERVICES,
  getOrderService,
  getServiceOptions,
  resolveOrderService,
} from "../../src/lib/service-catalog.js";

describe("service catalog", () => {
  it("offers the four advertised services, the commission first", () => {
    expect(ORDER_SERVICES.map((s) => s.id)).toEqual([
      "bespoke",
      "alterations",
      "rhinestoning",
      "repairs",
    ]);
    // The first entry is the default an order with no service resolves to, and
    // the frontend documents it as such.
    expect(ORDER_SERVICES[0].id).toBe(DEFAULT_SERVICE_ID);
  });

  it("asks for body measurements only for a garment made from scratch", () => {
    expect(getOrderService("bespoke")?.measurements).toBe(true);
    for (const id of ["alterations", "rhinestoning", "repairs"]) {
      expect(getOrderService(id)?.measurements).toBe(false);
    }
  });

  it("requires the free-text brief for work on a piece the customer owns", () => {
    expect(getOrderService("bespoke")?.detailsRequired).toBe(false);
    for (const id of ["alterations", "rhinestoning", "repairs"]) {
      expect(getOrderService(id)?.detailsRequired).toBe(true);
    }
  });

  it("resolves an absent or unknown service to the bespoke commission", () => {
    // An old client, or an id we've since retired, keeps the widest form and
    // the gate it always had rather than silently losing one.
    expect(resolveOrderService(undefined).id).toBe("bespoke");
    expect(resolveOrderService("").id).toBe("bespoke");
    expect(resolveOrderService("embroidery").id).toBe("bespoke");
    expect(resolveOrderService("repairs").id).toBe("repairs");
  });

  it("keeps the atelier-facing wording off the served catalog", () => {
    const { services } = getServiceOptions();
    expect(services).toHaveLength(ORDER_SERVICES.length);
    for (const option of services) {
      expect(option).not.toHaveProperty("orderLabel");
      expect(option).not.toHaveProperty("emailIntro");
    }
    expect(services[0]).toMatchObject({
      id: "bespoke",
      measurements: true,
      colors: true,
      detailsRequired: false,
    });
  });
});
