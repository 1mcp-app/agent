# Admin Console Operations Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the current admin console into a polished operations cockpit while preserving its API and behavior.

**Architecture:** Keep `AdminConsoleApp` as the existing behavior boundary and reshape only its authenticated shell and presentation. Reuse Mantine primitives and the current state/callback contracts, then verify the built SPA with the existing Playwright fixture.

**Tech Stack:** React 18, Mantine 8, Lucide React, CSS, Vitest, Testing Library, Playwright

---

### Task 1: Lock the cockpit semantics

**Files:**

- Modify: `web/admin/src/components/AdminConsoleApp.test.tsx`

- [ ] Add expectations for the operations navigation, command bar, overview heading, runtime health, and server inventory workspace.
- [ ] Run `pnpm test:admin -- web/admin/src/components/AdminConsoleApp.test.tsx` and confirm the new expectations fail.

### Task 2: Build the authenticated shell

**Files:**

- Modify: `web/admin/src/components/AdminConsoleApp.tsx`
- Modify: `web/admin/src/styles.css`
- Modify: `web/admin/src/theme.ts`

- [ ] Replace the thin header and status strip with a navigation rail and compact command bar.
- [ ] Reorganize the overview and inventory hierarchy without changing callbacks or API data.
- [ ] Add responsive styles for desktop, tablet, and mobile widths.
- [ ] Run the focused admin component test and confirm it passes.

### Task 3: Verify the built interface

**Files:**

- Modify: `test/e2e/admin-spa-browser-smoke.e2e.test.ts`

- [ ] Assert the cockpit landmarks and open a configured-server detail view in Playwright.
- [ ] Build the SPA with `pnpm build`.
- [ ] Run the focused Playwright smoke test at desktop and mobile widths.
- [ ] Run typecheck, lint, admin tests, formatting checks, and `git diff --check`.
