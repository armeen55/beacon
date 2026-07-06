import { describe, expect, it } from "vitest";

import {
  composeLocalSchema,
  hasLocalBusinessIdentity,
  type LocalBusinessFacts,
} from "./local-schema";

function facts(over: Partial<LocalBusinessFacts> = {}): LocalBusinessFacts {
  return {
    name: "Acme Plumbing",
    address: "123 Main St, Oakland, CA",
    phone: "+1-510-555-0100",
    domain: "acme-plumbing.com",
    areaServed: ["Oakland", "Fremont"],
    ...over,
  };
}

describe("hasLocalBusinessIdentity", () => {
  it("false with no name (never a LocalBusiness without a name)", () => {
    expect(hasLocalBusinessIdentity(facts({ name: "" }))).toBe(false);
  });

  it("false with a name but no address, phone, or served area (that is just an Organization)", () => {
    expect(
      hasLocalBusinessIdentity(facts({ address: "", phone: "", areaServed: [] })),
    ).toBe(false);
  });

  it("true with a name + an address only", () => {
    expect(
      hasLocalBusinessIdentity(facts({ phone: "", areaServed: [] })),
    ).toBe(true);
  });

  it("true with a name + a served area only", () => {
    expect(
      hasLocalBusinessIdentity(facts({ address: "", phone: "" })),
    ).toBe(true);
  });
});

describe("composeLocalSchema", () => {
  it("EMPTY / NO-OP: returns null for a tenant with no local identity (content tenant)", () => {
    expect(
      composeLocalSchema({
        pageUrl: "https://x.com/page",
        facts: facts({ name: "Encyclopedia", address: "", phone: "", areaServed: [] }),
      }),
    ).toBeNull();
  });

  it("emits valid LocalBusiness JSON-LD from configured facts (city page, no Service)", () => {
    const jsonLd = composeLocalSchema({
      pageUrl: "https://acme-plumbing.com/oakland",
      facts: facts(),
    });
    expect(jsonLd).not.toBeNull();
    // Round-trips through JSON (proves it is valid, serializable JSON-LD).
    const round = JSON.parse(JSON.stringify(jsonLd));
    expect(round["@context"]).toBe("https://schema.org");
    const graph = round["@graph"];
    expect(Array.isArray(graph)).toBe(true);
    const lb = graph.find((g: { "@type": string }) => g["@type"] === "LocalBusiness");
    expect(lb).toBeDefined();
    expect(lb.name).toBe("Acme Plumbing");
    expect(lb["@id"]).toBe("https://acme-plumbing.com#business");
    expect(lb.url).toBe("https://acme-plumbing.com");
    expect(lb.telephone).toBe("+1-510-555-0100");
    expect(lb.address["@type"]).toBe("PostalAddress");
    expect(lb.address.streetAddress).toBe("123 Main St, Oakland, CA");
    expect(lb.areaServed).toHaveLength(2);
    expect(lb.areaServed[0]).toEqual({ "@type": "City", name: "Oakland" });
    // No Service block when no service is passed.
    expect(graph.find((g: { "@type": string }) => g["@type"] === "Service")).toBeUndefined();
  });

  it("adds a Service block naming the service + areaServed on a service page", () => {
    const jsonLd = composeLocalSchema({
      pageUrl: "https://acme-plumbing.com/drain-cleaning-oakland",
      facts: facts(),
      service: "Drain Cleaning",
    });
    const round = JSON.parse(JSON.stringify(jsonLd));
    const svc = round["@graph"].find((g: { "@type": string }) => g["@type"] === "Service");
    expect(svc).toBeDefined();
    expect(svc.name).toBe("Drain Cleaning");
    // Service points back at the LocalBusiness by @id (one graph, linked).
    expect(svc.provider).toEqual({ "@id": "https://acme-plumbing.com#business" });
    expect(svc.areaServed).toHaveLength(2);
  });

  it("never invents fields it lacks: omits telephone / address when unset", () => {
    const jsonLd = composeLocalSchema({
      pageUrl: "https://acme.com/oakland",
      facts: facts({ phone: "", address: "" }),
    });
    const round = JSON.parse(JSON.stringify(jsonLd));
    const lb = round["@graph"][0];
    expect(lb.telephone).toBeUndefined();
    expect(lb.address).toBeUndefined();
    // Still valid: areaServed carries the identity.
    expect(lb.areaServed).toHaveLength(2);
  });

  it("falls back to the page URL as the anchor when no domain is configured", () => {
    const jsonLd = composeLocalSchema({
      pageUrl: "https://acme.com/oakland",
      facts: facts({ domain: "" }),
    });
    const round = JSON.parse(JSON.stringify(jsonLd));
    expect(round["@graph"][0].url).toBe("https://acme.com/oakland");
  });

  it("is generic: works for an arbitrary vertical + city (no hardcoding)", () => {
    const jsonLd = composeLocalSchema({
      pageUrl: "https://petpros.com/dog-grooming-austin",
      facts: {
        name: "PetPros",
        address: "5 Elm St, Austin, TX",
        phone: "512-555-0000",
        domain: "petpros.com",
        areaServed: ["Austin"],
      },
      service: "Dog Grooming",
    });
    const round = JSON.parse(JSON.stringify(jsonLd));
    const svc = round["@graph"].find((g: { "@type": string }) => g["@type"] === "Service");
    expect(svc.name).toBe("Dog Grooming");
    expect(round["@graph"][0].areaServed[0].name).toBe("Austin");
  });
});
