import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const TOPIC_ALIASES: Readonly<Record<string, string>> = {
  agents: "ai-agents",
  "chat-and-assistants": "chat-ui",
  desktop: "desktop-app",
  mobile: "mobile-app",
  "self-hosting": "self-hosted",
};

function migrateTopicList(source: string, indent: string): { source: string; migrated: number } {
  let migrated = 0;
  const itemIndent = `${indent}  `;
  const sectionPattern = new RegExp(`^(${indent}topics:\\r?\\n)([\\s\\S]*?)(?=${indent}use_cases:\\r?\\n)`, "m");
  const itemPattern = new RegExp(`^(${itemIndent}- )\"?([^\"\\r\\n]+)\"?\\r?$`, "gm");
  const updated = source.replace(
    sectionPattern,
    (_section, heading: string, body: string) => {
      const migratedBody = body.replace(
        itemPattern,
        (line, prefix: string, topic: string) => {
          const replacement = TOPIC_ALIASES[topic];
          if (!replacement) return line;
          migrated += 1;
          return line.includes(`"${topic}"`) ? `${prefix}"${replacement}"` : `${prefix}${replacement}`;
        },
      );
      return `${heading}${migratedBody}`;
    },
  );
  return { source: updated, migrated };
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  let changedFiles = 0;
  let migratedValues = 0;

  for (const [relativeDirectory, indent] of [["repositories", "    "], ["dossiers", "  "]] as const) {
    const directory = join(root, "data", relativeDirectory);
    const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".yaml")).sort();
    for (const filename of filenames) {
      const path = join(directory, filename);
      const source = await readFile(path, "utf8");
      const result = migrateTopicList(source, indent);
      if (result.source === source) continue;
      await writeFile(path, result.source, "utf8");
      changedFiles += 1;
      migratedValues += result.migrated;
    }
  }

  console.log(`Migrated ${migratedValues} topic values across ${changedFiles} catalog files.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
