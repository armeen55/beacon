/** lane-counts - THE ONE ARITHMETIC for the two open-lane counts, shared by the live Changes feed and the
 *  release stamp, so a stale count shown with its age is the same number the live strip would have shown. */

/** The two consecutive 28 day click windows a decay row carries; the only fields the watch rule reads. */
type DecaySlice = { clicksNow: number; clicksPrior: number };

/** A DECLINE WORTH A ROW. The smoke alarm's floor (10 clicks) earns the whole screen's attention; this is
 *  the floor that earns a LINE, because a page quietly shedding a handful of clicks is exactly what the
 *  operator never gets told. A page with almost no clicks to begin with is noise, so it needs a real prior. */
export const isWatchedDecay = (d: DecaySlice): boolean =>
  d.clicksPrior - d.clicksNow >= 3 && d.clicksPrior >= 5;
