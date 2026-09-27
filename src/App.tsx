/**
 * App.tsx —— 排版打印（v0.5：对齐官方「排版打印」交互）
 *
 * 左侧：模板面板（记录模板/视图模板分组 + 搜索 + 创建模板）
 * 顶部：模板名 / 纸张(修改弹出) / 当前记录切换 / 进入批量模式 / 导出 / 编辑 / 打印
 * 主区：默认所见即所得预览；点「编辑」进入拖拽排版编辑器
 * 挂载：记录视图 或 数据表视图（扩展视图插件，出现在表格顶部 + 菜单）均可，代码零修改
 *
 * 依赖 SDK：@lark-opdev/block-bitable-api（opdev create 模板已内置）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { bitable } from "@lark-opdev/block-bitable-api";

/* ---------------- 类型 ---------------- */

type ElType = "text" | "line" | "table" | "autotable" | "image" | "qrcode" | "barcode" | "sign" | "attach" | "free" | "article";

/** 文本类元素（共用属性面板与 {{字段}} chip 渲染） */
const TEXT_LIKE: ElType[] = ["text", "free", "article", "attach"];

interface ElProps {
  content?: string; src?: string; fontSize?: number; bold?: boolean;
  align?: "left" | "center" | "right"; rows?: number; cols?: number;
  cells?: Record<string, Record<string, string>>;
  fields?: string[]; // v1.1 自动表格列字段关联（per-element，undefined 才 fallback 全局 autoFields）
  titles?: string[]; // v1.3 列头自定义文字（空串渲染时 fallback 字段名）
}
interface LayoutEl { id: string; type: ElType; x: number; y: number; w: number; h: number; props: ElProps }
interface Tpl { id: string; name: string; kind: "record" | "view"; elements: LayoutEl[] }
interface TableMeta { id: string; name: string }
interface RecordRow { recordId: string; data: Record<string, string> }

/* ---------------- 常量 ---------------- */

const PAPER_MM: Record<string, [number, number]> = { A4: [210, 297], A5: [148, 210], letter: [216, 279] };
const MM = 3.78;
const SAVE_KEY = "print-plugin-layout-v4";

const COMPONENTS: { type: ElType; icon: string; label: string }[] = [
  { type: "text", icon: "🅰", label: "文本" },
  { type: "table", icon: "▦", label: "表格" },
  { type: "image", icon: "🖼️", label: "图片" },
  { type: "attach", icon: "📎", label: "附件" },
  { type: "qrcode", icon: "⊟", label: "二维码" },
  { type: "barcode", icon: "🕋", label: "条形码" },
  { type: "line", icon: "━", label: "水平线" },
  { type: "free", icon: "✥", label: "自由拖动元素" },
  { type: "article", icon: "📋", label: "文章区块" },
  { type: "autotable", icon: "🔁", label: "自动表格" },
  { type: "sign", icon: "✍️", label: "签名" },
];

const DEFAULTS: Record<ElType, { w: number; h: number; props: ElProps }> = {
  text: { w: 60, h: 10, props: { content: "", fontSize: 14, bold: false, align: "left" } },
  line: { w: 80, h: 2, props: {} },
  table: { w: 80, h: 30, props: { rows: 3, cols: 3, cells: {} } },
  autotable: { w: 180, h: 60, props: {} },
  image: { w: 40, h: 30, props: { src: "https://dummyimage.com/300x200/e5e6eb/646a73.png&text=Image" } },
  qrcode: { w: 25, h: 25, props: { content: "https://example.com" } },
  barcode: { w: 45, h: 14, props: { content: "20260927001" } },
  sign: { w: 60, h: 22, props: {} },
  attach: { w: 50, h: 10, props: { content: "📎 附件：{{附件}}", fontSize: 12 } },
  free: { w: 60, h: 10, props: { content: "自由拖动元素", fontSize: 14 } },
  article: { w: 100, h: 24, props: { content: "在这里输入文字，输入 {{字段}} 快速插入字段", fontSize: 12 } },
};

/** 导出 HTML 时内联的最小样式（与 print.css 中元素规则保持一致） */
const EXPORT_CSS = `
.paper{background:#fff;margin:0 auto 20px;position:relative;overflow:hidden}
.el{position:absolute;cursor:default}
.el .content{width:100%;height:100%;overflow:hidden}
.el-text .content{line-height:1.6;word-break:break-all;white-space:pre-wrap}
.el-line{border-top:1.5px solid #333}
.el-table table{width:100%;height:100%;border-collapse:collapse}
.el-table td,.el-table th{border:1px solid #444;padding:2px 4px;font-size:12px}
.el-autotable table{width:100%;border-collapse:collapse}
.el-autotable td,.el-autotable th{border:1px solid #444;padding:3px 5px;font-size:12px;text-align:left}
.el-autotable th{background:#f2f2f2}
.el-img img{width:100%;height:100%;object-fit:contain}
.el-qr,.el-bar{background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
.el-sign .content{display:flex;align-items:center;justify-content:center}
.sign-zone{width:100%;height:100%;border:1.5px dashed #999;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px}
.sign-zone img{width:100%;height:100%;object-fit:contain}
.paper-label{position:absolute;top:5px;right:10px;font-size:11px;color:#c0c4cc}`;

/* ---------------- 内置模板 ---------------- */

function presetDingdan(): LayoutEl[] {
  return [
    { id: "p1", type: "text", x: 15, y: 10, w: 100, h: 12, props: { content: "{{公司名称}}", fontSize: 22, bold: true } },
    { id: "p2", type: "text", x: 140, y: 14, w: 55, h: 8, props: { content: "订购单编号：", fontSize: 11 } },
    { id: "p3", type: "line", x: 15, y: 26, w: 180, h: 2, props: {} },
    { id: "p4", type: "text", x: 15, y: 32, w: 60, h: 8, props: { content: "订单编号：{{明细序号}}", fontSize: 12 } },
    { id: "p5", type: "text", x: 15, y: 44, w: 90, h: 22, props: { content: "供方：\n联系人：　电话：", fontSize: 12 } },
    { id: "p6", type: "text", x: 110, y: 44, w: 85, h: 22, props: { content: "发货地址：\n发货日期：{{出货日期}}", fontSize: 12 } },
    { id: "p7", type: "text", x: 15, y: 70, w: 60, h: 8, props: { content: "订购明细", fontSize: 13, bold: true } },
    { id: "p8", type: "autotable", x: 15, y: 80, w: 180, h: 50, props: {} },
    { id: "p9", type: "text", x: 120, y: 134, w: 75, h: 8, props: { content: "合计：{{SUM(金额)}}", fontSize: 12, bold: true, align: "right" } },
    { id: "p10", type: "sign", x: 130, y: 146, w: 60, h: 20, props: {} },
    { id: "p11", type: "text", x: 15, y: 172, w: 180, h: 14, props: { content: "如有任何疑问或需要进一步的信息，请随时与我们联系，感谢您的信任与合作！", fontSize: 10 } },
    { id: "p12", type: "text", x: 15, y: 186, w: 180, h: 8, props: { content: "联系人：王大锤　联系电话：19888888888　点火科技公司", fontSize: 10 } },
  ];
}
function presetBaojia(): LayoutEl[] {
  return [
    { id: "p1", type: "text", x: 70, y: 10, w: 70, h: 12, props: { content: "销 售 报 价 单", fontSize: 22, bold: true, align: "center" } },
    { id: "p2", type: "text", x: 15, y: 28, w: 90, h: 9, props: { content: "客户名称：{{商品名称}}", fontSize: 12 } },
    { id: "p3", type: "text", x: 130, y: 28, w: 65, h: 9, props: { content: "报价日期：{{出货日期}}", fontSize: 12 } },
    { id: "p4", type: "autotable", x: 15, y: 42, w: 180, h: 55, props: {} },
    { id: "p5", type: "line", x: 15, y: 104, w: 180, h: 2, props: {} },
    { id: "p6", type: "text", x: 15, y: 110, w: 110, h: 18, props: { content: "报价说明：\n1. 以上价格含税含运费；\n2. 有效期 30 天。", fontSize: 11 } },
    { id: "p7", type: "sign", x: 135, y: 108, w: 60, h: 22, props: {} },
  ];
}
function presetChuku(): LayoutEl[] {
  return [
    { id: "p1", type: "text", x: 70, y: 12, w: 70, h: 12, props: { content: "产 品 出 库 单", fontSize: 22, bold: true, align: "center" } },
    { id: "p2", type: "text", x: 15, y: 30, w: 120, h: 10, props: { content: "日期：{{出货日期}}　经手人：________", fontSize: 12 } },
    { id: "p3", type: "autotable", x: 15, y: 45, w: 180, h: 60, props: {} },
    { id: "p4", type: "text", x: 95, y: 110, w: 100, h: 8, props: { content: "合计：{{SUM(金额)}}", fontSize: 12, bold: true, align: "right" } },
    { id: "p5", type: "text", x: 15, y: 122, w: 100, h: 8, props: { content: "审核：________", fontSize: 12 } },
    { id: "p5b", type: "qrcode", x: 170, y: 118, w: 25, h: 25, props: { content: "https://njswd.github.io/feishu-print-plugin/" } },
  ];
}

/* ---------------- 工具 ---------------- */

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderTpl(tpl: string, data: Record<string, string> | null, rowsData?: Record<string, string>[]): string {
  return String(tpl).replace(/\{\{(.*?)\}\}/g, (_, raw: string) => {
    const m = raw.match(/^SUM\((.+)\)$/);
    if (m) {
      const name = m[1].trim();
      const list = rowsData && rowsData.length ? rowsData : data ? [data] : [];
      let sum = 0;
      list.forEach((r) => { const n = parseFloat(r[name]); if (!isNaN(n)) sum += n; });
      return String(Math.round(sum * 100) / 100);
    }
    const v = data ? data[raw.trim()] : undefined;
    return v === undefined || v === null ? "" : String(v);
  });
}

/* ---------- 编辑态字段 chip（v0.9：能取到数据=蓝色，取不到=红色）---------- */
function chipLabel(f: string): string {
  const m = f.match(/^SUM\((.+)\)$/);
  return m ? "求和 · " + m[1].trim() : f;
}
/** v1.0 判断字段是否与数据表关联（SUM(字段) 剥壳后检查；含系统字段） */
const SYS_DATA: Record<string, string> = {
  "公司名称": "点火科技公司", "公司地址": "江苏省南京市溧水区",
  "客服电话": "198-8888-8888", "公司邮箱": "service@example.com",
};
const LOOP_FIELDS = ["商品名称", "型号", "规格", "数量", "单价", "金额"];
const TYPE_NAMES: Record<string, string> = {
  text: "文本", table: "表格", image: "图片", attach: "附件", qrcode: "二维码", barcode: "条形码",
  line: "水平线", free: "自由拖动元素", article: "文章区块", autotable: "自动表格", sign: "签名",
};
/* v1.0 侧栏图标栏 */
const RAIL_TITLES: Record<string, string> = { comp: "组件", data: "数据源", page: "页面设置", setting: "设置", inspector: "检查器" };
const RAIL_ICONS: Record<string, React.ReactNode> = {
  comp: (<svg viewBox="0 0 20 20" fill="currentColor"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5" /><rect x="11" y="2.5" width="6.5" height="6.5" rx="1.5" /><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5" /><rect x="11" y="11" width="6.5" height="6.5" rx="1.5" /></svg>),
  data: (<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 3h3v2H7v10h1v2H5z" /><rect x="9.2" y="3" width="1.8" height="14" rx="0.9" /><path d="M15 3h-3v2h1v10h-1v2h3z" /></svg>),
  page: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M2.5 11c2.5-6 4.5-6 6.5-1.5s4 4.5 6-.5" /><path d="M2.5 17h15" /></svg>),
  setting: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="10" cy="10" r="3.2" /><path d="M10 2.2v2.6M10 15.2v2.6M2.2 10h2.6M15.2 10h2.6M4.6 4.6l1.9 1.9M13.5 13.5l1.9 1.9M15.4 4.6l-1.9 1.9M6.5 13.5l-1.9 1.9" /></svg>),
  inspector: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 5.5h11M3 9.5h7M3 13.5h4.5" /><circle cx="13.5" cy="12.5" r="3" /><path d="M15.8 14.8l2 2" /></svg>),
};
function fieldMeta(f: string, rec?: Record<string, string>): { ic: string; type: string } {
  const v = rec?.[f] || "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return { ic: "▦", type: "日期" };
  if (v !== "" && !isNaN(Number(v))) return { ic: "Σ", type: "数字" };
  return { ic: "A≡", type: "文本" };
}
/** v1.3 自动表格列字段来源：per-element props.fields（undefined 才 fallback；空数组=已删光显示空表） */
function autoFieldsOf(el: LayoutEl, autoFields: string[]): string[] {
  return el.props.fields ? el.props.fields : autoFields;
}
/* ---------- v1.5.3 自动排版（局部避让版）：重叠时只动被操作控件，其他控件保持原位 ---------- */
/* v1.5 全局装箱会把右上/居中控件全拉到左边（用户实测反馈），改为"下落避让"：
   被拖控件保持 x（wrap 模式）向下落到首个无重叠空位 = "自动换行"；
   cols2 模式 x 吸附近侧列后下落 = "排成两列"。 */
function overlapsAnyAt(list: LayoutEl[], x: number, y: number, w: number, h: number, skipId: string): boolean {
  for (const e of list) {
    if (e.id === skipId || e.type === "line") continue;
    if (x < e.x + e.w - 0.5 && x + w > e.x + 0.5 && y < e.y + e.h - 0.5 && y + h > e.y + 0.5) return true;
  }
  return false;
}
function evadeDropY(list: LayoutEl[], x: number, y: number, w: number, h: number, skipId: string): number {
  let guard = 0;
  for (;;) {
    let maxBottom = -Infinity;
    for (const e of list) {
      if (e.id === skipId || e.type === "line") continue;
      if (x < e.x + e.w - 0.5 && x + w > e.x + 0.5 && y < e.y + e.h - 0.5 && y + h > e.y + 0.5)
        maxBottom = Math.max(maxBottom, e.y + e.h);
    }
    if (maxBottom === -Infinity) break;
    y = maxBottom + 3;
    if (++guard > 200) break;
  }
  return y;
}
/** 重叠时的避让落位；返回 {x,y} 或 null（不重叠/off）。moveX=false 时保持 x（resize 场景） */
function calcEvade(list: LayoutEl[], x: number, y: number, w: number, h: number, skipId: string, mode: string | undefined, moveX: boolean, areaW: number): { x: number; y: number } | null {
  if (!mode || mode === "off") return null;
  if (!overlapsAnyAt(list, x, y, w, h, skipId)) return null;
  let ex = x;
  if (moveX && mode === "cols2") {
    const half = (areaW - 3) / 2;
    ex = (x + w / 2 < areaW / 2) ? 0 : Math.round((half + 3) * 10) / 10;
  }
  return { x: ex, y: evadeDropY(list, ex, y, w, h, skipId) };
}
/** v1.5.4 行内并排（参考官方 DocGenius）：重叠时找重叠面积最大控件所在行的左右空位，顶对齐 */
function rowSlotCalc(list: LayoutEl[], x: number, y: number, w: number, h: number, skipId: string, areaW: number): { x: number; y: number; line: { y: number; x1: number; x2: number } } | null {
  let hit: LayoutEl | null = null, best = 0;
  for (const e of list) {
    if (e.id === skipId || e.type === "line") continue;
    const ox = Math.min(x + w, e.x + e.w) - Math.max(x, e.x);
    const oy = Math.min(y + h, e.y + e.h) - Math.max(y, e.y);
    if (ox > 0.5 && oy > 0.5 && ox * oy > best) { best = ox * oy; hit = e; }
  }
  if (!hit) return null;
  let rowY = hit.y, x1 = Math.min(x, hit.x), x2 = Math.max(x + w, hit.x + hit.w);
  for (const t of list) {
    if (t.id === skipId || t.type === "line") continue;
    if (t.y < hit!.y + hit!.h - 0.5 && t.y + t.h > hit!.y + 0.5) {
      rowY = Math.min(rowY, t.y);
      x1 = Math.min(x1, t.x); x2 = Math.max(x2, t.x + t.w);
    }
  }
  const gap = 3;
  const left = hit.x - w - gap, right = hit.x + hit.w + gap;
  const cands = (x + w / 2 <= hit.x + hit.w / 2) ? [left, right] : [right, left];
  for (const cx of cands) {
    if (cx < 0 || cx + w > areaW + 0.5) continue;
    if (!overlapsAnyAt(list, cx, rowY, w, h, skipId))
      return { x: Math.round(cx * 10) / 10, y: rowY, line: { y: rowY, x1: Math.min(x1, cx), x2: Math.max(x2, cx + w) } };
  }
  return null;
}
/** 统一吸附决策：同行顶对齐 > 重叠时行内并排（wrap）/列吸附（cols2）> 下落兜底；moveX=false（resize）跳过并排 */
function calcSnap(list: LayoutEl[], x: number, y: number, w: number, h: number, skipId: string, moveX: boolean, mode: string | undefined, areaW: number): { x: number; y: number; line?: { y: number; x1: number; x2: number } } | null {
  if (!mode || mode === "off") return null;
  if (!overlapsAnyAt(list, x, y, w, h, skipId)) {
    const al = rowAlignCalc(list, skipId);
    return al ? { x, y: al.y, line: al } : null;
  }
  if (moveX && mode === "cols2") return calcEvade(list, x, y, w, h, skipId, mode, moveX, areaW);
  if (moveX) {
    const slot = rowSlotCalc(list, x, y, w, h, skipId, areaW);
    if (slot) return slot;
  }
  return { x, y: evadeDropY(list, x, y, w, h, skipId) };
}
/** v1.5.2 同行顶部吸附：与已放置控件水平同行（y 区间重叠）且顶部不齐时，返回吸附目标（参考 DocuGenius 排版效果） */
function rowAlignCalc(list: LayoutEl[], dragId: string): { y: number; x1: number; x2: number } | null {
  const drag = list.find((e) => e.id === dragId);
  if (!drag) return null;
  let minY = Infinity, x1 = drag.x, x2 = drag.x + drag.w, found = false;
  list.forEach((e) => {
    if (e.id === dragId || e.type === "line") return;
    if (e.y < drag.y + drag.h - 0.5 && e.y + e.h > drag.y + 0.5) {
      found = true;
      minY = Math.min(minY, e.y);
      x1 = Math.min(x1, e.x); x2 = Math.max(x2, e.x + e.w);
    }
  });
  if (!found || Math.abs(drag.y - minY) <= 0.5) return null;
  return { y: minY, x1, x2 };
}
function fieldExists(f: string, names: string[]): boolean {
  const m = f.match(/^SUM\((.+)\)$/);
  const name = (m ? m[1] : f).trim();
  return names.includes(name) || Object.prototype.hasOwnProperty.call(SYS_DATA, name);
}
function chipHtml(f: string, names: string[], withCaret: boolean): string {
  const ok = fieldExists(f, names);
  return '<span class="' + (ok ? "fld-chip chip-ok" : "fld-chip chip-bad") + '" data-raw="' + esc(f) + '"'
    + (ok ? "" : ' title="未找到字段"') + '>' + esc(chipLabel(f)) + (withCaret ? ' <i class="chip-caret">⌄</i>' : "") + '</span>';
}
function richEditHTML(raw: string | undefined, names: string[]): string {
  return esc(raw || "").replace(/\{\{(.*?)\}\}/g, (_, f: string) => chipHtml(f, names, true));
}
/** v0.9 预览态渲染：未知字段显示红色 chip，已知字段取值/求和（内部已转义） */
function renderTplHtml(tpl: string, data: Record<string, string> | null, rowsData: Record<string, string>[] | undefined, names: string[]): string {
  return esc(String(tpl || "")).replace(/\{\{(.*?)\}\}/g, (_, f: string) => {
    if (!fieldExists(f, names)) return chipHtml(f, names, false);
    const m = f.match(/^SUM\((.+)\)$/);
    if (m) {
      const name = m[1].trim();
      const list = rowsData && rowsData.length ? rowsData : data ? [data] : [];
      let sum = 0;
      list.forEach((r) => { const n = parseFloat(r[name]); if (!isNaN(n)) sum += n; });
      return esc(String(Math.round(sum * 100) / 100));
    }
    const key = f.trim();
    const v = data && data[key] !== undefined ? data[key] : SYS_DATA[key];
    return v === undefined || v === null ? "" : esc(String(v));
  });
}
/** 把编辑中的 DOM 还原为原始文本（chip → {{字段}}） */
function richToRaw(node: HTMLElement): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.nodeValue || "";
    else if (n.nodeType === 1) {
      const el = n as HTMLElement;
      if (el.classList.contains("fld-chip")) out += "{{" + (el.dataset.raw || el.textContent || "") + "}}";
      else if (el.tagName === "BR") out += "\n";
      else if (el.tagName === "DIV" || el.tagName === "P") out += (out ? "\n" : "") + richToRaw(el);
      else out += richToRaw(el);
    }
  });
  return out;
}

/* ---------- v1.1 输入【快速插入字段（对齐官方：编辑文本/单元格时敲 [ 或 【 弹出字段选择）---------- */
/** 光标前未闭合的【触发符 → 返回过滤词（无触发返回 null） */
function fpMatchBefore(host: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !host.contains(sel.getRangeAt(0).startContainer)) return null;
  const r = sel.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(host);
  pre.setEnd(r.startContainer, r.startOffset);
  const m = pre.toString().match(/[\[【]([^\]】]*)$/);
  return m ? m[1] : null;
}
/** 纯文本偏移 → host 内 DOM 位置 */
function fpTextPos(host: HTMLElement, target: number): { node: Text; offset: number } | null {
  const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let n: Node | null = w.nextNode();
  let acc = 0;
  while (n) {
    const t = n as Text;
    const len = t.nodeValue ? t.nodeValue.length : 0;
    if (acc + len >= target) return { node: t, offset: target - acc };
    acc += len;
    n = w.nextNode();
  }
  return null;
}
/** v1.1 字段选择浮层状态（host 不参与渲染，仅用于选中后定位 DOM 区间） */
type FpState = { host: HTMLElement; elId: string; kind: "content" | "cell"; r: number; c: number; filter: string; x: number; y: number; active: number };

function cellToText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(cellToText).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.name === "string") return o.name;
    if (typeof o.link === "string") return o.link;
  }
  return String(v);
}

function paintCodes(root: HTMLElement | null) {
  if (!root) return;
  const w = window as any;
  if (!w.QRCode || !w.JsBarcode) {
    root.querySelectorAll<HTMLElement>(".content.el-qr,.content.el-bar").forEach((box) => {
      if (!box.querySelector(".lib-fallback"))
        box.innerHTML =
          '<div class="lib-fallback">' + (box.classList.contains("el-qr") ? "二维码" : "条形码") + "<br>(需联网加载库)</div>";
    });
    return;
  }
  root.querySelectorAll<HTMLElement>(".content.el-qr").forEach((box) => {
    const txt = box.dataset.qr || " ";
    box.innerHTML = "";
    try { new w.QRCode(box, { text: txt, width: 200, height: 200, correctLevel: "M" }); } catch (e) { /* ignore */ }
  });
  root.querySelectorAll<HTMLElement>(".content.el-bar").forEach((box) => {
    const txt = box.dataset.bar || "0000000000";
    box.innerHTML = '<svg class="bar-svg"></svg>';
    try {
      w.JsBarcode(box.querySelector(".bar-svg"), txt, { format: "CODE128", displayValue: true, height: 60, fontSize: 12, margin: 0 });
    } catch (e) { /* ignore */ }
  });
}

/* ================= 主组件 ================= */

export default function App() {
  const [error, setError] = useState("");

  // 数据源
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tableId, setTableId] = useState("");
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);

  // 模板与界面状态
  const [templates, setTemplates] = useState<Tpl[]>([
    { id: "t1", name: "订购单", kind: "record", elements: presetDingdan() },
    { id: "t2", name: "销售报价单", kind: "record", elements: presetBaojia() },
    { id: "t3", name: "产品出库单", kind: "view", elements: presetChuku() },
  ]);
  const [currentTpl, setCurrentTpl] = useState("t1");
  const [view, setView] = useState<"preview" | "edit">("preview");
  const [currentRec, setCurrentRec] = useState(0);
  const [batch, setBatch] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null); // 双击进入编辑的元素/单元格
  const [autoFields, setAutoFields] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [paperPop, setPaperPop] = useState(false);
  const [morePop, setMorePop] = useState(false);
  const [alignPop, setAlignPop] = useState(false);
  const [posPop, setPosPop] = useState(false);
  const [signFor, setSignFor] = useState<string | null>(null);
  const [chipPop, setChipPop] = useState<{ elId: string; raw: string; x: number; y: number } | null>(null); // v0.8 chip 气泡
  const [fieldDlgOpen, setFieldDlgOpen] = useState(false); // v0.8 更换字段对话框
  const [fieldSearch, setFieldSearch] = useState("");
  const [paper, setPaper] = useState("A4");
  const [landscape, setLandscape] = useState(false);
  const [margins, setMargins] = useState({ t: 15, r: 15, b: 15, l: 15 }); // v1.0 四边边距(mm)
  const [perPage, setPerPage] = useState(8);
  const [editPanel, setEditPanel] = useState<"comp" | "data" | "page" | "setting" | "inspector">("comp"); // v1.0 侧栏面板
  const [pgSet, setPgSet] = useState({ rotate: "default", continuous: false, hfShow: false, hfGap: 2.82, mirror: false, hideFirst: false, layoutMode: "wrap" });
  const [appSet, setAppSet] = useState({ fontPt: 10, lineHeight: 1.5, paraGap: 0, wmMode: "text", wmText: "" });
  const [dsTab, setDsTab] = useState<"field" | "sys">("field");
  const [dsSearch, setDsSearch] = useState("");
  const [loopOpen, setLoopOpen] = useState(false);
  const [fp, setFp] = useState<FpState | null>(null); // v1.1 输入【快速插入字段：光标处字段选择浮层
  const [atCtx, setAtCtx] = useState<{ elId: string; col: number; field: string | null; title: string } | null>(null); // v1.3 编辑列上下文（col=-1 列尾新增）
  const [acSearch, setAcSearch] = useState(""); // v1.3 编辑列对话框字段搜索
  const [atPop, setAtPop] = useState<{ elId: string; col: number; field: string; ok: boolean; x: number; y: number } | null>(null); // v1.4 自动表格 chip 气泡
  const [ghost, setGhost] = useState<{ list: LayoutEl[]; activeId: string; refLine?: { y: number; x1: number; x2: number } } | null>(null); // v1.5.1 拖动实时排版预览（v1.5.2 加同行吸附参考线）

  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const signCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragType = useRef<ElType | null>(null);
  const idRef = useRef(100);

  const cur = templates.find((t) => t.id === currentTpl) || templates[0];
  const els = cur?.elements || [];
  const selected = els.find((e) => e.id === selectedId) || null;
  const [pw0, ph0] = PAPER_MM[paper];
  const paperW = landscape ? ph0 : pw0;
  const paperH = landscape ? pw0 : ph0;
  const recLabel = (r?: RecordRow) => (r ? r.data[fieldNames[0]] || r.data[fieldNames[1]] || "记录" : "");

  function patchTpl(tid: string, patch: (t: Tpl) => Tpl) {
    setTemplates((prev) => prev.map((t) => (t.id === tid ? patch(t) : t)));
  }
  function setEls(next: LayoutEl[]) {
    patchTpl(currentTpl, (t) => ({ ...t, elements: next }));
  }
  /** 统一修改元素并记录撤销历史 */
  function mutateEls(fn: (list: LayoutEl[]) => LayoutEl[]) {
    const next = fn(els);
    setEls(next);
    commit(next);
  }
  function updateProps(id: string, patch: ElProps) {
    mutateEls((list) => list.map((it) => (it.id === id ? { ...it, props: { ...it.props, ...patch } } : it)));
  }
  function nextElId(): string {
    let max = 0;
    templates.forEach((t) => t.elements.forEach((e) => { const n = parseInt(e.id.slice(1)); if (n > max) max = n; }));
    return "e" + Math.max(max + 1, idRef.current++);
  }

  /* ---------- v1.1 输入【快速插入字段 ---------- */
  function fpCheckEl(host: HTMLElement, el: LayoutEl, kind: "content" | "cell", r = 0, c = 0) {
    const f = fpMatchBefore(host);
    if (f === null || f.includes("]") || f.includes("】")) { setFp(null); return; }
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const box = rect && (rect.width || rect.height) ? rect : host.getBoundingClientRect();
    setFp((prev) => ({
      host, elId: el.id, kind, r, c, filter: f,
      x: Math.max(4, Math.min(box.left, window.innerWidth - 246)),
      y: box.bottom + 6,
      active: prev && prev.host === host && prev.filter === f ? prev.active : 0,
    }));
  }
  function fpKeyEl(e: React.KeyboardEvent) {
    if (!fp) return;
    const items = fieldNames.filter((f) => !fp.filter || f.toLowerCase().includes(fp.filter.toLowerCase()));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const next = (fp.active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      setFp({ ...fp, active: next });
    } else if (e.key === "Enter" || e.key === "Tab") {
      const it = items[fp.active] || items[0];
      if (it) { e.preventDefault(); fpPickField(it); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFp(null);
    }
  }
  /** 选中字段：从触发符到光标整体删除，原位插入 chip；保存交给 onBlur 的 richToRaw（避免重渲染丢光标） */
  function fpPickField(name: string) {
    if (!fp) return;
    const host = fp.host;
    const sel = window.getSelection();
    setFp(null);
    if (!sel || !sel.rangeCount) return;
    const cr = sel.getRangeAt(0);
    if (!host.contains(cr.startContainer)) return;
    const pre = cr.cloneRange();
    pre.selectNodeContents(host);
    pre.setEnd(cr.startContainer, cr.startOffset);
    const txt = pre.toString();
    const idx = Math.max(txt.lastIndexOf("["), txt.lastIndexOf("【"));
    if (idx < 0) return;
    const start = fpTextPos(host, idx);
    if (!start) return;
    const del = document.createRange();
    del.setStart(start.node, start.offset);
    del.setEnd(cr.startContainer, cr.startOffset);
    del.deleteContents();
    const chip = document.createElement("span");
    chip.className = "fld-chip chip-ok";
    chip.setAttribute("data-raw", name);
    chip.setAttribute("contenteditable", "false");
    chip.innerHTML = esc(chipLabel(name)) + ' <i class="chip-caret">⌄</i>';
    del.insertNode(chip);
    const anchor = document.createTextNode("");
    if (chip.after) chip.after(anchor);
    else chip.parentNode!.insertBefore(anchor, chip.nextSibling);
    host.focus();
    const r2 = document.createRange();
    r2.setStart(anchor, 0);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
  }

  /* ---------- 撤销 / 重做 / 清空（v0.6）---------- */
  const histRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const [, setHistTick] = useState(0);
  function resetHist() { histRef.current = { stack: [JSON.stringify(els)], idx: 0 }; }
  function commit(next?: LayoutEl[]) {
    const h = histRef.current;
    const s = JSON.stringify(next !== undefined ? next : els);
    if (h.stack[h.idx] === s) return;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(s);
    if (h.stack.length > 50) h.stack.shift();
    h.idx = h.stack.length - 1;
    setHistTick((t) => t + 1);
  }
  function undo() {
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    setEls(JSON.parse(h.stack[h.idx]));
    setSelectedId(null);
    setHistTick((t) => t + 1);
  }
  function redo() {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    setEls(JSON.parse(h.stack[h.idx]));
    setSelectedId(null);
    setHistTick((t) => t + 1);
  }
  function clearAll() {
    if (!els.length) return;
    if (!confirm("确定清空当前模板的所有元素？")) return;
    mutateEls(() => []);
    setSelectedId(null);
  }
  function showGuide() {
    alert("快捷指南：\n\n1. 编辑态左侧图标栏可切换面板：组件 / 数据源 / 页面设置 / 设置 / 检查器；\n2. 从「组件」拖元素到纸张排版；双击文本直接编辑；\n3. 输入 {{字段名}} 引用字段（蓝色=可取数，红色=未找到），{{SUM(金额)}} 对整页求和；点击字段 chip 可更改/删除；\n4. 点击元素出现浮动工具条：对齐 / 编辑 / 位置 / 复制 / 删除；\n5. 「页面设置」改纸张/方向/四边边距；「设置」配默认字号与全局水印；「检查器」看模板结构并选中元素；\n6. 新建模板：预览页左下角「＋ 创建模板」。");
  }

  /* ---------- 浮动工具条（v0.7）---------- */
  useEffect(() => { setAlignPop(false); setPosPop(false); setEditingKey(null); }, [selectedId, view]);
  const innerArea = () => ({ w: paperW - margins.l - margins.r, h: paperH - margins.t - margins.b });
  const padStr = margins.t + "mm " + margins.r + "mm " + margins.b + "mm " + margins.l + "mm";
  /* v1.0 全局水印（固定文字 / 字段值） */
  const wmText = appSet.wmMode === "text" ? (appSet.wmText || "")
    : appSet.wmMode === "field" && appSet.wmText && records[currentRec]?.data[appSet.wmText] ? String(records[currentRec].data[appSet.wmText])
    : "";
  const wmLayer = wmText ? (<div className="wm-layer"><span>{wmText}</span></div>) : null;
  function alignSel(dir: string) {
    if (!selected) return;
    const a = innerArea();
    let x = selected.x, y = selected.y;
    if (dir === "left") x = 0;
    if (dir === "hcenter") x = Math.round(((a.w - selected.w) / 2) * 10) / 10;
    if (dir === "right") x = Math.round((a.w - selected.w) * 10) / 10;
    if (dir === "top") y = 0;
    if (dir === "vcenter") y = Math.round(((a.h - selected.h) / 2) * 10) / 10;
    if (dir === "bottom") y = Math.round((a.h - selected.h) * 10) / 10;
    mutateEls((list) => list.map((it) => (it.id === selected.id ? { ...it, x, y } : it)));
    setAlignPop(false);
  }
  function fbCopy() {
    if (!selected) return;
    const clone: LayoutEl = {
      ...JSON.parse(JSON.stringify(selected)),
      id: nextElId(),
      x: Math.round((selected.x + 5) * 10) / 10,
      y: Math.round((selected.y + 5) * 10) / 10,
    };
    mutateEls((list) => [...list, clone]);
    setSelectedId(clone.id);
  }
  function fbDelete() {
    if (!selected) return;
    mutateEls((list) => list.filter((it) => it.id !== selected.id));
    setSelectedId(null);
  }
  function fbEdit() {
    if (!selected) return;
    if (TEXT_LIKE.includes(selected.type)) {
      const id = selected.id;
      setEditingKey(id);
      setTimeout(() => {
        document.querySelector<HTMLElement>('.el[data-id="' + id + '"] [contenteditable]')?.focus();
      }, 0);
    } else { setPosPop(true); setAlignPop(false); }
  }
  /* v1.0 数据源面板：点击字段插入到选中文本 */
  function insertField(f: string) {
    if (selected && TEXT_LIKE.includes(selected.type)) {
      updateProps(selected.id, { content: (selected.props.content || "") + "{{" + f + "}}" });
    } else alert("请先选中一个文本类元素（文本/文章区块/附件等）。");
  }

  /* ---------- 字段 chip 气泡 + 更换字段对话框（v0.8）---------- */
  useEffect(() => { setChipPop(null); setAtPop(null); }, [view, currentTpl]);
  function handleChipClick(chip: HTMLElement, elId: string) {
    const r = chip.getBoundingClientRect();
    const pref = editorRef.current?.getBoundingClientRect();
    setSelectedId(elId);
    setAlignPop(false); setPosPop(false);
    setChipPop({
      elId,
      raw: (chip.dataset.raw || chip.textContent || "").trim(),
      x: Math.max(4, Math.min(pref ? r.left - pref.left : 4, paperW * MM - 240)),
      y: pref ? r.bottom - pref.top + 6 : 0,
    });
  }
  /* v1.4 自动表格单元格 chip 气泡（对齐官方：[字段名] + 状态警告 + 更换/删除此列） */
  function handleAtChipClick(chip: HTMLElement, elId: string, col: number) {
    const el = els.find((it) => it.id === elId);
    if (!el || el.type !== "autotable") return;
    const fs = autoFieldsOf(el, autoFields);
    const fname = fs[col] || "";
    const r = chip.getBoundingClientRect();
    const pref = editorRef.current?.getBoundingClientRect();
    setSelectedId(elId);
    setAlignPop(false); setPosPop(false);
    setAtPop({
      elId, col, field: fname, ok: fieldNames.includes(fname),
      x: Math.max(4, Math.min(pref ? r.left - pref.left : 4, paperW * MM - 240)),
      y: pref ? r.bottom - pref.top + 6 : 0,
    });
  }
  /** 元素内所有文本值的 token 替换/删除（content + 表格单元格） */
  function replaceToken(list: LayoutEl[], elId: string, tokenOld: string, tokenNew: string): LayoutEl[] {
    return list.map((it) => {
      if (it.id !== elId) return it;
      const p = { ...it.props };
      if (typeof p.content === "string" && p.content.includes(tokenOld)) {
        p.content = p.content.split(tokenOld).join(tokenNew);
      }
      if (it.type === "table" && p.cells) {
        const cells: ElProps["cells"] = {};
        Object.keys(p.cells).forEach((r) => {
          const row = { ...p.cells![r] };
          Object.keys(row).forEach((c) => {
            const v = row[c];
            if (typeof v === "string" && v.includes(tokenOld)) row[c] = v.split(tokenOld).join(tokenNew);
          });
          cells[r] = row;
        });
        p.cells = cells;
      }
      return { ...it, props: p };
    });
  }
  function applyFieldChange(newField: string) {
    setFieldDlgOpen(false);
    if (!chipPop) return;
    const tokenOld = "{{" + chipPop.raw + "}}";
    const tokenNew = /^SUM\(/.test(chipPop.raw) ? "{{SUM(" + newField + ")}}" : "{{" + newField + "}}";
    mutateEls((list) => replaceToken(list, chipPop.elId, tokenOld, tokenNew));
    setChipPop(null);
  }
  function chipDelete() {
    if (!chipPop) return;
    const token = "{{" + chipPop.raw + "}}";
    mutateEls((list) => replaceToken(list, chipPop.elId, token, ""));
    setChipPop(null);
  }

  /* ---------- v1.3 编辑自动表格列：列头文字自定义 + 关联字段选择 + 删除列 ---------- */
  function openAutoColDlg(elId: string, col: number) {
    const el = els.find((it) => it.id === elId);
    if (!el || el.type !== "autotable") return;
    const fs = autoFieldsOf(el, autoFields);
    const titles = el.props.titles || [];
    setAtCtx({ elId, col, field: col < 0 ? null : fs[col] || null, title: col < 0 ? "" : titles[col] || "" });
    setAcSearch("");
  }
  /** 确定：写回 fields + titles（title 空则渲染时 fallback 字段名） */
  function applyAutoColumn() {
    const ctx = atCtx;
    if (!ctx) { setAtCtx(null); return; }
    const field = ctx.field || fieldNames[0];
    if (!field) { setAtCtx(null); return; }
    const title = ctx.title.trim();
    mutateEls((list) => list.map((it) => {
      if (it.id !== ctx.elId || it.type !== "autotable") return it;
      const fs = it.props.fields ? [...it.props.fields] : [...autoFields];
      const titles = it.props.titles ? [...it.props.titles] : [];
      if (ctx.col < 0) {
        fs.push(field);
        while (titles.length < fs.length - 1) titles.push("");
        titles.push(title);
      } else {
        fs[ctx.col] = field;
        while (titles.length < fs.length) titles.push("");
        titles[ctx.col] = title;
      }
      return { ...it, props: { ...it.props, fields: fs, titles } };
    }));
    setAtCtx(null);
  }
  /** 删除列（fields/titles 同步删）——对话框「删除此列」与 chip 气泡「🗑」共用 */
  function deleteColAt(elId: string, col: number) {
    if (col < 0) return;
    mutateEls((list) => list.map((it) => {
      if (it.id !== elId || it.type !== "autotable") return it;
      const fs = it.props.fields ? [...it.props.fields] : [...autoFields];
      const titles = it.props.titles ? [...it.props.titles] : [];
      fs.splice(col, 1);
      if (titles.length > col) titles.splice(col, 1);
      return { ...it, props: { ...it.props, fields: fs, titles } };
    }));
  }
  function deleteAutoCol() {
    const ctx = atCtx;
    if (!ctx || ctx.col < 0) return;
    deleteColAt(ctx.elId, ctx.col);
    setAtCtx(null);
  }

  /* ---------- 自动保存 / 加载 ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.templates?.length) { setTemplates(d.templates); setCurrentTpl(d.currentTpl || d.templates[0].id); }
        if (d.autoFields) setAutoFields(d.autoFields);
        if (d.paper) setPaper(d.paper);
        if (d.landscape) setLandscape(d.landscape);
        if (d.margins && typeof d.margins.t === "number") setMargins(d.margins);
        else if (d.margin) setMargins({ t: d.margin, r: d.margin, b: d.margin, l: d.margin });
        if (d.pgSet) setPgSet((prev) => ({ ...prev, ...d.pgSet }));
        /* v1.5.1 一次性迁移：旧版默认 off → wrap（拖动实时预览开箱即用） */
        if (!localStorage.getItem(SAVE_KEY + ".mig151")) {
          localStorage.setItem(SAVE_KEY + ".mig151", "1");
          setPgSet((prev) => ({ ...prev, layoutMode: "wrap" }));
        }
        if (d.appSet) setAppSet((prev) => ({ ...prev, ...d.appSet }));
        if (d.perPage) setPerPage(d.perPage);
      }
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ templates, currentTpl, autoFields, paper, landscape, margins, perPage, pgSet, appSet }));
    } catch (e) { /* ignore */ }
  }, [templates, currentTpl, autoFields, paper, landscape, margins, perPage, pgSet, appSet]);

  /* ---------- 加载多维表格数据 ---------- */
  async function loadTable(tid: string) {
    setError("");
    try {
      const table = await bitable.base.getTableById(tid);
      const fml = await table.getFieldMetaList();
      setFieldNames(fml.map((f: any) => f.name));
      const res = await table.getRecords({ pageSize: 500 });
      const rows: RecordRow[] = [];
      for (const rec of res.records || []) {
        const data: Record<string, string> = {};
        for (const f of fml) data[f.name] = cellToText(await table.getCellValue(f.id, rec.recordId));
        rows.push({ recordId: rec.recordId, data });
      }
      setRecords(rows);
    } catch (e: any) {
      setError("读取数据失败：" + (e?.message || e));
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const metaList = await bitable.base.getTableMetaList();
        const tList = metaList.map((t: any) => ({ id: t.id, name: t.name }));
        setTables(tList);
        if (tList.length > 0) { setTableId(tList[0].id); await loadTable(tList[0].id); }
      } catch (e: any) {
        setError("初始化失败（请检查 bitable:app 权限）：" + (e?.message || e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 自动表格字段默认全选 */
  useEffect(() => {
    if (fieldNames.length > 0 && autoFields.length === 0) setAutoFields(fieldNames.slice(0, 8));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldNames]);

  /* 二维码/条形码 */
  useEffect(() => { paintCodes(editorRef.current); paintCodes(previewRef.current); });
  useEffect(() => {
    const w = window as any;
    const load = (src: string, key: string) =>
      new Promise<void>((resolve) => {
        if (w[key]) return resolve();
        const s = document.createElement("script");
        s.src = src; s.onload = () => resolve(); s.onerror = () => resolve();
        document.head.appendChild(s);
      });
    Promise.all([
      load("https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js", "QRCode"),
      load("https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js", "JsBarcode"),
    ]).then(() => { paintCodes(editorRef.current); paintCodes(previewRef.current); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 拖放 / 拖动 / 缩放 ---------- */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    editorRef.current?.classList.remove("dragover");
    if (!dragType.current) return;
    const paperEl = editorRef.current!;
    const rect = paperEl.getBoundingClientRect();
    const cs = getComputedStyle(paperEl);
    const pad = parseFloat(cs.paddingLeft) / MM;
    const innerW = (rect.width - parseFloat(cs.paddingLeft) * 2) / MM;
    const innerH = (rect.height - parseFloat(cs.paddingTop) * 2) / MM;
    const d = DEFAULTS[dragType.current];
    const defPx = Math.round((appSet.fontPt || 10) * 96 / 72); /* v1.0 默认字号 pt → px */
    const el: LayoutEl = {
      id: nextElId(), type: dragType.current,
      x: Math.max(0, Math.min((e.clientX - rect.left) / MM - pad, innerW - d.w)),
      y: Math.max(0, Math.min((e.clientY - rect.top) / MM - pad, innerH - d.h)),
      w: d.w, h: d.h, props: JSON.parse(JSON.stringify(d.props)),
    };
    if (TEXT_LIKE.includes(el.type) && el.props.fontSize) el.props.fontSize = defPx;
    mutateEls((list) => {
      let next = [...list, el];
      /* v1.5.4 拖入 → 行内并排/顶对齐/下落（其他控件不动） */
      const s = calcSnap(next, el.x, el.y, el.w, el.h, el.id, true, pgSet.layoutMode, innerArea().w);
      if (s) next = next.map((it) => (it.id === el.id ? { ...it, x: s.x, y: s.y } : it));
      return next;
    });
    setSelectedId(el.id);
    dragType.current = null;
  }

  function startDrag(e: React.MouseEvent, el: LayoutEl, kind: "move" | "resize") {
    e.stopPropagation();
    setChipPop(null);
    setAtPop(null);
    if (kind === "move") setSelectedId(el.id);
    const startX = e.clientX, startY = e.clientY;
    const ox = el.x, oy = el.y, ow = el.w, oh = el.h;
    let last: LayoutEl[] | null = null;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / MM, dy = (ev.clientY - startY) / MM;
      last = els.map((it) => {
        if (it.id !== el.id) return it;
        if (kind === "move") return { ...it, x: ox + dx, y: oy + dy };
        return { ...it, w: Math.max(3, ow + dx), h: Math.max(2, oh + dy) };
      });
      setEls(last);
      /* v1.5.4 统一吸附预览：行内并排 / 顶对齐吸附（带参考线）/ 下落避让 */
      const cur = last.find((it) => it.id === el.id)!;
      const s = calcSnap(last, cur.x, cur.y, cur.w, cur.h, el.id, kind === "move", pgSet.layoutMode, innerArea().w);
      if (s) setGhost({ list: [{ ...cur, x: s.x, y: s.y }], activeId: el.id, refLine: s.line });
      else setGhost(null);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setGhost(null);
      if (last) {
        let next = last;
        const cur = next.find((it) => it.id === el.id)!;
        const s = calcSnap(next, cur.x, cur.y, cur.w, cur.h, el.id, kind === "move", pgSet.layoutMode, innerArea().w);
        if (s) next = next.map((it) => (it.id === el.id ? { ...it, x: s.x, y: s.y } : it));
        setEls(next);
        commit(next);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /* ---------- 元素内容 ---------- */
  function elContent(el: LayoutEl, data: Record<string, string> | null, rowsData?: Record<string, string>[], edit?: boolean): React.ReactNode {
    const p = el.props;
    const style: React.CSSProperties = {
      fontSize: (p.fontSize || 14) + "px", fontWeight: p.bold ? 700 : 400, textAlign: p.align || "left",
    };
    switch (el.type) {
      case "text":
      case "free":
      case "article":
      case "attach":
        if (edit) {
          const editing = editingKey === el.id;
          return (
            <div className="content editable" style={style} contentEditable={editing} suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: richEditHTML(p.content || "", fieldNames) }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingKey(el.id);
                setTimeout(() => {
                  document.querySelector<HTMLElement>('.el[data-id="' + el.id + '"] [contenteditable]')?.focus();
                }, 0);
              }}
              onMouseDown={(e) => { if (editing || (e.target as HTMLElement).closest(".fld-chip")) e.stopPropagation(); }}
              onInput={(e) => fpCheckEl(e.currentTarget, el, "content")}
              onKeyDown={fpKeyEl}
              onClick={(e) => {
                const chip = (e.target as HTMLElement).closest(".fld-chip") as HTMLElement | null;
                if (chip) { e.stopPropagation(); handleChipClick(chip, el.id); }
              }}
              onBlur={(e) => { setFp(null); updateProps(el.id, { content: richToRaw(e.currentTarget) }); setEditingKey(null); }} />
          );
        }
        return <div className="content" style={style} dangerouslySetInnerHTML={{ __html: renderTplHtml(p.content || "", data, rowsData, fieldNames) }} />;
      case "line":
        return <div className="content el-line" />;
      case "image":
        return <div className="content el-img"><img src={p.src} alt="" /></div>;
      case "qrcode":
        return <div className="content el-qr" data-qr={p.content} />;
      case "barcode":
        return <div className="content el-bar" data-bar={p.content} />;
      case "sign":
        return p.src ? (
          <div className="content el-sign"><div className="sign-zone"><img src={p.src} alt="签名" /></div></div>
        ) : (
          <div className="content el-sign"><div className="sign-zone">签名区</div></div>
        );
      case "table": {
        const nRows = p.rows || 3, cols = p.cols || 3;
        return (
          <div className="content el-table" style={style}>
            <table>
              {Array.from({ length: nRows }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => {
                    const raw = p.cells?.[r]?.[c] || "";
                    const cellKey = el.id + ":" + r + ":" + c;
                    return edit ? (
                      <td key={c} data-cell={r + "-" + c} style={{ textAlign: p.align || "left" }}
                        contentEditable={editingKey === cellKey} suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: richEditHTML(raw, fieldNames) }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingKey(cellKey);
                          setTimeout(() => {
                            document.querySelector<HTMLElement>('.el[data-id="' + el.id + '"] td[data-cell="' + (r + "-" + c) + '"]')?.focus();
                          }, 0);
                        }}
                        onMouseDown={(e) => { if (editingKey === cellKey || (e.target as HTMLElement).closest(".fld-chip")) e.stopPropagation(); }}
                        onInput={(e) => fpCheckEl(e.currentTarget, el, "cell", r, c)}
                        onKeyDown={fpKeyEl}
                        onClick={(e) => {
                          const chip = (e.target as HTMLElement).closest(".fld-chip") as HTMLElement | null;
                          if (chip) { e.stopPropagation(); handleChipClick(chip, el.id); }
                        }}
                        onBlur={(e) => {
                          setFp(null);
                          const cells = { ...(p.cells || {}) };
                          cells[r] = { ...(cells[r] || {}), [c]: richToRaw(e.currentTarget) };
                          updateProps(el.id, { cells });
                          setEditingKey(null);
                        }} />
                    ) : (
                      <td key={c} style={{ textAlign: p.align || "left" }} dangerouslySetInnerHTML={{ __html: renderTplHtml(raw, data, rowsData, fieldNames) }} />
                    );
                  })}
                </tr>
              ))}
            </table>
          </div>
        );
      }
      case "autotable": {
        /* v1.3 编辑态：列头可点击、数据行渲染字段 chip（点击进「编辑列」对话框），列尾＋新增 */
        const fs = autoFieldsOf(el, autoFields);
        const titles = el.props.titles || [];
        const sample = records.slice(0, 2);
        return (
          <div className="content el-autotable">
            <table>
              <thead><tr>
                {fs.map((f, ci) => (
                  <th key={f + "-" + ci} className="at-th" title="点击编辑列"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); openAutoColDlg(el.id, ci); }}>
                    {titles[ci] || f}
                  </th>
                ))}
                <th className="at-add" title="添加字段列"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); openAutoColDlg(el.id, -1); }}>＋</th>
              </tr></thead>
              <tbody>
                {sample.map((rec, i) => (
                  <tr key={i}>
                    {fs.map((f, ci) => (
                      <td key={f + "-" + ci}>
                        <span className="fld-chip chip-ok at-chip" title="点击更改或删除此列"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); handleAtChipClick(e.currentTarget, el.id, ci); }}>
                          {chipLabel(f)} <i className="chip-caret">⌄</i>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                <tr><td colSpan={fs.length + 1} style={{ color: "#bbb", textAlign: "center" }}>…预览时自动填入全部记录…</td></tr>
              </tbody>
            </table>
          </div>
        );
      }
    }
  }

  /* ---------- 分页 ---------- */
  interface Page { data?: Record<string, string>; rows: RecordRow[] }
  const pages = useMemo<Page[]>(() => {
    const list: Page[] = [];
    if (cur.kind === "record") {
      if (batch) records.forEach((r) => list.push({ data: r.data, rows: [r] }));
      else list.push({ data: records[currentRec]?.data || {}, rows: records.slice(currentRec, currentRec + 1) });
    } else {
      const hasAuto = els.some((e) => e.type === "autotable");
      if (hasAuto) {
        for (let i = 0; i < records.length; i += perPage) list.push({ rows: records.slice(i, i + perPage) });
        if (list.length === 0) list.push({ rows: [] });
      } else {
        list.push({ data: null, rows: [] });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, records, currentRec, batch, perPage]);

  /* ---------- 签名板 ---------- */
  useEffect(() => {
    if (!signFor || !signCanvasRef.current) return;
    const c = signCanvasRef.current;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#1f2329";
    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
    };
    const down = (e: PointerEvent) => { drawing = true; c.setPointerCapture(e.pointerId); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: PointerEvent) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const up = () => { drawing = false; };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
    };
  }, [signFor]);

  /* ---------- Delete 键 ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Delete" && selectedId && view === "edit") {
        mutateEls((list) => list.filter((it) => it.id !== selectedId));
        setSelectedId(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, els, view]);

  /* ---------- 导出 HTML ---------- */
  function exportHtml() {
    const inner = exportRef.current?.innerHTML || "";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(cur.name)}</title><style>
body{margin:0;background:#eee;font-family:"Microsoft YaHei",sans-serif}
.paper{width:${paperW}mm;height:${paperH}mm;padding:${margins.t}mm ${margins.r}mm ${margins.b}mm ${margins.l}mm;box-sizing:border-box}${EXPORT_CSS}
</style></head><body>${inner}</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cur.name + ".html";
    a.click();
  }

  /* ---------- 渲染 ---------- */
  if (error) return <div className="err">{error}</div>;

  return (
    <div className="app">
      {/* ===== 左侧面板 ===== */}
      <aside className="side">
        {view === "edit" ? (
          <>
            <div className="side-body">
              <div className="icon-rail">
                {(["comp", "data", "page", "setting", "inspector"] as const).map((k) => (
                  <button key={k} className={"rail-btn" + (editPanel === k ? " on" : "")} title={RAIL_TITLES[k]} onClick={() => setEditPanel(k)}>
                    {RAIL_ICONS[k]}
                  </button>
                ))}
              </div>
              <div className="panel-area"><div className="panel-scroll">
                {editPanel === "comp" && (
                  <>
                    <div className="panel-title">组件</div>
                    <div className="tip-box">拖动到右侧页面开始排版演示 🙂</div>
                    {COMPONENTS.map((it) => (
                      <div key={it.type} className="comp-card" draggable onDragStart={() => (dragType.current = it.type)}>
                        <span className="ic">{it.icon}</span>{it.label}
                      </div>
                    ))}
                  </>
                )}
                {editPanel === "data" && (
                  <>
                    <div className="panel-title">数据源</div>
                    <input className="ds-search" placeholder="搜索字段" value={dsSearch} onChange={(e) => setDsSearch(e.target.value)} />
                    <div className="ds-tabs">
                      <button className={"ds-tab" + (dsTab !== "sys" ? " on" : "")} onClick={() => setDsTab("field")}>字段</button>
                      <button className={"ds-tab" + (dsTab === "sys" ? " on" : "")} onClick={() => setDsTab("sys")}>系统</button>
                    </div>
                    {dsTab !== "sys" ? (
                      <>
                        {fieldNames.filter((f) => !dsSearch.trim() || f.toLowerCase().includes(dsSearch.trim().toLowerCase())).map((f) => {
                          const m = fieldMeta(f, records[0]?.data);
                          return (
                            <div key={f} className="ds-item" title="点击插入到选中文本" onClick={() => insertField(f)}>
                              <span className="ic">{m.ic}</span><span className="nm">{f}</span>
                              <button className="cp" title="复制变量" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText("{{" + f + "}}"); }}>⧉</button>
                            </div>
                          );
                        })}
                        <div className="ps-sec">循环字段</div>
                        <div className="ps-row" style={{ padding: "0 0 6px" }}><span style={{ color: "var(--blue)", fontSize: 12, cursor: "pointer" }}>ⓘ 循环变量使用方法</span></div>
                        <div className="loop-wrap">
                          <div className="loop-head" onClick={() => setLoopOpen(!loopOpen)}>
                            <span className="ic">⑃</span><span className="nm">订单明细</span>
                            <button className="loop-fold">{loopOpen ? "收起 ∧" : "展开 ∨"}</button>
                          </div>
                          {loopOpen && (
                            <div className="loop-sub">
                              {LOOP_FIELDS.map((f) => {
                                const m = fieldMeta(f, records[0]?.data);
                                return (
                                  <div key={f} className="ds-item" onClick={() => insertField(f)}>
                                    <span className="ic">{m.ic}</span><span className="nm">{f}</span>
                                    <button className="cp" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText("{{" + f + "}}"); }}>⧉</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="ds-item" onClick={() => insertField("明细序号")}>
                          <span className="ic">#</span><span className="nm">自动序号</span>
                          <button className="cp" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText("{{明细序号}}"); }}>⧉</button>
                        </div>
                      </>
                    ) : (
                      Object.keys(SYS_DATA).map((f) => (
                        <div key={f} className="ds-item" title="点击插入到选中文本" onClick={() => insertField(f)}>
                          <span className="ic">T</span><span className="nm">{f}</span>
                          <button className="cp" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText("{{" + f + "}}"); }}>⧉</button>
                        </div>
                      ))
                    )}
                  </>
                )}
                {editPanel === "page" && (
                  <>
                    <div className="panel-title">页面设置</div>
                    <div className="ps-sec">页面尺寸（mm）</div>
                    <div className="ps-grid">
                      <div><label>纸张</label>
                        <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                          <option value="A4">A4</option><option value="A5">A5</option><option value="letter">Letter</option>
                        </select></div>
                      <div><label>页面方向</label>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className={"btn-sm" + (!landscape ? " on" : "")} style={{ margin: 0 }} onClick={() => setLandscape(false)}>纵向</button>
                          <button className={"btn-sm" + (landscape ? " on" : "")} style={{ margin: 0 }} onClick={() => setLandscape(true)}>横向</button>
                        </div></div>
                    </div>
                    <div className="ps-grid" style={{ marginTop: 7 }}>
                      <div><label>宽</label><input value={paperW} readOnly /></div>
                      <div><label>高</label><input value={paperH} readOnly /></div>
                    </div>
                    <div className="ps-sec">页边距 (mm)</div>
                    <div className="ps-grid">
                      {([["t", "上"], ["b", "下"], ["l", "左"], ["r", "右"]] as const).map(([k, label]) => (
                        <div key={k}><label>{label}</label>
                          <input type="number" min={0} max={60} value={margins[k]}
                            onChange={(e) => setMargins({ ...margins, [k]: +e.target.value || 0 })} /></div>
                      ))}
                    </div>
                    {cur.kind === "view" && (
                      <div className="ps-grid" style={{ marginTop: 7 }}>
                        <div><label>自动表格每页行数</label>
                          <input type="number" min={1} max={30} value={perPage} onChange={(e) => setPerPage(+e.target.value || 8)} /></div>
                        <div />
                      </div>
                    )}
                    <div className="ps-sec">打印选项</div>
                    <div className="ps-grid">
                      <div><label>打印旋转 ⓘ</label>
                        <select value={pgSet.rotate} onChange={(e) => setPgSet({ ...pgSet, rotate: e.target.value })}>
                          <option value="default">默认</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option>
                        </select></div>
                      <div><label>连续页面 ⓘ</label>
                        <div style={{ padding: "5px 0" }}>
                          <label className="sw"><input type="checkbox" checked={pgSet.continuous} onChange={(e) => setPgSet({ ...pgSet, continuous: e.target.checked })} /><i></i></label>
                        </div></div>
                    </div>
                    {/* v1.5 自动排版：控件重叠时不允许堆叠，自动换行或排成双列 */}
                    <div className="ps-sec">自动排版</div>
                    <div className="ps-grid">
                      <div><label>堆叠处理 ⓘ</label>
                        <select value={pgSet.layoutMode || "wrap"} onChange={(e) => setPgSet({ ...pgSet, layoutMode: e.target.value })}>
                          <option value="off">不重排</option><option value="wrap">重叠时自动换行</option><option value="cols2">重叠时排成双列</option>
                        </select></div>
                      <div />
                    </div>
                    <div className="empty-tip" style={{ marginTop: 4 }}>拖到其他控件上方：自动并排到该行空位（顶对齐）或下落到空位，其他控件不动；与控件水平同行：自动顶部对齐（红色吸附线）</div>
                    <div className="ps-sec">页头页尾配置</div>
                    <div className="ps-row"><span>显示页头页尾</span>
                      <label className="sw"><input type="checkbox" checked={pgSet.hfShow} onChange={(e) => setPgSet({ ...pgSet, hfShow: e.target.checked })} /><i></i></label></div>
                    {pgSet.hfShow && (
                      <>
                        <div className="ps-grid">
                          <div><label>页头 (mm)</label><input type="number" step={0.1} value={pgSet.hfGap} onChange={(e) => setPgSet({ ...pgSet, hfGap: +e.target.value || 2.82 })} /></div>
                          <div><label>页尾 (mm)</label><input type="number" step={0.1} value={pgSet.hfGap} onChange={(e) => setPgSet({ ...pgSet, hfGap: +e.target.value || 2.82 })} /></div>
                        </div>
                        <div className="ps-row"><span>左右页镜像 ⓘ</span>
                          <label className="sw"><input type="checkbox" checked={pgSet.mirror} onChange={(e) => setPgSet({ ...pgSet, mirror: e.target.checked })} /><i></i></label></div>
                        <div className="ps-row"><span>首页隐藏 ⓘ</span>
                          <label className="sw"><input type="checkbox" checked={pgSet.hideFirst} onChange={(e) => setPgSet({ ...pgSet, hideFirst: e.target.checked })} /><i></i></label></div>
                      </>
                    )}
                  </>
                )}
                {editPanel === "setting" && (
                  <>
                    <div className="panel-title">设置</div>
                    <div className="ps-sec">默认字体大小（pt）</div>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, background: "#fff" }}
                      value={appSet.fontPt} onChange={(e) => setAppSet({ ...appSet, fontPt: +e.target.value || 10 })}>
                      {[8, 9, 10, 11, 12, 14].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <div className="ps-sec">默认行高</div>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, background: "#fff" }}
                      value={appSet.lineHeight} onChange={(e) => setAppSet({ ...appSet, lineHeight: +e.target.value || 1.5 })}>
                      {[1, 1.15, 1.5, 2].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <div className="ps-sec">默认段后间距</div>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, background: "#fff" }}
                      value={appSet.paraGap} onChange={(e) => setAppSet({ ...appSet, paraGap: +e.target.value || 0 })}>
                      {[0, 2, 4, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <div className="ps-sec">全局水印</div>
                    <div className="wm-radio">
                      <label><input type="radio" name="wmMode" checked={appSet.wmMode !== "field" && appSet.wmMode !== "image"} onChange={() => setAppSet({ ...appSet, wmMode: "text" })} /> 固定文字</label>
                      <label><input type="radio" name="wmMode" checked={appSet.wmMode === "field"} onChange={() => setAppSet({ ...appSet, wmMode: "field" })} /> 字段值</label>
                      <label><input type="radio" name="wmMode" checked={appSet.wmMode === "image"} onChange={() => setAppSet({ ...appSet, wmMode: "image" })} /> 图片</label>
                    </div>
                    <textarea placeholder="输入水印内容" value={appSet.wmText}
                      style={{ width: "100%", height: 64, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                      onChange={(e) => setAppSet({ ...appSet, wmText: e.target.value })} />
                    <div style={{ fontSize: 11, color: "#a0a6b0", marginTop: 7, lineHeight: 1.7 }}>支持固定文字、图片，或根据当前记录字段动态显示</div>
                  </>
                )}
                {editPanel === "inspector" && (
                  <>
                    <div className="panel-title">检查器</div>
                    <div className="ps-sec" style={{ marginTop: 2 }}>模板结构</div>
                    <div className="insp-page">
                      <div className="insp-page-head"><span>页面 1</span><span style={{ letterSpacing: -1 }}>{"</>"}</span></div>
                      <div className="insp-grid">
                        {els.map((el) => {
                          const wide = el.type === "line" || el.type === "table" || el.type === "autotable" || el.w >= 100;
                          return (
                            <div key={el.id} className={"insp-el" + (el.id === selectedId ? " on" : "") + (wide ? " wide" : "")}
                              title="点击选中该元素" onClick={() => setSelectedId(el.id)}>
                              {COMPONENTS.find((c) => c.type === el.type)?.icon || "▫"} {TYPE_NAMES[el.type] || el.type}
                            </div>
                          );
                        })}
                        {els.length === 0 && <div className="side-empty">暂无元素，请从「组件」面板拖入</div>}
                      </div>
                    </div>
                    <div className="ps-sec">元素属性</div>
                    {!selected ? (
                      <div className="empty-tip">点击纸张上的元素进行设置；双击文本可直接编辑；选中后按 Delete 删除。</div>
                    ) : (
                      <div>
                        <div className="prop-grid">
                          <div><label>X(mm)</label>
                            <input type="number" value={selected.x.toFixed(1)} onChange={(e) => setEls(els.map((it) => it.id === selected.id ? { ...it, x: +e.target.value || 0 } : it))} /></div>
                          <div><label>Y(mm)</label>
                            <input type="number" value={selected.y.toFixed(1)} onChange={(e) => setEls(els.map((it) => it.id === selected.id ? { ...it, y: +e.target.value || 0 } : it))} /></div>
                          <div><label>宽(mm)</label>
                            <input type="number" value={selected.w.toFixed(1)} onChange={(e) => setEls(els.map((it) => it.id === selected.id ? { ...it, w: Math.max(3, +e.target.value || 3) } : it))} /></div>
                          <div><label>高(mm)</label>
                            <input type="number" value={selected.h.toFixed(1)} onChange={(e) => setEls(els.map((it) => it.id === selected.id ? { ...it, h: Math.max(2, +e.target.value || 2) } : it))} /></div>
                        </div>
                        {TEXT_LIKE.includes(selected.type) && (
                          <>
                            <div className="props" style={{ marginTop: 6 }}>
                              <textarea value={selected.props.content || ""} onChange={(e) => updateProps(selected.id, { content: e.target.value })} />
                            </div>
                            <div className="prop-grid" style={{ marginTop: 6 }}>
                              <div><label>字号</label>
                                <input type="number" value={selected.props.fontSize || 14} onChange={(e) => updateProps(selected.id, { fontSize: +e.target.value || 14 })} /></div>
                              <div><label>对齐</label>
                                <select value={selected.props.align || "left"} onChange={(e) => updateProps(selected.id, { align: e.target.value as any })}>
                                  <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                                </select></div>
                            </div>
                            <div className="fld-check" style={{ marginTop: 4 }}>
                              <input type="checkbox" checked={!!selected.props.bold} onChange={(e) => updateProps(selected.id, { bold: e.target.checked })} />
                              <span>加粗</span>
                            </div>
                            <div className="empty-tip" style={{ marginTop: 4 }}>文本中输入 {"{{字段}}"} 引用数据，{"{{SUM(金额)}}"} 求和</div>
                          </>
                        )}
                        {selected.type === "image" && (
                          <div className="props" style={{ marginTop: 6 }}>
                            <textarea placeholder="图片 URL" value={selected.props.src || ""} onChange={(e) => updateProps(selected.id, { src: e.target.value })} />
                          </div>
                        )}
                        {(selected.type === "qrcode" || selected.type === "barcode") && (
                          <div className="props" style={{ marginTop: 6 }}>
                            <textarea value={selected.props.content || ""} onChange={(e) => updateProps(selected.id, { content: e.target.value })} />
                          </div>
                        )}
                        {selected.type === "sign" && (
                          <>
                            <button className="btn-sm" onClick={() => setSignFor(selected.id)}>
                              ✍️ {selected.props.src ? "重新手写签名" : "手写签名"}
                            </button>
                            {selected.props.src && (
                              <button className="btn-sm" onClick={() => updateProps(selected.id, { src: undefined })}>清除签名</button>
                            )}
                          </>
                        )}
                        {selected.type === "table" && (
                          <div className="prop-grid" style={{ marginTop: 6 }}>
                            <div><label>行数</label>
                              <input type="number" min={1} max={20} value={selected.props.rows || 3} onChange={(e) => updateProps(selected.id, { rows: Math.max(1, +e.target.value || 3) })} /></div>
                            <div><label>列数</label>
                              <input type="number" min={1} max={10} value={selected.props.cols || 3} onChange={(e) => updateProps(selected.id, { cols: Math.max(1, +e.target.value || 3) })} /></div>
                          </div>
                        )}
                        {selected.type === "autotable" && (
                          <div className="empty-tip" style={{ marginTop: 6 }}>点击表格单元格的字段块可更换关联字段，列尾「＋」新增字段列；初始列取「模板设置」勾选</div>
                        )}
                        <button className="btn-del" onClick={() => { setEls(els.filter((it) => it.id !== selected.id)); setSelectedId(null); }}>
                          🗑 删除该元素
                        </button>
                      </div>
                    )}
                    <details className="fold"><summary>文档</summary><div className="fold-body">
                      <div className="ps-row"><span>模板类型</span><span style={{ color: "var(--sub)" }}>{cur.kind === "record" ? "记录模板" : "视图模板"}</span></div>
                      <div className="ps-row"><span>元素数量</span><span style={{ color: "var(--sub)" }}>{els.length}</span></div>
                    </div></details>
                    <details className="fold"><summary>页面设置</summary><div className="fold-body">
                      <div className="ps-row"><span>纸张</span><span style={{ color: "var(--sub)" }}>{paper} · {landscape ? "横向" : "纵向"}</span></div>
                      <div className="ps-row"><span>边距</span><span style={{ color: "var(--sub)" }}>上{margins.t} 下{margins.b} 左{margins.l} 右{margins.r} mm</span></div>
                    </div></details>
                    <details className="fold"><summary>模板设置</summary><div className="fold-body">
                      <div className="sec-title" style={{ marginTop: 0 }}>自动表格 · 显示字段</div>
                      {fieldNames.map((f) => (
                        <label key={f} className="fld-check">
                          <input type="checkbox" checked={autoFields.includes(f)}
                            onChange={(e) => setAutoFields((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))} />
                          <span>{f}</span>
                        </label>
                      ))}
                    </div></details>
                  </>
                )}
              </div></div>
            </div>
            <div className="side-foot">
              <span style={{ fontSize: 12, color: "var(--sub)" }}>快捷指南 ⓘ</span>
              <button className="link-btn" onClick={showGuide}>如何创建新模板</button>
            </div>
          </>
        ) : (
          <>
            <div className="side-search">
              <input placeholder="搜索模板" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="side-scroll">
              <div className="group-title">记录模板（每条记录一份文件）</div>
              {templates.filter((t) => t.kind === "record" && (!search || t.name.toLowerCase().includes(search.toLowerCase()))).length === 0 && (
                <div className="side-empty">暂无模板</div>
              )}
              {templates.filter((t) => t.kind === "record" && (!search || t.name.toLowerCase().includes(search.toLowerCase()))).map((t) => (
                <div key={t.id} className={"tpl-item" + (t.id === currentTpl ? " on" : "")}
                  onClick={() => { setCurrentTpl(t.id); setSelectedId(null); setBatch(false); setCurrentRec(0); }}>
                  <span>📄</span><span className="nm">{t.name}</span>
                  <button className="del" onClick={(e) => {
                    e.stopPropagation();
                    if (templates.length <= 1) return alert("至少保留一个模板。");
                    if (!confirm("确定删除模板「" + t.name + "」？")) return;
                    const rest = templates.filter((x) => x.id !== t.id);
                    setTemplates(rest);
                    if (currentTpl === t.id) setCurrentTpl(rest[0].id);
                  }}>🗑</button>
                </div>
              ))}
              <div className="group-title">视图模板（整表批量打印）</div>
              {templates.filter((t) => t.kind === "view" && (!search || t.name.toLowerCase().includes(search.toLowerCase()))).length === 0 && (
                <div className="side-empty">暂无模板</div>
              )}
              {templates.filter((t) => t.kind === "view" && (!search || t.name.toLowerCase().includes(search.toLowerCase()))).map((t) => (
                <div key={t.id} className={"tpl-item" + (t.id === currentTpl ? " on" : "")}
                  onClick={() => { setCurrentTpl(t.id); setSelectedId(null); setBatch(false); }}>
                  <span>🗃️</span><span className="nm">{t.name}</span>
                  <button className="del" onClick={(e) => {
                    e.stopPropagation();
                    if (templates.length <= 1) return alert("至少保留一个模板。");
                    if (!confirm("确定删除模板「" + t.name + "」？")) return;
                    const rest = templates.filter((x) => x.id !== t.id);
                    setTemplates(rest);
                    if (currentTpl === t.id) setCurrentTpl(rest[0].id);
                  }}>🗑</button>
                </div>
              ))}
            </div>
            <div className="side-foot">
              <button className="btn-create" onClick={() => {
                const kindStr = prompt("创建模板类型 —— 输入 1=记录模板（单条记录一份文件），2=视图模板（整表批量打印）：", "1");
                if (!kindStr) return;
                const kind: "record" | "view" = kindStr.trim() === "2" ? "view" : "record";
                const name = prompt("模板名称：", kind === "record" ? "记录模板 " : "视图模板 ");
                if (!name) return;
                const t: Tpl = {
                  id: "t" + Date.now(), name, kind,
                  elements: [{ id: nextElId(), type: "text", x: 70, y: 15, w: 70, h: 12, props: { content: name, fontSize: 22, bold: true, align: "center" } }],
                };
                setTemplates([...templates, t]);
                setCurrentTpl(t.id); setSelectedId(null); setBatch(false);
                histRef.current = { stack: [JSON.stringify(t.elements)], idx: 0 };
                setView("edit");
              }}>＋ 创建模板</button>
            </div>
          </>
        )}
      </aside>

      {/* ===== 主区域 ===== */}
      <div className="main">
        {/* 顶部操作栏 */}
        <div className="topbar">
          {view === "edit" ? (
            <>
              <button className="tb-btn" onClick={() => { setView("preview"); setSelectedId(null); }}>✕ 退出</button>
              <input className="name-input" value={cur.name}
                onChange={(e) => patchTpl(cur.id, (t) => ({ ...t, name: e.target.value }))} />
              <span className="grow" />
              <button className="tb-btn" onClick={clearAll}>🗑 清空</button>
              <button className="tb-btn" title="撤销" disabled={histRef.current.idx <= 0} onClick={undo}>↶</button>
              <button className="tb-btn" title="重做" disabled={histRef.current.idx >= histRef.current.stack.length - 1} onClick={redo}>↷</button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{cur.kind === "record" ? "📄" : "🗃️"} {cur.name}</span>
              <span className="pop-wrap">
                <button className="paper-chip" onClick={() => setPaperPop(!paperPop)}>
                  {paper}/{landscape ? "横向" : "纵向"} · 修改 ▾
                </button>
                {paperPop && (
                  <span className="popover show" onClick={(e) => e.stopPropagation()}>
                    <label>纸张</label>
                    <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                      <option value="A4">A4</option><option value="A5">A5</option><option value="letter">Letter</option>
                    </select>
                    <div className="row2">
                      <div style={{ flex: 1 }}><label>方向</label>
                        <select value={landscape ? "l" : "p"} onChange={(e) => setLandscape(e.target.value === "l")}>
                          <option value="p">纵向</option><option value="l">横向</option>
                        </select></div>
                        <div style={{ flex: 1 }}><label>边距mm</label>
                          <input type="number" min={0} max={60} value={margins.t} onChange={(e) => { const v = +e.target.value || 0; setMargins({ t: v, r: v, b: v, l: v }); }} /></div>
                    </div>
                    {cur.kind === "view" && (
                      <>
                        <label>自动表格每页行数</label>
                        <input type="number" min={1} max={30} value={perPage} onChange={(e) => setPerPage(+e.target.value || 8)} />
                      </>
                    )}
                  </span>
                )}
              </span>
              {cur.kind === "record" ? (
                <>
                  <span className="sep" />
                  <span className="rec-chip">当前记录: <b>{recLabel(records[currentRec])}</b></span>
                  <select value={currentRec} onChange={(e) => setCurrentRec(+e.target.value)} style={{ maxWidth: 110 }}>
                    {records.map((r, i) => <option key={r.recordId} value={i}>{recLabel(r)}</option>)}
                  </select>
                  <button className={"link-btn" + (batch ? " batch-on" : "")} onClick={() => setBatch(!batch)}>
                    {batch ? "✓ 批量模式中" : "进入批量模式"}
                  </button>
                </>
              ) : (
                <>
                  <span className="sep" />
                  <span className="rec-chip">整表批量 · 共 {records.length} 条</span>
                </>
              )}
              <span className="grow" />
              <button className="tb-btn" onClick={exportHtml}>⬇ 导出</button>
              <button className="tb-btn" onClick={() => { resetHist(); setView("edit"); setSelectedId(null); }}>✏️ 编辑</button>
              <button className="tb-btn primary" onClick={() => window.print()}>🖨 打印</button>
            </>
          )}
        </div>

        {/* 数据表切换（小字） */}
        {tables.length > 1 && (
          <div style={{ background: "#fff", borderBottom: "1px solid var(--line)", padding: "4px 14px", fontSize: 12, color: "var(--sub)" }}>
            数据表：
            <select value={tableId} onChange={async (e) => { setTableId(e.target.value); await loadTable(e.target.value); }}
              style={{ padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 5, fontSize: 12 }}>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* 内容区 */}
        <div className="content">
          {view === "preview" ? (
            <div ref={previewRef}>
              {pages.map((pg, i) => (
                <div key={i} className="paper" style={{ width: paperW + "mm", height: paperH + "mm", padding: padStr }}>
                  <span className="paper-label">第 {i + 1} 页 / 共 {pages.length} 页</span>
                  {wmLayer}
                  {els.map((el) => (
                    <div key={el.id} className={"el el-" + el.type}
                      style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}>
                      {el.type === "autotable" ? (
                        <div className="content el-autotable">
                          <table>
                            <thead><tr>{autoFieldsOf(el, autoFields).map((f, ci) => <th key={f + "-" + ci}>{el.props.titles?.[ci] || f}</th>)}</tr></thead>
                            <tbody>
                              {pg.rows.map((rec, r) => (
                                <tr key={r}>{autoFieldsOf(el, autoFields).map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                              ))}
                              {cur.kind === "view" && Array.from({ length: Math.max(0, perPage - pg.rows.length) }, (_, r) => (
                                <tr key={"p" + r}>{autoFieldsOf(el, autoFields).map((f) => <td key={f}>&nbsp;</td>)}</tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        elContent(el, pg.data || null, pg.rows.map((r) => r.data), false)
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="canvas-top">
                <span>改动将自动保存</span>
                <span className="grow" />
                <span className="pop-wrap">
                  <button className="more-btn" onClick={() => setMorePop(!morePop)}>⋯ 更多</button>
                  {morePop && (
                    <span className="popover show right" onClick={(e) => e.stopPropagation()}>
                      <button className="pop-item" style={{ marginTop: 8 }} onClick={exportHtml}>⬇ 导出 HTML</button>
                      <button className="pop-item" onClick={showGuide}>📖 使用指南</button>
                    </span>
                  )}
                </span>
              </div>
              <div
              ref={editorRef}
              className="paper"
              style={{ width: paperW + "mm", height: paperH + "mm", padding: padStr }}
              onDragOver={(e) => { e.preventDefault(); editorRef.current?.classList.add("dragover"); }}
              onDragLeave={() => editorRef.current?.classList.remove("dragover")}
              onDrop={onDrop}
              onMouseDown={(e) => { if (e.target === editorRef.current) setSelectedId(null); }}
            >
              {wmLayer}
              {els.map((el) => (
                <div key={el.id} data-id={el.id}
                  className={"el el-" + el.type + (el.id === selectedId ? " selected" : "")}
                  style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}
                  onMouseDown={(e) => startDrag(e, el, "move")}>
                  {elContent(el, cur.kind === "record" ? records[currentRec]?.data || {} : null, undefined, true)}
                  <div className="drag-handle" title="拖动移动" onMouseDown={(e) => startDrag(e, el, "move")}>✥</div>
                  <div className="resize-handle" onMouseDown={(e) => startDrag(e, el, "resize")} />
                </div>
              ))}
              {/* v1.5.1 拖动实时排版预览：重叠时显示重排式样虚线框；v1.5.2 同行时显示顶部吸附线 */}
              {ghost && (
                <div className="ghost-layer">
                  {ghost.list.map((g) => (
                    <div key={g.id} className={"ghost-el" + (g.id === ghost.activeId ? " active" : "")}
                      style={{ left: g.x + "mm", top: g.y + "mm", width: g.w + "mm", height: g.h + "mm" }} />
                  ))}
                  {ghost.refLine && (
                    <div className="ghost-refline"
                      style={{ top: ghost.refLine.y + "mm", left: ghost.refLine.x1 + "mm", width: (ghost.refLine.x2 - ghost.refLine.x1) + "mm" }} />
                  )}
                </div>
              )}
              {/* v1.1 输入【快速插入字段：光标处字段选择浮层 */}
              {fp && (
                <div className="field-picker"
                  style={{ position: "fixed", left: fp.x, top: fp.y }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const it = (e.target as HTMLElement).closest(".fp-item") as HTMLElement | null;
                    if (it && it.dataset.f) fpPickField(it.dataset.f);
                  }}>
                  <div className="fp-head">选择字段{fp.filter ? ' · "' + fp.filter + '"' : ""}</div>
                  {(() => {
                    const items = fieldNames.filter((f) => !fp.filter || f.toLowerCase().includes(fp.filter.toLowerCase()));
                    if (!items.length) return <div className="fp-item" style={{ cursor: "default", color: "#86909c" }}><span className="fp-ic">∅</span><b>无匹配字段，Esc 关闭</b></div>;
                    return items.map((f, i) => {
                      const m = fieldMeta(f, records[0]?.data);
                      return (
                        <div key={f} className={"fp-item" + (i === Math.min(fp.active, items.length - 1) ? " active" : "")} data-f={f}>
                          <span className="fp-ic">{m.ic}</span><b>{f}</b><i>{m.type}</i>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              {selected && (
                <div className="float-bar"
                  style={{ left: selected.x + "mm", top: (selected.y > 12 ? selected.y - 9 : selected.y + selected.h + 2) + "mm" }}
                  onMouseDown={(e) => e.stopPropagation()}>
                  <div className="fb-wrap">
                    <button className="fb-btn" onClick={() => { setAlignPop(!alignPop); setPosPop(false); }}>≡ 对齐 ▾</button>
                    <button className="fb-btn" onClick={fbEdit}>✏️ 编辑</button>
                    <button className="fb-btn" onClick={() => { setPosPop(!posPop); setAlignPop(false); }}>⌖ 位置</button>
                    <button className="fb-btn" onClick={fbCopy}>⧉ 复制</button>
                    <button className="fb-btn fb-del" title="删除" onClick={fbDelete}>🗑</button>
                    {alignPop && (
                      <div className="fb-pop show">
                        <button className="mi" onClick={() => alignSel("left")}>⇤ 左对齐</button>
                        <button className="mi" onClick={() => alignSel("hcenter")}>↔ 水平居中</button>
                        <button className="mi" onClick={() => alignSel("right")}>⇥ 右对齐</button>
                        <button className="mi" onClick={() => alignSel("top")}>⇧ 顶对齐</button>
                        <button className="mi" onClick={() => alignSel("vcenter")}>↕ 垂直居中</button>
                        <button className="mi" onClick={() => alignSel("bottom")}>⇩ 底对齐</button>
                      </div>
                    )}
                    {posPop && (
                      <div className="fb-pop fb-pos show">
                        <div><label>X(mm)</label>
                          <input type="number" value={Math.round(selected.x * 10) / 10}
                            onChange={(e) => mutateEls((list) => list.map((it) => (it.id === selected.id ? { ...it, x: +e.target.value || 0 } : it)))} /></div>
                        <div><label>Y(mm)</label>
                          <input type="number" value={Math.round(selected.y * 10) / 10}
                            onChange={(e) => mutateEls((list) => list.map((it) => (it.id === selected.id ? { ...it, y: +e.target.value || 0 } : it)))} /></div>
                        <div><label>宽(mm)</label>
                          <input type="number" value={Math.round(selected.w * 10) / 10}
                            onChange={(e) => mutateEls((list) => list.map((it) => (it.id === selected.id ? { ...it, w: Math.max(3, +e.target.value || 3) } : it)))} /></div>
                        <div><label>高(mm)</label>
                          <input type="number" value={Math.round(selected.h * 10) / 10}
                            onChange={(e) => mutateEls((list) => list.map((it) => (it.id === selected.id ? { ...it, h: Math.max(2, +e.target.value || 2) } : it)))} /></div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {chipPop && (
                <div className="chip-pop" style={{ left: chipPop.x + "px", top: chipPop.y + "px" }}
                  onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <span className="cp-name" title={chipLabel(chipPop.raw)}>{chipLabel(chipPop.raw)}</span>
                  <button className="cp-btn" onClick={() => { setFieldDlgOpen(true); setFieldSearch(""); }}>更改</button>
                  <button className="cp-btn" onClick={chipDelete}>删除</button>
                </div>
              )}
              {/* v1.4 自动表格单元格 chip 气泡：[字段名] + 状态警告 + 更换/删除此列 */}
              {atPop && (
                <div className="chip-pop" style={{ left: atPop.x + "px", top: atPop.y + "px" }}
                  onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <span className="cp-name" title={atPop.field}>[{atPop.field}]</span>
                  <button className="cp-btn" onClick={() => { const p = atPop; setAtPop(null); if (p) openAutoColDlg(p.elId, p.col); }}>更改</button>
                  <button className="cp-btn" title="删除此列" onClick={() => { const p = atPop; setAtPop(null); if (p) deleteColAt(p.elId, p.col); }}>删除</button>
                  {!atPop.ok && <div className="atp-warn">字段改名或被删除</div>}
                </div>
              )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 导出用隐藏容器（与预览相同内容） */}
      <div ref={exportRef} style={{ display: "none" }}>
        {pages.map((pg, i) => (
          <div key={i} className="paper" style={{ width: paperW + "mm", height: paperH + "mm", padding: padStr }}>
            <span className="paper-label">第 {i + 1} 页 / 共 {pages.length} 页</span>
            {wmLayer}
            {els.map((el) => (
              <div key={el.id} className={"el el-" + el.type}
                style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}>
                {el.type === "autotable" ? (
                  <div className="content el-autotable">
                    <table>
                      <thead><tr>{autoFieldsOf(el, autoFields).map((f, ci) => <th key={f + "-" + ci}>{el.props.titles?.[ci] || f}</th>)}</tr></thead>
                      <tbody>
                        {pg.rows.map((rec, r) => (
                          <tr key={r}>{autoFieldsOf(el, autoFields).map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  elContent(el, pg.data || null)
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 签名弹窗 */}
      {signFor && (
        <div className="modal-mask show">
          <div className="modal">
            <h3>✍️ 手写签名（鼠标按住拖动书写）</h3>
            <canvas ref={signCanvasRef} width={600} height={220} id="signCanvas" />
            <div className="modal-row">
              <button className="icon-btn" onClick={() => {
                const c = signCanvasRef.current!;
                c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              }}>清 空</button>
              <button className="icon-btn" onClick={() => setSignFor(null)}>取 消</button>
              <button className="btn-print" onClick={() => {
                const src = signCanvasRef.current!.toDataURL("image/png");
                updateProps(signFor, { src });
                setSignFor(null);
              }}>确 认</button>
            </div>
          </div>
        </div>
      )}

      {/* 更换字段对话框（v0.8） */}
      {fieldDlgOpen && (
        <div className="modal-mask show">
          <div className="modal field-modal">
            <div className="fm-head"><span>更换字段</span><button className="fm-close" onClick={() => setFieldDlgOpen(false)}>✕</button></div>
            <input className="fm-search" autoFocus placeholder="搜索字段" value={fieldSearch}
              onChange={(e) => setFieldSearch(e.target.value)} />
            <div className="fm-list">
              {(() => {
                const q = fieldSearch.trim().toLowerCase();
                const list = fieldNames.filter((f) => !q || f.toLowerCase().includes(q));
                if (!list.length) return <div className="fm-item" style={{ cursor: "default" }}><span className="fm-ic">∅</span><span className="fm-txt"><b>无匹配字段</b></span></div>;
                return list.map((f) => {
                  const v = records[0]?.data[f] || "";
                  const isNum = v !== "" && !isNaN(Number(v));
                  return (
                    <div key={f} className="fm-item" onClick={() => applyFieldChange(f)}>
                      <span className="fm-ic">{isNum ? "#" : "T"}</span>
                      <span className="fm-txt"><b>{f}</b><i>{isNum ? "数字" : "文本"}</i></span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
      {/* v1.3 编辑自动表格列对话框 */}
      {atCtx && (
        <div className="modal-mask show">
          <div className="modal field-modal">
            <div className="fm-head"><span>编辑列</span><button className="fm-close" onClick={() => setAtCtx(null)}>✕</button></div>
            <div className="fm-form">
              <label>列头文字</label>
              <input value={atCtx.title} placeholder="留空则显示字段名" autoFocus
                onChange={(e) => setAtCtx({ ...atCtx, title: e.target.value })} />
            </div>
            <input className="fm-search" placeholder="搜索关联字段" value={acSearch} style={{ marginTop: 10 }}
              onChange={(e) => setAcSearch(e.target.value)} />
            <div className="fm-list">
              {(() => {
                const q = acSearch.trim().toLowerCase();
                const list = fieldNames.filter((f) => !q || f.toLowerCase().includes(q));
                if (!list.length) return <div className="fm-item" style={{ cursor: "default" }}><span className="fm-ic">∅</span><span className="fm-txt"><b>无匹配字段</b></span></div>;
                return list.map((f) => {
                  const m = fieldMeta(f, records[0]?.data);
                  return (
                    <div key={f} className={"fm-item" + (atCtx.field === f ? " active" : "")}
                      onClick={() => setAtCtx({ ...atCtx, field: f })}>
                      <span className="fm-ic">{m.ic}</span>
                      <span className="fm-txt"><b>{f}</b><i>{m.type}</i></span>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="fm-foot">
              {atCtx.col >= 0 && <button className="fm-delcol" onClick={deleteAutoCol}>🗑 删除此列</button>}
              <button className="fm-ok" onClick={applyAutoColumn}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
