# 尘梦启动器 · ChenMeng Launcher

每个世界，一页梦境。

ChenMeng is an independent Minecraft Java Edition desktop launcher built with Vue, Electron and Node.js. Its paper-and-watercolor interface focuses on selecting an instance and continuing a game.

This project is under active development. Microsoft sign-in and Xbox authorization have been tested with a real account. Minecraft game-token issuance currently returns HTTP 403; application access review and end-to-end online gameplay verification remain pending.

## 当前功能

- 原版游戏版本选择、文件校验、下载进度与游戏启动。
- 新建实例时选择 Fabric、Forge 或 NeoForge 及其版本，随游戏一起安装。
- Modrinth 内容搜索按当前游戏版本筛选，模组与整合包同时匹配加载器；安装必需依赖并校验文件。
- .mrpack 整合包导入与可选内容导出，支持模组、资源包、光影、配置、存档和截图。
- 窗口缩小时逐级精简首页，最小化为带账户和启动按钮的迷你布局。
- 实例创建、切换、移除，以及存档、模组、截图等目录快捷访问。
- Java 检测、内存分配、版本隔离、启动后隐藏窗口与游戏标题设置。
- 游戏截图或自选图片封面。
- 世界手记支持标题、日期、备注、滤镜预览、原图定位与带纸边的 PNG 导出。
- 本地离线玩家配置，以及 Microsoft 设备代码登录入口。

## Authentication and API usage

The desktop app initiates the Microsoft OAuth device-code flow for personal Microsoft accounts, requesting XboxLive.signin and offline_access. Users enter the device code and authorize the application on Microsoft's website.

The main process exchanges the Microsoft access token for Xbox Live and XSTS tokens, then requests a Minecraft access token through authentication/login_with_xbox and reads minecraft/profile to obtain the Java Edition player name and UUID. The Minecraft access token is used when starting the game. The intended API use is signing players into their own accounts and launching their Java Edition game.

The registered application client ID is 8afeda54-6272-4879-a5e6-5c8b24f2e26e. Minecraft service access is currently being investigated as part of the application review process.

## Local data and privacy

The launcher stores instance settings, the selected player's name and UUID, and journal annotations locally. After successful online sign-in, the Microsoft refresh token is encrypted using Electron safeStorage before local persistence. Access tokens are held in the main process and passed to the game when launching. Switching to an offline player removes the saved refresh-token entry.

The device code is copied to the system clipboard once when sign-in starts. Screenshots and exported journal images are stored locally. Authentication communicates directly with Microsoft, Xbox and Minecraft services. Game downloads use Mojang/Minecraft distribution endpoints.

## Development

Install Node.js 22 and npm, then run the following commands from the repository directory.

```sh
npm ci
npm run build
npm start
```

On Windows, Start-ChenMeng.cmd opens the built application using a project-local data directory. A compatible Java runtime is required for gameplay. npm run dev starts the development workflow.

The Windows runtime has received the most testing. Desktop interaction, account renewal and online gameplay still need broader verification. A packaged executable is not included in this initial source publication.

## Planned work

- Complete Minecraft service approval and verify online sign-in, renewal and gameplay.
- Broaden Forge/NeoForge installation and desktop interaction testing.
- Add world backups and improve launch diagnostics.

Project feedback can be submitted through this repository's Issues.

ChenMeng is an independent community project and is not affiliated with or endorsed by Mojang or Microsoft. Minecraft belongs to its respective owners.

Source license is MIT, as provided in LICENSE.


## Content installation and modpacks

Content Workshop searches the official Modrinth API. Mods and modpacks are filtered by both the selected Minecraft version and loader. Resource packs and shaders are filtered by game version. Shaders also require a compatible shader loader in the instance.

Required Modrinth dependencies are resolved recursively. Conflicting versions and declared incompatibilities stop installation. New files are staged before being copied into the instance; a failed operation rolls back newly added files. Managed content can be moved to the recycle bin after a confirmation.

Modrinth .mrpack imports create a separate isolated instance. The importer applies client overrides, skips server-only files, and asks whether to include optional client files. Unsupported pack loaders are rejected explicitly. Failed download/install tasks can be retried from Downloads.

Exports allow selecting mods, resource packs, shaders, configuration, options.txt, saves, and screenshots. Unchanged managed files are represented by download URLs and hashes; other selected local files are included as overrides. Export size is limited to 1 GiB and archive extraction to 2 GiB. Review selected local files before distributing an exported pack.

## Download sources and validation

Vanilla files use Mojang/Minecraft distribution endpoints. Modrinth uses its official API and CDN. Fabric uses Fabric Meta and Maven; Forge and NeoForge use their official Maven repositories. There is currently no mirror selector. Transfer speed depends on the user's network and the upstream service.

Fabric 1.21.1 with loader 0.16.10 has passed a real dependency download and launch-argument generation check. Full game-window verification for all loaders remains pending. NeoForge's official repository returned connection resets in the development environment. Forge and NeoForge processor execution also requires a compatible locally installed Java runtime.

XMCL installer/core dependencies are pinned. The unzip dependency is pinned to 2.1.2 because the 2.2.0 published package references missing TypeScript sources and a workspace dependency.


### 模组工作台

内容工坊可按游戏版本、加载器和分类浏览。模组页面采用双栏紧凑列表：左侧是 Modrinth 搜索结果，右侧扫描当前实例的 mods 文件夹（含手动放入的 jar 和 jar.disabled）。已通过哈希识别的本地项目及待添加项目会从左侧隐藏。

- 左侧选择版本后拖入右侧，或使用“加入”；右侧可指定版本、加入更新、暂存移除。此时不下载。草稿按实例保存在当前启动器会话中，退出应用后不保留。
- “检查更新 / 前置”按文件 SHA-512 识别项目，比较当前游戏版本与加载器对应的最新正式版，并提示缺少的必需依赖。没有 Modrinth 记录的文件仍显示本地元信息，无法自动识别或更新时会明确提示。
- “检查更改 / 补齐前置”生成可审阅清单；只在点击“应用更改并下载”后下载、校验、替换文件。检查必需依赖、版本约束和已声明的不兼容关系，不保证运行时无冲突。
- 新文件全部下载成功后才提交更改；替换或移除的旧文件保存在实例的 mod-backups 下。下载失败不改变原模组；提交阶段发生可捕获错误时恢复旧文件。应用前后检查本地文件快照，拒绝覆盖编辑期间被外部修改的文件。
- 点击名称查看信息，支持打开本地位置和 Modrinth 项目；CurseForge、MC 百科使用明确标注的名称搜索入口，不猜测跨站项目 ID。
- 浏览其他游戏版本或加载器时禁止添加到当前实例，点击“匹配当前实例”恢复安装条件。

验证：

```sh
npm ci
npm test
npm run build
```

模组测试覆盖手动 JAR、哈希识别、兼容更新、前置、下载/提交失败回滚、过期清单，以及 Vue DOM 中的拖拽暂存和显式应用。DOM 测试不代替 Windows Electron 的资源管理器与真实游戏联调。
