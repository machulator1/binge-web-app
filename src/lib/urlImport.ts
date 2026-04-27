export type SavedModality = "article" | "video" | "podcast";

export function looksLikeUrl(value: string) {
  const v = value.trim();
  if (!v) return false;

  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    if (/^[\w-]+\.[\w.-]+(\/|$)/i.test(v)) return true;
    return false;
  }
}

export function normalizeUrl(value: string) {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function hostLabel(hostname: string) {
  const parts = hostname.split(".").filter(Boolean);
  const core = parts.length >= 2 ? parts[parts.length - 2] : hostname;
  return core
    .split(/[-_]/g)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export function modalityFromUrl(url: URL): SavedModality {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("vimeo.com")) {
    return "video";
  }

  if (
    host.includes("spotify.com") ||
    host.includes("podcasts.apple.com") ||
    host.includes("soundcloud.com")
  ) {
    return "podcast";
  }

  if (path.endsWith(".pdf")) return "article";
  return "article";
}

export function mockDuration(modality: SavedModality) {
  if (modality === "video") return 8 + Math.floor(Math.random() * 22);
  if (modality === "podcast") return 12 + Math.floor(Math.random() * 35);
  return 6 + Math.floor(Math.random() * 14);
}

export function minimalTitleFromUrl(url: URL) {
  const host = hostLabel(url.hostname);
  const lastSegment = url.pathname.split("/").filter(Boolean).slice(-1)[0];
  const segment = lastSegment ? decodeURIComponent(lastSegment).replace(/[-_]+/g, " ") : "";
  const cleaned = segment.replace(/\.(html?|php|aspx?)$/i, "").trim();
  if (cleaned && cleaned.length >= 3) return cleaned;
  return host;
}

export function buildMockSavedItem(rawUrl: string) {
  const url = new URL(normalizeUrl(rawUrl));
  const modality = modalityFromUrl(url);
  const source = hostLabel(url.hostname);
  const title = minimalTitleFromUrl(url);
  const durationMinutes = mockDuration(modality);
  const description = "";
  const thumbnailUrl = `https://picsum.photos/seed/${encodeURIComponent(url.hostname + url.pathname)}/960/540`;
  const dateSaved = new Date().toISOString().slice(0, 10);

  return {
    title,
    url: url.toString(),
    modality,
    thumbnailUrl,
    durationMinutes,
    source,
    status: "saved" as const,
    dateSaved,
    description,
  };
}
