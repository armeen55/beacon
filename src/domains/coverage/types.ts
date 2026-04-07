import type {
  CoverageCategory,
  CoverageStatus,
  Priority,
} from "@/lib/constants";

export type CoverageItem = {
  id: string;
  category: CoverageCategory;
  item_name: string;
  description: string | null;
  url: string | null;
  status: CoverageStatus;
  priority: Priority;
  last_checked: string | null;
  notes: string | null;
  linked_brief_id: string | null;
  created_at: string;
  updated_at: string;
};
