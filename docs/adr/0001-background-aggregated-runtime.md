# Background Aggregated Runtime

`1mcp serve --background` starts a detached **Background Aggregated Runtime** for the selected **Runtime Scope**, while `1mcp serve --status`, `1mcp serve --stop`, and `1mcp serve --restart` own lifecycle inspection, shutdown, and stop-then-start. `--restart` is a composition of `--stop` then `--background` and introduces no new lifecycle primitives. Runtime uniqueness is scoped to the configuration directory: the default config directory behaves as the global runtime, and an explicit alternate `--config-dir` may run its own instance. Client surfaces such as `proxy`, `inspect`, and `run` remain attach-only rather than implicitly starting or stopping runtimes.

Background runtimes are HTTP-only because lifecycle discovery, readiness, and PID-file status all depend on an HTTP runtime URL; stdio cannot be detached safely because the protocol uses the invoking process stdin/stdout.
