import type { Platform, MetricType, SignalType, AssetType } from "@/lib/constants";
import {
  PLATFORMS,
  METRIC_TYPES,
  SIGNAL_TYPES,
  ASSET_TYPES,
  PLATFORM_LABELS,
  METRIC_TYPE_LABELS,
  SIGNAL_TYPE_LABELS,
  ASSET_TYPE_LABELS,
} from "@/lib/constants";

export function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export function parseJSON(raw: string): Record<string, string>[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("JSON must be an array of objects");
  return parsed.map((row: Record<string, unknown>) => {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = k.trim().toLowerCase().replace(/\s+/g, "_");
      normalized[key] = v == null ? "" : String(v);
    }
    return normalized;
  });
}

function buildReverseMap(labels: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, label] of Object.entries(labels)) {
    map.set(key.toLowerCase(), key);
    map.set(label.toLowerCase(), key);
  }
  return map;
}

const platformMap = buildReverseMap(PLATFORM_LABELS as Record<string, string>);
const metricMap = buildReverseMap(METRIC_TYPE_LABELS as Record<string, string>);
const signalMap = buildReverseMap(SIGNAL_TYPE_LABELS as Record<string, string>);
const assetMap = buildReverseMap(ASSET_TYPE_LABELS as Record<string, string>);

platformMap.set("google ai overview", "google_aio");
platformMap.set("google ai overviews", "google_aio");
platformMap.set("google", "google_aio");
platformMap.set("google search", "google_aio");
platformMap.set("aio", "google_aio");
platformMap.set("sge", "google_aio");
platformMap.set("gpt", "chatgpt");
platformMap.set("openai", "chatgpt");
platformMap.set("chat gpt", "chatgpt");
platformMap.set("perplexity ai", "perplexity");
platformMap.set("pplx", "perplexity");
platformMap.set("bing", "claude");
platformMap.set("bing chat", "claude");
platformMap.set("bing copilot", "claude");
platformMap.set("copilot", "claude");
platformMap.set("ms copilot", "claude");
platformMap.set("meta", "claude");
platformMap.set("meta ai", "claude");
platformMap.set("bard", "gemini");

metricMap.set("rank", "visibility_rank");
metricMap.set("ranking", "visibility_rank");
metricMap.set("rankings", "visibility_rank");
metricMap.set("visibility", "visibility_rank");
metricMap.set("position", "average_position");
metricMap.set("avg position", "average_position");
metricMap.set("avg. position", "average_position");
metricMap.set("clicks", "organic_clicks");
metricMap.set("organic traffic", "organic_clicks");
metricMap.set("traffic", "organic_clicks");
metricMap.set("referrals", "ai_referrals");
metricMap.set("ai referrals", "ai_referrals");
metricMap.set("forms", "form_submissions");
metricMap.set("leads", "form_submissions");
metricMap.set("conversions", "form_submissions");
metricMap.set("sov", "share_of_voice");
metricMap.set("voice share", "share_of_voice");
metricMap.set("mentions", "mention_count");
metricMap.set("citations", "citation_share");
metricMap.set("citation", "citation_share");
metricMap.set("impressions", "organic_clicks");
metricMap.set("ctr", "organic_clicks");

signalMap.set("seo", "content");
signalMap.set("blog", "content");
signalMap.set("blog post", "content");
signalMap.set("content update", "content");
signalMap.set("page update", "content");
signalMap.set("new page", "page");
signalMap.set("new content", "content");
signalMap.set("meta", "technical");
signalMap.set("redirect", "technical");
signalMap.set("internal link", "technical");
signalMap.set("internal linking", "technical");
signalMap.set("schema", "technical");
signalMap.set("schema markup", "technical");
signalMap.set("structured data", "technical");
signalMap.set("title tag", "technical");
signalMap.set("canonical", "technical");
signalMap.set("crawl", "technical");
signalMap.set("link building", "off_page_seo");
signalMap.set("backlinks", "off_page_seo");
signalMap.set("backlink", "off_page_seo");
signalMap.set("pr", "off_page_seo");
signalMap.set("outreach", "off_page_seo");
signalMap.set("gbp", "citation");
signalMap.set("google business", "citation");
signalMap.set("directory", "citation");
signalMap.set("listing", "citation");

assetMap.set("blog", "service_page");
assetMap.set("blog post", "service_page");
assetMap.set("article", "service_page");
assetMap.set("landing page", "service_page");
assetMap.set("page", "service_page");
assetMap.set("location page", "city_page");
assetMap.set("location", "city_page");
assetMap.set("home", "homepage");
assetMap.set("home page", "homepage");
assetMap.set("project", "project_page");
assetMap.set("portfolio", "project_page");
assetMap.set("profile", "directory_profile");
assetMap.set("directory listing", "directory_profile");

export function normalizePlatform(raw: string): Platform | null {
  if (!raw) return null;
  const match = platformMap.get(raw.toLowerCase().trim());
  if (match && (PLATFORMS as readonly string[]).includes(match)) return match as Platform;
  return null;
}

export function normalizeMetricType(raw: string): MetricType | null {
  if (!raw) return null;
  const match = metricMap.get(raw.toLowerCase().trim());
  if (match && (METRIC_TYPES as readonly string[]).includes(match)) return match as MetricType;
  return null;
}

export function normalizeSignalType(raw: string): SignalType | null {
  if (!raw) return null;
  const match = signalMap.get(raw.toLowerCase().trim());
  if (match && (SIGNAL_TYPES as readonly string[]).includes(match)) return match as SignalType;
  return null;
}

export function normalizeAssetType(raw: string): AssetType | null {
  if (!raw) return null;
  const match = assetMap.get(raw.toLowerCase().trim());
  if (match && (ASSET_TYPES as readonly string[]).includes(match)) return match as AssetType;
  return null;
}

export function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  let url = raw.trim();
  url = url.replace(/\/+$/, "");
  return url || null;
}

export function normalizeTopic(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeCity(raw: string): string | null {
  if (!raw) return null;
  return raw.trim().replace(/\s+/g, " ") || null;
}
