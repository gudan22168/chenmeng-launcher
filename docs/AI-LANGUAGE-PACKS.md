# AI 模组语言翻译（第一版）

入口：内容工坊 → 模组 → AI 语言翻译。

1. 在设置中配置 AI 地址、模型和 Key。
2. 选择已安装模组、源语言（通常 en_us）和目标语言（通常 zh_cn）。
3. 读取预览，仅列出模组内和现有合并包都没有的目标语言条目。
4. 点击 AI 翻译剩余条目，确认服务与批次数。成功批次自动保存到实例 translation-work/draft.json。
5. 检查和修改译文，点击校验并更新合并资源包。
6. 在游戏资源包界面启用 ChenMeng-Translations.zip。

每个实例固定一个 resourcepacks/ChenMeng-Translations.zip。不同模组命名空间、不同目标语言合并保留。不会修改模组 JAR，不会自动启用资源包。已有译文默认跳过，不覆盖；同名但非本启动器生成的包不会覆盖。

上一版包保留在 translation-backups/ChenMeng-Translations.zip.previous。需要回退时关闭游戏，将备份复制回 resourcepacks/ChenMeng-Translations.zip。仅保留上一版。

每批最多 30 条 / 约 5000 输入字符；每次预览最多 4000 条。AI 失败后停止，不自动重复计费。重新读取相同模组和语言可以恢复最近一次草稿，再次翻译仅提交空白条目。手动编辑需导出或提交翻译以保存。

仅支持模组 JAR 顶层 assets/<namespace>/lang/<locale>.json，暂不支持旧版 .lang、内嵌子 JAR、指南书文本或自动清理过期译文。已有汉化的校订、批量选择多个模组和术语表留待后续版本。

只发送语言原文、翻译键、命名空间和源/目标语言，不发送游戏日志、存档或账户信息。沿用本地 AI 配置；调用服务可能计费。原文可能包含模组作者的文本，输出分享前请遵守对应许可。

验证：新增 tests/translations.test.mjs，覆盖占位符、响应键、分批、资源包格式、多模组合并、单包约束、备份、过期写入拒绝与路径检查。
