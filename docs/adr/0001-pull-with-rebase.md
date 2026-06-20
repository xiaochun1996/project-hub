# Pull 操作使用 rebase 而非 merge

`git pull` 默认执行 merge，会产生合并提交。我们选择 `git pull --rebase`，因为 Project Hub 面向个人/小团队项目，线性历史比保留合并提交更有价值。rebase 会改写本地 commit SHA，但不影响远程已有的 commit。Diverged 状态下若 rebase 冲突，git 会停止等待用户手动解决，不会造成数据丢失。
