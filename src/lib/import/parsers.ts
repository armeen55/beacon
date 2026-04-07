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
  const cleaned = raw.replace(/^\ufeff/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
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
platformMap.set("google aio", "google_aio");
platformMap.set("ai overview", "google_aio");
platformMap.set("ai overviews", "google_aio");
platformMap.set("serp", "google_aio");
platformMap.set("anthropic", "claude");

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
metricMap.set("avg pos", "average_position");
metricMap.set("avg. pos", "average_position");
metricMap.set("avg. position", "average_position");
metricMap.set("sessions", "organic_clicks");
metricMap.set("pageviews", "organic_clicks");
metricMap.set("page views", "organic_clicks");
metricMap.set("calls", "form_submissions");
metricMap.set("phone calls", "form_submissions");

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
signalMap.set("local", "citation");
signalMap.set("maps", "citation");
signalMap.set("gmb", "citation");
signalMap.set("google business", "citation");
signalMap.set("performance", "technical");
signalMap.set("core web vitals", "technical");
signalMap.set("cwv", "technical");
signalMap.set("speed", "technical");
signalMap.set("site speed", "technical");
signalMap.set("leadform", "lead_form");
signalMap.set("lead form", "lead_form");
signalMap.set("form", "lead_form");

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
assetMap.set("gmb", "directory_profile");
assetMap.set("google business profile", "directory_profile");
assetMap.set("maps listing", "directory_profile");
assetMap.set("pillar", "service_page");
assetMap.set("hub", "service_page");
assetMap.set("resource", "service_page");
assetMap.set("guide", "service_page");
assetMap.set("profound", "infrastructure");
assetMap.set("sitewide", "service_page");

function stripParenthetical(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*[—–]\s+.*$/, "")
    .trim();
}

function lookupWithFallback(
  raw: string,
  map: Map<string, string>,
  validSet: readonly string[]
): string | null {
  const key = raw.toLowerCase().trim();
  const exact = map.get(key);
  if (exact && (validSet as readonly string[]).includes(exact)) return exact;
  const stripped = stripParenthetical(key);
  if (stripped !== key) {
    const fallback = map.get(stripped);
    if (fallback && (validSet as readonly string[]).includes(fallback)) return fallback;
  }
  return null;
}

export function normalizePlatform(raw: string): Platform | null {
  if (!raw) return null;
  return lookupWithFallback(raw, platformMap, PLATFORMS) as Platform | null;
}

export function normalizeMetricType(raw: string): MetricType | null {
  if (!raw) return null;
  return lookupWithFallback(raw, metricMap, METRIC_TYPES) as MetricType | null;
}

export function normalizeSignalType(raw: string): SignalType | null {
  if (!raw) return null;
  return lookupWithFallback(raw, signalMap, SIGNAL_TYPES) as SignalType | null;
}

export function normalizeAssetType(raw: string): AssetType | null {
  if (!raw) return null;
  return lookupWithFallback(raw, assetMap, ASSET_TYPES) as AssetType | null;
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

export function cleanNumeric(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[$%,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export function normalizeImportDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;

  const usSlash = trimmed.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})$/);
  if (usSlash) {
    const [, m, d, y] = usSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const usDash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (usDash) {
    const [, m, d, y] = usDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}
