# 压缩包导入与标准版本目录

在实例页或内容工坊选择“导入 ZIP / RAR / .mrpack”，也可以把一个文件拖到窗口任意位置。确认后在下载页查看进度。

支持 Modrinth .mrpack（也可使用包含 modrinth.index.json 的 ZIP），以及包含 versions/<版本>/<版本>.json 的完整游戏目录 ZIP / RAR；允许外层套文件夹，支持独立版本目录和共享游戏目录，识别原版、Fabric、Forge、NeoForge。多个独立版本需分别打包或通过本地目录导入选择。CurseForge 仅清单包、Quilt、旧启动格式、加密 RAR、分卷 RAR 与 7z 尚不支持。

读取和解压在后台线程进行。导入保留模组、配置、存档、资源包、光影等游玩文件，游戏本体、资源和加载器在首次启动时检查并补全。不会使用包中启动器账户、Java 路径或自定义启动参数。下载失败或取消不留下新实例，可重试。

新实例使用 .minecraft/versions/1.20.1 等目录；同版本多实例自动添加编号。游戏本体使用 <版本>.json、<版本>.jar，libraries 和 assets 在 .minecraft 下共享。版本隔离关闭时普通新实例的游玩目录为 .minecraft；导入实例固定隔离以避免覆盖。旧实例仍使用原来的 instances/runtime 目录，不自动迁移存档。

首屏不再同步读取模组别名存储，安装依赖和非首页页面按需加载。启动时不扫描压缩包。

验证：npm test；npm run build；node scripts/archive-smoke.mjs（开发桌面）；node scripts/archive-smoke.mjs <打包后的 EXE 绝对路径>（成品桌面）。桌面测试使用临时游戏目录，模拟本地文件拖入并核对导入结果。

压缩包限制：压缩文件及总解压大小最多 2 GiB，单文件最多 256 MiB，最多 100,000 条目；拒绝越界路径、重复路径和链接。

RAR 解压组件随程序打包，不需要另装 WinRAR。支持单文件 RAR4 / RAR5（包括固实压缩及中文路径），RAR 中的 Modrinth 清单也可识别。组件仅在后台导入线程中按需加载；文件先解到临时目录，验证完成后再建立实例。采用内存解码，因此大包会占用较多内存，遇到内存不足可分成较小的整合包。组件及 UnRAR 许可见 THIRD-PARTY-NOTICES.txt。

RAR 桌面验证：node scripts/archive-smoke.mjs --rar；加 --picker 验证文件选择入口；可同时传入打包 EXE 的绝对路径。

启动速度说明：解压即用版（x64.zip）完整解压后启动内部 EXE；单文件 portable.exe 每次启动会先将程序解压到临时目录，仍有额外等待。RAR 导入组件不会在首页初始化。
