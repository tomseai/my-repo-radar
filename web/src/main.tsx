import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import catalogUrl from "../../generated/catalog.json?url";
import searchUrl from "../../generated/search-index.json?url";
import {
  assertCompatible,
  type CatalogArtifact,
  type SearchArtifact,
} from "../../src/web-model";
import { App } from "./App";
import { PersonalProvider } from "./personal/Personal";
import "./styles.css";

function Bootstrap() {
  const [data, setData] = useState<{
    catalog: CatalogArtifact;
    search: SearchArtifact;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const responses = await Promise.all(
          [catalogUrl, searchUrl].map((url) =>
            fetch(url, { signal: controller.signal }),
          ),
        );
        if (responses.some((response) => !response.ok))
          throw new Error(
            "The catalog could not be loaded. Check your connection and retry.",
          );
        const [catalog, search] = await Promise.all(
          responses.map((response) => response.json()),
        );
        assertCompatible(catalog, search);
        setData({ catalog, search });
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the catalog.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (error)
    return (
      <main className="boot" role="alert">
        <h1>Unable to open the radar</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
        <p>
          <a href="https://github.com/tomseai/my-repo-radar">
            Browse the Markdown catalog
          </a>
        </p>
      </main>
    );
  return data ? (
    <PersonalProvider repositories={data.catalog.repositories}>
      <App {...data} />
    </PersonalProvider>
  ) : (
    <main className="boot" role="status">
      <span className="radar-mark" aria-hidden="true" />
      <h1>Loading your radar…</h1>
      <p>Reading the catalog and search index.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
