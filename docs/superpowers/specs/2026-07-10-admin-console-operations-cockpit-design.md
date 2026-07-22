# Admin Console Operations Cockpit Design

## Goal

Refine the existing React and Mantine admin console into a dense operations cockpit without changing the `/admin/api` contract or removing current workflows.

## Layout

- Use a persistent graphite navigation rail on desktop and a compact horizontal rail on narrow screens.
- Keep a slim top command bar for runtime status, refresh, and logout.
- Present the main area as a focused workspace with an overview header, operational counters, server inventory, and supporting runtime, OAuth, and audit panels.
- Preserve the configured-server detail editor and preview flow while giving the inventory more horizontal room.

## Visual System

- Use graphite navigation surfaces, warm off-white workspace surfaces, and teal as the primary operational accent.
- Reserve amber and red for attention and failure states.
- Use compact uppercase labels, tabular operational values, restrained borders, and low-elevation panels.
- Avoid decorative gradients, excessive rounding, and dashboard-card repetition.

## Interaction

- Keep server search, filtering, enable/disable actions, detail editing, preview, refresh, copy, and logout behavior unchanged.
- Add clear navigation landmarks and a live runtime indicator.
- Keep the layout free of page-level horizontal overflow at mobile widths.

## Verification

- Extend component tests to cover the cockpit landmarks and labels.
- Use Playwright against the built SPA for desktop and mobile verification, including login, filtering, mutation, detail opening, and screenshot inspection.
