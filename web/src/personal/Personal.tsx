import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogRepository } from "../../../src/web-model";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  PersonalError,
  PROFILE_FILE,
  exportFiles,
  exportZip,
  importFiles,
  importZip,
  newPersonalRecord,
  normalizeId,
  priorities,
  serializePersonal,
  statuses,
  validatePersonal,
  type PersonalRecord,
} from "../../../src/personal-model";
import {
  FolderStore,
  type PersonalDirectory,
  type PersonalSnapshot,
} from "../../../src/personal-store";
import { recalledFolder, rememberFolder } from "./remember";
import "./personal.css";

type Mode = "disconnected" | "folder" | "temporary";
type Draft = {
  record: PersonalRecord;
  tags: string;
  uses: string;
  rating: string;
  expected: string | null;
  dirty: boolean;
};
const emptySnapshot = (): PersonalSnapshot => ({
  records: new Map(),
  raw: new Map(),
  issues: [],
});
const statusNames: Record<PersonalRecord["status"], string> = {
  unseen: "Unseen",
  interested: "Interested",
  evaluate: "Want to try",
  testing: "Testing",
  adopted: "Using",
  watching: "Watching",
  rejected: "Rejected",
};
const supportsFolders = () =>
  typeof (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker === "function" && window.isSecureContext;
function pickFolder(): Promise<PersonalDirectory> {
  return (
    window as unknown as {
      showDirectoryPicker(options: {
        mode: string;
        id: string;
      }): Promise<PersonalDirectory>;
    }
  ).showDirectoryPicker({ mode: "readwrite", id: "repo-radar-personal" });
}
function messageFor(error: unknown): string {
  if (error instanceof PersonalError) return error.message;
  const name = (error as Error)?.name;
  if (name === "AbortError")
    return "Operation cancelled. Existing files were not intentionally replaced.";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Folder access is unavailable. Reconnect and grant permission, or use ZIP import/export. Your draft is still available in this tab.";
  if (name === "NoModificationAllowedError")
    return "Another writer may be using this file. Close the other editor and try again.";
  return "The operation could not finish. Keep this tab open and export your drafts before reconnecting. No note content was logged.";
}
function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob(
    [typeof bytes === "string" ? bytes : new Uint8Array(bytes)],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // A separate download target keeps the editor's unsaved-change guard active.
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function recordDraft(record: PersonalRecord, expected: string | null): Draft {
  return {
    record,
    tags: record.personal_tags.join(", "),
    uses: record.useful_for.join(", "),
    rating: record.rating === null ? "" : String(record.rating),
    expected,
    dirty: false,
  };
}
function parsedDraft(draft: Draft): PersonalRecord {
  const values = (raw: string) => [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  return validatePersonal({
    ...draft.record,
    rating: draft.rating.trim() === "" ? null : Number(draft.rating),
    personal_tags: values(draft.tags),
    useful_for: values(draft.uses),
  });
}
function useController(repositories: CatalogRepository[]) {
  const [mode, setMode] = useState<Mode>("disconnected");
  const [snapshot, setSnapshot] = useState<PersonalSnapshot>(emptySnapshot);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [remembered, setRemembered] = useState<PersonalDirectory | null>(null);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [pending, setPending] = useState<PersonalRecord[] | null>(null);
  const [replace, setReplace] = useState(false);
  const store = useRef<FolderStore | null>(null);
  const running = useRef(false);
  const hasDrafts = [...drafts.values()].some((draft) => draft.dirty);
  useEffect(() => {
    let mounted = true;
    recalledFolder()
      .then((handle) => {
        if (mounted) setRemembered(handle);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasDrafts || memoryDirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasDrafts, memoryDirty, busy]);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setFailure(messageFor(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const confirmSwitch = () =>
    !(hasDrafts || memoryDirty) ||
    window.confirm(
      "This will discard drafts or unexported temporary notes in this tab. Export them first if needed. Continue?",
    );
  const acceptSnapshot = (next: PersonalSnapshot) => {
    setSnapshot(next);
    setDrafts(new Map());
    setPending(null);
    setMemoryDirty(false);
  };
  async function connect(reconnect = false) {
    if (running.current || !confirmSwitch()) return;
    // Call the picker/permission prompt directly from the user gesture.
    await run(async () => {
      const root = reconnect && remembered ? remembered : await pickFolder();
      if (
        reconnect &&
        (await root.requestPermission({ mode: "readwrite" })) !== "granted"
      )
        throw new PersonalError("Folder permission was not granted.");
      const nextStore = new FolderStore(root);
      const next = await nextStore.open();
      store.current = nextStore;
      setMode("folder");
      setFolderName(root.name);
      acceptSnapshot(next);
      setRemembered(root);
      try {
        await rememberFolder(root);
        setNotice(
          "Folder connected. Save writes directly to your files; nothing is uploaded.",
        );
      } catch {
        setNotice(
          "Folder connected for this session. Browser storage is unavailable, so select the folder again next time.",
        );
      }
    });
  }
  function temporary() {
    if (running.current || !confirmSwitch()) return;
    store.current = null;
    setMode("temporary");
    setFolderName("");
    acceptSnapshot(emptySnapshot());
    setNotice(
      "Temporary workspace: notes are in this tab only. Export a ZIP before closing.",
    );
  }
  async function disconnect() {
    if (running.current || !confirmSwitch()) return;
    await run(async () => {
      store.current = null;
      setMode("disconnected");
      setFolderName("");
      acceptSnapshot(emptySnapshot());
      setRemembered(null);
      try {
        await rememberFolder(null);
        setNotice(
          "Disconnected. Browser handle cleared; your files were not deleted.",
        );
      } catch {
        setNotice(
          "Disconnected. If browser storage is blocked, clear this site's data to remove any previously remembered handle. Files are untouched.",
        );
      }
    });
  }
  async function refresh() {
    if (
      hasDrafts &&
      !window.confirm(
        "Discard all unsaved drafts and reload the folder? Export drafts first if needed.",
      )
    )
      return;
    await run(async () => {
      if (store.current) {
        acceptSnapshot(await store.current.load());
        setNotice("Reloaded from disk.");
      }
    });
  }
  function resolve(repo: CatalogRepository): {
    id: string;
    ambiguous: boolean;
  } {
    const candidates = [
      repo.id,
      ...repo.identity.aliases.map((alias) =>
        alias.startsWith("github:")
          ? alias
          : `github:${alias.replace(/^https:\/\/github.com\//, "")}`,
      ),
    ]
      .map((id) => {
        try {
          return normalizeId(id);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    const matches = [...new Set(candidates)].filter(
      (id) => snapshot.records.has(id) || drafts.has(id),
    );
    return {
      id: matches[0] ?? normalizeId(repo.id),
      ambiguous: matches.length > 1,
    };
  }
  function updateDraft(id: string, value: Draft) {
    setDrafts((current) => new Map(current).set(id, { ...value, dirty: true }));
  }
  function discardDraft(id: string) {
    setDrafts((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }
  async function save(id: string, draft: Draft) {
    await run(async () => {
      if (mode === "disconnected")
        throw new PersonalError(
          "Connect a folder or start a temporary workspace first.",
        );
      if (snapshot.issues.length)
        throw new PersonalError(
          "Resolve the workspace file warnings and reload before writing. Your draft is intact.",
        );
      const record = parsedDraft(draft);
      record.updated_at = new Date().toISOString();
      exportFiles([...new Map(snapshot.records).set(id, record).values()]);
      let raw: string;
      if (store.current) {
        const action = () => store.current!.save(record, draft.expected);
        raw = navigator.locks
          ? await navigator.locks.request("repo-radar-personal-write", action)
          : await action();
      } else {
        raw = serializePersonal(record);
        setMemoryDirty(true);
      }
      setSnapshot((current) => ({
        ...current,
        records: new Map(current.records).set(id, record),
        raw: new Map(current.raw).set(id, raw),
      }));
      discardDraft(id);
      setNotice(
        mode === "folder"
          ? "Saved to your folder. Previous content, if any, is in backups/."
          : "Kept in this tab. Export a ZIP to keep it after closing.",
      );
    });
  }
  async function reloadRecord(id: string) {
    if (
      !window.confirm(
        "Replace this draft with the current disk version? Export your draft first to keep both.",
      )
    )
      return;
    await run(async () => {
      if (store.current) setSnapshot(await store.current.load());
      discardDraft(id);
      setNotice("Draft replaced with the latest loaded version.");
    });
  }
  async function exportAll(asFolder: boolean) {
    if (running.current) return;
    if (hasDrafts) {
      setFailure(
        "Save drafts first, or export each draft from its editor. The workspace export contains saved records only.",
      );
      return;
    }
    await run(async () => {
      const root = asFolder ? await pickFolder() : null;
      const current = store.current ? await store.current.load() : snapshot;
      if (current.issues.length)
        throw new PersonalError(
          "Some files need review. Back up the entire folder with your file manager; an export would omit invalid files.",
        );
      const records = [...current.records.values()];
      exportFiles(records);
      if (root) {
        for await (const _entry of root.entries())
          throw new PersonalError(
            "Export to an empty folder to avoid replacing any existing files.",
          );
        const target = new FolderStore(root);
        await target.open();
        for (const record of records) await target.save(record, null);
      } else
        download(
          exportZip(records),
          `repo-radar-personal-${new Date().toISOString().slice(0, 10)}.zip`,
          "application/zip",
        );
      setSnapshot(current);
      setMemoryDirty(false);
      setNotice(
        asFolder
          ? "Exported current records to the chosen folder. Local backup history is not included."
          : "ZIP download requested. Check that it was saved before closing this tab. Local backup history is not included.",
      );
    });
  }
  async function prepareImport(files: FileList | null, directory = false) {
    if (!files?.length) return;
    await run(async () => {
      if (hasDrafts)
        throw new PersonalError(
          "Save or export/discard drafts before importing.",
        );
      const selected = Array.from(files).filter(
        (file) =>
          !directory ||
          !file.webkitRelativePath
            .split("/")
            .slice(1)
            .join("/")
            .startsWith("backups/"),
      );
      if (selected.length > MAX_FILES + 1)
        throw new PersonalError(
          "Select at most 2,000 records and a workspace marker.",
        );
      let records: PersonalRecord[];
      if (
        !directory &&
        selected.length === 1 &&
        selected[0].name.toLowerCase().endsWith(".zip")
      ) {
        if (selected[0].size > 10_000_000)
          throw new PersonalError("ZIP exceeds the 10 MB limit.");
        records = importZip(new Uint8Array(await selected[0].arrayBuffer()));
      } else {
        const content: Record<string, string> = {};
        let total = 0;
        for (const file of selected) {
          const path = directory
            ? file.webkitRelativePath.split("/").slice(1).join("/")
            : file.name;
          if (directory && path.startsWith("backups/")) continue;
          if (
            file.size > MAX_FILE_BYTES ||
            (total += file.size) > MAX_TOTAL_BYTES
          )
            throw new PersonalError(
              "Selected files exceed safe import limits.",
            );
          if (Object.hasOwn(content, path))
            throw new PersonalError("Duplicate import filenames.");
          content[path] = await file.text();
        }
        records = importFiles(content, directory);
      }
      setPending(records);
      setReplace(false);
      setNotice("Review the import below. No records have been changed.");
    });
  }
  async function applyImport() {
    if (!pending) return;
    await run(async () => {
      if (snapshot.issues.length)
        throw new PersonalError("Resolve workspace warnings before importing.");
      const merged = new Map(snapshot.records);
      for (const record of pending)
        if (replace || !merged.has(record.repository_id))
          merged.set(record.repository_id, record);
      exportFiles([...merged.values()]);
      let count = 0;
      for (const record of pending) {
        if (!replace && snapshot.records.has(record.repository_id)) continue;
        try {
          const expected = snapshot.raw.get(record.repository_id) ?? null;
          const action = () => store.current!.save(record, expected);
          const raw = store.current
            ? navigator.locks
              ? await navigator.locks.request(
                  "repo-radar-personal-write",
                  action,
                )
              : await action()
            : serializePersonal(record);
          setSnapshot((current) => ({
            ...current,
            records: new Map(current.records).set(record.repository_id, record),
            raw: new Map(current.raw).set(record.repository_id, raw),
          }));
          count++;
        } catch {
          setPending(null);
          throw new PersonalError(
            `Import stopped after ${count} saved records. Earlier records remain saved; remaining records were not imported. Reload the folder and inspect for conflicts before retrying.`,
          );
        }
      }
      if (!store.current) {
        setMode("temporary");
        setMemoryDirty(true);
      }
      setPending(null);
      setNotice(
        `Imported ${count} records${store.current ? " into your folder" : " into this temporary tab; export before closing"}. Existing records were ${replace ? "replaced with backups when using a folder" : "kept"}.`,
      );
    });
  }
  return {
    mode,
    snapshot,
    drafts,
    busy,
    notice,
    failure,
    remembered,
    folderName,
    memoryDirty,
    pending,
    replace,
    hasDrafts,
    repositories,
    setReplace,
    setPending,
    connect,
    temporary,
    disconnect,
    refresh,
    resolve,
    updateDraft,
    discardDraft,
    save,
    reloadRecord,
    exportAll,
    prepareImport,
    applyImport,
    draftFor(id: string) {
      return (
        drafts.get(id) ??
        recordDraft(
          snapshot.records.get(id) ?? newPersonalRecord(id),
          snapshot.raw.get(id) ?? null,
        )
      );
    },
    exportDraft(draft: Draft) {
      try {
        download(
          serializePersonal(parsedDraft(draft)),
          "repo-radar-draft.yaml",
          "application/yaml",
        );
        setNotice(
          "Draft download requested. Verify the download before discarding your draft.",
        );
      } catch (error) {
        setFailure(messageFor(error));
      }
    },
  };
}
type Controller = ReturnType<typeof useController>;
const Context = createContext<Controller | null>(null);
export function PersonalProvider({
  repositories,
  children,
}: {
  repositories: CatalogRepository[];
  children: ReactNode;
}) {
  const value = useController(repositories);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePersonal() {
  const value = useContext(Context);
  if (!value) throw new Error("Personal provider is missing.");
  return value;
}
export function PersonalMessages() {
  const personal = usePersonal();
  return (
    <>
      <div role="status" className="personal-message">
        {personal.busy ? "Working with your local files…" : personal.notice}
      </div>
      {personal.failure && (
        <p className="personal-warning" role="alert">
          {personal.failure}
        </p>
      )}
      {personal.snapshot.issues.length > 0 && (
        <p className="personal-warning" role="alert">
          {personal.snapshot.issues.length} file warnings. Writing is disabled
          until you inspect repositories/ and reload. Unsupported or
          sync-conflict files were not modified.
        </p>
      )}
    </>
  );
}
export function PersonalBadge({ repo }: { repo: CatalogRepository }) {
  const personal = usePersonal();
  const match = personal.resolve(repo);
  const record = personal.snapshot.records.get(match.id);
  if (match.ambiguous)
    return <span className="personal-badge">Private identity conflict</span>;
  if (personal.drafts.get(match.id)?.dirty)
    return <span className="personal-badge">Unsaved private draft</span>;
  return record ? (
    <span className="personal-badge">
      {record.pinned ? "★ " : ""}Private · {statusNames[record.status]}
      {record.notes ? " · Notes" : ""}
    </span>
  ) : null;
}
function Connections() {
  const personal = usePersonal();
  return (
    <div className="personal-connections">
      <p>
        {personal.mode === "folder" ? (
          <>
            Connected: <strong>{personal.folderName}</strong>. Files stay in
            your chosen folder.
          </>
        ) : personal.mode === "temporary" ? (
          <strong>
            Temporary workspace — export before closing. Nothing is saved on
            disk automatically.
          </strong>
        ) : (
          "Connect a dedicated empty folder or reopen an existing personal workspace."
        )}
      </p>
      <div className="personal-actions">
        {supportsFolders() && (
          <button
            disabled={personal.busy}
            onClick={() => void personal.connect()}
          >
            Choose notes folder
          </button>
        )}
        {supportsFolders() &&
          personal.remembered &&
          personal.mode !== "folder" && (
            <button
              disabled={personal.busy}
              onClick={() => void personal.connect(true)}
            >
              Reconnect previous folder
            </button>
          )}
        {personal.mode === "disconnected" && (
          <button disabled={personal.busy} onClick={personal.temporary}>
            Use temporary workspace
          </button>
        )}
        {personal.mode === "folder" && (
          <button
            disabled={personal.busy}
            onClick={() => void personal.refresh()}
          >
            Reload folder
          </button>
        )}
        {(personal.mode !== "disconnected" || personal.remembered) && (
          <button
            disabled={personal.busy}
            onClick={() => void personal.disconnect()}
          >
            Disconnect
          </button>
        )}
      </div>
      {!supportsFolders() && (
        <p className="muted">
          This browser cannot write directly to a chosen folder. Use temporary
          notes and ZIP import/export instead.
        </p>
      )}
    </div>
  );
}
export function PersonalEditor({
  repo,
  recordId,
}: {
  repo?: CatalogRepository;
  recordId?: string;
}) {
  const personal = usePersonal();
  const match = repo
    ? personal.resolve(repo)
    : { id: recordId!, ambiguous: false };
  const draft = personal.draftFor(match.id);
  const patch = (fields: Partial<PersonalRecord>) =>
    personal.updateDraft(match.id, {
      ...draft,
      record: { ...draft.record, ...fields },
    });
  return (
    <section className="personal-editor" aria-label="Private repository notes">
      <h2>Your private workspace</h2>
      <p className="muted">
        Only you see these fields. They are not part of the public catalog.
      </p>
      {personal.mode === "disconnected" ? (
        <Connections />
      ) : match.ambiguous ? (
        <p className="personal-warning">
          Notes exist for multiple identities of this repository. Open Private
          workspace to review each file individually; automatic merging is
          disabled.
        </p>
      ) : (
        <>
          <p className="personal-location">
            {personal.mode === "folder"
              ? `Saving to ${personal.folderName}`
              : "Temporary notes — export to keep"}{" "}
            · {match.id}
          </p>
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void personal.save(match.id, draft);
            }}
          >
            <fieldset disabled={personal.busy}>
              <legend className="sr-only">Private fields</legend>
              <div className="personal-fields">
                <label>
                  Status
                  <select
                    value={draft.record.status}
                    onChange={(event) =>
                      patch({
                        status: event.target.value as PersonalRecord["status"],
                      })
                    }
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {statusNames[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={draft.record.priority}
                    onChange={(event) =>
                      patch({
                        priority: event.target
                          .value as PersonalRecord["priority"],
                      })
                    }
                  >
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Personal rating (0–10)
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="1"
                    value={draft.rating}
                    onChange={(event) =>
                      personal.updateDraft(match.id, {
                        ...draft,
                        rating: event.target.value,
                      })
                    }
                    placeholder="Unrated"
                  />
                </label>
                <label className="personal-check">
                  <input
                    type="checkbox"
                    checked={draft.record.pinned}
                    onChange={(event) =>
                      patch({ pinned: event.target.checked })
                    }
                  />
                  Pinned
                </label>
                <label>
                  Personal tags (comma-separated)
                  <input
                    maxLength={5000}
                    value={draft.tags}
                    onChange={(event) =>
                      personal.updateDraft(match.id, {
                        ...draft,
                        tags: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Useful for (comma-separated)
                  <input
                    maxLength={5000}
                    value={draft.uses}
                    onChange={(event) =>
                      personal.updateDraft(match.id, {
                        ...draft,
                        uses: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Tried version
                  <input
                    maxLength={200}
                    value={draft.record.tried.version ?? ""}
                    onChange={(event) =>
                      patch({
                        tried: {
                          ...draft.record.tried,
                          version: event.target.value || null,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Tried date
                  <input
                    type="date"
                    value={draft.record.tried.at ?? ""}
                    onChange={(event) =>
                      patch({
                        tried: {
                          ...draft.record.tried,
                          at: event.target.value || null,
                        },
                      })
                    }
                  />
                </label>
              </div>
              <label className="personal-notes">
                Notes
                <textarea
                  aria-label="Notes"
                  rows={7}
                  maxLength={100000}
                  value={draft.record.notes}
                  onChange={(event) => patch({ notes: event.target.value })}
                  placeholder="Why this repo matters to you, what you tried, what to revisit…"
                />
              </label>
              <div className="personal-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!draft.dirty || personal.snapshot.issues.length > 0}
                >
                  {personal.mode === "folder"
                    ? "Save to folder"
                    : "Save in temporary workspace"}
                </button>
                <button
                  type="button"
                  onClick={() => personal.exportDraft(draft)}
                >
                  Export this draft
                </button>
                {draft.dirty && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Discard this unsaved draft?"))
                        personal.discardDraft(match.id);
                    }}
                  >
                    Discard draft
                  </button>
                )}
                {personal.mode === "folder" && (
                  <button
                    type="button"
                    onClick={() => void personal.reloadRecord(match.id)}
                  >
                    Reload disk version
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          <p className="muted">
            {draft.dirty
              ? "Unsaved draft — kept while navigating this tab. Save or export before closing."
              : personal.snapshot.records.has(match.id)
                ? `Last saved: ${draft.record.updated_at}`
                : "No private record yet."}
          </p>
        </>
      )}
      <PersonalMessages />
    </section>
  );
}
export function PersonalWorkspace({
  repositoryHref,
}: {
  repositoryHref: (id: string) => string;
}) {
  const personal = usePersonal();
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState("");
  useEffect(() => {
    if (personal.mode === "disconnected") {
      setStatus("");
      setQuery("");
      setPinned(false);
      setEditing("");
    }
  }, [personal.mode]);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const ids = [
    ...new Set([
      ...personal.snapshot.records.keys(),
      ...personal.drafts.keys(),
    ]),
  ];
  const all = ids.map((id) => {
    const record = personal.drafts.has(id)
      ? personal.drafts.get(id)!.record
      : personal.snapshot.records.get(id)!;
    const repo = personal.repositories.find(
      (repo) => personal.resolve(repo).id === id || normalizeId(repo.id) === id,
    );
    return { id, record, repo };
  });
  const visible = all
    .filter(
      ({ id, record, repo }) =>
        (!status || record.status === status) &&
        (!pinned || record.pinned) &&
        `${id} ${repo?.project.name ?? ""} ${record.notes} ${record.personal_tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.record.pinned) - Number(a.record.pinned) ||
        b.record.updated_at.localeCompare(a.record.updated_at),
    );
  return (
    <section className="personal-workspace">
      <p className="intro">
        Your notes, decisions and trial history. Local files, no account, no
        upload.
      </p>
      <Connections />
      <PersonalMessages />
      <div className="personal-actions">
        <button
          disabled={personal.busy || personal.mode === "disconnected"}
          onClick={() => void personal.exportAll(false)}
        >
          Export ZIP
        </button>
        {supportsFolders() && (
          <button
            disabled={personal.busy || personal.mode === "disconnected"}
            onClick={() => void personal.exportAll(true)}
          >
            Export to folder
          </button>
        )}
        <button
          disabled={personal.busy}
          onClick={() => fileRef.current?.click()}
        >
          Import ZIP or YAML
        </button>
        <button
          disabled={personal.busy}
          onClick={() => folderRef.current?.click()}
        >
          Import folder
        </button>
      </div>
      <input
        className="sr-only"
        tabIndex={-1}
        aria-label="Import ZIP or YAML files"
        disabled={personal.busy}
        ref={fileRef}
        type="file"
        multiple
        accept=".zip,.yaml"
        onChange={(event) => {
          void personal.prepareImport(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        className="sr-only"
        tabIndex={-1}
        aria-label="Import personal folder"
        disabled={personal.busy}
        ref={folderRef}
        type="file"
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          void personal.prepareImport(event.target.files, true);
          event.target.value = "";
        }}
      />
      {personal.pending && (
        <section className="import-review">
          <h2>Review import</h2>
          <p>
            {personal.pending.length} records ·{" "}
            {
              personal.pending.filter(
                (record) =>
                  !personal.snapshot.records.has(record.repository_id),
              ).length
            }{" "}
            new ·{" "}
            {
              personal.pending.filter((record) =>
                personal.snapshot.records.has(record.repository_id),
              ).length
            }{" "}
            already present.
          </p>
          <p>
            Existing records are kept by default. Replacement in a connected
            folder creates backups first.
          </p>
          <label className="personal-check">
            <input
              type="checkbox"
              checked={personal.replace}
              onChange={(event) => personal.setReplace(event.target.checked)}
            />
            Replace existing records with imported versions
          </label>
          <div className="personal-actions">
            <button
              disabled={personal.busy}
              onClick={() => void personal.applyImport()}
            >
              Confirm import
            </button>
            <button
              disabled={personal.busy}
              onClick={() => personal.setPending(null)}
            >
              Cancel import
            </button>
          </div>
        </section>
      )}
      <div className="personal-fields workspace-filters">
        <label>
          Search private notes
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Personal status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusNames[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="personal-check">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          Pinned only
        </label>
      </div>
      <p>
        {visible.length} private records
        {personal.hasDrafts ? " · Unsaved drafts present" : ""}
        {personal.memoryDirty ? " · Export needed" : ""}
      </p>
      {!visible.length && (
        <p className="muted">
          Open a repository detail to add notes, or import an existing personal
          workspace.
        </p>
      )}
      {visible.map(({ id, record, repo }) => (
        <article className="personal-record" key={id}>
          <div>
            <strong>{repo?.project.name ?? id}</strong>
            <span>
              {record.pinned ? "★ " : ""}
              {statusNames[record.status]} · {record.priority} priority
              {personal.drafts.get(id)?.dirty ? " · Unsaved draft" : ""}
            </span>
            {!repo && (
              <p className="muted">
                Not in the current public catalog. Your notes are preserved.
              </p>
            )}
          </div>
          <div className="personal-actions">
            {repo && <a href={repositoryHref(repo.id)}>Repository detail</a>}
            <button onClick={() => setEditing(editing === id ? "" : id)}>
              {editing === id ? "Hide notes" : "Edit notes"}
            </button>
          </div>
          {editing === id && <PersonalEditor recordId={id} />}
        </article>
      ))}
      <p className="muted">
        Use a dedicated folder outside the public repository, optionally managed
        by your desktop sync app. Disconnecting never deletes files. Browser
        storage remembers only the folder handle, not note contents.
      </p>
    </section>
  );
}
