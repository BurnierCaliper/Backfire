# Backfire 协作约定

给在这个仓库里干活的 AI 助手（Claude Code、Codex 等）看，人也照这个来。

## 分支流程：先拉最新的 main，再开新分支

修 bug、加功能、改文档，都按这个顺序：

1. **开工前先看工作区。** 运行 `git status`。如果有未提交的改动，先告诉用户，问清楚怎么处理再动；不要丢弃，也不要 `reset`。
2. **拉最新的 main：**

   ```
   git switch main
   git pull --ff-only
   ```

3. **从最新的 main 开新分支，一件事一个分支：** `git switch -c fix/简短英文描述`。修 bug 用 `fix/`，加功能用 `feat/`，只改文档用 `docs/`。不要直接在 `main` 上改。
4. **改完跑测试**（`npm test`；改了界面再跑 `npm run test:ui`，需要浏览器和 Playwright），然后提交，推送到自己的分支：`git push -u origin <分支名>`。告一段落就提交推送，别把改动长期留在本地。
5. **通过 PR 合进 main。** 开 PR 前如果 `main` 又更新了，先 `git fetch`，再 `git rebase origin/main`，解决冲突、重新跑测试，然后 `git push --force-with-lease`。只对自己的分支强制推送，不要强制推送 `main`。

## 多个会话同时干活

- 同时开好几个会话时，每个会话用自己的 git worktree（独立的工作副本），不要几个会话在同一个文件夹里来回切分支。
- 收尾时把改动都提交并推送到自己的分支，不要留下未提交的改动。
