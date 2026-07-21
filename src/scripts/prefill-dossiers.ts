import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parse, stringify } from "yaml";

const PILOT_REPOSITORIES = [
  "adonisjs/core",
  "ag-ui-protocol/ag-ui",
  "assistant-ui/assistant-ui",
  "BurntSushi/ripgrep",
  "gitbutlerapp/gitbutler",
  "langfuse/langfuse",
  "microsoft/AI-For-Beginners",
  "oraios/serena",
  "sindresorhus/awesome",
  "t3-oss/create-t3-app",
];

interface Options {
  all: boolean;
  force: boolean;
  help: boolean;
  pilot: boolean;
  repositories: string[];
}

interface InventoryRecord {
  analysis: {
    classification: {
      primary_category: string | null;
      technologies: string[];
      topics: string[];
      use_cases: string[];
    };
    summary: { one_line: string; why_useful: string } | null;
  };
  id: string;
  import: {
    github_snapshot: {
      archived: boolean;
      license_spdx: string | null;
      primary_language: string | null;
    };
  };
  repository: {
    name: string;
    owner: string;
  };
}

interface BundleFile {
  cached_path: string;
  path: string;
  source_url: string;
}

interface BundleManifest {
  collected_at: string;
  files: BundleFile[];
  full_name: string;
  source_commit: string;
}

interface DossierSource {
  checked_at: string;
  commit: string;
  id: string;
  notes: null;
  path: string;
  type: string;
  url: string;
}

function usage(): string {
  return `Usage: npm run prefill:dossiers -- [options]

Create dossier stubs from inventory records and local research bundles.

Options:
  --pilot              Prefill the diverse ten-repository pilot set
  --repo <owner/name>  Prefill one repository (repeatable)
  --all                Prefill every repository with a research bundle
  --force              Replace existing dossier files
  --help               Show this help message`;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parsePrefillArgs(args: string[]): Options {
  const options: Options = { all: false, force: false, help: false, pilot: false, repositories: [] };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    switch (option) {
      case "--all":
        options.all = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
        options.help = true;
        break;
      case "--pilot":
        options.pilot = true;
        break;
      case "--repo":
        options.repositories.push(requireValue(args, index, option));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }
  if (!options.help && !options.all && !options.pilot && options.repositories.length === 0) {
    throw new Error("Choose --pilot, --all, or at least one --repo owner/name.");
  }
  for (const repository of options.repositories) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
      throw new Error(`Invalid repository name: ${repository}`);
    }
  }
  return options;
}

function sourceType(path: string): string {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if (/^security(?:\.|$)/.test(name)) return "security-policy";
  if (["package.json", "pyproject.toml", "cargo.toml", "go.mod", "composer.json", "pom.xml"].includes(name)) {
    return "package-manifest";
  }
  if (/^(examples?|samples?)\//.test(lower)) return "example";
  return "repository-file";
}

function sourceId(path: string, used: Set<string>): string {
  const base = basename(path)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "source";
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export function selectDossierSources(manifest: BundleManifest, maximum = 4): DossierSource[] {
  const used = new Set<string>();
  const selected: BundleFile[] = [];
  const add = (file: BundleFile | undefined): void => {
    if (file && !selected.some((candidate) => candidate.path === file.path) && selected.length < maximum) {
      selected.push(file);
    }
  };

  add(manifest.files.find((file) => /(^|\/)readme(?:\.|$)/i.test(file.path)));
  add(manifest.files.find((file) => /(^|\/)license(?:\.|$)/i.test(file.path)));
  add(manifest.files.find((file) => /(^|\/)security(?:\.|$)/i.test(file.path)));
  add(manifest.files.find((file) => /(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(file.path)));
  for (const file of manifest.files) add(file);

  return selected.map((file) => ({
    checked_at: manifest.collected_at.slice(0, 10),
    commit: manifest.source_commit,
    id: sourceId(file.path, used),
    notes: null,
    path: file.path,
    type: sourceType(file.path),
    url: file.source_url,
  }));
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function makeDossier(record: InventoryRecord, manifest: BundleManifest): Record<string, unknown> {
  const sources = selectDossierSources(manifest);
  const snapshot = record.import.github_snapshot;
  const importedSpdx = snapshot.license_spdx && snapshot.license_spdx !== "NOASSERTION"
    ? snapshot.license_spdx
    : null;
  return {
    schema_version: 2,
    repository_id: record.id,
    research: {
      state: "queued",
      source_commit: manifest.source_commit,
      bundle_collected_at: manifest.collected_at,
      researched_at: null,
      confidence: null,
    },
    classification: {
      primary_category: record.analysis.classification.primary_category,
      topics: record.analysis.classification.topics,
    },
    project: {
      name: record.repository.name,
      kind: null,
      summary: record.analysis.summary?.one_line ?? null,
      best_for: record.analysis.summary ? [record.analysis.summary.why_useful] : [],
    },
    key_features: [],
    usage: {
      interfaces: [],
      installation: [],
      setup: null,
    },
    technology: {
      languages: unique([snapshot.primary_language]),
      notable_components: [],
    },
    license: {
      spdx: importedSpdx,
      name: null,
      notes: null,
    },
    status: {
      lifecycle: snapshot.archived ? "archived" : null,
      archived: snapshot.archived,
      latest_release: null,
      latest_release_at: null,
    },
    strengths: [],
    caveats: [],
    sources: sources.map((source) => source.url),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const options = parsePrefillArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const root = resolve(process.cwd());
  const inventoryDirectory = join(root, "data", "repositories");
  const bundleDirectory = join(root, ".research-cache", "repositories");
  const dossierDirectory = join(root, "data", "dossiers");
  await mkdir(dossierDirectory, { recursive: true });

  const inventoryFiles = (await readdir(inventoryDirectory)).filter((file) => file.endsWith(".yaml")).sort();
  const records = await Promise.all(inventoryFiles.map(async (file) => ({
    file,
    record: parse(await readFile(join(inventoryDirectory, file), "utf8")) as InventoryRecord,
  })));
  const wanted = new Set<string>();
  if (options.pilot) PILOT_REPOSITORIES.forEach((name) => wanted.add(name.toLowerCase()));
  options.repositories.forEach((name) => wanted.add(name.toLowerCase()));

  const selected = options.all
    ? records
    : records.filter(({ record }) => wanted.has(`${record.repository.owner}/${record.repository.name}`.toLowerCase()));
  if (!options.all && selected.length !== wanted.size) {
    const found = new Set(selected.map(({ record }) => `${record.repository.owner}/${record.repository.name}`.toLowerCase()));
    const missing = [...wanted].filter((name) => !found.has(name));
    throw new Error(`Missing inventory records: ${missing.join(", ")}`);
  }

  let written = 0;
  let skipped = 0;
  for (const { file, record } of selected) {
    const slug = file.replace(/\.yaml$/, "");
    const outputPath = join(dossierDirectory, file);
    if (!options.force && await pathExists(outputPath)) {
      skipped += 1;
      continue;
    }
    const manifestPath = join(bundleDirectory, slug, "manifest.json");
    if (!await pathExists(manifestPath)) {
      throw new Error(`Missing research bundle for ${record.id}. Run collect:research first.`);
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BundleManifest;
    const dossier = makeDossier(record, manifest);
    await writeFile(outputPath, stringify(dossier, { lineWidth: 0 }), "utf8");
    written += 1;
  }
  console.log(`Prefilled ${written} dossiers; skipped ${skipped} existing dossiers.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
