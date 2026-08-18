---
title: Historical 1MCP Project Roadmap
description: Archived 2025 roadmap retained as historical planning context; it does not describe the current release.
status: archived
archived: 2026-08-06
---

# Historical 1MCP Project Roadmap

> Archived on 2026-08-06. This is a historical planning snapshot, not current product guidance. Its references to v0.28.0 describe the release line planned at the time. Consult the [changelog](https://github.com/1mcp-app/agent/blob/main/CHANGELOG.md), current command documentation, and release workflows for current behavior.

> **Unified Model Context Protocol server that aggregates multiple MCP servers into a single interface**

## 📊 Project Overview

**1MCP (One MCP)** simplifies AI assistant configuration by providing a unified proxy for multiple MCP servers, reducing resource usage and complexity.

- **Current Version**: v0.28.0 (December 2025)
- **Repository**: [github.com/1mcp-app/agent](https://github.com/1mcp-app/agent)
- **Maintainer**: [@xizhibei](https://github.com/xizhibei)
- **Target Users**: AI assistant users, developers with multiple MCP servers, organizations needing centralized MCP management

## 🎯 Priorities

| Priority        | Focus Area                     | Timeline | Success Metric                                        |
| --------------- | ------------------------------ | -------- | ----------------------------------------------------- |
| 🔴 **Critical** | Proxy Agent Context Release    | Q1 2026  | Enhanced context management for proxy agents          |
| 🔴 **Critical** | MCP Tools Lazy Loading         | Q1 2026  | Reduced startup time, on-demand tool loading          |
| 🔴 **Critical** | Protocol Compliance & Security | H1 2026  | MCP spec compatibility, zero critical vulnerabilities |
| 🔴 **Critical** | Web Management UI              | H2 2026  | Beta release with core management features            |
| 🟡 **High**     | Developer Experience           | H2 2026  | Improved documentation, setup wizard                  |
| 🟡 **High**     | Performance & Reliability      | Ongoing  | 50% latency reduction, better resource usage          |
| 🟢 **Medium**   | Plugin Ecosystem               | 2027+    | Community contributions, extensible architecture      |

## 📅 Development Timeline

### H1 2026 (January - June)

**🎯 Focus: Foundation & Performance**

| Feature                             | Status      | Effort | Notes                                        |
| ----------------------------------- | ----------- | ------ | -------------------------------------------- |
| **Proxy Agent Context**             | 🚧 Planning | High   | Enhanced context management for proxy agents |
| **MCP Tools Lazy Loading**          | 🚧 Planning | High   | On-demand tool loading, reduced startup time |
| **Protocol Version Validation**     | 🚧 Planning | Medium | MCP spec compatibility checker               |
| **Security Hardening**              | 📋 Planned  | Medium | Input validation, sandboxing                 |
| **Configuration Schema Validation** | 📋 Planned  | Low    | JSON schema enforcement                      |
| **Enhanced Monitoring**             | 📋 Planned  | Medium | Real-time health checks and metrics          |

### H2 2026 (July - December)

**🎯 Focus: User Experience & Tools**

| Feature                         | Status     | Effort | Help Needed                    |
| ------------------------------- | ---------- | ------ | ------------------------------ |
| **Web Management UI**           | 📋 Planned | High   | Frontend contributions welcome |
| **Health Monitoring Dashboard** | 📋 Planned | Medium | Real-time status display       |
| **Setup Wizard**                | 📋 Planned | Medium | User onboarding flow           |
| **Enhanced Debugging Tools**    | 📋 Planned | Low    | Better error messages          |

### 2027+

**🎯 Focus: Ecosystem & Scale**

| Feature                       | Status     | Effort | Community Opportunity                 |
| ----------------------------- | ---------- | ------ | ------------------------------------- |
| **Plugin System**             | 💭 Idea    | High   | Core architecture + community plugins |
| **Advanced Analytics**        | 💭 Idea    | Medium | Usage tracking and insights           |
| **Performance Optimizations** | 📋 Planned | Medium | Connection pooling, caching           |
| **Distributed Architecture**  | 💭 Idea    | High   | Multi-instance coordination           |

## 🚦 Current Status

### ✅ Completed (v0.16.0 - v0.27.4)

**Core Platform**

- ✅ MCP server aggregation with multi-transport support
- ✅ Complete CLI suite with preset management
- ✅ OAuth 2.1 authentication with scope-based authorization
- ✅ Cross-platform binary distribution (SEA builds)
- ✅ 90%+ test coverage with comprehensive CI/CD

**Recent Enhancements** (v0.23.0 - v0.27.4)

- ✅ Context-aware template processing with Handlebars
- ✅ Client instance pooling and connection lifecycle management
- ✅ Security hardening with path validation and sandboxing
- ✅ Cross-domain integration testing framework

**Latest Release** (v0.28.0)

- ✅ **Comprehensive MCP Server Management System** - Enhanced server lifecycle management
- ✅ **Pre-release Version Detection** - Improved Docker and npm workflows
- ✅ **Updated Documentation** - Fixed binary names in installation guide

**Upcoming Release** (v0.29.0)

- ✅ **Proxy Agent Context** - Enhanced context management for proxy agent scenarios

### 🚧 Currently Working On

| Feature                        | Progress | Next Step                        | Challenges                              |
| ------------------------------ | -------- | -------------------------------- | --------------------------------------- |
| **Proxy Agent Context**        | 80%      | Final testing & documentation    | Integration testing with various agents |
| **MCP Tools Lazy Loading**     | 10%      | Design lazy loading architecture | Tool discovery timing                   |
| **Protocol Version Check**     | 20%      | Research MCP spec changes        | Keeping up with spec evolution          |
| **Configuration Validation**   | 60%      | Integrate with existing config   | Backward compatibility                  |
| **Enhanced Error Handling**    | 40%      | Better user feedback messages    | Balancing detail vs clarity             |
| **Documentation Improvements** | 30%      | More examples and tutorials      | Time constraints                        |

## 🔮 Future Ideas

### Long-term Vision

| Idea                          | Timeline   | Value                           | Dependencies                  |
| ----------------------------- | ---------- | ------------------------------- | ----------------------------- |
| **Advanced Lazy Loading**     | Post v0.28 | Better performance, scalability | Tool metadata standardization |
| **Plugin System**             | 2027+      | Community contributions         | Core API stability            |
| **Smart Tool Caching**        | Post v0.28 | Faster tool access              | Cache invalidation strategy   |
| **Performance Optimizations** | Ongoing    | Better user experience          | Profiling and metrics         |
| **Advanced Analytics**        | 2027+      | Usage insights                  | Privacy considerations        |
| **Natural Language Config**   | 2028+      | Accessibility                   | AI/ML integration             |

## ⚠️ Challenges & Considerations

| Challenge                | Impact   | Mitigation                   |
| ------------------------ | -------- | ---------------------------- |
| **MCP Spec Evolution**   | High     | Flexible adapter system      |
| **Security Maintenance** | Critical | Regular dependency updates   |
| **Time Constraints**     | Medium   | Community contributions      |
| **Support Load**         | Medium   | Good documentation           |
| **Burnout Prevention**   | Critical | Sustainable development pace |

## 🛠️ Technical Priorities

### Infrastructure & Tools

| Area              | Focus          | Current Status                |
| ----------------- | -------------- | ----------------------------- |
| **CI/CD**         | GitHub Actions | ✅ Automated builds and tests |
| **Testing**       | Unit & E2E     | ✅ 90%+ coverage              |
| **Documentation** | VitePress      | ✅ Functional site            |
| **Releases**      | Automated      | ✅ Multi-platform binaries    |
| **Monitoring**    | Basic logs     | 🚧 Needs enhancement          |

## 📈 Community & Success Metrics

| Metric                    | Current  | Goal (2026)         | How to Measure       |
| ------------------------- | -------- | ------------------- | -------------------- |
| **GitHub Stars**          | 500+     | 1,000+              | GitHub API           |
| **Issues/PRs**            | Active   | More contributions  | GitHub activity      |
| **Community Engagement**  | Growing  | Regular discussions | Discord, Discussions |
| **Documentation Quality** | Good     | Excellent           | User feedback        |
| **User Satisfaction**     | Positive | 90%+ satisfied      | Surveys, feedback    |

## 🤝 How to Contribute

As a solo maintainer, community contributions are greatly appreciated! Here's how you can help:

### 🚀 Quick Contributions

- **Report Issues**: Found a bug? [Open an issue](https://github.com/1mcp-app/agent/issues)
- **Documentation**: Improve docs or add examples
- **Examples**: Share your 1MCP configurations
- **Feedback**: Test new features and provide feedback

### 💻 Code Contributions

- **Good First Issues**: Look for `good first issue` labels
- **Web UI**: Frontend development for the management interface
- **Proxy Agent Context**: Help with final testing and integration
- **Lazy Loading Implementation**: Help design and implement tool lazy loading
- **Plugin System**: Help design and implement the plugin system
- **Testing**: Add test cases or improve test coverage

### 📋 Areas Seeking Help

| Area                       | Skills Needed              | Difficulty |
| -------------------------- | -------------------------- | ---------- |
| **MCP Tools Lazy Loading** | Node.js, async programming | High       |
| **Web Management UI**      | React/Vue, Node.js         | Medium     |
| **Documentation**          | Writing, examples          | Low        |
| **Testing**                | Jest, E2E testing          | Medium     |
| **Security Review**        | Security analysis          | High       |
| **Performance**            | Node.js optimization       | High       |

---

## 📞 Contact & Community

- **Issues & Bug Reports**: [GitHub Issues](https://github.com/1mcp-app/agent/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/1mcp-app/agent/discussions)
- **Questions**: [GitHub Discussions](https://github.com/1mcp-app/agent/discussions)
- **Documentation**: [docs.1mcp.app](https://docs.1mcp.app/)

---

**Last Updated**: December 21, 2025 (v0.28.0)
**Next Review**: June 30, 2026
**Maintainer**: [@xizhibei](https://github.com/xizhibei)

_This roadmap evolves based on user feedback and community contributions. Schedule may adjust based on personal capacity and priorities._
