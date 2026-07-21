import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import type { ErrorObject } from "ajv/dist/2020.js";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

interface Taxonomy {
  primary_categories: string[];
  technologies: string[];
  topics: string[];
  use_cases: string[];
  version: number;
}

interface RepositoryRecord {
  analysis: {
    analyzed_at: string | null;
    classification: {
      primary_category: string | null;
      state: string;
      technologies: string[];
      topics: string[];
      use_cases: string[];
    };
    evidence: unknown[];
    state: string;
    summary: unknown;
  };
  curation: {
    confidence: string | null;
    evidence: unknown[];
    recommendation: string | null;
    reviewed_at: string | null;
    state: string;
    verdict: string | null;
  };
  id: string;
  import: { github_snapshot: { [key: string]: unknown } };
  repository: {
    github_node_id: string | null;
    name: string;
    owner: string;
    url: string;
  };
}

function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || "/";
  return `${path} ${error.message ?? "is invalid"}`;
}

function assertVocabulary(
  errors: string[],
  filename: string,
  field: string,
  values: string[],
  allowed: Set<string>,
): void {
  for (const value of values) {
    if (!allowed.has(value)) {
      errors.push(`${filename}: analysis.classification.${field} contains unknown value ${JSON.stringify(value)}`);
    }
  }
}

function semanticErrors(filename: string, record: RepositoryRecord, taxonomy: Taxonomy): string[] {
  const errors: string[] = [];
  const { owner, name, url, github_node_id: nodeId } = record.repository;
  const expectedId = `github:${owner}/${name}`;
  const expectedUrl = `https://github.com/${owner}/${name}`;
  const expectedFilename = `${owner.toLowerCase()}--${name.toLowerCase()}.yaml`;

  if (record.id !== expectedId) {
    errors.push(`${filename}: id must be ${JSON.stringify(expectedId)}`);
  }
  if (url.toLowerCase() !== expectedUrl.toLowerCase()) {
    errors.push(`${filename}: repository.url must identify ${owner}/${name}`);
  }
  if (filename !== expectedFilename) {
    errors.push(`${filename}: filename must be ${expectedFilename}`);
  }

  const classification = record.analysis.classification;
  if (
    classification.primary_category !== null &&
    !taxonomy.primary_categories.includes(classification.primary_category)
  ) {
    errors.push(`${filename}: unknown primary category ${JSON.stringify(classification.primary_category)}`);
  }
  assertVocabulary(errors, filename, "topics", classification.topics, new Set(taxonomy.topics));
  assertVocabulary(errors, filename, "use_cases", classification.use_cases, new Set(taxonomy.use_cases));
  assertVocabulary(errors, filename, "technologies", classification.technologies, new Set(taxonomy.technologies));

  if (["researched", "complete"].includes(record.analysis.state)) {
    if (classification.primary_category === null || record.analysis.summary === null || record.analysis.analyzed_at === null) {
      errors.push(`${filename}: researched analysis requires a category, summary, and analyzed_at`);
    }
    if (record.analysis.evidence.length === 0) {
      errors.push(`${filename}: researched analysis requires evidence`);
    }
  }
  if (record.analysis.state === "complete" && classification.state !== "confirmed") {
    errors.push(`${filename}: complete analysis requires confirmed classification`);
  }

  if (record.curation.state === "reviewed") {
    if (
      record.curation.recommendation === null ||
      record.curation.verdict === null ||
      record.curation.confidence === null ||
      record.curation.reviewed_at === null ||
      record.curation.evidence.length === 0
    ) {
      errors.push(`${filename}: reviewed curation requires a recommendation, verdict, confidence, date, and evidence`);
    }
  }

  if (nodeId === null) {
    errors.push(`${filename}: imported GitHub repository is missing github_node_id`);
  }
  return errors;
}

async function readYaml<T>(path: string): Promise<T> {
  return parse(await readFile(path, "utf8")) as T;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const repositoryDirectory = join(root, "data", "repositories");
  const repositorySchema = JSON.parse(await readFile(join(root, "schema", "repository.schema.json"), "utf8"));
  const taxonomySchema = JSON.parse(await readFile(join(root, "schema", "taxonomy.schema.json"), "utf8"));
  const taxonomy = await readYaml<Taxonomy>(join(root, "data", "taxonomy.yaml"));

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateRepository = ajv.compile<RepositoryRecord>(repositorySchema);
  const validateTaxonomy = ajv.compile<Taxonomy>(taxonomySchema);
  const errors: string[] = [];

  if (!validateTaxonomy(taxonomy)) {
    errors.push(...(validateTaxonomy.errors ?? []).map((error: ErrorObject) => `data/taxonomy.yaml: ${formatAjvError(error)}`));
  }

  const filenames = (await readdir(repositoryDirectory))
    .filter((filename) => filename.endsWith(".yaml"))
    .sort();
  const seenIdentities = new Map<string, string>();
  const seenNodeIds = new Map<string, string>();

  for (const filename of filenames) {
    const path = join(repositoryDirectory, filename);
    let record: RepositoryRecord;
    try {
      record = await readYaml<RepositoryRecord>(path);
    } catch (error) {
      errors.push(`${filename}: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    if (!validateRepository(record)) {
      errors.push(...(validateRepository.errors ?? []).map((error: ErrorObject) => `${filename}: ${formatAjvError(error)}`));
      continue;
    }
    errors.push(...semanticErrors(filename, record, taxonomy));

    const identity = `${record.repository.owner}/${record.repository.name}`.toLowerCase();
    const priorIdentity = seenIdentities.get(identity);
    if (priorIdentity) {
      errors.push(`${filename}: duplicates repository identity from ${priorIdentity}`);
    } else {
      seenIdentities.set(identity, filename);
    }
    const nodeId = record.repository.github_node_id;
    if (nodeId) {
      const priorNodeId = seenNodeIds.get(nodeId);
      if (priorNodeId) {
        errors.push(`${filename}: duplicates GitHub node ID from ${priorNodeId}`);
      } else {
        seenNodeIds.set(nodeId, filename);
      }
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    throw new Error(`Validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}.`);
  }

  console.log(`Validated ${filenames.length} repository records and data/taxonomy.yaml.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
