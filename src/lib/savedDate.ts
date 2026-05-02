export function savedAtFromDateSaved(dateSaved?: string | null) {
  const raw = (dateSaved ?? "").trim();
  if (!raw) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function dateSavedFromSavedAt(savedAt?: string | null) {
  const raw = (savedAt ?? "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function savedDateLabel(savedAt?: string | null) {
  const raw = (savedAt ?? "").trim();
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (diffDays === 0) return "Saved today";
  if (diffDays === 1) return "Saved yesterday";

  const sameYear = date.getFullYear() === now.getFullYear();
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);

  return `Saved ${formatted}`;
}
