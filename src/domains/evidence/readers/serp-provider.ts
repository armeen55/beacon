// serp-provider: `rootDomain`, the URL helper the evidence readers and the research funnel share. A PURE URL HELPER, NEVER SERVER-ONLY: serp-shape reads it, diagnosis reads serp-shape, and the readiness verdict reads diagnosis inside the browser bundle.
export function rootDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
