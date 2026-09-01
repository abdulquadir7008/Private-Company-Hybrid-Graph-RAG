export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "company";
}

export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const candidate = slugify(base);
  if (!(await exists(candidate))) return candidate;
  for (let i = 2; i < 1000; i++) {
    const withSuffix = `${candidate.slice(0, 44)}-${i}`;
    if (!(await exists(withSuffix))) return withSuffix;
  }
  return `${candidate.slice(0, 40)}-${Date.now().toString(36)}`;
}