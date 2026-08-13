import Link from "next/link";

/** THE END OF AN ADDRESS THAT WAS NEVER A PAGE, outside the app shell (a shell miss has its own honest end at
 *  (shell)/not-found.tsx). Next's own fallback is an unstyled black page, which reads as a broken product. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-6">
      <section className="w-full space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">This page does not exist</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">The work lives on Today, best edit first.</p>
        <Link href="/" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">
          Go to Today
        </Link>
      </section>
    </main>
  );
}
