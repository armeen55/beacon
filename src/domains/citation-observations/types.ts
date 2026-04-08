export type SourceCategory =
  | "owned"
  | "competitor"
  | "directory"
  | "earned_media"
  | "ugc"
  | "institution"
  | "social"
  | "other";

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  owned: "Your site",
  competitor: "Competitor",
  directory: "Directory / listing",
  earned_media: "Press / editorial",
  ugc: "User-generated",
  institution: "Government / .edu",
  social: "Social media",
  other: "Other",
};

export type CitationObservation = {
  id: string;
  prompt_answer_id: string;
  domain: string;
  url: string | null;
  title: string | null;
  citation_order: number | null;
  source_category: SourceCategory;
  is_owned: boolean;
  tracked_entity_id: string | null;
  observed_at: string;
};
