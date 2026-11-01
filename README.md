# 尘梦启动器 · ChenMeng Launcher

每个世界，一页梦境。

ChenMeng is an independent Minecraft Java Edition desktop launcher built with Vue, Electron and Node.js. Its paper-and-watercolor interface focuses on selecting an instance and continuing a game.

This project is under active development. Microsoft sign-in and Xbox authorization have been tested with a real account. Minecraft game-token issuance currently returns HTTP 403; application access review and end-to-end online gameplay verification remain pending.

## 当前功能

- 原版游戏版本选择、文件校验、下载进度与游戏启动。
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
- Add Modrinth discovery, compatible content installation, and modpack import/export.
- Add world backups and improve launch diagnostics.

Project feedback can be submitted through this repository's Issues.

ChenMeng is an independent community project and is not affiliated with or endorsed by Mojang or Microsoft. Minecraft belongs to its respective owners.

Source license is MIT, as provided in LICENSE.
