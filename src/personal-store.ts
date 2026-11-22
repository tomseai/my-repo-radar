import {
  ConflictError,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  PersonalError,
  PROFILE,
  PROFILE_FILE,
  isSystemFile,
  parsePersonal,
  personalFilename,
  serializePersonal,
  validateProfile,
  type PersonalRecord,
} from "./personal-model.js";

export interface PersonalFile {
  kind: "file";
  getFile(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable(options?: { mode?: "exclusive" }): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
export interface PersonalDirectory {
  kind: "directory";
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<PersonalDirectory>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<PersonalFile>;
  entries(): AsyncIterableIterator<[string, PersonalDirectory | PersonalFile]>;
  queryPermission(options: { mode: "readwrite" }): Promise<string>;
  requestPermission(options: { mode: "readwrite" }): Promise<string>;
}
export interface PersonalSnapshot {
  records: Map<string, PersonalRecord>;
  raw: Map<string, string>;
  issues: string[];
}
export async function readOptional(
  root: PersonalDirectory,
  name: string,
): Promise<string | null> {
  try {
    const file = await (await root.getFileHandle(name)).getFile();
    if (file.size > MAX_FILE_BYTES)
      throw new PersonalError("A workspace file exceeds the 256 KB limit.");
    return await file.text();
  } catch (error) {
    if ((error as Error).name === "NotFoundError") return null;
    throw error;
  }
}
async function write(
  root: PersonalDirectory,
  name: string,
  raw: string,
): Promise<void> {
  const file = await root.getFileHandle(name, { create: true });
  const stream = await file.createWritable({ mode: "exclusive" });
  try {
    await stream.write(raw);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}
export class FolderStore {
  constructor(readonly root: PersonalDirectory) {}
  async open(): Promise<PersonalSnapshot> {
    if (
      (await this.root.queryPermission({ mode: "readwrite" })) !== "granted" &&
      (await this.root.requestPermission({ mode: "readwrite" })) !== "granted"
    )
      throw new PersonalError(
        "Folder permission was not granted. Nothing was changed.",
      );
    const profile = await readOptional(this.root, PROFILE_FILE);
    if (profile === null) {
      for await (const [name] of this.root.entries())
        if (!isSystemFile(name))
          throw new PersonalError(
            "Choose an empty dedicated folder or an existing personal workspace. Do not select the public repository.",
          );
      await write(this.root, PROFILE_FILE, PROFILE);
    } else validateProfile(profile);
    return this.load();
  }
  async load(): Promise<PersonalSnapshot> {
    const profile = await readOptional(this.root, PROFILE_FILE);
    if (profile === null)
      throw new PersonalError(
        "Workspace marker is missing. Reconnect the correct folder.",
      );
    validateProfile(profile);
    const result: PersonalSnapshot = {
      records: new Map(),
      raw: new Map(),
      issues: [],
    };
    let dir: PersonalDirectory;
    try {
      dir = await this.root.getDirectoryHandle("repositories");
    } catch (error) {
      if ((error as Error).name === "NotFoundError") return result;
      throw error;
    }
    let total = 0;
    let count = 0;
    for await (const [name, handle] of dir.entries()) {
      if (isSystemFile(name)) continue;
      if (++count > MAX_FILES)
        throw new PersonalError("Workspace has too many files.");
      if (handle.kind !== "file" || !name.endsWith(".yaml")) {
        result.issues.push(
          "An unsupported file or directory was left untouched in repositories/.",
        );
        continue;
      }
      try {
        const raw = await readOptional(dir, name);
        if (raw === null) throw new Error();
        if (raw === "") continue; // A failed first write may leave an empty placeholder, not a saved record.
        total += new TextEncoder().encode(raw).length;
        if (total > MAX_TOTAL_BYTES)
          throw new PersonalError("Workspace exceeds the 20 MB limit.");
        const record = parsePersonal(raw);
        if (
          personalFilename(record.repository_id) !== name ||
          result.records.has(record.repository_id)
        )
          throw new PersonalError(
            "A duplicate or renamed file needs manual review.",
          );
        result.records.set(record.repository_id, record);
        result.raw.set(record.repository_id, raw);
      } catch {
        result.issues.push(
          "A YAML file is invalid, unsupported, or a sync-conflict copy. It was left untouched; inspect repositories/ before continuing.",
        );
      }
    }
    return result;
  }
  async save(record: PersonalRecord, expected: string | null): Promise<string> {
    const raw = serializePersonal(record);
    const profile = await readOptional(this.root, PROFILE_FILE);
    if (profile === null)
      throw new PersonalError("Workspace marker is missing.");
    validateProfile(profile);
    const dir = await this.root.getDirectoryHandle("repositories", {
      create: true,
    });
    const name = personalFilename(record.repository_id);
    const current = await readOptional(dir, name);
    if (current !== expected && !(expected === null && current === ""))
      throw new ConflictError();
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable({ mode: "exclusive" });
    try {
      // Recheck after acquiring the writer. New files exist as empty files now.
      const latest = await readOptional(dir, name);
      if (latest !== expected && !(expected === null && latest === ""))
        throw new ConflictError();
      // Back up only once the save is known to proceed, so a conflict leaves no history entry.
      if (latest) {
        const history = await this.root.getDirectoryHandle("backups", {
          create: true,
        });
        const backup = await history.getDirectoryHandle(
          `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`,
          { create: true },
        );
        await write(backup, name, latest);
      }
      await stream.write(raw);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
    const saved = await readOptional(dir, name);
    if (saved !== raw)
      throw new PersonalError(
        "The file changed while saving. Keep your draft and inspect the folder.",
      );
    return raw;
  }
}
