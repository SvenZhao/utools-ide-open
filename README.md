# ideOpen

uTools 插件 — 统一管理 VSCode 系及 JetBrains 系编辑器的最近项目。

## 功能

- **统一入口**：输入 `ideopen` 进入设置页，管理所有 IDE 配置
- **动态注册**：配置后自动注册 IDE 别名命令，输入别名直达最近项目
- **多 IDE 支持**：VSCode、Cursor、VSCodium、Qoder、IntelliJ IDEA、PyCharm、WebStorm、GoLand 等
- **键盘操作**：上下键选择、回车打开、Delete 删除
- **跨平台**：macOS / Windows / Linux

## 使用

1. 输入 `ideopen` 进入设置页
2. 点「+ 新增配置」或点快速填入按钮选择 IDE
3. 配置别名、启动命令、数据文件路径
4. 保存后输入别名（如 `vsc`）即可查看最近项目

## 开发

```bash
npm install
npm run dev        # 开发模式（需 uTools 开发者工具）
npm run build      # 构建
```

## 数据源

插件通过读取 IDE 的本地数据库来获取最近项目记录：

- **VSCode 系**：`state.vscdb`（SQLite）或 `storage.json`
- **JetBrains 系**：`recentProjects.xml`

路径中的 `appData` 目录自动适配各平台：

| 平台 | appData 路径 |
|------|-------------|
| macOS | `~/Library/Application Support` |
| Windows | `%APPDATA%` |
| Linux | `~/.config` |
