# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the documentation site in this repository.

## Documentation Site Information

- **Documentation Framework**: VitePress (latest)
- **Site URL**: https://docs.1mcp.app/
- **GitHub Pages**: https://1mcp-app.github.io/agent/
- **Auto-deployment**: GitHub Actions on pushes to `main` affecting `docs/` directory
- **Multilingual Support**: English (default) and Chinese (Simplified)

## Development Commands

```bash
# Start development server
pnpm docs:dev

# Build for production
pnpm docs:build

# Preview production build
pnpm docs:preview
```

## Site Architecture

### VitePress Configuration

- **Config files**:
  - `.vitepress/config/index.ts` - Main VitePress configuration with multilingual setup
  - `.vitepress/config/en.ts` - English locale configuration
  - `.vitepress/config/zh.ts` - Chinese locale configuration
- **Theme**: Default VitePress theme with custom styling
- **Search**: Local search provider built-in
- **Mermaid**: Diagrams enabled via `vitepress-plugin-mermaid` with custom theme
- **Schema Generation**: Automatic JSON schema generation via SchemaGenPlugin
- **Analytics**: Google Analytics (G-46LFKQ768B)
- **SEO**: Comprehensive meta tags, Open Graph, Twitter Cards, JSON-LD structured data
- **Sitemap**: Automatic sitemap generation for https://docs.1mcp.app/

### Content Structure

```
docs/
├── .vitepress/
│   └── config/
│       ├── index.ts       # Main configuration with multilingual setup
│       ├── en.ts         # English locale configuration
│       └── zh.ts         # Chinese locale configuration
├── CLAUDE.md             # Documentation guidance file
├── README.md             # Documentation overview
├── en/                   # English documentation (root locale)
│   ├── index.md          # Homepage (hero layout)
│   ├── guide/            # Getting started and feature guides
│   ├── commands/         # CLI command reference
│   └── reference/        # Technical reference documentation
├── zh/                   # Chinese documentation
│   ├── index.md          # Chinese homepage
│   ├── guide/            # Chinese guides
│   ├── commands/         # Chinese command reference
│   └── reference/        # Chinese technical reference
└── public/               # Static assets (logos, screenshots)
    └── images/
```

### Navigation Architecture

- **Multilingual Setup**: English (root) and Chinese locales
- **Three-tier navigation**: Guide → Commands → Reference
- **Nested sidebars**: Configured per locale in respective config files
- **Cross-linking**: Uses absolute paths (`/guide/getting-started`)
- **URL Rewriting**: English content served from root paths (no `/en/` prefix)

## Content Guidelines

### Markdown Features

- **Frontmatter**: Required for page metadata and layout
- **Code highlighting**: JavaScript/TypeScript/Bash syntax highlighting
- **Line numbers**: Enabled by default for code blocks
- **Mermaid diagrams**: Supported for architecture diagrams
- **Search**: Content automatically indexed for local search
- **Template syntax escaping**: Use `v-pre` to prevent Vue interpolation of template syntax

### Template Syntax Escaping with `v-pre`

VitePress uses Vue for rendering, which means `{{ }}` syntax gets interpreted as Vue templates. To display Handlebars or other template syntax literally:

**Inline template syntax** - Use `<span v-pre>` tags:

```markdown
- Use <span v-pre>`{{variable}}`</span> for template variables
- The <span v-pre>`{{#if condition}}`</span> helper enables conditionals
```

**Code blocks with template syntax** - Use `::: v-pre` container:

````markdown
::: v-pre

```text
{{#each servers}}
  {{name}}: {{instructions}}
{{/each}}
```
````

:::

```

**Important**:
- Always wrap Handlebars syntax (`{{}}`) with `v-pre` to prevent Vue from trying to interpolate it
- For single inline variables, use `<span v-pre>`
- For entire code blocks containing multiple template expressions, use the `::: v-pre` fence
- Without `v-pre`, Vue will throw errors or display content incorrectly

**SSR crash with dot-notation variables**:
- `<span v-pre>` prevents Vue from **rendering** `{{ }}` at runtime, but the SSR compiler still **parses and compiles** the surrounding template
- Simple variables like `{{serverCount}}` resolve to `undefined` during SSR, which is safe (renders as empty string)
- Dot-notation variables like `{{project.path}}` cause a **TypeError** during SSR build because Vue tries to access `.path` on `undefined`
- **Fix**: Wrap sections containing inline dot-notation template variables in `<ClientOnly>` tags, which skips SSR entirely for that content
- Code blocks inside `::: v-pre` fences are unaffected — `v-pre` at the block level prevents compilation entirely
- Example: `<ClientOnly>` is needed in `serena.md` (uses `{{project.path}}`) but not in `custom-instructions-template.md` (uses only simple variables like `{{serverCount}}`)

### Writing Standards
- **Clear headings**: Use semantic hierarchy (H1 → H2 → H3)
- **Code examples**: Include working examples for all commands
- **Internal links**: Use absolute paths starting with `/`
- **External links**: Full URLs for GitHub, npm, etc.

### Page Types
1. **Hero pages**: Use `layout: home` with hero configuration
2. **Guide pages**: Step-by-step tutorials and explanations
3. **Reference pages**: Technical specifications and API docs
4. **Command pages**: CLI command documentation with examples

## Key Configuration Areas

### Site Navigation (TypeScript Config)
- **Locales**: English (root) and Chinese (`/zh/`) with language switcher
- **Top nav**: Guide, Commands, Reference, Version dropdown
- **Sidebar**: Three separate sidebar configs for each section per locale
- **Social links**: GitHub repository link
- **Edit links**: Direct to GitHub edit interface

### Content Organization
- **Guide section**: Getting started, features, integration guides, Claude Desktop integration, fast startup
- **Commands section**: Complete CLI reference including MCP commands (formerly server commands)
- **Reference section**: Architecture, security, API documentation, health checks, trust proxy

### Asset Management
- **Images**: Store in `public/images/` directory
- **Screenshots**: Include for UI-heavy features (OAuth, Claude Desktop)
- **Logos**: Site logo and favicon configured in head section

## Development Patterns

### Adding New Content
1. **Create markdown file** in appropriate directory
2. **Add frontmatter** with title and description
3. **Update navigation** in `.vitepress/config.js` sidebar
4. **Test internal links** before committing
5. **Verify build** with `pnpm docs:build`

### Content Cross-References
- **Main project**: Link to `../README.md`, `../CHANGELOG.md`
- **Command docs**: Reference actual CLI help output
- **Architecture**: Link between guide and reference sections
- **Examples**: Include working configuration files

### Asset Optimization
- **Images**: Optimize for web (PNG/JPG)
- **Screenshots**: Include for complex UI flows
- **Diagrams**: Use Mermaid for system architecture
- **File sizes**: Keep assets reasonable for fast loading

## Deployment Process

### Automatic Deployment
- **Trigger**: Pushes to `main` branch with `docs/` changes
- **Workflow**: `.github/workflows/deploy-docs.yml`
- **Build process**: VitePress static site generation
- **Hosting**: GitHub Pages with custom domain

### Manual Verification
- **Local build**: `pnpm docs:build` before pushing
- **Link validation**: Check all internal/external links
- **Mobile testing**: Verify responsive layout
- **Search functionality**: Confirm search works post-deploy

## Site Features

### Built-in Capabilities
- **Dark/light mode**: Automatic theme switching
- **Mobile responsive**: Works on all device sizes
- **Fast loading**: Optimized static site generation
- **SEO friendly**: Meta tags, sitemap, structured data
- **Offline capable**: Service worker for offline access

### Custom Enhancements
- **Mermaid diagrams**: Architecture and flow diagrams
- **Code copy buttons**: One-click code copying
- **Last updated timestamps**: Automatic update tracking
- **Edit suggestions**: Direct GitHub edit links
- **Version information**: Linked to changelog and releases

## Important Files

### Configuration Files
- `.vitepress/config/index.ts`: Main site configuration with multilingual setup
- `.vitepress/config/en.ts`: English locale configuration
- `.vitepress/config/zh.ts`: Chinese locale configuration
- `package.json`: Documentation build scripts (docs:*)

### Content Templates
- `en/index.md`: Homepage hero layout example
- `en/guide/getting-started.md`: Standard guide page structure
- `en/commands/mcp/add.md`: MCP command reference format
- `en/reference/architecture.md`: Technical reference format
- Corresponding Chinese versions in `zh/` directory

## Quality Standards

### Content Requirements
- **Accuracy**: All commands and examples must work
- **Completeness**: Cover all features and use cases
- **Clarity**: Write for both beginners and experts
- **Currency**: Keep synchronized with actual implementation

### Technical Standards
- **Valid markdown**: Proper syntax and formatting
- **Working links**: All internal and external links functional
- **Mobile friendly**: Content readable on all devices
- **Fast loading**: Optimized images and minimal dependencies
```
