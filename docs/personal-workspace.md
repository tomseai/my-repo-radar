# Private repository notes

The public catalog and your personal data are separate. Open **Private
workspace** in the header, or the **Your private workspace** panel in a
repository detail. There are no accounts, servers, analytics, or cloud APIs.

## Connect a folder

1. Choose a dedicated **empty folder outside the public repository**, or a
   folder previously created by this application.
2. Click **Choose notes folder** and approve the browser's read/write request.
3. Open a repository detail and edit your personal fields.
4. Click **Save to folder**. Changes are not automatically saved as you type.

The browser remembers only the folder handle in IndexedDB when available.
After reopening the app, click **Reconnect previous folder** and approve access
if requested. Notes are re-read from disk, not recovered from a browser cache.
If browser storage was cleared, choose the same folder again.

The directory picker requires a supporting browser and a secure context
(HTTPS or a trustworthy local development origin). Unsupported browsers can
use the temporary workspace and file import/export instead. See the
[File System Access API documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

The folder can be local or managed by an external desktop sync client. The app
only reads/writes local files; it does not sign into OneDrive, Google Drive, or
Dropbox, upload files, or guarantee that a cloud sync has completed. Make sure
your files are locally accessible. Avoid simultaneous editing on multiple devices.

## Personal fields

- Status: unseen, interested, want to try, testing, using, watching, rejected.
- Priority: none, low, medium, high.
- Personal rating: an optional integer from 0 to 10, never a public quality score.
- Pinned, personal tags, and useful-for tags.
- Plain-text notes, up to 100,000 characters, within the 256 KB YAML file limit.
- Tried version and date.
- Creation and last-save timestamps.

Drafts survive navigation within the current tab. Unsaved drafts are marked,
and the browser is asked to warn before the tab closes. Browser warnings are
best effort; save or export before closing. Private search and filters remain
in memory and never enter the shareable catalog URL.

## File format

```text
my-repo-radar-personal/
|-- repo-radar-personal.yaml
|-- repositories/
|   `-- github%3Aexample%2Fproject.yaml
`-- backups/
    `-- <timestamp-and-random-id>/
        `-- github%3Aexample%2Fproject.yaml
```

The marker identifies format version 1. Each repository has one YAML file whose
name is its normalized, URL-encoded public repository ID, avoiding invalid
filename characters and ambiguous owner/name separators. For example:

```yaml
version: 1
repository_id: github:example/project
status: testing
priority: medium
rating: 8
pinned: true
personal_tags:
  - revisit
useful_for:
  - documentation
notes: |
  Example note for a fictional repository.
tried:
  version: v1.0.0
  at: "2026-11-22"
created_at: "2026-11-22T12:00:00.000Z"
updated_at: "2026-11-22T12:00:00.000Z"
```

Unknown fields, future versions, malformed YAML, duplicate keys and aliases
are rejected rather than silently dropped. No schema migration is currently
needed; unsupported versions are left unchanged.

## Conflicts and backups

Before changing an existing record, the app compares its full current file
contents with the version the editor loaded, then saves the previous bytes
under `backups/`. It rechecks after opening the writer, commits by closing the
writable stream, and verifies the saved contents. Same-origin app tabs are
serialized using Web Locks where supported.

If the file changed externally, the save stops and your draft remains intact.
Use **Export this draft** to keep your version, then **Reload disk version**
and reconcile the changes. It never resolves a conflict by guessing which
version is newer. A narrow race with an external sync process remains possible;
this is not a distributed transaction or a live multi-device editing service.

Invalid files and sync-conflict copies cause visible warnings and disable
writes until reviewed. Inspect the folder in a file manager and reload it.
OS metadata such as `.DS_Store`, `desktop.ini`, and `Thumbs.db` is ignored,
including during import; it does not count against record or content limits.
Restore a backup by copying its YAML back to `repositories/` while the editor
has no unsaved draft, then reload. Backups are local files and are not pruned
automatically. To remove a private record, remove its file yourself and reload.

Known public repository aliases are used to find notes after transfers.
Multiple matching identities require manual review instead of an automatic
merge. Notes for repositories no longer in the catalog remain editable in
Private workspace; public catalog removals do not delete them.

## Import and export

- **Export ZIP** downloads the current saved records and workspace marker.
- **Export to folder** writes the same structure into an empty selected folder.
- **Import ZIP or YAML** accepts an app ZIP export or selected version-1 YAML records.
- **Import folder** reads a directory exported by the app. It does not connect
  that directory for ongoing writes; use **Choose notes folder** for that.

Imports show counts before applying. Existing records are kept by default.
Explicitly choosing replacement backs up overwritten records in folder mode.
A multi-file import is not atomic: if one write fails, earlier successful
writes remain, and the app reports the partial completion before stopping.

Workspace exports contain saved current records, **not** drafts or backup
history. Export drafts individually or save them first. Back up the whole
directory with your file manager if you need backup history and invalid/conflict
files too. Check that a browser download completed before closing the tab.

Safe import limits: 2,000 records, 256 KB per YAML file, 20 MB uncompressed
content, and 10 MB compressed ZIP. Unsafe archive paths, duplicate identities,
unsupported files, and excessive expansion are rejected.

## Temporary workspace

This is an explicit fallback, not durable storage. Notes and drafts exist only
in this tab. Save into the temporary workspace, then export a ZIP before closing
or reloading. Import that ZIP next time. The app warns when temporary changes
have not been exported to a folder. The warning remains after a ZIP download
request because the app cannot confirm whether you saved or cancelled it.
It never silently substitutes browser storage for a
failed folder save.

## Privacy boundary

- Notes never modify canonical YAML, generated JSON, public Markdown, or public
  search text. Private fields are not added to URLs or runtime requests.
- Only the chosen folder handle is persisted in IndexedDB; note content is not
  stored in localStorage or IndexedDB. Disconnect clears app memory and the
  remembered handle, without deleting files.
- Personal files and backups are **plain text, not encrypted**. Anyone with
  access to that folder or its cloud account can read them.
- Grant access only to an app origin you trust. Browser permissions/storage are
  origin-scoped, not isolated by a GitHub Pages project path.
- Vite has automatic public-directory copying disabled. Website builds include
  only explicitly imported assets and public catalog data. Personal filenames,
  markers and default export names are ignored by Git as an extra safeguard.
- Still keep the personal directory outside the public checkout. Git ignores
  are not a substitute for this separation, and force-adding files can bypass them.

## Verification scope

Automated tests cover schema validation, archive boundaries, permission denial,
backups, failed writes, and external-change conflicts. Local browser checks cover
editing, navigation-kept drafts, reload/reconnect, folder and ZIP transfer,
replacement confirmation, mobile layouts, and unavailable browser storage.
Folder checks use real browser file handles in a disposable origin-private file
system with a test directory picker. Native operating-system picker permissions
and real OneDrive/Google Drive/Dropbox synchronization still need an end-user
check with a dedicated test folder; they are not claimed as verified.
