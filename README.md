# 打印排版助手 —— 飞书多维表格插件 Demo

一个完整的打印排版插件源码：读取多维表格数据 → 勾选记录 → 纸张/分页/模板设置 → 所见即所得预览 → 一键打印（或另存 PDF）。

## 📁 目录结构

```
print-plugin-demo/
├── demo-standalone.html   ← 独立预览版：浏览器直接双击打开就能玩（不需要飞书）
├── package.json           ← 依赖与脚本（start / build / upload）
├── block.json             ← 插件能力声明（要填你的 BlockTypeID）
├── app.json               ← 应用声明（要填你的 App ID）
├── webpack.config.js      ← 构建配置（官方工具封装）
├── tsconfig.json
└── src/
    ├── index.tsx          ← 入口：挂载 React
    ├── App.tsx            ← 核心逻辑（读数据/选记录/排版/预览/打印）
    └── print.css          ← 样式 + 打印 CSS（@media print）
```

## 🚀 两种玩法

### 玩法一：先看效果（零门槛）

双击 `demo-standalone.html`，浏览器打开。里面是模拟的木箱出库数据：
- 切纸张/横竖/边距 → 预览实时变化
- 点字段变量 chip 插入模板 → 看排版效果
- 点「打印 / 另存为 PDF」→ 弹出系统打印对话框（这是真的能打印）

### 玩法二：跑进飞书（正式流程）

**第 1 步：拿到你的两个 ID**（参考教程文档第二章）
1. open.feishu.cn/app → 创建企业自建应用「打印排版助手」
2. 添加应用能力 → 多维表格插件 → **记录视图**
3. 抄下 `BlockTypeID`（blk_xxx）和 `App ID`（cli_xxx）

**第 4 步：初始化官方模板（推荐方式）**
```bash
npm install @lark-opdev/cli@latest -g -f
opdev login
opdev create my-print/panel -a bitable-extensions -s record-view
# 过程中填入你的 App ID 和 BlockTypeID
cd my-print/panel
npm install
```

**第 5 步：用本 demo 的源码覆盖模板**
把本目录 `src/` 下的 3 个文件（index.tsx、App.tsx、print.css）复制到模板的 `src/` 目录覆盖同名文件。
> 注意：模板的 package.json / webpack.config.js / block.json / app.json 保留模板自带的（它们和官方脚手架配套），不要用本 demo 的去覆盖——本 demo 的这几个文件只是给你看结构用的。

**第 6 步：调试**
```bash
npm run start
```
自动打开带 debugPort 的多维表格 → 面板右侧 + 号 → 选本地 blk_xxx 组件 → 添加插件 → 新标签页调试。

**第 7 步：发布**
```bash
npm run upload   # 版本号递增，如 0.0.1 → 0.0.2
```
然后回开发者后台：插件能力页选小组件版本 → 版本管理与发布 → 创建版本 → 申请线上发布 → 管理员审核。

## ⚠️ 注意事项

1. **权限**：需在后台开通 `bitable:app`（用户身份）权限，否则读数据报 403。
2. **App ID / BlockTypeID**：本 demo 里的 `app.json`、`block.json` 是占位符（XXXXXXXX），直接 `npm run upload` 会失败，必须先 `opdev create` 或填入真实 ID。
3. **字段类型**：`App.tsx` 里的 `cellToText()` 已兼容文本/数字/单选/多选等常见类型；人员、附件等复杂字段首次对接时先 `console.log` 看真实结构。
4. **深色主题**：本 demo 按浅色主题设计，如需适配深色模式，把写死的颜色换成 CSS 变量即可。
5. **打印方向**：打印对话框里的纸张方向由浏览器/打印机驱动决定，建议同时打印测试页校准 `@page` 设置。

## 🔧 二次开发方向（v2 建议）

- 拖拽式版式编辑器（HTML5 Drag & Drop）
- 标签纸模式（如 40×30mm 不干胶网格排版）
- 附件字段图片打印（`bitable.base.getAttachmentUrl`）
- 设置持久化改用 `bitable.bridge` 存储 API（跨设备同步）
- 批量导出 PDF（打印对话框选"另存为 PDF"即可，无需额外开发）
