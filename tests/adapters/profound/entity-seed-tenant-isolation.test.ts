import { describe, expect, it } from "vitest";
import { buildEntitySeed } from "@/adapters/profound/entity-seed";

describe("Profound entity seed tenant isolation", () => {
  it("uses only the explicit tenant identity and configured competitor domains", () => {
    const iranopedia = buildEntitySeed("tenant-iranopedia", {
      name: "Iranopedia",
      domain: "www.iranopedia.com",
      primaryCompetitors: ["https://example.org/about", "Wikipedia"],
    });

    const owned = iranopedia.entities.filter((entity) => entity.is_owned);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      account_id: "tenant-iranopedia",
      name: "Iranopedia",
      domain: "iranopedia.com",
    });
    expect(iranopedia.ownedDomains).toEqual(["iranopedia.com"]);
    expect(
      iranopedia.entities.find((entity) => entity.domain === "example.org"),
    ).toMatchObject({ account_id: "tenant-iranopedia", is_owned: false });
    expect(
      iranopedia.entities.some((entity) =>
        entity.domain?.includes("ritzbuilders"),
      ),
    ).toBe(false);
  });

  it("fails closed when the tenant business identity is incomplete", () => {
    expect(() =>
      buildEntitySeed("tenant-a", {
        name: "Tenant A",
        domain: "",
        primaryCompetitors: [],
      }),
    ).toThrow(/valid tenant business domain/);
    expect(() =>
      buildEntitySeed("tenant-b", {
        name: "",
        domain: "tenant-b.example",
        primaryCompetitors: [],
      }),
    ).toThrow(/tenant business name/);
  });
});
