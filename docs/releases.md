# Windows 版本发布

[downloads](../downloads/README.md) 是固定下载入口。安装文件保存在 GitHub Releases，源码、更新说明和发布流程保存在仓库。

## 准备下一版

1. 完成代码修改。
2. 运行 `npm run release:prepare -- 0.3.2`，使用新的三段版本号。工具同步 package.json、锁文件、输出目录并创建版本说明。
3. 填写 `downloads/versions/v0.3.2.md`，删除 RELEASE_NOTES_TODO 标记。
4. 运行 `npm run desktop:test` 和 `npm run build`。
5. 提交源码并推送 main，然后创建并推送对应标签：

```powershell
git add package.json package-lock.json downloads src public desktop migrations scripts .github docs
git commit -m "release: prepare v0.3.2"
git push origin main
git tag -a v0.3.2 -m "HashPlay v0.3.2"
git push origin v0.3.2
```

标签触发 Windows release：安装锁定依赖、运行测试、构建程序、启动便携版验收、生成校验文件，成功后才发布。固定最新版链接随 Release 更新，历史文件保留。

手动重跑时，在 Actions 的 Windows release 页面选择对应版本标签。已有公开版本直接跳过，避免覆盖；未完成的草稿可以重跑。发布后的修正使用新版本号。

## 当前版本

v0.3.1 使用本机已验收的安装包。98 项自动回归、便携版八个页面、自动新增与更正、编辑保护、断线恢复通过；五个真实来源共 5000 条记录一致。

## 本地打包发布

```powershell
npm run desktop:dist
npm run release:assets
```

在对应源码提交的标签上创建草稿 Release，上传版本化便携版、安装版、SHA256SUMS.txt、release-manifest.json，再发布。manifest 记录源码提交、文件大小和校验值。

不要把安装包、数据库、日志、密钥文件或本地截图原件提交到 Git。截图分析索引已包含在源码中。

升级继续使用同一用户数据目录，迁移随启动执行。旧程序可能无法读取新数据库，回退时应使用升级前备份。应用目前采用手动下载安装更新。

## 现有版本重试

手动运行 Windows release 时填写已经存在的版本标签（例如 v0.4.0）。工作流使用最新的发布流程代码，检出标签对应的应用源码，并校验它与 package.json 一致；不会移动标签或覆盖已经公开的发行版。

Electron 44 的运行文件需显式执行 `node node_modules/electron/install.js` 安装，发布流程已补上此步；打包阶段使用 `--publish never`，完整便携版验证通过后才公开附件。
