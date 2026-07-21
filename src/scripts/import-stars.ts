import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DEFAULT_USERNAME = "tomseai";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const MAX_AUTOMATIC_WAIT_MS = 60_000;

export interface CliOptions {
  apiBaseUrl: string;
  help: boolean;
  fetchedAt: string;
  maxRetries: number;
  outputDirectory: string;
  perPage: number;
  retryBaseDelayMs: number;
  username: string;
}

interface GithubRepository {
  full_name?: unknown;
  id?: unknown;
  [key: string]: unknown;
}

interface StarredRepositoryResponse {
  repo?: GithubRepository;
  starred_at?: unknown;
}

export interface ImportedStarredRepository {
  repository: GithubRepository;
  starred_at: string | null;
}

export interface StarsImportDocument {
  format_version: 1;
  repositories: ImportedStarredRepository[];
  source: {
    api_base_url: string;
    kind: "github-starred-repositories";
    username: string;
  };
}

export interface FetchResponse {
  headers: Headers;
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  statusText: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<FetchResponse>;

function usage(): string {
  return `Usage: npm run import:stars -- [options]

Import public GitHub repositories starred by a user into a deterministic JSON snapshot.

Options:
  --user <login>                 GitHub user login (default: ${DEFAULT_USERNAME})
  --output-dir <path>            Directory for YAML records (default: data/repositories)
  --fetched-at <ISO-8601>        Metadata observation time (default: current UTC time)
  --api-base-url <url>           GitHub API base URL (default: ${DEFAULT_API_BASE_URL})
  --per-page <1-100>             API page size (default: ${DEFAULT_PER_PAGE})
  --max-retries <number>         Retries for retryable failures (default: ${DEFAULT_MAX_RETRIES})
  --retry-base-delay-ms <number> Initial exponential retry delay (default: ${DEFAULT_RETRY_BASE_DELAY_MS})
  --help                         Show this help message

Set GITHUB_TOKEN to raise GitHub API rate limits. A token is optional for public data.`;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value: string, option: string, maximum?: number): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${option} must be a whole number.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? "at least 1" : `between 1 and ${maximum}`;
    throw new Error(`${option} must be ${range}.`);
  }

  return parsed;
}

export function parseCliArgs(args: string[]): CliOptions {
  let username = DEFAULT_USERNAME;
  let outputDirectory = "data/repositories";
  let fetchedAt = new Date().toISOString();
  let apiBaseUrl = DEFAULT_API_BASE_URL;
  let perPage = DEFAULT_PER_PAGE;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    switch (option) {
      case "--help":
        help = true;
        break;
      case "--user":
        username = requireValue(args, index, option);
        index += 1;
        break;
      case "--output-dir":
        outputDirectory = requireValue(args, index, option);
        index += 1;
        break;
      case "--fetched-at":
        fetchedAt = requireValue(args, index, option);
        index += 1;
        break;
      case "--api-base-url":
        apiBaseUrl = requireValue(args, index, option).replace(/\/$/, "");
        break;
      case "--per-page":
        perPage = parsePositiveInteger(requireValue(args, index, option), option, 100);
        index += 1;
        break;
      case "--max-retries":
        maxRetries = parsePositiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--retry-base-delay-ms":
        retryBaseDelayMs = parsePositiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (!/^[A-Za-z0-9-]+$/.test(username)) {
    throw new Error("--user must be a valid GitHub login.");
  }

  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new Error("--api-base-url must be an absolute HTTP(S) URL.");
  }

  if (Number.isNaN(Date.parse(fetchedAt))) {
    throw new Error("--fetched-at must be a valid ISO-8601 date-time.");
  }

  return {
    apiBaseUrl,
    fetchedAt,
    help,
    maxRetries,
    outputDirectory,
    perPage,
    retryBaseDelayMs,
    username,
  };
}

export function parseLinkHeader(header: string | null): Map<string, string> {
  const links = new Map<string, string>();
  if (!header) {
    return links;
  }

  const matcher = /<([^>]+)>;\s*rel="([^"]+)"/g;
  for (const match of header.matchAll(matcher)) {
    links.set(match[2], match[1]);
  }
  return links;
}

function readRetryDelayMs(response: FetchResponse, fallbackDelayMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.ceil(Number(retryAfter) * 1_000);
  }

  const resetAt = response.headers.get("x-ratelimit-reset");
  if (resetAt && /^\d+$/.test(resetAt)) {
    return Math.max(0, Number(resetAt) * 1_000 - Date.now());
  }

  return fallbackDelayMs;
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function githubHeaders(token: string | undefined): HeadersInit {
  return {
    Accept: "application/vnd.github.star+json",
    "User-Agent": "my-repo-radar-stars-importer",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function requestJson(
  url: string,
  fetchImpl: FetchLike,
  options: CliOptions,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<{ body: unknown; response: FetchResponse }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: githubHeaders(process.env.GITHUB_TOKEN) });
      if (response.ok) {
        return { body: await response.json(), response };
      }

      const retryable = isRetryableStatus(response.status);
      if (!retryable || attempt === options.maxRetries) {
        throw new Error(`GitHub API request failed (${response.status} ${response.statusText}) for ${url}`);
      }

      const fallbackDelay = options.retryBaseDelayMs * 2 ** attempt;
      const delay = readRetryDelayMs(response, fallbackDelay);
      if (delay > MAX_AUTOMATIC_WAIT_MS) {
        throw new Error(
          `GitHub API rate limit reached. Retry after ${Math.ceil(delay / 1_000)} seconds, or set GITHUB_TOKEN and retry.`,
        );
      }
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.startsWith("GitHub API")) {
        throw error;
      }
      if (attempt === options.maxRetries) {
        throw new Error(`GitHub API request failed after ${attempt + 1} attempts for ${url}.`, { cause: error });
      }
      await sleep(options.retryBaseDelayMs * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("GitHub API request failed.");
}

function asStarredResponse(value: unknown): StarredRepositoryResponse[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub API returned an unexpected response while listing starred repositories.");
  }
  return value as StarredRepositoryResponse[];
}

function validateStarredRepository(item: StarredRepositoryResponse): ImportedStarredRepository {
  if (!item.repo || typeof item.repo !== "object") {
    throw new Error("GitHub API returned a starred repository without repository metadata.");
  }
  if (typeof item.repo.id !== "number" || typeof item.repo.full_name !== "string") {
    throw new Error("GitHub API returned repository metadata without an id or full_name.");
  }
  if (item.starred_at !== undefined && typeof item.starred_at !== "string") {
    throw new Error(`GitHub API returned an invalid starred_at value for ${item.repo.full_name}.`);
  }
  return { repository: item.repo, starred_at: item.starred_at ?? null };
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function normalizeImportDocument(
  username: string,
  apiBaseUrl: string,
  records: ImportedStarredRepository[],
): StarsImportDocument {
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();

  for (const record of records) {
    const id = record.repository.id as number;
    const fullName = record.repository.full_name as string;
    if (seenIds.has(id) || seenNames.has(fullName)) {
      throw new Error(`GitHub API returned a duplicate starred repository: ${fullName}.`);
    }
    seenIds.add(id);
    seenNames.add(fullName);
  }

  return {
    format_version: 1,
    repositories: [...records].sort((left, right) =>
      compareText(left.repository.full_name as string, right.repository.full_name as string),
    ),
    source: {
      api_base_url: apiBaseUrl,
      kind: "github-starred-repositories",
      username,
    },
  };
}

export async function collectStarredRepositories(
  options: CliOptions,
  fetchImpl: FetchLike = globalThis.fetch,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
): Promise<StarsImportDocument> {
  const initialUrl = new URL(`${options.apiBaseUrl}/users/${options.username}/starred`);
  initialUrl.searchParams.set("per_page", String(options.perPage));

  const records: ImportedStarredRepository[] = [];
  const visitedUrls = new Set<string>();
  let nextUrl: string | undefined = initialUrl.toString();

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      throw new Error(`GitHub API pagination loop detected at ${nextUrl}.`);
    }
    visitedUrls.add(nextUrl);

    const { body, response } = await requestJson(nextUrl, fetchImpl, options, sleep);
    records.push(...asStarredResponse(body).map(validateStarredRepository));
    nextUrl = parseLinkHeader(response.headers.get("link")).get("next");
  }

  return normalizeImportDocument(options.username, options.apiBaseUrl, records);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }
  return value;
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Cannot serialize a non-finite number as YAML.");
    }
    return String(value);
  }
  throw new Error(`Cannot serialize ${typeof value} as a YAML scalar.`);
}

function isEmptyContainer(value: unknown): boolean {
  return (Array.isArray(value) && value.length === 0) ||
    (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function serializeYamlValue(value: unknown, indentation = ""): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indentation}[]`];
    }
    return value.flatMap((item) => {
      if (item === null || typeof item !== "object" || isEmptyContainer(item)) {
        return [`${indentation}- ${isEmptyContainer(item) ? (Array.isArray(item) ? "[]" : "{}") : yamlScalar(item)}`];
      }
      const nested = serializeYamlValue(item, `${indentation}  `);
      return [`${indentation}- ${nested[0].trimStart()}`, ...nested.slice(1)];
    });
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right));
    if (entries.length === 0) {
      return [`${indentation}{}`];
    }
    return entries.flatMap(([key, nestedValue]) => {
      if (nestedValue === null || typeof nestedValue !== "object" || isEmptyContainer(nestedValue)) {
        const serialized = isEmptyContainer(nestedValue)
          ? (Array.isArray(nestedValue) ? "[]" : "{}")
          : yamlScalar(nestedValue);
        return [`${indentation}${yamlKey(key)}: ${serialized}`];
      }
      return [`${indentation}${yamlKey(key)}:`, ...serializeYamlValue(nestedValue, `${indentation}  `)];
    });
  }

  return [`${indentation}${yamlScalar(value)}`];
}

export function repositoryFilename(record: ImportedStarredRepository): string {
  const fullName = record.repository.full_name as string;
  const [owner, name, ...remaining] = fullName.split("/");
  if (!owner || !name || remaining.length > 0) {
    throw new Error(`GitHub API returned an invalid full_name: ${fullName}.`);
  }
  return `${owner.toLowerCase()}--${name.toLowerCase()}.yaml`;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonNegativeInteger(value: unknown, field: string, fullName: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`GitHub API returned an invalid ${field} value for ${fullName}.`);
  }
  return value as number;
}

function booleanValue(value: unknown, field: string, fullName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`GitHub API returned an invalid ${field} value for ${fullName}.`);
  }
  return value;
}

function stringArray(value: unknown, field: string, fullName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`GitHub API returned an invalid ${field} value for ${fullName}.`);
  }
  return [...new Set(value)].sort(compareText);
}

function githubSnapshot(record: ImportedStarredRepository, fetchedAt: string): Record<string, unknown> {
  const repository = record.repository;
  const fullName = repository.full_name as string;
  const license = repository.license;
  const licenseSpdx = license && typeof license === "object"
    ? nullableString((license as Record<string, unknown>).spdx_id)
    : null;

  return {
    archived: booleanValue(repository.archived, "archived", fullName),
    created_at: nullableString(repository.created_at),
    default_branch: nullableString(repository.default_branch),
    description: nullableString(repository.description),
    disabled: booleanValue(repository.disabled, "disabled", fullName),
    fetched_at: fetchedAt,
    fork: booleanValue(repository.fork, "fork", fullName),
    forks: nonNegativeInteger(repository.forks_count, "forks_count", fullName),
    homepage: nullableString(repository.homepage),
    latest_release: null,
    license_spdx: licenseSpdx,
    open_issues: nonNegativeInteger(repository.open_issues_count, "open_issues_count", fullName),
    primary_language: nullableString(repository.language),
    pushed_at: nullableString(repository.pushed_at),
    stars: nonNegativeInteger(repository.stargazers_count, "stargazers_count", fullName),
    topics: stringArray(repository.topics, "topics", fullName),
    updated_at: nullableString(repository.updated_at),
  };
}

export function serializeRepositoryRecord(
  record: ImportedStarredRepository,
  username: string,
  fetchedAt: string,
  importState: "imported" | "refreshed" = "imported",
): string {
  const fullName = record.repository.full_name as string;
  const [owner, name] = fullName.split("/");
  const htmlUrl = record.repository.html_url;
  if (typeof htmlUrl !== "string") {
    throw new Error(`GitHub API returned repository metadata without html_url for ${fullName}.`);
  }

  const document = {
    analysis: {
      analyzed_at: null,
      classification: {
        primary_category: null,
        state: "unclassified",
        technologies: [],
        topics: [],
        use_cases: [],
      },
      evidence: [],
      state: "unstarted",
      summary: null,
    },
    curation: {
      confidence: null,
      evidence: [],
      limitations: [],
      recommendation: null,
      reviewed_at: null,
      state: "uncurated",
      strengths: [],
      verdict: null,
    },
    id: `github:${owner}/${name}`,
    import: {
      github_snapshot: githubSnapshot(record, fetchedAt),
      sources: [{
        observed_at: record.starred_at ?? fetchedAt,
        relation: "starred",
        source_id: `github:user:${username}:stars`,
        source_url: `https://github.com/${username}?tab=stars`,
      }],
      state: importState,
    },
    repository: {
      aliases: [],
      github_node_id: nullableString(record.repository.node_id),
      host: "github.com",
      name,
      owner,
      url: htmlUrl,
    },
    version: 1,
  };

  return `${serializeYamlValue(document).join("\n")}\n`;
}

function blockBounds(lines: string[], key: string): { end: number; start: number } | null {
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(" ") || lines[end].startsWith("\t") || lines[end] === "")) {
    end += 1;
  }
  return { end, start };
}

function preserveYamlBlock(document: string, existing: string, key: string): string {
  const documentLines = document.trimEnd().split(/\r?\n/);
  const existingLines = existing.trimEnd().split(/\r?\n/);
  const documentBounds = blockBounds(documentLines, key);
  const existingBounds = blockBounds(existingLines, key);
  if (!documentBounds || !existingBounds) {
    throw new Error(`Existing record is missing its top-level ${key} block and cannot be refreshed safely.`);
  }
  return [
    ...documentLines.slice(0, documentBounds.start),
    ...existingLines.slice(existingBounds.start, existingBounds.end),
    ...documentLines.slice(documentBounds.end),
  ].join("\n");
}

async function readExistingRecord(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function writeRepositoryRecords(
  outputDirectory: string,
  records: ImportedStarredRepository[],
  username: string,
  fetchedAt: string,
): Promise<void> {
  const absoluteOutputDirectory = resolve(outputDirectory);
  await mkdir(absoluteOutputDirectory, { recursive: true });

  for (const record of records) {
    const outputPath = join(absoluteOutputDirectory, repositoryFilename(record));
    const existing = await readExistingRecord(outputPath);
    let content = serializeRepositoryRecord(record, username, fetchedAt, existing === null ? "imported" : "refreshed");
    if (existing !== null) {
      content = preserveYamlBlock(content, existing, "analysis");
      content = preserveYamlBlock(content, existing, "curation");
    }
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, outputPath);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const document = await collectStarredRepositories(options);
  await writeRepositoryRecords(options.outputDirectory, document.repositories, options.username, options.fetchedAt);
  console.log(`Imported ${document.repositories.length} starred repositories to ${options.outputDirectory}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
