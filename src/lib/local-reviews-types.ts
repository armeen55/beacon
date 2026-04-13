/**
 * Local review records (Track 1.4 Phase 2B).
 * Stored in `.data/local-reviews.json` — manual import and/or GBP connector sync (on-demand).
 */

export type LocalReviewSource = "google" | "yelp" | "bbb" | "houzz" | "other";

export type LocalReview = {
  id: string;
  source: LocalReviewSource;
  rating: number;
  /** Normalized calendar date (YYYY-MM-DD) or full ISO from import. */
  created_at: string;
  review_text?: string;
  reviewer_name?: string;
  listing_name?: string;
  review_url?: string;
  location_id?: string;
};

export type LocalSentimentBand = "positive" | "mixed" | "concerning";
