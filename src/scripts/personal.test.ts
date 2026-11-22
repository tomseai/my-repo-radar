import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  ConflictError,
  PROFILE,
  PROFILE_FILE,
  exportFiles,
  exportZip,
  importFiles,
  importZip,
  newPersonalRecord,
  parsePersonal,
  personalFilename,
  serializePersonal,
  validatePersonal,
} from "../personal-model.js";
import {
  FolderStore,
  type PersonalDirectory,
  type PersonalFile,
} from "../personal-store.js";

const record = () => ({
  ...newPersonalRecord("github:example/project", "2026-11-22T12:00:00.000Z"),
  notes: "Private note\nwith unicode: čítam ✓",
  personal_tags: ["work", "try"],
  status: "testing" as const,
  priority: "high" as const,
  rating: 8,
  pinned: true,
  tried: { version: "v1.0", at: "2026-11-22" },
});
function notFound(): never {
  throw Object.assign(new Error(), { name: "NotFoundError" });
}
class MemoryFile implements PersonalFile {
  kind = "file" as const;
  raw = "";
  failWrite = false;
  locked = false;
  async getFile() {
    const text = this.raw;
    return {
      size: new TextEncoder().encode(text).length,
      text: async () => text,
    };
  }
  async createWritable() {
    if (this.locked)
      throw Object.assign(new Error(), { name: "NoModificationAllowedError" });
    this.locked = true;
    let next = this.raw;
    return {
      write: async (raw: string) => {
        if (this.failWrite) throw new Error("Failure");
        next = raw;
      },
      close: async () => {
        this.raw = next;
        this.locked = false;
      },
      abort: async () => {
        this.locked = false;
      },
    };
  }
}
class MemoryDirectory implements PersonalDirectory {
  kind = "directory" as const;
  children = new Map<string, MemoryDirectory | MemoryFile>();
  permission = "granted";
  constructor(public name = "notes") {}
  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryDirectory> {
    if (!this.children.has(name) && options?.create)
      this.children.set(name, new MemoryDirectory(name));
    const child = this.children.get(name);
    if (!child) return notFound();
    if (child.kind !== "directory") throw new Error();
    return child;
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryFile> {
    if (!this.children.has(name) && options?.create)
      this.children.set(name, new MemoryFile());
    const child = this.children.get(name);
    if (!child) return notFound();
    if (child.kind !== "file") throw new Error();
    return child;
  }
  async *entries(): AsyncIterableIterator<
    [string, MemoryDirectory | MemoryFile]
  > {
    yield* this.children.entries();
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
}
test("personal YAML preserves every private field and normalizes identity", () => {
  const original = record();
  original.repository_id = "github:Example/Project";
  assert.deepEqual(parsePersonal(serializePersonal(original)), {
    ...original,
    repository_id: "github:example/project",
  });
  assert.ok(!personalFilename(original.repository_id).includes("/"));
  assert.notEqual(
    personalFilename("github:a/b--c"),
    personalFilename("github:a--b/c"),
  );
});
test("personal schema rejects future versions, bad dates, ratings, unknown fields and paths", () => {
  for (const patch of [
    { version: 2 },
    { rating: 11 },
    { rating: 1.5 },
    { pinned: "yes" },
    { status: "invented" },
    { tried: { version: null, at: "2026-02-30" } },
    { repository_id: "../../secret" },
    { personal_tags: ["x", "x"] },
    { mystery: "field" },
  ])
    assert.throws(() => validatePersonal({ ...record(), ...patch }));
});
test("YAML errors and aliases do not leak note contents through error messages", () => {
  const secret = "DO_NOT_LEAK_PRIVATE_TEXT";
  for (const raw of [
    `notes: [${secret}`,
    `notes: ${secret}\nnotes: duplicate`,
    `notes: &anchor ${secret}\nuseful_for: *anchor`,
  ])
    assert.throws(
      () => parsePersonal(raw),
      (error) => error instanceof Error && !error.message.includes(secret),
    );
});
test("ZIP and folder exports round-trip, including empty workspaces", () => {
  assert.deepEqual(importZip(exportZip([record()])), [record()]);
  assert.deepEqual(importFiles(exportFiles([record()])), [record()]);
  assert.deepEqual(importZip(exportZip([])), []);
});
test("import rejects duplicate identities, traversal, missing marker and unsafe expansion", () => {
  const file = serializePersonal(record());
  assert.throws(
    () => importFiles({ "one.yaml": file, "two.yaml": file }, false),
    /Duplicate/,
  );
  assert.throws(() => importFiles({ "one.yaml": file }), /marker/);
  assert.throws(
    () => importZip(zipSync({ "../escape.yaml": strToU8(file) })),
    /Unsafe/,
  );
  assert.throws(
    () =>
      importZip(
        zipSync({
          [PROFILE_FILE]: strToU8(PROFILE),
          "repositories/big.yaml": new Uint8Array(300_000),
        }),
      ),
    /limits/,
  );
  assert.throws(
    () =>
      importZip(
        zipSync({
          [PROFILE_FILE]: strToU8(PROFILE),
          "unexpected.txt": strToU8("secret"),
        }),
      ),
    /unsupported/,
  );
});
test("folder initialization refuses nonempty unrelated folders or denied permission", async () => {
  const root = new MemoryDirectory();
  await root.getFileHandle("unrelated.txt", { create: true });
  await assert.rejects(new FolderStore(root).open(), /empty dedicated/);
  assert.equal(root.children.has(PROFILE_FILE), false);
  const denied = new MemoryDirectory();
  denied.permission = "denied";
  await assert.rejects(new FolderStore(denied).open(), /permission/);
  assert.equal(denied.children.size, 0);
});
test("folder writes only changed records and preserves previous bytes in backups", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  assert.equal((await store.open()).records.size, 0);
  const first = record();
  const firstRaw = await store.save(first, null);
  const second = newPersonalRecord("github:another/repo");
  await store.save(second, null);
  const dir = await root.getDirectoryHandle("repositories");
  const untouched = (
    await dir.getFileHandle(personalFilename(second.repository_id))
  ).raw;
  await store.save({ ...first, notes: "Changed" }, firstRaw);
  assert.equal(
    (await dir.getFileHandle(personalFilename(second.repository_id))).raw,
    untouched,
  );
  const backups = await root.getDirectoryHandle("backups");
  const folder = [...backups.children.values()][0] as MemoryDirectory;
  assert.equal(
    (await folder.getFileHandle(personalFilename(first.repository_id))).raw,
    firstRaw,
  );
  assert.equal(
    (await store.load()).records.get(first.repository_id)?.notes,
    "Changed",
  );
});
test("external changes and another tab's save cause a conflict, never a blind overwrite", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  await store.open();
  const first = record();
  const raw = await store.save(first, null);
  const other = new FolderStore(root);
  await other.open();
  await other.save({ ...first, notes: "Other tab" }, raw);
  await assert.rejects(
    store.save({ ...first, notes: "Stale draft" }, raw),
    ConflictError,
  );
  assert.equal(
    (await store.load()).records.get(first.repository_id)?.notes,
    "Other tab",
  );
  await assert.rejects(store.save(first, null), ConflictError);
});
test("write failure leaves old content intact and preserves backup", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  await store.open();
  const first = record();
  const raw = await store.save(first, null);
  const file = await (
    await root.getDirectoryHandle("repositories")
  ).getFileHandle(personalFilename(first.repository_id));
  file.failWrite = true;
  await assert.rejects(store.save({ ...first, notes: "Never committed" }, raw));
  assert.equal(file.raw, raw);
  assert.equal(file.locked, false);
  assert.ok(root.children.has("backups"));
});
test("invalid and conflict-copy files are reported and left unchanged", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  await store.open();
  await store.save(record(), null);
  const dir = await root.getDirectoryHandle("repositories");
  const conflict = await dir.getFileHandle("sync-conflict.yaml", {
    create: true,
  });
  conflict.raw = serializePersonal(record());
  const invalid = await dir.getFileHandle("future.yaml", { create: true });
  invalid.raw = "version: 2\n";
  const result = await store.load();
  assert.equal(result.records.size, 1);
  assert.equal(result.issues.length, 2);
  assert.equal(invalid.raw, "version: 2\n");
});
test("a failed first write leaves a recoverable empty placeholder", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  await store.open();
  const dir = await root.getDirectoryHandle("repositories", { create: true });
  const file = await dir.getFileHandle(
    personalFilename(record().repository_id),
    { create: true },
  );
  assert.equal((await store.load()).records.size, 0);
  await store.save(record(), null);
  assert.equal(parsePersonal(file.raw).notes, record().notes);
});
test("imports validate an optional marker and accept safe double-dot repo names", () => {
  assert.throws(() =>
    importFiles({ [PROFILE_FILE]: "app: other\nversion: 1\n" }, false),
  );
  const dotted = { ...record(), repository_id: "github:example/safe..name" };
  assert.deepEqual(importZip(exportZip([dotted])), [dotted]);
});

test("multibyte notes exceeding the byte limit are rejected before touching files", async () => {
  const root = new MemoryDirectory();
  const store = new FolderStore(root);
  await store.open();
  const oversized = { ...record(), notes: "界".repeat(100000) };
  assert.throws(() => serializePersonal(oversized), /256 KB/);
  await assert.rejects(store.save(oversized, null), /256 KB/);
  assert.equal(root.children.has("repositories"), false);
});
