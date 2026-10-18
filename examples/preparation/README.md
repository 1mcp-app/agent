# Preparation recipe developer fixture

This is a disposable test backend for contributors working on preparation recipes. It checks a snapshot of one `source.txt` file to demonstrate initialization, synchronization, checkout isolation, and pending tool responses.

It does not prepare CodeGraph, Code Review Graph, Serena, or a real project index. End users do not need to run it. The files are source-checkout examples and are not included in the npm package.

- `recipe.json`: the configured-command recipe used by the E2E test.
- `fixture.mjs`: the toy backend and its probe/action commands.
- `create-demo.mjs`: creates two temporary checkouts and configuration for a local walkthrough.

For prerequisites, commands, and expected results, see the [integration author guide](../../docs/development/backend-preparation-recipes.md). For ordinary server use, see [Backend preparation](https://docs.1mcp.app/guide/backend-preparation).
