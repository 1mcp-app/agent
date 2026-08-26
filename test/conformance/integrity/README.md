# Conformance integrity integration

Call `verifyConformanceIntegrity` before producing a Conformance Baseline. A
baseline may be infrastructure-green only when the returned report has
`ok: true`; bind `report.digest` and `report.source.sha` into the baseline.

The caller supplies repository-relative locations for:

- the source Git worktree and expected exact SHA;
- every artifact plus its previously recorded SHA-256 digest;
- the root package manifest, installed package manifests, and `pnpm-lock.yaml`;
- both frozen official requirement YAML files;
- the Go `go.mod`, `go.sum`, and vendor tree; and
- the Python `pyproject.toml` and `uv.lock`.

`pnpm-lock.yaml` must be parsed with a structured YAML parser supplied as
`npm.parseYaml`. The integrity module intentionally does not parse YAML text or
add a dependency. Integration may pass the repository's selected YAML parser,
for example `parse` from the `yaml` package.

The verifier checks the complete accepted package set and fixed ecosystem
inputs; callers cannot weaken pins by omitting a package. Reports and classified
issues contain logical IDs and package names only. Supplied absolute paths, Git
status filenames, parser errors, environment values, and file contents are not
retained.

Directory hashing sorts normalized relative file paths by UTF-8 bytes and hashes
each path with the SHA-256 of its bytes. Symlinks and other non-file entries are
rejected so hashing never follows content outside the supplied tree.
