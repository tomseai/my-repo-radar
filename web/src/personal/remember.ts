import type { PersonalDirectory } from "../../../src/personal-store";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("repo-radar-personal-handles", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onerror = () =>
      reject(new Error("Browser storage is unavailable."));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function rememberFolder(
  handle: PersonalDirectory | null,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      if (handle) tx.objectStore("handles").put(handle, "directory");
      else tx.objectStore("handles").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          new Error("Could not update the saved folder permission handle."),
        );
    });
  } finally {
    db.close();
  }
}
export async function recalledFolder(): Promise<PersonalDirectory | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("handles", "readonly")
        .objectStore("handles")
        .get("directory");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new Error("Could not recall the folder."));
    });
  } finally {
    db.close();
  }
}
