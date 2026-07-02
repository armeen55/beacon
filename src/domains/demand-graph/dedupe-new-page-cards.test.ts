import { describe, it, expect } from "vitest";
import { dedupeNewPageCards, type DedupableCard } from "./dedupe-new-page-cards";

const card = (o: Partial<DedupableCard> & { id: string; topic: string }): DedupableCard => ({
  searchVolume: null,
  score: 0,
  ...o,
});

describe("dedupeNewPageCards", () => {
  it("operator ground-truth: collapses reordered duplicate restaurant queries into ONE card, keeping the real search-volume number", () => {
    const cards = [
      card({ id: "a", topic: "Restaurants in Tehran", searchVolume: 1200, score: 40 }),
      card({ id: "b", topic: "Tehran Restaurants", searchVolume: null, score: 55 }),
    ];
    const { kept, dropped } = dedupeNewPageCards(cards);
    expect(kept.length).toBe(1);
    expect(kept[0].id).toBe("a"); // real volume wins over a higher proxy score
    expect(dropped.length).toBe(1);
    expect(dropped[0].id).toBe("b");
  });

  it("keeps two DIFFERENT topics separate", () => {
    const cards = [
      card({ id: "a", topic: "Persian Wedding Traditions", searchVolume: 1900, score: 40 }),
      card({ id: "b", topic: "Persian Literature", searchVolume: 390, score: 30 }),
    ];
    const { kept } = dedupeNewPageCards(cards);
    expect(kept.length).toBe(2);
  });

  it("when neither side has a real search volume, keeps the higher score", () => {
    const cards = [
      card({ id: "a", topic: "Nowruz Activities USA", searchVolume: null, score: 20 }),
      card({ id: "b", topic: "Nowruz Activities in the USA", searchVolume: null, score: 45 }),
    ];
    const { kept } = dedupeNewPageCards(cards);
    expect(kept.length).toBe(1);
    expect(kept[0].id).toBe("b");
  });

  it("never merges two generic labels with no distinguishing tokens (falls back to exact identity)", () => {
    const cards = [card({ id: "a", topic: "Guide", score: 5 }), card({ id: "b", topic: "Tips", score: 5 })];
    const { kept } = dedupeNewPageCards(cards);
    expect(kept.length).toBe(2);
  });

  it("returns input order for non-duplicate cards", () => {
    const cards = [card({ id: "a", topic: "Persian Gardens" }), card({ id: "b", topic: "Persian Mythology" })];
    const { kept } = dedupeNewPageCards(cards);
    expect(kept.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
