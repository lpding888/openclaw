# Fork 同步与发布

本页用于把你的仓库变成“持续同步上游 + 自动发布可安装版本”。

## 一次性配置

1. 在仓库 `Settings -> Secrets and variables -> Actions` 配置 `Secrets`:
- `NPM_TOKEN`（必需，用于 npm 发布）
- `DOCKERHUB_USERNAME`（可选，用于 Docker 发布）
- `DOCKERHUB_TOKEN`（可选，用于 Docker 发布）
- `DOCKERHUB_IMAGE_NAME`（可选，格式 `yourname/openclaw-cn`）

2. 配置 `Variables`:
- `NPM_PACKAGE_NAME`（建议，例：`@yourname/openclaw-cn`）
- `UPSTREAM_REPO`（可选，默认 `openclaw/openclaw`）

3. 确保默认分支是你要发布的分支（通常 `main`）。

## 自动同步上游

仓库已内置工作流：

- `.github/workflows/upstream-sync-pr.yml`

它会每 6 小时自动执行：

1. 拉取上游 `openclaw/openclaw`
2. 合并到 `automation/upstream-sync` 分支
3. 自动创建或更新同步 PR 到你的默认分支

你也可以手动执行一次：

1. 打开 `Actions`
2. 选择 `Sync Upstream and Open PR`
3. 点击 `Run workflow`

## 自动发布

仓库已有两个发布工作流：

1. `.github/workflows/npm-publish.yml`
- 触发条件：推送 `v*` 标签
- 自动根据 fork 适配包名和仓库链接
- 若你设置了 `NPM_PACKAGE_NAME`，优先使用它

2. `.github/workflows/docker-build-multiarch.yml`
- 触发条件：推送 `v*` 标签
- 默认镜像名为 `${github.repository_owner}/openclaw-cn`
- 也可用 `DOCKERHUB_IMAGE_NAME` 覆盖

## 发布步骤

1. 合并自动同步 PR（或手动改造后推送到 `main`）
2. 创建标签并推送：

```bash
git tag v2026.2.16-cn.1
git push origin v2026.2.16-cn.1
```

3. 等待 Actions 完成 npm 和 Docker 发布

## 给他人安装

如果发布包名是 `@yourname/openclaw-cn`，安装命令：

```bash
npm install -g @yourname/openclaw-cn@latest
```

启动命令（兼容别名）：

```bash
openclaw-cn --help
clawdbot-cn --help
```
