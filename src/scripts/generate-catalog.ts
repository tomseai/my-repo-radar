import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";
import type { ErrorObject } from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

type NullableString = string | null;

interface GithubSnapshot {
  archived: boolean;
  created_at: NullableString;
  default_branch: NullableString;
  description: NullableString;
  disabled: boolean;
  fetched_at: string;
  fork: boolean;
  forks: number;
  homepage: NullableString;
  license_spdx: NullableString;
  latest_release: { published_at: NullableString; tag: string; url: NullableString } | null;
  open_issues: number;
  primary_language: NullableString;
  pushed_at: NullableString;
  stars: number;
  topics: string[];
  updated_at: NullableString;
}

interface InventoryRecord {
  analysis: {
    classification: {
      primary_category: NullableString;
      technologies: string[];
      topics: string[];
      use_cases: string[];
    };
  };
  id: string;
  import: { github_snapshot: GithubSnapshot };
  repository: {
    aliases: string[];
    name: string;
    owner: string;
    url: string;
  };
  version: number;
}

interface Dossier {
  caveats: string[];
  classification: { primary_category: NullableString; topics: string[] };
  key_features: string[];
  license: { name: NullableString; notes: NullableString; spdx: NullableString };
  project: { best_for: string[]; kind: NullableString; name: string; summary: NullableString };
  repository_id: string;
  research: {
    bundle_collected_at: string;
    confidence: NullableString;
    researched_at: NullableString;
    source_commit: string;
    state: string;
  };
  schema_version: number;
  sources: string[];
  status: {
    archived: boolean | null;
    latest_release: NullableString;
    latest_release_at: NullableString;
    lifecycle: NullableString;
  };
  strengths: string[];
  technology: { languages: string[]; notable_components: string[] };
  usage: { installation: string[]; interfaces: string[]; setup: NullableString };
}

interface Taxonomy {
  version: number;
}

export interface CatalogRepository {
  id: string;
  identity: { aliases: string[]; name: string; owner: string; url: string };
  project: Dossier["project"];
  classification: {
    primary_category: NullableString;
    technologies: string[];
    topics: string[];
    use_cases: string[];
  };
  key_features: string[];
  usage: Dossier["usage"];
  technology: Dossier["technology"];
  license: Dossier["license"];
  status: Dossier["status"];
  github: GithubSnapshot;
  research: Dossier["research"];
  strengths: string[];
  caveats: string[];
  sources: string[];
}

export interface CatalogArtifact {
  schema_version: 1;
  source_versions: { dossier: number; inventory: number; taxonomy: number };
  counts: {
    repositories: number;
    research_states: Record<string, number>;
    confidence: Record<string, number>;
  };
  repositories: CatalogRepository[];
}

export interface SearchEntry {
  id: string;
  name: string;
  owner: string;
  url: string;
  category: NullableString;
  topics: string[];
  kind: NullableString;
  languages: string[];
  technologies: string[];
  license: NullableString;
  lifecycle: NullableString;
  archived: boolean | null;
  confidence: NullableString;
  stars: number;
  text: string;
}

export interface SearchArtifact {
  schema_version: 1;
  catalog_schema_version: 1;
  count: number;
  entries: SearchEntry[];
}

function countValues(values: Array<string | null>): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function searchText(repository: CatalogRepository): string {
  const values = [
    repository.identity.owner,
    repository.identity.name,
    ...repository.identity.aliases,
    repository.project.name,
    repository.project.kind,
    repository.project.summary,
    ...repository.project.best_for,
    repository.classification.primary_category,
    ...repository.classification.topics,
    ...repository.classification.use_cases,
    ...repository.classification.technologies,
    ...repository.key_features,
    ...repository.usage.interfaces,
    ...repository.usage.installation,
    ...repository.technology.languages,
    ...repository.technology.notable_components,
    repository.license.spdx,
    repository.license.name,
    ...repository.strengths,
    ...repository.caveats,
    repository.github.description,
    ...repository.github.topics,
  ];
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildArtifacts(
  records: Array<{ inventory: InventoryRecord; dossier: Dossier }>,
  taxonomyVersion: number,
): { catalog: CatalogArtifact; search: SearchArtifact } {
  const repositories = records
    .map(({ inventory, dossier }): CatalogRepository => {
      if (inventory.id !== dossier.repository_id) {
        throw new Error(`Inventory ${inventory.id} is paired with dossier ${dossier.repository_id}.`);
      }
      return {
        id: inventory.id,
        identity: {
          aliases: inventory.repository.aliases,
          name: inventory.repository.name,
          owner: inventory.repository.owner,
          url: inventory.repository.url,
        },
        project: dossier.project,
        classification: {
          primary_category: dossier.classification.primary_category,
          technologies: inventory.analysis.classification.technologies,
          topics: dossier.classification.topics,
          use_cases: inventory.analysis.classification.use_cases,
        },
        key_features: dossier.key_features,
        usage: dossier.usage,
        technology: dossier.technology,
        license: dossier.license,
        status: dossier.status,
        github: inventory.import.github_snapshot,
        research: dossier.research,
        strengths: dossier.strengths,
        caveats: dossier.caveats,
        sources: dossier.sources,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  const inventoryVersions = new Set(records.map(({ inventory }) => inventory.version));
  const dossierVersions = new Set(records.map(({ dossier }) => dossier.schema_version));
  if (inventoryVersions.size !== 1 || dossierVersions.size !== 1) {
    throw new Error("Catalog generation requires one inventory version and one dossier schema version.");
  }

  const catalog: CatalogArtifact = {
    schema_version: 1,
    source_versions: {
      dossier: [...dossierVersions][0] ?? 0,
      inventory: [...inventoryVersions][0] ?? 0,
      taxonomy: taxonomyVersion,
    },
    counts: {
      repositories: repositories.length,
      research_states: countValues(repositories.map((repository) => repository.research.state)),
      confidence: countValues(repositories.map((repository) => repository.research.confidence)),
    },
    repositories,
  };

  const entries = repositories.map((repository): SearchEntry => ({
    id: repository.id,
    name: repository.project.name,
    owner: repository.identity.owner,
    url: repository.identity.url,
    category: repository.classification.primary_category,
    topics: repository.classification.topics,
    kind: repository.project.kind,
    languages: repository.technology.languages,
    technologies: repository.classification.technologies,
    license: repository.license.spdx ?? repository.license.name,
    lifecycle: repository.status.lifecycle,
    archived: repository.status.archived,
    confidence: repository.research.confidence,
    stars: repository.github.stars,
    text: searchText(repository),
  }));
  return {
    catalog,
    search: {
      schema_version: 1,
      catalog_schema_version: 1,
      count: entries.length,
      entries,
    },
  };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadArtifacts(root: string): Promise<{ catalog: CatalogArtifact; search: SearchArtifact }> {
  const inventoryDirectory = join(root, "data", "repositories");
  const dossierDirectory = join(root, "data", "dossiers");
  const filenames = (await readdir(inventoryDirectory)).filter((file) => file.endsWith(".yaml")).sort();
  const dossierNames = new Set((await readdir(dossierDirectory)).filter((file) => file.endsWith(".yaml")));
  const missing = filenames.filter((file) => !dossierNames.has(file));
  const orphaned = [...dossierNames].filter((file) => !filenames.includes(file)).sort();
  if (missing.length > 0 || orphaned.length > 0) {
    throw new Error(`Catalog inputs are incomplete (missing dossiers: ${missing.length}; orphaned dossiers: ${orphaned.length}).`);
  }

  const records = await Promise.all(filenames.map(async (filename) => ({
    inventory: parse(await readFile(join(inventoryDirectory, filename), "utf8")) as InventoryRecord,
    dossier: parse(await readFile(join(dossierDirectory, filename), "utf8")) as Dossier,
  })));
  const taxonomy = parse(await readFile(join(root, "data", "taxonomy.yaml"), "utf8")) as Taxonomy;
  return buildArtifacts(records, taxonomy.version);
}

async function validateArtifacts(
  root: string,
  artifacts: { catalog: CatalogArtifact; search: SearchArtifact },
): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const targets = [
    { name: "catalog.json", value: artifacts.catalog, schema: "catalog.schema.json" },
    { name: "search-index.json", value: artifacts.search, schema: "search-index.schema.json" },
  ];
  const errors: string[] = [];
  for (const target of targets) {
    const schema = JSON.parse(await readFile(join(root, "schema", target.schema), "utf8"));
    const validate = ajv.compile(schema);
    if (!validate(target.value)) {
      errors.push(...(validate.errors ?? []).map((error: ErrorObject) =>
        `${target.name}${error.instancePath || "/"} ${error.message ?? "is invalid"}`));
    }
  }
  if (errors.length > 0) throw new Error(`Generated artifact validation failed:\n- ${errors.join("\n- ")}`);
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes("--check");
  const root = resolve(process.cwd());
  const outputDirectory = join(root, "generated");
  const artifacts = await loadArtifacts(root);
  await validateArtifacts(root, artifacts);
  const outputs = [
    { name: "catalog.json", content: serialize(artifacts.catalog) },
    { name: "search-index.json", content: serialize(artifacts.search) },
  ];

  if (check) {
    const stale: string[] = [];
    for (const output of outputs) {
      const path = join(outputDirectory, output.name);
      if (!await exists(path) || await readFile(path, "utf8") !== output.content) stale.push(output.name);
    }
    if (stale.length > 0) {
      throw new Error(`Generated artifacts are missing or stale: ${stale.join(", ")}. Run npm run generate.`);
    }
    console.log(`Generated artifacts are current for ${artifacts.catalog.counts.repositories} repositories.`);
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(outputs.map((output) => writeFile(join(outputDirectory, output.name), output.content, "utf8")));
  console.log(`Generated catalog and search index for ${artifacts.catalog.counts.repositories} repositories.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
