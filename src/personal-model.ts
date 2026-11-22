import { parseDocument, stringify } from "yaml";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const statuses = [
  "unseen",
  "interested",
  "evaluate",
  "testing",
  "adopted",
  "watching",
  "rejected",
] as const;
export const priorities = ["none", "low", "medium", "high"] as const;
export const PROFILE_FILE = "repo-radar-personal.yaml";
export const PROFILE = "app: my-repo-radar-personal\nversion: 1\n";
export const MAX_FILE_BYTES = 256_000;
export const MAX_FILES = 2000;
export const MAX_TOTAL_BYTES = 20_000_000;
export class PersonalError extends Error {}
export class ConflictError extends PersonalError {
  constructor() {
    super(
      "The file changed outside this editor. Your draft is intact. Reload the disk version or export your draft before resolving the conflict.",
    );
  }
}
export interface PersonalRecord {
  version: 1;
  repository_id: string;
  status: (typeof statuses)[number];
  priority: (typeof priorities)[number];
  rating: number | null;
  pinned: boolean;
  personal_tags: string[];
  useful_for: string[];
  notes: string;
  tried: { version: string | null; at: string | null };
  created_at: string;
  updated_at: string;
}
export function normalizeId(id: string): string {
  if (
    !/^github:[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(id) ||
    id.length > 200 ||
    /\/(\.|\.\.)$/.test(id)
  )
    throw new PersonalError("Invalid repository identity.");
  return id.toLowerCase();
}
export function personalFilename(id: string): string {
  return `${encodeURIComponent(normalizeId(id))}.yaml`;
}
export function newPersonalRecord(
  id: string,
  now = new Date().toISOString(),
): PersonalRecord {
  return {
    version: 1,
    repository_id: normalizeId(id),
    status: "unseen",
    priority: "none",
    rating: null,
    pinned: false,
    personal_tags: [],
    useful_for: [],
    notes: "",
    tried: { version: null, at: null },
    created_at: now,
    updated_at: now,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PersonalError("Expected a personal record object.");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new PersonalError(
      "Missing or unsupported personal fields. The file was not changed.",
    );
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function list(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((item) => text(item, 100) && item.trim().length > 0) &&
    new Set(value).size === value.length
  );
}
function timestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function validatePersonal(value: unknown): PersonalRecord {
  const record = object(value);
  if (record.version !== 1)
    throw new PersonalError(
      "Unsupported personal data version. No migration or overwrite was performed.",
    );
  exactKeys(record, [
    "version",
    "repository_id",
    "status",
    "priority",
    "rating",
    "pinned",
    "personal_tags",
    "useful_for",
    "notes",
    "tried",
    "created_at",
    "updated_at",
  ]);
  if (typeof record.repository_id !== "string")
    throw new PersonalError("Missing repository identity.");
  const id = normalizeId(record.repository_id);
  const tried = object(record.tried);
  exactKeys(tried, ["version", "at"]);
  if (
    !(statuses as readonly unknown[]).includes(record.status) ||
    !(priorities as readonly unknown[]).includes(record.priority) ||
    (record.rating !== null &&
      !(
        Number.isInteger(record.rating) &&
        Number(record.rating) >= 0 &&
        Number(record.rating) <= 10
      )) ||
    typeof record.pinned !== "boolean" ||
    !list(record.personal_tags) ||
    !list(record.useful_for) ||
    !text(record.notes, 100_000) ||
    !(tried.version === null || text(tried.version, 200)) ||
    !(
      tried.at === null ||
      (typeof tried.at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(tried.at) &&
        Number.isFinite(Date.parse(tried.at)) &&
        new Date(tried.at).toISOString().slice(0, 10) === tried.at)
    ) ||
    !timestamp(record.created_at) ||
    !timestamp(record.updated_at) ||
    Date.parse(String(record.updated_at)) <
      Date.parse(String(record.created_at))
  )
    throw new PersonalError(
      "Invalid personal fields. Check dates, tags and the 0–10 rating; notes are limited to 100,000 characters.",
    );
  return { ...(record as unknown as PersonalRecord), repository_id: id };
}
function parseYaml(raw: string): unknown {
  if (strToU8(raw).length > MAX_FILE_BYTES)
    throw new PersonalError("Personal YAML exceeds the 256 KB limit.");
  try {
    const doc = parseDocument(raw, { schema: "core", uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) throw new Error();
    return doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw new PersonalError(
      "Invalid YAML. Duplicate keys, aliases and custom tags are not supported.",
    );
  }
}
export function parsePersonal(raw: string): PersonalRecord {
  return validatePersonal(parseYaml(raw));
}
export function serializePersonal(record: PersonalRecord): string {
  const raw = stringify(validatePersonal(record), { lineWidth: 0 });
  if (strToU8(raw).length > MAX_FILE_BYTES)
    throw new PersonalError(
      "The YAML record exceeds the 256 KB limit. Shorten the notes before saving.",
    );
  return raw;
}
export function validateProfile(raw: string): void {
  const profile = object(parseYaml(raw));
  exactKeys(profile, ["app", "version"]);
  if (profile.app !== "my-repo-radar-personal" || profile.version !== 1)
    throw new PersonalError("This is not a supported personal workspace.");
}
export function exportFiles(records: PersonalRecord[]): Record<string, string> {
  if (records.length > MAX_FILES)
    throw new PersonalError("Workspace exceeds the 2,000 record limit.");
  const files: Record<string, string> = { [PROFILE_FILE]: PROFILE };
  let total = strToU8(PROFILE).length;
  for (const record of records) {
    const path = `repositories/${personalFilename(record.repository_id)}`;
    if (files[path])
      throw new PersonalError("Duplicate repository identities in export.");
    files[path] = serializePersonal(record);
    total += strToU8(files[path]).length;
    if (total > MAX_TOTAL_BYTES)
      throw new PersonalError("Workspace exceeds the 20 MB limit.");
  }
  return files;
}
export function exportZip(records: PersonalRecord[]): Uint8Array {
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(exportFiles(records)).map(([name, raw]) => [
        name,
        strToU8(raw),
      ]),
    ),
    { level: 6 },
  );
  if (archive.length > 10_000_000)
    throw new PersonalError(
      "ZIP exceeds the 10 MB limit. Export to a folder instead.",
    );
  return archive;
}
export function importFiles(
  files: Record<string, string>,
  requireProfile = true,
): PersonalRecord[] {
  if (Object.keys(files).length > MAX_FILES + 1)
    throw new PersonalError("Too many import files.");
  if (requireProfile) {
    if (!files[PROFILE_FILE])
      throw new PersonalError(
        "Missing personal workspace marker. Select a radar export, not the public catalog.",
      );
  }
  if (files[PROFILE_FILE]) validateProfile(files[PROFILE_FILE]);
  const records = new Map<string, PersonalRecord>();
  let total = 0;
  for (const [path, raw] of Object.entries(files)) {
    total += strToU8(raw).length;
    if (total > MAX_TOTAL_BYTES)
      throw new PersonalError("Import exceeds the 20 MB limit.");
    if (path === PROFILE_FILE) continue;
    if (
      !/^(?:repositories\/)?[^/\\]+\.yaml$/.test(path) ||
      /(?:^|\/)\.\.(?:\/|$)/.test(path) ||
      path.includes(":")
    )
      throw new PersonalError("Unsupported import path.");
    const record = parsePersonal(raw);
    if (records.has(record.repository_id))
      throw new PersonalError(
        "Duplicate identities or sync-conflict copies found. Resolve them before importing.",
      );
    records.set(record.repository_id, record);
  }
  return [...records.values()];
}
export function importZip(data: Uint8Array): PersonalRecord[] {
  if (data.length > 10_000_000)
    throw new PersonalError("ZIP exceeds the 10 MB compressed limit.");
  let total = 0;
  let count = 0;
  const names = new Set<string>();
  try {
    const files = unzipSync(data, {
      filter(file) {
        if (/^[a-z]:|^\/|\\|(?:^|\/)\.\.(?:\/|$)/i.test(file.name))
          throw new PersonalError("Unsafe archive path.");
        if (file.name.endsWith("/")) return false;
        if (
          file.name !== PROFILE_FILE &&
          !/^repositories\/[^/]+\.yaml$/.test(file.name)
        )
          throw new PersonalError(
            "ZIP contains unsupported files. Use a personal workspace export.",
          );
        if (names.has(file.name.toLowerCase()))
          throw new PersonalError("Duplicate ZIP entries.");
        names.add(file.name.toLowerCase());
        total += file.originalSize;
        count++;
        if (
          file.originalSize > MAX_FILE_BYTES ||
          total > MAX_TOTAL_BYTES ||
          count > MAX_FILES + 1
        )
          throw new PersonalError("ZIP expansion exceeds safe import limits.");
        return true;
      },
    });
    return importFiles(
      Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]),
      ),
    );
  } catch (error) {
    if (error instanceof PersonalError) throw error;
    throw new PersonalError("Unable to read this ZIP. No data was changed.");
  }
}
