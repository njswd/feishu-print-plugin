/**
 * App.tsx —— 打印排版助手（拖拽元素式排版，对标飞书官方「排版打印」交互）
 *
 * 左侧元素库（文本/水平线/表格/自动表格/图片/二维码/条形码）拖到右侧纸张上，
 * 自由移动、缩放、编辑属性；「打印预览」按记录生成多页；改动自动保存。
 *
 * 依赖 SDK：@lark-opdev/block-bitable-api（opdev create 模板已内置）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { bitable } from "@lark-opdev/block-bitable-api";

/* ---------------- 类型 ---------------- */

type ElType = "text" | "line" | "table" | "autotable" | "image" | "qrcode" | "barcode";

interface ElProps {
  content?: string;
  src?: string;
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  rows?: number;
  cols?: number;
  cells?: Record<string, Record<string, string>>;
}

interface LayoutEl {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // 单位 mm
  props: ElProps;
}

interface TableMeta { id: string; name: string }
interface FieldMeta { id: string; name: string }
interface RecordRow { recordId: string; data: Record<string, string> }

/* ---------------- 常量 ---------------- */

const PAPER_MM: Record<string, [number, number]> = {
  A4: [210, 297], A5: [148, 210], letter: [216, 279],
};
const MM = 3.78; // 屏幕上 1mm ≈ 3.78px
const SAVE_KEY = "print-plugin-layout-v2";

const PALETTE: { type: ElType; label: string }[] = [
  { type: "text", label: "📝 文本" },
  { type: "line", label: "━ 水平线" },
  { type: "table", label: "▦ 表格" },
  { type: "autotable", label: "🔁 自动表格" },
  { type: "image", label: "🖼️ 图片" },
  { type: "qrcode", label: "⊟ 二维码" },
  { type: "barcode", label: "🕋 条形码" },
];

const DEFAULTS: Record<ElType, { w: number; h: number; props: ElProps }> = {
  text: { w: 60, h: 10, props: { content: "双击编辑文本", fontSize: 14, bold: false, align: "left" } },
  line: { w: 80, h: 2, props: {} },
  table: { w: 80, h: 30, props: { rows: 3, cols: 3, cells: {} } },
  autotable: { w: 180, h: 60, props: {} },
  image: { w: 40, h: 30, props: { src: "https://dummyimage.com/300x200/e5e6eb/646a73.png&text=Image" } },
  qrcode: { w: 25, h: 25, props: { content: "https://example.com" } },
  barcode: { w: 45, h: 14, props: { content: "20260926001" } },
};

const INITIAL: LayoutEl[] = [
  { id: "e1", type: "text", x: 70, y: 12, w: 70, h: 12,
    props: { content: "产 品 出 库 单", fontSize: 22, bold: true, align: "center" } },
  { id: "e2", type: "text", x: 15, y: 30, w: 120, h: 10,
    props: { content: "单号：{{客户名称}}-{{出货日期}}", fontSize: 12, align: "left" } },
  { id: "e3", type: "autotable", x: 15, y: 45, w: 180, h: 60, props: {} },
  { id: "e4", type: "text", x: 15, y: 112, w: 100, h: 10,
    props: { content: "经手人：________　审核：________", fontSize: 12, align: "left" } },
  { id: "e5", type: "qrcode", x: 170, y: 105, w: 25, h: 25,
    props: { content: "https://njswd.github.io/feishu-print-plugin/" } },
];

/* ---------------- 工具 ---------------- */

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderTpl(tpl: string, data: Record<string, string>): string {
  return String(tpl).replace(/\{\{(.*?)\}\}/g, (_, name: string) => {
    const v = data[name.trim()];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** 各种字段类型安全转文本 */
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

/** 二维码 / 条形码 渲染（CDN 库，离线降级为占位） */
function paintCodes(root: HTMLElement | null) {
  if (!root) return;
  if (!(window as any).QRCode || !(window as any).JsBarcode) {
    root.querySelectorAll<HTMLElement>(".el-qr,.el-bar").forEach((box) => {
      if (!box.querySelector(".lib-fallback"))
        box.innerHTML =
          '<div class="lib-fallback">' +
          (box.classList.contains("el-qr") ? "二维码" : "条形码") +
          "<br>(需联网加载库)</div>";
    });
    return;
  }
  root.querySelectorAll<HTMLElement>(".el-qr").forEach((box) => {
    const txt = box.dataset.qr || " ";
    box.innerHTML = "";
    try {
      new (window as any).QRCode(box, { text: txt, width: 200, height: 200, correctLevel: "M" });
    } catch (e) { /* ignore */ }
  });
  root.querySelectorAll<HTMLElement>(".el-bar").forEach((box) => {
    const txt = box.dataset.bar || "0000000000";
    box.innerHTML = '<svg class="bar-svg"></svg>';
    try {
      (window as any).JsBarcode(box.querySelector(".bar-svg"), txt, {
        format: "CODE128", displayValue: true, height: 60, fontSize: 12, margin: 0,
      });
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

  // 排版状态
  const [elements, setElements] = useState<LayoutEl[]>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoFields, setAutoFields] = useState<string[]>(["客户名称", "产品名称", "箱型规格", "数量", "单位", "出货日期"]);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [paper, setPaper] = useState("A4");
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState(15);
  const [perPage, setPerPage] = useState(8);

  const stageRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(100);

  const selected = elements.find((e) => e.id === selectedId) || null;
  const [pw0, ph0] = PAPER_MM[paper];
  const paperW = landscape ? ph0 : pw0;
  const paperH = landscape ? pw0 : ph0;

  /* ---------- 自动保存 / 加载 ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.elements?.length) { setElements(d.elements); idRef.current = d.elements.length + 100; }
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
      localStorage.setItem(SAVE_KEY, JSON.stringify({ elements, autoFields, paper, landscape, margin, perPage }));
    } catch (e) { /* ignore */ }
  }, [elements, autoFields, paper, landscape, margin, perPage]);

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
        for (const f of fml) {
          data[f.name] = cellToText(await table.getCellValue(f.id, rec.recordId));
        }
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
        if (tList.length > 0) {
          setTableId(tList[0].id);
          await loadTable(tList[0].id);
        }
      } catch (e: any) {
        setError("初始化失败（请检查 bitable:app 权限）：" + (e?.message || e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 二维码/条形码在每次渲染后补画 */
  useEffect(() => { paintCodes(editorRef.current); });
  useEffect(() => { if (mode === "preview") paintCodes(printRef.current); });

  /* 动态加载二维码 / 条形码库（加载完成后重绘一次） */
  useEffect(() => {
    const w = window as any;
    const load = (src: string, key: string) =>
      new Promise<void>((resolve) => {
        if (w[key]) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
      });
    Promise.all([
      load("https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js", "QRCode"),
      load("https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js", "JsBarcode"),
    ]).then(() => {
      paintCodes(editorRef.current);
      if (mode === "preview") paintCodes(printRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 拖放：元素库 → 纸张 ---------- */
  const dragType = useRef<ElType | null>(null);

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
      id: "e" + idRef.current++,
      type: dragType.current!,
      x: Math.max(0, Math.min((e.clientX - rect.left) / MM - pad, innerW - d.w)),
      y: Math.max(0, Math.min((e.clientY - rect.top) / MM - pad, innerH - d.h)),
      w: d.w, h: d.h,
      props: JSON.parse(JSON.stringify(d.props)),
    };
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
    dragType.current = null;
  }

  /* ---------- 拖动/缩放画布元素 ---------- */
  function startDrag(e: React.MouseEvent, el: LayoutEl, kind: "move" | "resize") {
    e.stopPropagation();
    if (kind === "move") setSelectedId(el.id);
    const startX = e.clientX, startY = e.clientY;
    const ox = el.x, oy = el.y, ow = el.w, oh = el.h;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / MM;
      const dy = (ev.clientY - startY) / MM;
      setElements((prev) =>
        prev.map((it) => {
          if (it.id !== el.id) return it;
          if (kind === "move") return { ...it, x: ox + dx, y: oy + dy };
          return { ...it, w: Math.max(3, ow + dx), h: Math.max(2, oh + dy) };
        })
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /* ---------- 元素内容渲染 ---------- */
  function elContent(el: LayoutEl, data: Record<string, string> | null): React.ReactNode {
    const p = el.props;
    const style: React.CSSProperties = {
      fontSize: (p.fontSize || 14) + "px",
      fontWeight: p.bold ? 700 : 400,
      textAlign: p.align || "left",
    };
    switch (el.type) {
      case "text":
        return (
          <div
            className="content editable"
            style={style}
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: esc(renderTpl(p.content || "", data || {})) }}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => updateProps(el.id, { content: e.currentTarget.textContent || "" })}
          />
        );
      case "line":
        return <div className="content el-line" />;
      case "image":
        return <div className="content el-img"><img src={p.src} alt="" /></div>;
      case "qrcode":
        return <div className="content el-qr" data-qr={p.content} />;
      case "barcode":
        return <div className="content el-bar" data-bar={p.content} />;
      case "table": {
        const rows = p.rows || 3, cols = p.cols || 3;
        return (
          <div className="content el-table" style={style}>
            <table>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td
                      key={c}
                      contentEditable
                      suppressContentEditableWarning
                      style={{ textAlign: p.align || "left" }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const cells = { ...(p.cells || {}) };
                        cells[r] = { ...(cells[r] || {}), [c]: e.currentTarget.textContent || "" };
                        updateProps(el.id, { cells });
                      }}
                    >
                      {p.cells?.[r]?.[c] || ""}
                    </td>
                  ))}
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
              <thead>
                <tr>{autoFields.map((f) => <th key={f}>{f}</th>)}</tr>
              </thead>
              <tbody>
                {sample.map((rec, i) => (
                  <tr key={i}>{autoFields.map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                ))}
                <tr>
                  <td colSpan={autoFields.length} style={{ color: "#bbb", textAlign: "center" }}>
                    …预览时自动填入全部记录并分页…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }
    }
  }

  function updateProps(id: string, patch: ElProps) {
    setElements((prev) => prev.map((it) => (it.id === id ? { ...it, props: { ...it.props, ...patch } } : it)));
  }

  /* ---------- 分页逻辑 ---------- */
  interface Page { data?: Record<string, string>; rows: RecordRow[] }
  const pages = useMemo<Page[]>(() => {
    const hasAuto = elements.some((e) => e.type === "autotable");
    const list: Page[] = [];
    if (hasAuto) {
      for (let i = 0; i < records.length; i += perPage) list.push({ rows: records.slice(i, i + perPage) });
      if (list.length === 0) list.push({ rows: [] });
    } else {
      records.forEach((rec) => list.push({ data: rec.data, rows: [rec] }));
    }
    return list;
  }, [elements, records, perPage]);

  /* ---------- 删除（Delete 键） ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Delete" && selectedId) {
        setElements((prev) => prev.filter((it) => it.id !== selectedId));
        setSelectedId(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId]);

  /* ---------- 渲染 ---------- */
  if (error) return <div className="err">{error}</div>;

  return (
    <div className="app">
      {/* ===== 顶部工具栏 ===== */}
      <div className="toolbar">
        <h1>🖨️ 打印排版助手</h1>
        <div className="tabs">
          <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑排版</button>
          <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>打印预览</button>
        </div>
        <select value={paper} onChange={(e) => setPaper(e.target.value)}>
          <option value="A4">A4</option><option value="A5">A5</option><option value="letter">Letter</option>
        </select>
        <select value={landscape ? "l" : "p"} onChange={(e) => setLandscape(e.target.value === "l")}>
          <option value="p">竖版</option><option value="l">横版</option>
        </select>
        <input type="number" min={5} max={40} value={margin} onChange={(e) => setMargin(+e.target.value || 15)} style={{ width: 64 }} title="页边距 mm" />
        <input type="number" min={1} max={30} value={perPage} onChange={(e) => setPerPage(+e.target.value || 8)} style={{ width: 56 }} title="自动表格每页行数" />
        <span className="hint">*改动将自动保存</span>
        <button className="btn-print" onClick={() => { document.body.classList.add("printing"); setTimeout(() => window.print(), 100); }}>
          🖨️ 打印 / 存 PDF
        </button>
      </div>

      <div className="layout">
        {/* ===== 左侧栏 ===== */}
        <div className="sidebar">
          <div className="sec-title">数据源</div>
          <select
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #e5e6eb", borderRadius: 6 }}
            value={tableId}
            onChange={async (e) => { setTableId(e.target.value); await loadTable(e.target.value); }}
          >
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <div className="sec-title">元素库 · 拖到右侧纸张上</div>
          <div className="palette">
            {PALETTE.map((it) => (
              <div
                key={it.type}
                className="pal-item"
                draggable
                onDragStart={() => (dragType.current = it.type)}
              >
                {it.label}
              </div>
            ))}
          </div>

          <div className="sec-title">记录字段（点按插入到选中文本）</div>
          <div className="chips">
            {fieldNames.map((f) => (
              <button
                key={f}
                className="chip"
                onClick={() => {
                  if (selected && selected.type === "text") {
                    updateProps(selected.id, { content: (selected.props.content || "") + "{{" + f + "}}" });
                  } else {
                    alert("请先在纸张上选中一个「文本」元素，再点字段插入变量。");
                  }
                }}
              >
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
                <div><label>X (mm)</label>
                  <input type="number" value={selected.x.toFixed(1)} onChange={(e) => setElements((p) => p.map((it) => it.id === selected.id ? { ...it, x: +e.target.value || 0 } : it))} /></div>
                <div><label>Y (mm)</label>
                  <input type="number" value={selected.y.toFixed(1)} onChange={(e) => setElements((p) => p.map((it) => it.id === selected.id ? { ...it, y: +e.target.value || 0 } : it))} /></div>
                <div><label>宽 (mm)</label>
                  <input type="number" value={selected.w.toFixed(1)} onChange={(e) => setElements((p) => p.map((it) => it.id === selected.id ? { ...it, w: Math.max(3, +e.target.value || 3) } : it))} /></div>
                <div><label>高 (mm)</label>
                  <input type="number" value={selected.h.toFixed(1)} onChange={(e) => setElements((p) => p.map((it) => it.id === selected.id ? { ...it, h: Math.max(2, +e.target.value || 2) } : it))} /></div>
              </div>
              {selected.type === "text" && (
                <>
                  <div className="props" style={{ marginTop: 6 }}>
                    <textarea value={selected.props.content || ""} onChange={(e) => updateProps(selected.id, { content: e.target.value })} />
                  </div>
                  <div className="prop-grid" style={{ marginTop: 6 }}>
                    <div><label>字号(px)</label>
                      <input type="number" value={selected.props.fontSize || 14} onChange={(e) => updateProps(selected.id, { fontSize: +e.target.value || 14 })} /></div>
                    <div><label>对齐</label>
                      <select value={selected.props.align || "left"} onChange={(e) => updateProps(selected.id, { align: e.target.value as any })}>
                        <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                      </select></div>
                  </div>
                  <div className="fld-check" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={!!selected.props.bold} onChange={(e) => updateProps(selected.id, { bold: e.target.checked })} />
                    <span>加粗</span>
                  </div>
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
              {selected.type === "table" && (
                <div className="prop-grid" style={{ marginTop: 6 }}>
                  <div><label>行数</label>
                    <input type="number" min={1} max={20} value={selected.props.rows || 3} onChange={(e) => updateProps(selected.id, { rows: Math.max(1, +e.target.value || 3) })} /></div>
                  <div><label>列数</label>
                    <input type="number" min={1} max={10} value={selected.props.cols || 3} onChange={(e) => updateProps(selected.id, { cols: Math.max(1, +e.target.value || 3) })} /></div>
                </div>
              )}
              {selected.type === "autotable" && (
                <div className="empty-tip" style={{ marginTop: 6 }}>
                  显示字段在下方「自动表格·显示字段」勾选；预览时自动填入全部记录并按每页行数分页。
                </div>
              )}
              <button
                className="btn-del"
                onClick={() => { setElements((p) => p.filter((it) => it.id !== selected.id)); setSelectedId(null); }}
              >
                🗑 删除该元素
              </button>
            </div>
          )}

          <div className="sec-title">自动表格 · 显示字段</div>
          {fieldNames.map((f) => (
            <label key={f} className="fld-check">
              <input
                type="checkbox"
                checked={autoFields.includes(f)}
                onChange={(e) =>
                  setAutoFields((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))
                }
              />
              <span>{f}</span>
            </label>
          ))}
        </div>

        {/* ===== 右侧画布 ===== */}
        <div className="stage" ref={stageRef}>
          {/* 编辑纸张 */}
          <div
            ref={editorRef}
            className="paper"
            style={{ width: paperW + "mm", height: paperH + "mm", padding: margin + "mm", display: mode === "edit" ? "block" : "none" }}
            onDragOver={(e) => { e.preventDefault(); editorRef.current?.classList.add("dragover"); }}
            onDragLeave={() => editorRef.current?.classList.remove("dragover")}
            onDrop={onDrop}
            onMouseDown={(e) => { if (e.target === editorRef.current) { setSelectedId(null); } }}
          >
            {elements.map((el) => (
              <div
                key={el.id}
                className={"el el-" + el.type + (el.id === selectedId ? " selected" : "")}
                style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}
                onMouseDown={(e) => startDrag(e, el, "move")}
              >
                {elContent(el, null)}
                <div className="resize-handle" onMouseDown={(e) => startDrag(e, el, "resize")} />
              </div>
            ))}
          </div>

          {/* 预览页 */}
          <div ref={printRef} id="printArea" style={{ display: mode === "preview" ? "block" : "none" }}>
            {pages.map((pg, i) => (
              <div key={i} className="paper" style={{ width: paperW + "mm", height: paperH + "mm", padding: margin + "mm" }}>
                <span className="paper-label">第 {i + 1} 页 / 共 {pages.length} 页</span>
                {elements.map((el) => (
                  <div
                    key={el.id}
                    className={"el el-" + el.type}
                    style={{ left: el.x + "mm", top: el.y + "mm", width: el.w + "mm", height: el.h + "mm" }}
                  >
                    {el.type === "autotable" ? (
                      <div className="content el-autotable">
                        <table>
                          <thead>
                            <tr>{autoFields.map((f) => <th key={f}>{f}</th>)}</tr>
                          </thead>
                          <tbody>
                            {pg.rows.map((rec, r) => (
                              <tr key={r}>{autoFields.map((f) => <td key={f}>{rec.data[f] || ""}</td>)}</tr>
                            ))}
                            {Array.from({ length: Math.max(0, perPage - pg.rows.length) }, (_, r) => (
                              <tr key={"p" + r}>{autoFields.map((f) => <td key={f}>&nbsp;</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      elContent(el, pg.data || {})
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
