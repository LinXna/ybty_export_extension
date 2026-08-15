# 历史参考工具

本目录统一保存已经退出扩展正式运行链、但对理解雷速接口迁移过程仍有参考价值的代码。

## leisu_interface_migration.js

早期浏览器页面实验工具，包含 `match_analysis` 的 ROT/Base64/GZIP 解码、接口统计标准化、阵容与文字直播整理等方法，并通过 `globalThis.CodexLeisuInterfaceMigration` 暴露给控制台。

正式导出已由根目录的 `background.js` 和 `leisu_content.js` 接管。本文件不在 `manifest.json` 中加载，不参与“滚球接口获取导出”，不得作为当前正式实现调用。仅用于查阅早期实现思路或手工回归验证。
