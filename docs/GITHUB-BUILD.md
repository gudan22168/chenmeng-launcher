# GitHub 云端构建

main 分支每次推送，以及 pull request，自动执行 Windows portable build。也可在 Actions 中选择该工作流，点击 Run workflow 手动触发。

流程：npm ci → 全部测试（包含 Vue DOM 测试）→ Vite 构建 → Windows x64 portable EXE 打包。任何一步失败都不会发布 EXE，不跳过失败测试。

下载：仓库 Actions → Windows portable build → 绿色成功的运行 → Artifacts → ChenMeng-Windows-x64-运行编号。下载 ZIP 并解压，里面是 EXE。GitHub 下载 Artifacts 通常需要登录。可执行文件保留 30 天，测试日志保留 14 天；过期可手动重新构建。

构建不包含用户本机的实例、存档、AI Key 或登录信息。不需要配置签名或发布密钥；当前生成的 EXE 未进行代码签名。不会自动创建 Release。

如果失败，打开红色步骤查看完整错误，或下载 test-log。截图最末尾通常只有汇总，首个异常堆栈才是定位依据。

本机构建仍可运行 Build-Launcher.cmd。
