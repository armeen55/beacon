import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "./extractor";

const TENANT = "tenant-test";
const URL = "https://example.com/page";

function wrapHtml(bodyInner: string): string {
  return `<!doctype html><html><head><title>Test Page</title></head><body>${bodyInner}</body></html>`;
}

describe("extractPageSnapshot - body_paragraph_sample (N19)", () => {
  it("extracts real <p> tags as before when they carry real text", () => {
    const html = wrapHtml(`
      <main>
        <p>This is the first real paragraph and it has more than eight words in it.</p>
        <p>This is the second real paragraph, also long enough to count as content.</p>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-1", TENANT);
    expect(snap.body_paragraph_sample).toBeDefined();
    expect(snap.body_paragraph_sample).toHaveLength(2);
    expect(snap.body_paragraph_sample![0]).toContain("first real paragraph");
  });

  it("drops <p> tags below the word-count floor (captions, tiny footers)", () => {
    const html = wrapHtml(`
      <main>
        <p>Too short.</p>
        <p>This one, however, has plenty of words to clear the eight word floor easily.</p>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-2", TENANT);
    expect(snap.body_paragraph_sample).toHaveLength(1);
  });

  // Regression: real Iranopedia /persian-kabobs/* pages ship <p> tags that
  // hold nothing but a zero-width space (an editor placeholder), not real
  // content. Ground-truthed live 2026-07-02, 10 such <p> tags, 0 real text.
  // These must NOT count as paragraphs, and must NOT trigger the div/span
  // fallback either (the page genuinely has no server-rendered body copy;
  // fabricating "content" from decorative wrapper divs would be worse than
  // reporting zero).
  it("treats zero-width-space-only <p> tags as empty, not real paragraphs", () => {
    const zwsp = "​".repeat(20);
    const html = wrapHtml(`
      <main>
        <h1>Kabob Barg</h1>
        <p>${zwsp}</p>
        <p>${zwsp}</p>
        <p>${zwsp}</p>
        <div><span>Kabob Barg</span></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-3", TENANT);
    expect(snap.body_paragraph_sample ?? []).toHaveLength(0);
  });

  // Regression: real Iranopedia /iran-animals ships ZERO <p> tags anywhere
  // in <main>, but does have real intro prose sitting in a leaf <span> deep
  // inside wrapper <div>s (a page-builder pattern, not a Wix-specific one;
  // the fallback keys on word count, not a vendor class name). This is the
  // exact "kabob-page zero-paragraph gap" the item calls out, except this
  // fixture is the shape that SHOULD recover content (unlike the
  // zero-width-space case above, which correctly stays empty).
  it("falls back to leaf block-level text when there are zero usable <p> tags", () => {
    const html = wrapHtml(`
      <main>
        <div class="hero">
          <div class="heroInner">
            <span>Discover the Animals of Iran</span>
          </div>
          <div class="heroInner">
            <span>Explore the rich diversity of Iran animals and discover the Persian wildlife that inhabits this unique region.</span>
          </div>
        </div>
        <div class="cardGrid">
          <div class="card"><span>Persian Cat</span><span>Learn More</span></div>
          <div class="card"><span>Caracal</span><span>Learn More</span></div>
        </div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-4", TENANT);
    expect(snap.body_paragraph_sample ?? []).not.toHaveLength(0);
    const joined = (snap.body_paragraph_sample ?? []).join(" ");
    expect(joined).toContain("Explore the rich diversity");
    // Short card-label leaves ("Persian Cat", "Learn More") stay below the
    // 8-word floor and must not pollute the sample.
    expect(joined).not.toContain("Learn More");
  });

  it("does not run the fallback when real <p> paragraphs already exist", () => {
    const html = wrapHtml(`
      <main>
        <p>This page has a perfectly normal paragraph with more than eight words present.</p>
        <div><span>This div text should never appear because the p tag pass already succeeded here.</span></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-5", TENANT);
    expect(snap.body_paragraph_sample).toHaveLength(1);
    expect(snap.body_paragraph_sample![0]).toContain("perfectly normal paragraph");
  });

  it("does not duplicate the same leaf text seen through nested wrapper divs", () => {
    // A leaf span's text is only counted once even though ancestor wrapper
    // divs "contain" the same text via descendant aggregation; the
    // fallback only walks LEAF nodes (no element children), so wrappers
    // are skipped entirely, not deduped after the fact.
    const html = wrapHtml(`
      <main>
        <div><div><div>
          <span>This single sentence should appear exactly one time in the sample.</span>
        </div></div></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-6", TENANT);
    const matches = (snap.body_paragraph_sample ?? []).filter((p) =>
      p.includes("This single sentence"),
    );
    expect(matches).toHaveLength(1);
  });

  it("caps the excerpt fairly at 20 entries of up to 300 chars (~6k chars total)", () => {
    const longSentence =
      "Word ".repeat(70) + "and this paragraph is deliberately long enough to exceed the three hundred character per-entry cap so we can verify fair truncation happens on every entry equally.";
    const paragraphs = Array.from({ length: 30 }, (_, i) => `<p>Paragraph number ${i} follows. ${longSentence}</p>`).join("\n");
    const html = wrapHtml(`<main>${paragraphs}</main>`);
    const snap = extractPageSnapshot(html, URL, "page-7", TENANT);
    const sample = snap.body_paragraph_sample ?? [];
    // Capped at 20 entries even though 30 qualifying paragraphs exist.
    expect(sample.length).toBe(20);
    // Every entry is truncated fairly to at most 300 chars.
    for (const p of sample) {
      expect(p.length).toBeLessThanOrEqual(300);
    }
    // Total excerpt stays within the ~6k char bound (20 x 300).
    const totalChars = sample.join("").length;
    expect(totalChars).toBeLessThanOrEqual(6000);
  });

  it("preserves document order in the fallback sample", () => {
    const html = wrapHtml(`
      <main>
        <div><span>First sentence appears here with plenty of words to clear the floor.</span></div>
        <div><span>Second sentence appears here with plenty of words to clear the floor.</span></div>
        <div><span>Third sentence appears here with plenty of words to clear the floor.</span></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-8", TENANT);
    const sample = snap.body_paragraph_sample ?? [];
    expect(sample.length).toBe(3);
    expect(sample[0]).toContain("First sentence");
    expect(sample[1]).toContain("Second sentence");
    expect(sample[2]).toContain("Third sentence");
  });
});

// ── P24 image-SEO lane (2026-07-03): image inventory extractor ──────────────
describe("extractPageSnapshot - images (P24 image-SEO lane)", () => {
  it("captures each <img> with src, alt, width, height", () => {
    const html = wrapHtml(`
      <main>
        <img src="/img/persian-koobideh-kabob.jpg" alt="Plate of kabob" width="800" height="600" />
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "img-1", TENANT);
    expect(snap.images).toBeDefined();
    expect(snap.images).toHaveLength(1);
    expect(snap.images![0]).toEqual({
      src: "https://example.com/img/persian-koobideh-kabob.jpg",
      alt: "Plate of kabob",
      width: 800,
      height: 600,
    });
  });

  it("distinguishes a MISSING alt (null) from an EMPTY alt (\"\")", () => {
    const html = wrapHtml(`
      <main>
        <img src="/a.jpg" />
        <img src="/spacer.gif" alt="" />
        <img src="/c.jpg" alt="A cat" />
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "img-2", TENANT);
    const imgs = snap.images ?? [];
    expect(imgs).toHaveLength(3);
    expect(imgs[0]!.alt).toBeNull(); // no alt attribute at all
    expect(imgs[1]!.alt).toBe(""); // decorative empty alt
    expect(imgs[2]!.alt).toBe("A cat");
  });

  it("resolves relative and protocol-relative srcs against the page URL", () => {
    const html = wrapHtml(`
      <main>
        <img src="pics/x.jpg" alt="rel" />
        <img src="//cdn.example.net/y.jpg" alt="proto" />
        <img src="https://other.com/z.jpg" alt="abs" />
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "img-3", TENANT);
    const srcs = (snap.images ?? []).map((i) => i.src);
    expect(srcs).toContain("https://example.com/pics/x.jpg");
    expect(srcs).toContain("https://cdn.example.net/y.jpg");
    expect(srcs).toContain("https://other.com/z.jpg");
  });

  it("skips images with no src and inline data:/blob: placeholders", () => {
    const html = wrapHtml(`
      <main>
        <img alt="no src" />
        <img src="" alt="empty src" />
        <img src="data:image/gif;base64,R0lGOD" alt="inline data" />
        <img src="/real.jpg" alt="real" />
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "img-4", TENANT);
    const imgs = snap.images ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.src).toBe("https://example.com/real.jpg");
  });

  it("returns undefined (not []) when a page has no images (byte-identical to pre-field snapshots)", () => {
    const html = wrapHtml(`<main><p>Just words, no pictures at all here on this page.</p></main>`);
    const snap = extractPageSnapshot(html, URL, "img-5", TENANT);
    expect(snap.images).toBeUndefined();
  });

  it("treats non-numeric or zero width/height as null", () => {
    const html = wrapHtml(`<main><img src="/a.jpg" alt="x" width="auto" height="0" /></main>`);
    const snap = extractPageSnapshot(html, URL, "img-6", TENANT);
    expect(snap.images![0]!.width).toBeNull();
    expect(snap.images![0]!.height).toBeNull();
  });
});
