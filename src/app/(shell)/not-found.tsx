import Link from "next/link";

/** THE END OF A LINK THAT NO LONGER POINTS ANYWHERE, inside the app shell rather than outside it. Next's own
 *  fallback is an unstyled black page saying "This page could not be found", which is what the operator hit
 *  after marking a change done and reopening its address. Every miss under the shell now lands on the product,
 *  says what most likely happened, and offers the one way forward. */
export default function ShellNotFound() {
  return (
    <div className="max-w-3xl">
      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">This change is not here</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          It may have been replaced by a newer ranking. Every change that still stands is ranked on Changes,
          best first.
        </p>
        <Link href="/changes" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">
          See the work that stands now
        </Link>
      </section>
    </div>
  );
}
