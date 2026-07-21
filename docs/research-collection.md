# Research Data Collection

The catalog uses a local, reproducible research cache before agent analysis.
This avoids reducing repository research to a README summary and gives every
agent the same commit-pinned source material.

## Collect bundles

```sh
npm run collect:research
```

Useful focused runs:

```sh
npm run collect:research -- --repo gitbutlerapp/gitbutler
npm run collect:research -- --limit 20
npm run collect:research -- --force
```

The collector creates `.research-cache/`, which is intentionally ignored by
Git. Each repository bundle contains:

- imported GitHub metadata;
- the exact source commit and default branch;
- a bounded repository tree;
- selected README, license, security, setup, architecture, manifest, example,
  and deployment files;
- an optional releases Atom feed;
- a manifest mapping every cached file to its immutable source URL and SHA-256
  digest.

The collector uses a depth-one, blobless Git clone to discover the repository
tree without downloading its full history or working tree. Selected text files
come from commit-pinned `raw.githubusercontent.com` URLs. Default limits prevent
large repositories or binary files from consuming unbounded disk space.

Re-running the command fetches the current default branch and skips bundle
rebuilding when the source commit is unchanged. A failed run can therefore be
resumed safely by running the same command again.

## Agent usage

Agents should read `manifest.json`, `metadata.json`, `tree.json`, and the
selected `files/` before using the network. Missing or ambiguous details may be
researched from additional primary sources, but cached evidence should remain
the common starting point for every analysis.

The cache is an input artifact, not the public catalog. Public repository
records should cite the immutable source URLs recorded in bundle manifests.
