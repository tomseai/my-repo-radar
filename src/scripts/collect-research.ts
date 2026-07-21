import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { parse } from "yaml";

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIRECTORY = ".research-cache";
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_FILES = 24;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TREE_ENTRIES = 30_000;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

const ROOT_DOCUMENT_NAMES = [
  /^readme(?:\.[^.]+)?$/i,
  /^license(?:\.[^.]+)?$/i,
  /^security(?:\.[^.]+)?$/i,
  /^contributing(?:\.[^.]+)?$/i,
  /^changelog(?:\.[^.]+)?$/i,
  /^architecture(?:\.[^.]+)?$/i,
  /^install(?:ation)?(?:\.[^.]+)?$/i,
  /^getting[-_ ]started(?:\.[^.]+)?$/i,
];

const MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "deno.json",
  "deno.jsonc",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
]);

const TEXT_EXTENSIONS = new Set([
  ".adoc",
  ".conf",
  ".css",
  ".graphql",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".rst",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const DOCUMENT_KEYWORDS = [
  "architecture",
  "configuration",
  "deployment",
  "design",
  "getting-started",
  "installation",
  "integration",
  "overview",
  "quickstart",
  "security",
  "self-host",
  "setup",
  "usage",
];

export interface CollectorOptions {
  cacheDirectory: string;
  concurrency: number;
  force: boolean;
  help: boolean;
  limit: number | null;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxTreeEntries: number;
  repository: string | null;
}

interface CatalogRecord {
  id: string;
  import: {
    github_snapshot: {
      default_branch: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  repository: {
    name: string;
    owner: string;
    url: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CandidateFile {
  path: string;
  score: number;
}

interface CachedFile {
  bytes: number;
  cached_path: string;
  path: string;
  sha256: string;
  source_url: string;
}

interface SkippedFile {
  path: string;
  reason: string;
  source_url: string;
}

interface ExistingBundleManifest {
  source_commit?: unknown;
}

interface CollectionResult {
  commit: string | null;
  error: string | null;
  files: number;
  full_name: string;
  status: "collected" | "skipped" | "failed";
}

function usage(): string {
  return `Usage: npm run collect:research -- [options]

Create local research bundles for catalog repositories.

Options:
  --cache-dir <path>          Cache directory (default: ${DEFAULT_CACHE_DIRECTORY})
  --concurrency <number>      Repositories processed in parallel (default: ${DEFAULT_CONCURRENCY})
  --repo <owner/name>         Collect one repository only
  --limit <number>            Process at most this many repositories
  --force                     Rebuild bundles even when the commit is unchanged
  --max-files <number>        Maximum selected files per repository (default: ${DEFAULT_MAX_FILES})
  --max-file-bytes <number>   Maximum bytes per selected file (default: ${DEFAULT_MAX_FILE_BYTES})
  --max-total-bytes <number>  Maximum selected bytes per repository (default: ${DEFAULT_MAX_TOTAL_BYTES})
  --max-tree-entries <number> Maximum tree paths retained (default: ${DEFAULT_MAX_TREE_ENTRIES})
  --help                      Show this help message

The collector uses a depth-one, blobless Git clone to obtain an immutable commit
and repository tree. Selected text files are downloaded from commit-pinned raw
URLs. Re-running skips repositories whose commit has not changed.`;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function positiveInteger(value: string, option: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${option} must be a positive whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive whole number.`);
  }
  return parsed;
}

export function parseCollectorArgs(args: string[]): CollectorOptions {
  const options: CollectorOptions = {
    cacheDirectory: DEFAULT_CACHE_DIRECTORY,
    concurrency: DEFAULT_CONCURRENCY,
    force: false,
    help: false,
    limit: null,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    maxFiles: DEFAULT_MAX_FILES,
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    maxTreeEntries: DEFAULT_MAX_TREE_ENTRIES,
    repository: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    switch (option) {
      case "--cache-dir":
        options.cacheDirectory = requireValue(args, index, option);
        index += 1;
        break;
      case "--concurrency":
        options.concurrency = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
        options.help = true;
        break;
      case "--limit":
        options.limit = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--max-file-bytes":
        options.maxFileBytes = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--max-files":
        options.maxFiles = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--max-total-bytes":
        options.maxTotalBytes = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--max-tree-entries":
        options.maxTreeEntries = positiveInteger(requireValue(args, index, option), option);
        index += 1;
        break;
      case "--repo":
        options.repository = requireValue(args, index, option);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (options.repository && !/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
    throw new Error("--repo must use owner/name format.");
  }
  return options;
}

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function pathDepth(path: string): number {
  return path.split("/").length - 1;
}

export function scoreResearchPath(path: string): number | null {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const basenameLower = basename.toLowerCase();
  const lower = normalized.toLowerCase();
  const depth = pathDepth(normalized);

  if (depth === 0) {
    const rootIndex = ROOT_DOCUMENT_NAMES.findIndex((pattern) => pattern.test(basename));
    if (rootIndex >= 0) {
      return 10_000 - rootIndex * 100;
    }
    if (MANIFEST_NAMES.has(basenameLower)) {
      return 9_000;
    }
  }

  if (MANIFEST_NAMES.has(basenameLower)) {
    return 8_200 - Math.min(depth, 20) * 20;
  }

  const isText = TEXT_EXTENSIONS.has(extension(normalized));
  if (!isText) {
    return null;
  }

  const inDocumentation = /^(docs?|documentation|architecture)\//i.test(normalized);
  const keyword = DOCUMENT_KEYWORDS.findIndex((value) => lower.includes(value));
  if (inDocumentation && keyword >= 0) {
    return 7_500 - keyword * 10 - Math.min(depth, 20) * 20;
  }
  if (inDocumentation && /^readme(?:\.[^.]+)?$/i.test(basename)) {
    return 7_200 - Math.min(depth, 20) * 20;
  }
  if (inDocumentation && [".md", ".mdx", ".rst", ".adoc"].includes(extension(normalized))) {
    return 6_000 - Math.min(depth, 20) * 20;
  }
  if (/^(examples?|samples?)\//i.test(normalized) && /^readme(?:\.[^.]+)?$/i.test(basename)) {
    return 5_000 - Math.min(depth, 20) * 20;
  }
  if (/^\.github\/workflows\//i.test(normalized) && [".yml", ".yaml"].includes(extension(normalized))) {
    return 3_000;
  }
  return null;
}

export function selectResearchPaths(paths: string[], maximum: number): CandidateFile[] {
  return paths
    .map((path) => ({ path, score: scoreResearchPath(path) }))
    .filter((candidate): candidate is CandidateFile => candidate.score !== null)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maximum);
}

export function safeCachedPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  return segments
    .map((segment) => {
      const sanitized = segment.replace(/[<>:"|?*\\]/g, "_").replace(/[. ]+$/g, "_");
      return sanitized || "_";
    })
    .join("/");
}

function slug(record: CatalogRecord): string {
  return `${record.repository.owner.toLowerCase()}--${record.repository.name.toLowerCase()}`;
}

function fullName(record: CatalogRecord): string {
  return `${record.repository.owner}/${record.repository.name}`;
}

function rawUrl(record: CatalogRecord, commit: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(record.repository.owner)}/${encodeURIComponent(record.repository.name)}/${commit}/${encodedPath}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runGit(arguments_: string[], cwd?: string): Promise<string> {
  const result = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function ensurePartialClone(record: CatalogRecord, clonePath: string): Promise<string> {
  const branch = record.import.github_snapshot.default_branch;
  if (!branch) {
    throw new Error("GitHub metadata has no default branch.");
  }

  if (await exists(join(clonePath, ".git"))) {
    await runGit(["fetch", "--depth=1", "--no-tags", "origin", branch], clonePath);
    const commit = await runGit(["rev-parse", "FETCH_HEAD"], clonePath);
    await runGit(["update-ref", "HEAD", commit], clonePath);
    return commit;
  }

  await mkdir(dirname(clonePath), { recursive: true });
  await runGit([
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    "--depth=1",
    "--no-tags",
    "--single-branch",
    "--branch",
    branch,
    record.repository.url,
    clonePath,
  ]);
  return runGit(["rev-parse", "HEAD"], clonePath);
}

async function repositoryTree(clonePath: string, commit: string): Promise<string[]> {
  const output = await runGit(["ls-tree", "-r", "--name-only", commit], clonePath);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

async function boundedFetch(url: string, maximumBytes: number): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": "my-repo-radar-research-collector" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBytes) {
    throw new Error(`file exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`file exceeds ${maximumBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return !sample.includes(0);
}

async function readExistingManifest(path: string): Promise<ExistingBundleManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ExistingBundleManifest;
  } catch {
    return null;
  }
}

function assertInside(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    throw new Error(`Refusing to modify a path outside ${parent}: ${child}`);
  }
}

async function collectRepository(
  record: CatalogRecord,
  cacheRoot: string,
  options: CollectorOptions,
): Promise<CollectionResult> {
  const name = fullName(record);
  const repositorySlug = slug(record);
  const clonesRoot = join(cacheRoot, "git");
  const bundlesRoot = join(cacheRoot, "repositories");
  const clonePath = join(clonesRoot, repositorySlug);
  const bundlePath = join(bundlesRoot, repositorySlug);

  try {
    const commit = await ensurePartialClone(record, clonePath);
    const priorManifest = await readExistingManifest(join(bundlePath, "manifest.json"));
    if (!options.force && priorManifest?.source_commit === commit) {
      const priorFiles = await readExistingManifest(join(bundlePath, "manifest.json"));
      const fileCount = Array.isArray((priorFiles as Record<string, unknown> | null)?.files)
        ? ((priorFiles as Record<string, unknown>).files as unknown[]).length
        : 0;
      return { commit, error: null, files: fileCount, full_name: name, status: "skipped" };
    }

    const allPaths = await repositoryTree(clonePath, commit);
    const retainedPaths = allPaths.slice(0, options.maxTreeEntries);
    const selected = selectResearchPaths(allPaths, options.maxFiles);
    const stagePath = `${bundlePath}.tmp-${process.pid}`;
    assertInside(bundlesRoot, stagePath);
    await rm(stagePath, { force: true, recursive: true });
    await mkdir(join(stagePath, "files"), { recursive: true });

    const cachedFiles: CachedFile[] = [];
    const skippedFiles: SkippedFile[] = [];
    const usedCachePaths = new Set<string>();
    let totalBytes = 0;

    for (const candidate of selected) {
      const sourceUrl = rawUrl(record, commit, candidate.path);
      if (totalBytes >= options.maxTotalBytes) {
        skippedFiles.push({ path: candidate.path, reason: "repository byte limit reached", source_url: sourceUrl });
        continue;
      }
      const remaining = Math.min(options.maxFileBytes, options.maxTotalBytes - totalBytes);
      try {
        const content = await boundedFetch(sourceUrl, remaining);
        if (!isProbablyText(content)) {
          skippedFiles.push({ path: candidate.path, reason: "binary content", source_url: sourceUrl });
          continue;
        }
        let cachedPath = safeCachedPath(candidate.path);
        if (usedCachePaths.has(cachedPath.toLowerCase())) {
          const suffix = createHash("sha256").update(candidate.path).digest("hex").slice(0, 8);
          cachedPath = `${cachedPath}.${suffix}`;
        }
        usedCachePaths.add(cachedPath.toLowerCase());
        const destination = join(stagePath, "files", ...cachedPath.split("/"));
        assertInside(join(stagePath, "files"), destination);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
        totalBytes += content.length;
        cachedFiles.push({
          bytes: content.length,
          cached_path: `files/${cachedPath}`,
          path: candidate.path,
          sha256: createHash("sha256").update(content).digest("hex"),
          source_url: sourceUrl,
        });
      } catch (error) {
        skippedFiles.push({
          path: candidate.path,
          reason: error instanceof Error ? error.message : String(error),
          source_url: sourceUrl,
        });
      }
    }

    const releasesUrl = `${record.repository.url}/releases.atom`;
    let releasesCached = false;
    try {
      const releases = await boundedFetch(releasesUrl, 1024 * 1024);
      await writeFile(join(stagePath, "releases.atom"), releases);
      releasesCached = true;
    } catch {
      // Repositories without releases commonly return an error or an empty feed.
    }

    const collectedAt = new Date().toISOString();
    await writeFile(
      join(stagePath, "metadata.json"),
      `${JSON.stringify({
        collected_at: collectedAt,
        id: record.id,
        import: record.import,
        repository: record.repository,
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(stagePath, "tree.json"),
      `${JSON.stringify({
        paths: retainedPaths,
        retained_entries: retainedPaths.length,
        total_entries: allPaths.length,
        truncated: retainedPaths.length < allPaths.length,
      }, null, 2)}\n`,
      "utf8",
    );
    const manifest = {
      schema_version: 1,
      repository_id: record.id,
      full_name: name,
      source_url: record.repository.url,
      source_commit: commit,
      default_branch: record.import.github_snapshot.default_branch,
      collected_at: collectedAt,
      collection_method: "partial-git-tree-and-commit-pinned-raw-files",
      limits: {
        max_file_bytes: options.maxFileBytes,
        max_files: options.maxFiles,
        max_total_bytes: options.maxTotalBytes,
        max_tree_entries: options.maxTreeEntries,
      },
      tree: {
        retained_entries: retainedPaths.length,
        total_entries: allPaths.length,
        truncated: retainedPaths.length < allPaths.length,
      },
      files: cachedFiles,
      skipped_files: skippedFiles,
      releases: releasesCached ? { cached_path: "releases.atom", source_url: releasesUrl } : null,
    };
    await writeFile(join(stagePath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    assertInside(bundlesRoot, bundlePath);
    await rm(bundlePath, { force: true, recursive: true });
    await rename(stagePath, bundlePath);
    return { commit, error: null, files: cachedFiles.length, full_name: name, status: "collected" };
  } catch (error) {
    return {
      commit: null,
      error: error instanceof Error ? error.message : String(error),
      files: 0,
      full_name: name,
      status: "failed",
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await callback(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function loadCatalogRecords(root: string): Promise<CatalogRecord[]> {
  const directory = join(root, "data", "repositories");
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).sort();
  return Promise.all(filenames.map(async (filename) => parse(await readFile(join(directory, filename), "utf8")) as CatalogRecord));
}

async function main(): Promise<void> {
  const options = parseCollectorArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const root = resolve(process.cwd());
  const cacheRoot = resolve(root, options.cacheDirectory);
  if (cacheRoot === root) {
    throw new Error("--cache-dir must not be the repository root.");
  }
  await mkdir(join(cacheRoot, "repositories"), { recursive: true });
  await mkdir(join(cacheRoot, "git"), { recursive: true });

  let records = await loadCatalogRecords(root);
  if (options.repository) {
    records = records.filter((record) => fullName(record).toLowerCase() === options.repository!.toLowerCase());
    if (records.length === 0) {
      throw new Error(`Repository ${options.repository} is not present in data/repositories.`);
    }
  }
  if (options.limit !== null) {
    records = records.slice(0, options.limit);
  }

  let completed = 0;
  const results = await mapWithConcurrency(records, options.concurrency, async (record) => {
    const result = await collectRepository(record, cacheRoot, options);
    completed += 1;
    const detail = result.status === "failed" ? `: ${result.error}` : ` (${result.files} files)`;
    console.log(`[${completed}/${records.length}] ${result.status} ${result.full_name}${detail}`);
    return result;
  });

  const runManifest = {
    schema_version: 1,
    started_for: records.length,
    finished_at: new Date().toISOString(),
    options: {
      concurrency: options.concurrency,
      force: options.force,
      max_file_bytes: options.maxFileBytes,
      max_files: options.maxFiles,
      max_total_bytes: options.maxTotalBytes,
      max_tree_entries: options.maxTreeEntries,
    },
    results,
    summary: {
      collected: results.filter((result) => result.status === "collected").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
  };
  await writeFile(join(cacheRoot, "manifest.json"), `${JSON.stringify(runManifest, null, 2)}\n`, "utf8");

  const failures = results.filter((result) => result.status === "failed");
  if (failures.length > 0) {
    throw new Error(`Research collection completed with ${failures.length} failed repositories.`);
  }
  console.log(`Research collection complete for ${results.length} repositories.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
