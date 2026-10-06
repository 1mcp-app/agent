# 维护者发布操作手册

本手册供负责 1MCP 版本发布的维护者使用。通过手动 **Release Pipeline** 发起发布。[#474](https://github.com/1mcp-app/agent/issues/474) 负责发布批准；[#485](https://github.com/1mcp-app/agent/issues/485) 负责兼容性、性能、金丝雀和回滚标准。工作流引用已批准的证据，不自行制定这些标准。

## 发起前

- 使用当前获批的 Release Pipeline 工作流版本。`target_ref` 必须是 `main` 或版本对应的 `release-MAJOR.MINOR` 分支；新发布必须使用尚未发布的新版本。
- 新发布前确认源码分支的 `.github/actions/setup-node-pnpm/action.yml` 与 dispatch 版本中的 action 字节完全一致。版本更新和候选解析在调用候选代码前拒绝旧版或不同的本地 action，因为旧 action 可能忽略缓存关闭参数。准备新候选前先对齐分支策略；不要修改、重建或替换已存在的恢复候选来通过此检查。历史候选不兼容时停止并由负责人核对。
- 提供发布负责人批准链接，以及该候选版本已获批准的 #485 就绪证据链接。两者均为本仓库 issue/PR URL，可包含评论锚点。记录 URL 不等于验证批准内容：负责人必须确认决定、范围、版本和源码身份。
- 确认现有 `release` environment、仓库权限和 npm trusted publisher 配置适用。工作流保留该 environment，不新增人工审核人或修改保护规则。
- npm trusted publishing 必须授权此工作流，并启用 **Allow npm dist-tag**。工作流安装支持 OIDC dist-tag 的 npm `11.21.0`；仅有 publish 权限不足以推进别名。凭据或 trusted publisher 配置属于负责人独立操作；失败后不要自动添加宽权限 token。
- 通过 #485 确认适用的外部安全及就绪决定。工作流绿色不替代这些决定。

## 正常发布

以下命令仅在负责人批准发布后执行；它们会修改版本提交、registry、Git tag、release 附件及渠道别名。

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f target_ref=main -f version=1.2.3   -f approval_ref=https://github.com/1mcp-app/agent/issues/474#issuecomment-APPROVED   -f readiness_ref=https://github.com/1mcp-app/agent/issues/485#issuecomment-APPROVED

gh run list --repo 1mcp-app/agent --workflow release-pipeline.yml --limit 5
gh run watch RUN_ID --repo 1mcp-app/agent --exit-status
gh run download RUN_ID --repo 1mcp-app/agent --name release-summary --dir release-evidence
```

将示例版本、批准锚点和 run ID 替换为实际获批值。版本更新后只解析一次最终提交。既有可复用 CI 检查该 SHA，包括静态检查、单元/Admin、全部既有 E2E 分片、浏览器/后台运行/打包/升级/Windows 安装器、Node/SEA 协作生命周期及 gate 模式产品一致性。原生凭据安全检查也运行在同一 SHA。即使 baseline 基础设施证据绿色，产品红色或缺失、损坏、过期的一致性证据也会阻止发布。

构建使用冻结依赖，保留已安装并冒烟测试的 npm tarball、五个平台的 SEA 压缩包及四个 OCI 平台 digest。每份 JSON 记录将版本/渠道/SHA 与压缩包 SHA-256、npm SHA-512 integrity、OCI digest 绑定。同 SHA 的独立构建不保证字节相同；发布和推进别名使用这些已测试对象，不重新构建。

npm 版本先发布到 `candidate-VERSION` 暂存 dist-tag（点替换成连字符）。OCI basic/extended 版本 manifest 引用已测试的 amd64/arm64 digest；GitHub 使用保留的 SEA 附件。必须读回验证 npm 身份/integrity、OCI revision/version/平台 digest、真实 Git tag 提交及下载后的二进制校验和，才能移动别名。稳定版推进 npm `latest`、OCI `latest`/`lite`、两种镜像的主版本/次版本别名及 GitHub latest。发布和别名推进成功后才完成维护分支。

请查看 `release-summary.json`，而不只看任务状态。摘要链接 run/release、批准及产物来源 run，记录源码和产物身份、gate 结果、已验证发布及每个别名状态。`attempting` 表示外部结果不确定。失败后仍执行摘要收集/上传，但依赖 runner 可用。始终执行的收集任务使用只读权限；独立任务在既有 `release` environment 中附加 JSON 快照。摘要提供预期附件链接，并要求检查该受保护任务的结果。附件失败不影响工作流 artifact 保留。附件按 run/attempt 命名，不覆盖原摘要。

## 非默认渠道演练

真实演练是经授权的发布，不是本地模拟。使用新预发布版本，并取得该次演练的批准：

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f target_ref=main -f version=1.2.3-beta.1   -f approval_ref=https://github.com/1mcp-app/agent/issues/474#issuecomment-REHEARSAL   -f readiness_ref=https://github.com/1mcp-app/agent/issues/485#issuecomment-REHEARSAL
```

Beta/alpha/rc 的 npm 推进到 `next`，extended OCI 推进到对应预发布渠道（如 `beta`），GitHub 标记 prerelease。它们不移动 npm `latest`、OCI 稳定版/主次版本别名、`lite` 或 GitHub latest。其他命名预发布渠道沿用既有 npm 渠道策略。稳定别名保留名称（`latest`、`lite`、`vMAJOR`、`vMAJOR-lite`）不能作为预发布渠道。

## 恢复部分发布

不要盲目重跑失败的发布任务。先下载摘要，检查日志及外部读回结果。必须保留原版本以及精确源码/产物身份，不重新打 tag、打包、构建或替换该版本现有内容。产物缺失/过期会阻止恢复；选择另一 run 或重建不能证明原来测试的字节。

负责人只读核查命令：

```bash
npm view @1mcp/agent@1.2.3 version gitHead dist.integrity --json
npm view @1mcp/agent dist-tags --json
gh api repos/1mcp-app/agent/git/ref/tags/v1.2.3
gh release view v1.2.3 --repo 1mcp-app/agent --json url,assets,isDraft,isPrerelease
docker buildx imagetools inspect ghcr.io/1mcp-app/agent:v1.2.3 --raw
docker buildx imagetools inspect ghcr.io/1mcp-app/agent:v1.2.3-lite --raw
```

Annotated Git tag 还须查询 tag 对象并解析到提交。下载 GitHub 附件并与 manifest 校验和比较，核对两种 OCI 镜像的平台 digest/revision/version。Registry 错误、读回不可用、异常 tag/release 或冲突附件属于不确定状态，不能当作不存在。暂停并由负责人核对；不要删除、覆盖二进制附件、使用 `--clobber` 或重复执行结果不明的 publish。

完成核对并明确批准恢复后，选择**最初产生产物的 Release Pipeline run**、最终 SHA 和相同版本：

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f target_ref=main -f version=1.2.3   -f recovery_run_id=ORIGINAL_RUN_ID -f candidate_sha=FINAL_40_CHARACTER_SHA   -f approval_ref=https://github.com/1mcp-app/agent/issues/474#issuecomment-RECOVERY   -f readiness_ref=https://github.com/1mcp-app/agent/issues/485#issuecomment-APPROVED
```

恢复先在 dispatch 工作流版本运行 resolver，尚不执行候选代码；验证原 run 是本仓库从 `main` 或匹配维护分支发起、已结束的手动发布工作流，摘要与 SHA/版本/渠道一致，且原 CI/原生安全 gate 成功。候选 package 元数据和本地 setup action 只作为数据解析；要求 action 字节与可信 dispatch 版本一致，并确认提交属于获批发布源码分支后才允许下游 checkout。随后重新执行最终 SHA 检查，跳过版本写入及产物构建，要求全部原始保留产物。写入任何缺失步骤前，先验证所有已存在的版本身份。匹配的 npm/OCI 内容和二进制附件直接复用；明确不存在的版本发布或附件可显式续做。只有 Git tag 而缺少匹配 release 属于不确定状态，由负责人处理。别名推进再次核查全部版本身份，跳过已匹配的别名。DNS、代理、授权错误不会推导为缺失。

本地 fixture 不发布任何内容，模拟四类故障：发布前失败、部分版本发布、部分别名推进、已存在身份冲突/不确定。另覆盖 beta/稳定版隔离、原 run 验证和缺失/篡改产物。运行 `node --test test/release/*.test.cjs` 与 `pnpm test:unit src/release`。本地结果不能证明真实 registry、OIDC、保护配置或负责人演练成功。声明发布就绪前仍需真实负责人演练；产品一致性 baseline 红色应先由所属工作流解决。

配置中的发布检查、版本更新、产物构建及发布不读取或保存共享依赖缓存。选择源码时关闭 pnpm 和一致性 uv 缓存，并显式关闭 setup-node 自动 package-manager 缓存。OCI 发布构建不使用共享 GitHub Actions 构建缓存。未选择 checkout 的常规 CI 保持既有依赖缓存。可信 resolver 在执行前将候选源码绑定到获批分支；缓存隔离进一步避免发布读取或保存共享依赖缓存。

## 必需安全检查清单

| 检查                  | 执行位置及证据                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 冻结依赖              | 既有 setup action 使用 `pnpm install --frozen-lockfile`；Docker 阶段使用冻结 lockfile；一致性 peer 使用冻结 pnpm/uv lock。                                                 |
| 工作流 shell/输入检查 | 既有可复用 CI 执行 SHA-256 固定的 actionlint 与 shellcheck；凭据发布前验证 candidate、批准引用和恢复身份。                                                                 |
| SDK 供应链边界        | 既有 CI static 执行 SDK boundary/topology 和 policy 测试；一致性检查固定依赖、规范及精确源码证据完整性。                                                                   |
| AUTH-07 凭据权限      | CI 执行 `pnpm test:security-permissions`，包括权限不变量及静态 mode guard。                                                                                                |
| 原生凭据存储          | 既有 Linux/macOS/Windows Node/SEA 工作流复用最终 SHA，包含校验和固定的 helper fixture 和真实临时 OS 存储核查。                                                             |
| npm provenance        | 保留 tarball 发布沿用 `--provenance`/OIDC；源码 SHA/ref 显式绑定最终版本提交/已验证分支，工作流/run 身份仍是实际 dispatch。读回还验证 npm `gitHead` 和 SHA-512 integrity。 |
| 产物身份/冒烟         | 安装后的 npm CLI、每个支持的 SEA 平台、basic/extended OCI amd64/arm64 通过版本冒烟；保留并读回压缩包/digest。                                                              |
| 外部策略/就绪         | 负责人提供适用兼容性/安全/金丝雀要求的已批准 #485 引用。仓库托管策略检查与此手动 run 分开。                                                                                |

既有 OCI 配置保持 `provenance: false`、`sbom: false`，这些发布工作流没有 scanner 步骤；发布工作流不签署 SEA 压缩包。这些设置不提供扫描、SBOM 或额外 attestation 覆盖。增加供应链策略需要独立负责人决定。参见[安全模型](https://docs.1mcp.app/zh/reference/security)与[开发指南](https://docs.1mcp.app/zh/guide/development)。
