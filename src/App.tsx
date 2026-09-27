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
  text: { w: 60, h: 10, props: { content: "双击编辑文本", fontSize: 14, bold: false, align: "left" } },
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

/* ---------- 编辑态字段 chip（对齐官方红色 chip）---------- */
function chipLabel(f: string): string {
  const m = f.match(/^SUM\((.+)\)$/);
  return m ? "求和 · " + m[1].trim() : f;
}
function richEditHTML(raw: string | undefined): string {
  return esc(raw || "").replace(/\{\{(.*?)\}\}/g, (_, f: string) =>
    '<span class="fld-chip" data-raw="' + esc(f) + '">' + esc(chipLabel(f)) + ' <i class="chip-caret">⌄</i></span>'
  );
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
  const [margin, setMargin] = useState(15);
  const [perPage, setPerPage] = useState(8);

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
    alert("快捷指南：\n\n1. 从左侧「组件」拖元素到纸张排版；\n2. 双击文本直接编辑，输入 {{字段名}} 引用表格字段，输入 {{SUM(金额)}} 对整页求和；\n3. 点击元素出现浮动工具条：对齐 / 编辑 / 位置 / 复制 / 删除；\n4. 顶栏支持清空 / 撤销 / 重做；\n5. 右上「⋯ 更多」可修改纸张参数、导出 HTML；\n6. 新建模板：预览页左下角「＋ 创建模板」。");
  }

  /* ---------- 浮动工具条（v0.7）---------- */
  useEffect(() => { setAlignPop(false); setPosPop(false); setEditingKey(null); }, [selectedId, view]);
  const innerArea = () => ({ w: paperW - margin * 2, h: paperH - margin * 2 });
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

  /* ---------- 字段 chip 气泡 + 更换字段对话框（v0.8）---------- */
  useEffect(() => { setChipPop(null); }, [view, currentTpl]);
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
        if (d.margin) setMargin(d.margin);
        if (d.perPage) setPerPage(d.perPage);
      }
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ templates, currentTpl, autoFields, paper, landscape, margin, perPage }));
    } catch (e) { /* ignore */ }
  }, [templates, currentTpl, autoFields, paper, landscape, margin, perPage]);

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
    const el: LayoutEl = {
      id: nextElId(), type: dragType.current,
      x: Math.max(0, Math.min((e.clientX - rect.left) / MM - pad, innerW - d.w)),
      y: Math.max(0, Math.min((e.clientY - rect.top) / MM - pad, innerH - d.h)),
      w: d.w, h: d.h, props: JSON.parse(JSON.stringify(d.props)),
    };
    mutateEls((list) => [...list, el]);
    setSelectedId(el.id);
    dragType.current = null;
  }

  function startDrag(e: React.MouseEvent, el: LayoutEl, kind: "move" | "resize") {
    e.stopPropagation();
    setChipPop(null);
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
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (last) commit(last);
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
              dangerouslySetInnerHTML={{ __html: richEditHTML(p.content || "双击编辑文本") }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingKey(el.id);
                setTimeout(() => {
                  document.querySelector<HTMLElement>('.el[data-id="' + el.id + '"] [contenteditable]')?.focus();
                }, 0);
              }}
              onMouseDown={(e) => { if (editing || (e.target as HTMLElement).closest(".fld-chip")) e.stopPropagation(); }}
              onClick={(e) => {
                const chip = (e.target as HTMLElement).closest(".fld-chip") as HTMLElement | null;
                if (chip) { e.stopPropagation(); handleChipClick(chip, el.id); }
              }}
              onBlur={(e) => { updateProps(el.id, { content: richToRaw(e.currentTarget) }); setEditingKey(null); }} />
          );
        }
        return <div className="content" style={style}>{renderTpl(p.content || "", data, rowsData)}</div>;
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
                        dangerouslySetInnerHTML={{ __html: richEditHTML(raw) }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingKey(cellKey);
                          setTimeout(() => {
                            document.querySelector<HTMLElement>('.el[data-id="' + el.id + '"] td[data-cell="' + (r + "-" + c) + '"]')?.focus();
                          }, 0);
                        }}
                        onMouseDown={(e) => { if (editingKey === cellKey || (e.target as HTMLElement).closest(".fld-chip")) e.stopPropagation(); }}
                        onClick={(e) => {
                          const chip = (e.target as HTMLElement).closest(".fld-chip") as HTMLElement | null;
                          if (chip) { e.stopPropagation(); handleChipClick(chip, el.id); }
                        }}
                        onBlur={(e) => {
                          const cells = { ...(p.cells || {}) };
                          cells[r] = { ...(cells[r] || {}), [c]: richToRaw(e.currentTarget) };
                          updateProps(el.id, { cells });
                          setEditingKey(null);
                        }} />
                    ) : (
                      <td key={c} style={{ textAlign: p.align || "left" }}>{renderTpl(raw, data, rowsData)}</td>
                    );
                  })}
                </tr>
              ))}
            </table>
          </div>
        );
      }
      case "autotable": {
        const sample = records.slice(0, 2);
        return (
          <div className="content el-autotable">
            <table>
              <thead><tr>{autoFields.map((f) => <th key={f}>{f}</th>)}</tr></thead>
              <tbody>
                {sample.map((rec, i) => (
                  <tr key={i}>{autoFields.map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                ))}
                <tr><td colSpan={autoFields.length} style={{ color: "#bbb", textAlign: "center" }}>…预览时自动填入全部记录…</td></tr>
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
.paper{width:${paperW}mm;height:${paperH}mm;padding:${margin}mm;box-sizing:border-box}${EXPORT_CSS}
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
            <div className="side-scroll">
              <div className="group-title" style={{ marginTop: 4 }}>组件</div>
              <div className="tip-box">💡 拖动到右侧页面开始排版</div>
              <div className="comp-list">
                {COMPONENTS.map((it) => (
                  <div key={it.type} className="comp-item" draggable onDragStart={() => (dragType.current = it.type)}>
                    <span className="ic">{it.icon}</span>{it.label}
                  </div>
                ))}
              </div>
              <div className="sec-title">字段（点击插入到选中文本）</div>
              <div className="chips">
                {fieldNames.map((f) => (
                  <button key={f} className="chip"
                    onClick={() => {
                      if (selected && TEXT_LIKE.includes(selected.type)) {
                        updateProps(selected.id, { content: (selected.props.content || "") + "{{" + f + "}}" });
                      } else alert("请先选中一个文本类元素（文本/文章区块/附件等）。");
                    }}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="sec-title">元素属性</div>
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
                    <div className="empty-tip" style={{ marginTop: 6 }}>显示字段在下方「自动表格·显示字段」勾选</div>
                  )}
                  <button className="btn-del" onClick={() => { setEls(els.filter((it) => it.id !== selected.id)); setSelectedId(null); }}>
                    🗑 删除该元素
                  </button>
                </div>
              )}
              <div className="sec-title">自动表格 · 显示字段</div>
              {fieldNames.map((f) => (
                <label key={f} className="fld-check">
                  <input type="checkbox" checked={autoFields.includes(f)}
                    onChange={(e) => setAutoFields((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))} />
                  <span>{f}</span>
                </label>
              ))}
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
                        <input type="number" min={5} max={40} value={margin} onChange={(e) => setMargin(+e.target.value || 15)} /></div>
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
                <div key={i} className="paper" style={{ width: paperW + "mm", height: paperH + "mm", padding: margin + "mm" }}>
                  <span className="paper-label">第 {i + 1} 页 / 共 {pages.length} 页</span>
                  {els.map((el) => (
                    <div key={el.id} className={"el el-" + el.type}
                      style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}>
                      {el.type === "autotable" ? (
                        <div className="content el-autotable">
                          <table>
                            <thead><tr>{autoFields.map((f) => <th key={f}>{f}</th>)}</tr></thead>
                            <tbody>
                              {pg.rows.map((rec, r) => (
                                <tr key={r}>{autoFields.map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                              ))}
                              {cur.kind === "view" && Array.from({ length: Math.max(0, perPage - pg.rows.length) }, (_, r) => (
                                <tr key={"p" + r}>{autoFields.map((f) => <td key={f}>&nbsp;</td>)}</tr>
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
                          <input type="number" min={5} max={40} value={margin} onChange={(e) => setMargin(+e.target.value || 15)} /></div>
                      </div>
                      {cur.kind === "view" && (
                        <>
                          <label>自动表格每页行数</label>
                          <input type="number" min={1} max={30} value={perPage} onChange={(e) => setPerPage(+e.target.value || 8)} />
                        </>
                      )}
                      <button className="pop-item" style={{ marginTop: 8 }} onClick={exportHtml}>⬇ 导出 HTML</button>
                      <button className="pop-item" onClick={showGuide}>📖 使用指南</button>
                    </span>
                  )}
                </span>
              </div>
              <div
              ref={editorRef}
              className="paper"
              style={{ width: paperW + "mm", height: paperH + "mm", padding: margin + "mm" }}
              onDragOver={(e) => { e.preventDefault(); editorRef.current?.classList.add("dragover"); }}
              onDragLeave={() => editorRef.current?.classList.remove("dragover")}
              onDrop={onDrop}
              onMouseDown={(e) => { if (e.target === editorRef.current) setSelectedId(null); }}
            >
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
              </div>
            </>
          )}
        </div>
      </div>

      {/* 导出用隐藏容器（与预览相同内容） */}
      <div ref={exportRef} style={{ display: "none" }}>
        {pages.map((pg, i) => (
          <div key={i} className="paper" style={{ width: paperW + "mm", height: paperH + "mm", padding: margin + "mm" }}>
            <span className="paper-label">第 {i + 1} 页 / 共 {pages.length} 页</span>
            {els.map((el) => (
              <div key={el.id} className={"el el-" + el.type}
                style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}>
                {el.type === "autotable" ? (
                  <div className="content el-autotable">
                    <table>
                      <thead><tr>{autoFields.map((f) => <th key={f}>{f}</th>)}</tr></thead>
                      <tbody>
                        {pg.rows.map((rec, r) => (
                          <tr key={r}>{autoFields.map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
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
    </div>
  );
}
