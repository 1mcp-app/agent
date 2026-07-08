# Admin Console Uses a Normalized Edit Contract

The Admin Console edits Configured Server Targets through a hand-authored normalized edit contract exposed by `/admin/api`, not by passing raw config objects, raw JSON, or the runtime Zod schema into the browser. The contract presents operator-facing field groups, structured form controls, redacted domain diffs, secret actions, validation messages, risk flags, preview fingerprints, and Environment Secret Reference defaults, while Admin Operations keep authorization, idempotency, audit, Config Change, backup, validation, and reload-observation semantics on the server side.

This avoids coupling the browser to storage shape, makes broad edits and renames confirmable, and keeps secret material out of previews, URLs, local storage, and raw diff output.
