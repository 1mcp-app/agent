---
title: Configuration adoption buckets
description: Meaning and limits of private server and tool count observations.
---

# Configuration adoption buckets

Product Usage Telemetry attaches configuration buckets to genuine product activity. Configuration loading, catalog refreshes and idle timers alone create no activity or installation identity. Collection follows the [telemetry controls](/commands/telemetry).

## Measurements

Only an active Aggregated Runtime observes these counts; ordinary CLI configuration reads do not contribute.

`servers` counts validated static server definitions plus declared template definitions at successful configuration load or reload, including disabled definitions. A template definition counts once regardless of how many instances exist. A template takes precedence over a static definition with the same name, so that target counts once. This measures configured definitions, not connected or enabled backends. Failed loads or incomplete definition validation produce no fresh server-count observation.

`tools` counts admitted external tool routes in an acquired runtime capability catalog, excluding internal tools and disabled source tools. It reflects the selected catalog and observed template instances, not every configured backend's potential tools. Disconnected, unavailable, uninstantiated, rejected or timed-out sources can reduce coverage. Different client selections can observe different counts. No extra backend request is made for telemetry.

Only these numeric counts reach the observer; names, schemas, tags, presets, URLs, configuration values and runtime/session identifiers are excluded.

## Buckets and changes

| Count       | Exported bucket |
| ----------- | --------------- |
| 0           | `0`             |
| 1           | `1`             |
| 2–5         | `2-5`           |
| 6–20        | `6-20`          |
| 21–100      | `21-100`        |
| 101 or more | `101+`          |

Only nonnegative safe integers are accepted. A zero observation means an observed zero count; a missing observation means unknown coverage.

Each process keeps the latest snapshot for each measurement, replacing earlier snapshots even when the count decreases. The next admitted genuine activity consumes that snapshot once. Repeated refreshes before activity collapse to one observation; refreshes followed by separate activities may produce repeated observations. These are observation frequencies, not installation totals, current fleet inventory, or UTC-period maxima. UTC reports date the observation with the activity that consumes it, even if the snapshot was taken before UTC midnight. They can contain several buckets for the same installation as configuration or selection changes.

## Shared identity and report limits

Runtime Scopes use the same local installation identity. The service deduplicates installation activity by identity rather than adding scopes as installations. Bucket measures sum observations; they do not union tools across scopes, select a per-installation maximum, or count distinct installations within each bucket. Do not add bucket observation counts to estimate installations. A reset can produce a new identity; disable clears unsent observations, and transmitted data cannot be recalled.

Human and explicitly enabled CI observations remain separate. Ordinary automated tests are excluded. Best-effort delivery, partial catalogs, resets and missing activity limit coverage. The private report's configuration rows show measurement name, bucket and observation count; they cannot reconstruct customer configuration.
