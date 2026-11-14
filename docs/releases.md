# 发布 oh-my-dsh

omdsh 发布两个 npm 包：`@agi-fans/dsh-tui`（库）和 `@agi-fans/oh-my-dsh`（CLI）。发布由推送 `vX.Y.Z` 标签触发，由 GitHub Actions 通过 npm 授信发布（trusted publishing，OIDC）完成。本地不再执行 `npm publish`，仓库也不保存长期 npm token。完整的准备、验证与恢复步骤见 [publish-oh-my-dsh 技能](../.agents/skills/publish-oh-my-dsh/SKILL.md)。

## 一次性配置

两个包都要在 npm 上各配置一次受信任发布者（Trusted Publisher）：

1. 打开 `@agi-fans/dsh-tui` 和 `@agi-fans/oh-my-dsh` 在 npmjs.com 上的 Settings → Trusted Publisher。
2. 选择 GitHub Actions，填写 Organization `agi-fans`、Repository `oh-my-dsh`、Workflow filename `publish.yml`，Environment 留空。
3. 保存。不需要创建 `NPM_TOKEN` secret，也不需要在本机登录 npm。

工作流文件名必须是 `publish.yml`，发布 job 必须声明 `id-token: write`。配置完成后，旧的 npm automation token 可以撤销。

## 发版流程

1. 按 [AGENTS.md](../AGENTS.md) 和技能准备版本：根、`@agi-fans/oh-my-dsh`、`@agi-fans/dsh-tui` 三处版本一致，`CHANGELOG.md` 的 `Unreleased` 移入 `## [X.Y.Z] - YYYY-MM-DD`，并更新比较链接。
2. 运行技能列出的完整验证，包括两个包的打包检查、依赖边界审计和 `pnpm check:md`。
3. 提交发布准备并推送 `main`。
4. 在发布提交上创建附注标签并只推送该标签：

```sh
git tag -a vX.Y.Z <release-commit> -m "vX.Y.Z"
git push origin vX.Y.Z
```

5. 等待 `Publish` 工作流完成，并核对 registry、标签和 GitHub Release（见技能的最终审计）。
6. 发布失败时按“失败与恢复”重跑，不要删除或移动标签。

## 工作流做了什么

- 校验标签名、三处 manifest 版本一致、`CHANGELOG.md` 存在该版本小节，以及标签提交是 `origin/main` 的祖先。
- 安装依赖，运行两个发布包的 typecheck、test、build，以及 `check:md`、`check:boundaries`。
- 发布 `@agi-fans/dsh-tui`；已存在的精确版本会跳过。
- 等待 registry 能读到刚发布的 TUI 版本，最多 15 分钟；超时只记录警告，不失败。
- 发布 `@agi-fans/oh-my-dsh`；同样跳过已存在的版本。
- 两个包都成功后，从 `CHANGELOG.md` 提取该版本小节创建 GitHub Release。

两个包都以 `--provenance` 发布，生成可公开验证的构建来源证明。版本号含 `-` 的预发布使用 `next` dist-tag，GitHub Release 标记为 prerelease。

## 失败与恢复

- 发布步骤是幂等的：精确版本已存在就跳过。部分失败时用 `gh run rerun <id> --failed` 重跑失败的 job，不会重复发布；无法重跑时在 Actions 页面选择该标签手动运行工作流，或执行 `gh workflow run publish.yml --ref vX.Y.Z`。
- 不要为了重跑删除、移动或重建标签。标签指向错误提交时，先修复合入 `main`，再发布新的补丁版本。
- 授信握手失败（OIDC 错误、`ENEEDAUTH`、403）通常意味着 Trusted Publisher 配置缺失，或仓库、工作流文件名不匹配。修好 npm 侧配置后重跑工作流；不要用本地 `npm publish` 绕过。
- registry 读取滞后于写入。发布步骤报告成功而 `npm view` 仍返回旧版本时，按传播延迟处理，不要重发同一个版本。
- 如果 `release` job 失败但两个包已发布，用 `node scripts/release-notes.mjs X.Y.Z` 生成说明并补建 Release，不要重跑整个发布。

## 手动兜底

只有工作流持续不可用时才在本地发布，发布顺序是先 `@agi-fans/dsh-tui` 再 `@agi-fans/oh-my-dsh`，并在发布后手动补建 GitHub Release。本地发布不会附带 GitHub Actions 的 provenance，恢复上线后应回到标签触发的流程。
