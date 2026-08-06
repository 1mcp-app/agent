# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `1mcp-app/agent`. Run GitHub CLI operations through `rtk proxy gh`.

## Conventions

- **Create an issue**: `rtk proxy gh issue create --repo 1mcp-app/agent --title "..." --body "..."`
- **Read an issue**: `rtk proxy gh issue view <number> --repo 1mcp-app/agent --comments`
- **List issues**: `rtk proxy gh issue list --repo 1mcp-app/agent --state open --json number,title,body,labels,comments`
- **Comment on an issue**: `rtk proxy gh issue comment <number> --repo 1mcp-app/agent --body "..."`
- **Apply / remove labels**: `rtk proxy gh issue edit <number> --repo 1mcp-app/agent --add-label "..."` / `--remove-label "..."`
- **Close**: `rtk proxy gh issue close <number> --repo 1mcp-app/agent --comment "..."`

When running from this clone, `rtk proxy gh` can infer the repository from `git remote -v`; pass `--repo 1mcp-app/agent` when running outside the repo or when the remote is ambiguous.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `1mcp-app/agent`.

## When a skill says "fetch the relevant ticket"

Run `rtk proxy gh issue view <number> --repo 1mcp-app/agent --comments`.
