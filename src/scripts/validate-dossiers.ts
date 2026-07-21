import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ErrorObject } from "ajv/dist/2020.js";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

interface Dossier {
  caveats: string[];
  classification: { primary_category: string | null; topics: string[] };
  key_features: string[];
  license: { name: string | null; spdx: string | null };
  project: { best_for: string[]; kind: string | null; summary: string | null };
  repository_id: string;
  research: { confidence: string | null; researched_at: string | null; source_commit: string; state: string };
  sources: string[];
  status: { lifecycle: string | null };
  strengths: string[];
}

interface Taxonomy {
  primary_categories: string[];
  topics: string[];
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const dossierDirectory = join(root, "data", "dossiers");
  let filenames: string[];
  try {
    filenames = (await readdir(dossierDirectory)).filter((file) => file.endsWith(".yaml")).sort();
  } catch {
    console.log("Validated 0 repository dossiers (data/dossiers does not exist yet).");
    return;
  }

  const schema = JSON.parse(await readFile(join(root, "schema", "repository-dossier.schema.json"), "utf8"));
  const taxonomy = parse(await readFile(join(root, "data", "taxonomy.yaml"), "utf8")) as Taxonomy;
  const inventoryFiles = (await readdir(join(root, "data", "repositories"))).filter((file) => file.endsWith(".yaml"));
  const inventoryIds = new Set<string>();
  for (const file of inventoryFiles) {
    const record = parse(await readFile(join(root, "data", "repositories", file), "utf8")) as { id: string };
    inventoryIds.add(record.id);
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile<Dossier>(schema);
  const errors: string[] = [];
  for (const filename of filenames) {
    const dossier = parse(await readFile(join(dossierDirectory, filename), "utf8")) as Dossier;
    if (!validate(dossier)) {
      errors.push(...(validate.errors ?? []).map((error: ErrorObject) => `${filename}: ${formatError(error)}`));
      continue;
    }
    if (!inventoryIds.has(dossier.repository_id)) {
      errors.push(`${filename}: repository_id does not exist in data/repositories`);
    }
    const expectedFilename = `${dossier.repository_id.slice("github:".length).replace("/", "--").toLowerCase()}.yaml`;
    if (filename !== expectedFilename) {
      errors.push(`${filename}: expected filename ${expectedFilename}`);
    }

    if (dossier.classification.primary_category !== null && !taxonomy.primary_categories.includes(dossier.classification.primary_category)) {
      errors.push(`${filename}: unknown primary category ${dossier.classification.primary_category}`);
    }
    for (const topic of dossier.classification.topics) {
      if (!taxonomy.topics.includes(topic)) errors.push(`${filename}: unknown topic ${topic}`);
    }

    try {
      const bundleManifest = JSON.parse(await readFile(
        join(root, ".research-cache", "repositories", filename.replace(/\.yaml$/, ""), "manifest.json"),
        "utf8",
      )) as { source_commit: string };
      if (bundleManifest.source_commit !== dossier.research.source_commit) {
        errors.push(`${filename}: dossier source_commit differs from the research bundle`);
      }
    } catch {
      errors.push(`${filename}: missing research bundle manifest`);
    }

    if (dossier.research.state === "complete") {
      if (dossier.project.kind === null || !dossier.project.summary || dossier.project.summary.length < 100) {
        errors.push(`${filename}: complete dossier requires a project kind and a summary of at least 100 characters`);
      }
      if (dossier.classification.primary_category === null || dossier.classification.topics.length === 0) {
        errors.push(`${filename}: complete dossier requires a primary category and at least one topic`);
      }
      if (dossier.project.best_for.length === 0 || dossier.key_features.length < 3) {
        errors.push(`${filename}: complete dossier requires best_for and at least three key features`);
      }
      if (dossier.license.spdx === null && dossier.license.name === null) {
        errors.push(`${filename}: complete dossier requires explicit license information`);
      }
      if (dossier.status.lifecycle === null || dossier.sources.length < 2) {
        errors.push(`${filename}: complete dossier requires lifecycle status and at least two sources`);
      }
      if (!dossier.sources.some((source) => source.includes(dossier.research.source_commit))) {
        errors.push(`${filename}: complete dossier requires at least one source pinned to source_commit`);
      }
      if (dossier.strengths.length === 0 || dossier.caveats.length === 0) {
        errors.push(`${filename}: complete dossier requires strengths and caveats`);
      }
      if (dossier.research.researched_at === null || dossier.research.confidence === null) {
        errors.push(`${filename}: complete dossier requires research time and confidence`);
      }
    }
  }

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`- ${error}`));
    throw new Error(`Dossier validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}.`);
  }
  console.log(`Validated ${filenames.length} repository dossiers.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
