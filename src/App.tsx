/**
 * App.tsx —— 打印排版助手主逻辑
 *
 * 功能闭环：
 *   读取多维表格数据 → 选记录/全选 → 纸张与排版设置 → 模板变量渲染 → 分页预览 → 打印
 *
 * 依赖 SDK：@lark-opdev/block-bitable-api（opdev create 模板已内置）
 */

import React, { useEffect, useMemo, useState } from "react";
import { bitable } from "@lark-opdev/block-bitable-api";

/* ---------------- 类型定义 ---------------- */

interface TableMeta {
  id: string;
  name: string;
}

interface FieldMeta {
  id: string;
  name: string;
}

interface RecordRow {
  recordId: string;
  /** 字段名 -> 单元格文本 */
  data: Record<string, string>;
}

type Mode = "one" | "table";

interface Settings {
  paper: "A4" | "A5" | "letter";
  landscape: boolean;
  margin: number;
  mode: Mode;
  perPage: number;
  template: string;
}

/* ---------------- 常量 ---------------- */

const PAPER_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  letter: [216, 279],
};

const DEFAULT_TEMPLATE = `　　产 品 出 库 单

客户名称：{{客户名称}}
产品名称：{{产品名称}}
箱型规格：{{箱型规格}}
数量：{{数量}}　单位：{{单位}}
备注：{{备注}}

出货日期：{{出货日期}}　　经手人：________`;

const STORAGE_KEY = "print-plugin-settings-v1";

/* ---------------- 工具函数 ---------------- */

/** 把 {{字段名}} 替换为记录值 */
function renderTemplate(tpl: string, data: Record<string, string>): string {
  return tpl.replace(/\{\{(.*?)\}\}/g, (_, name: string) => {
    const v = data[name.trim()];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** 把各种字段类型安全转成可打印文本 */
function cellToText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(cellToText).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // 常见结构：{text}, {name}, {enName}, {options:[...]}, 日期为时间戳
    if (typeof o.text === "string") return o.text;
    if (typeof o.name === "string") return o.name;
    if (typeof o.link === "string") return o.link;
    if (typeof o === "object" && "type" in o && "value" in o) return "";
  }
  return String(v);
}

/* ---------------- 主组件 ---------------- */

export default function App() {
  const [error, setError] = useState("");
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tableId, setTableId] = useState("");
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      /* 忽略读取失败 */
    }
    return {
      paper: "A4",
      landscape: false,
      margin: 15,
      mode: "one",
      perPage: 8,
      template: DEFAULT_TEMPLATE,
    };
  });

  // 设置变化时持久化（真实环境可换 bitable.bridge 存储 API）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }, [settings]);

  /* ---------- 加载数据 ---------- */

  async function loadTable(tid: string) {
    setLoading(true);
    setError("");
    try {
      const table = await bitable.base.getTableById(tid);
      const fieldMetaList = await table.getFieldMetaList();
      setFields(fieldMetaList.map((f: any) => ({ id: f.id, name: f.name })));

      const res = await table.getRecords({ pageSize: 500 });
      const rows: RecordRow[] = [];
      for (const rec of res.records || []) {
        const data: Record<string, string> = {};
        for (const f of fieldMetaList) {
          const v = await table.getCellValue(f.id, rec.recordId);
          data[f.name] = cellToText(v);
        }
        rows.push({ recordId: rec.recordId, data });
      }
      setRecords(rows);
      // 默认全选
      setSelectedIds(new Set(rows.map((r) => r.recordId)));
    } catch (e: any) {
      setError("读取数据失败：" + (e?.message || e));
    } finally {
      setLoading(false);
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
        setError("初始化失败（请检查插件权限 bitable:app）：" + (e?.message || e));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 选中记录相关 ---------- */

  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.recordId)),
    [records, selectedIds]
  );

  function toggleRecord(recordId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  /* ---------- 分页预览 ---------- */

  const pages = useMemo(() => {
    if (settings.mode === "one") {
      return selectedRecords.map((r) => ({ type: "one" as const, rows: [r] }));
    }
    const list: { type: "table"; rows: RecordRow[] }[] = [];
    for (let i = 0; i < selectedRecords.length; i += settings.perPage) {
      list.push({ type: "table", rows: selectedRecords.slice(i, i + settings.perPage) });
    }
    return list;
  }, [selectedRecords, settings.mode, settings.perPage]);

  const [pw, ph] = PAPER_MM[settings.paper];
  const paperW = settings.landscape ? ph : pw;
  const paperH = settings.landscape ? pw : ph;

  /* ---------- 渲染 ---------- */

  if (error) return <div className="err">{error}</div>;

  return (
    <div className="app">
      {/* ===== 左侧设置面板 ===== */}
      <div className="panel">
        <h3>数据源</h3>
        <select
          value={tableId}
          onChange={async (e) => {
            setTableId(e.target.value);
            await loadTable(e.target.value);
          }}
        >
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <h3>选择要打印的记录（{selectedIds.size}/{records.length}）</h3>
        <div className="record-list">
          <label className="rec-item">
            <input
              type="checkbox"
              checked={selectedIds.size === records.length && records.length > 0}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? new Set(records.map((r) => r.recordId)) : new Set())
              }
            />
            <b>全选</b>
          </label>
          {records.map((r) => {
            const first = fields[0] ? r.data[fields[0].name] : r.recordId;
            return (
              <label key={r.recordId} className="rec-item">
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.recordId)}
                  onChange={() => toggleRecord(r.recordId)}
                />
                <span>{String(first || "(空)")}</span>
              </label>
            );
          })}
        </div>

        <h3>纸张设置</h3>
        <div className="row">
          <select
            value={settings.paper}
            onChange={(e) => setSettings({ ...settings, paper: e.target.value as any })}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
            <option value="letter">Letter</option>
          </select>
          <select
            value={settings.landscape ? "l" : "p"}
            onChange={(e) => setSettings({ ...settings, landscape: e.target.value === "l" })}
          >
            <option value="p">竖版</option>
            <option value="l">横版</option>
          </select>
          <input
            type="number"
            min={5}
            max={40}
            value={settings.margin}
            onChange={(e) => setSettings({ ...settings, margin: +e.target.value || 15 })}
            title="页边距 mm"
          />
        </div>

        <h3>排版模式</h3>
        <select
          value={settings.mode}
          onChange={(e) => setSettings({ ...settings, mode: e.target.value as Mode })}
        >
          <option value="one">每条记录一页（合同/工单）</option>
          <option value="table">每页 N 条表格（清单）</option>
        </select>
        {settings.mode === "table" && (
          <input
            type="number"
            min={1}
            max={30}
            value={settings.perPage}
            onChange={(e) => setSettings({ ...settings, perPage: +e.target.value || 8 })}
          />
        )}

        <h3>打印模板</h3>
        <textarea
          value={settings.template}
          onChange={(e) => setSettings({ ...settings, template: e.target.value })}
        />
        <div className="chips">
          {fields.map((f) => (
            <button
              key={f.id}
              className="chip"
              onClick={() =>
                setSettings({ ...settings, template: settings.template + "{{" + f.name + "}}" })
              }
            >
              {f.name}
            </button>
          ))}
        </div>

        <button className="btn-print" onClick={() => window.print()}>
          🖨️ 打印 / 另存为 PDF
        </button>
      </div>

      {/* ===== 右侧打印预览 ===== */}
      <div className="preview">
        <div className="preview-title">
          预览：{pages.length} 页 · {paperW}×{paperH}mm · {settings.landscape ? "横" : "竖"}版
        </div>
        <div id="printArea">
          {pages.map((page, i) => (
            <div
              key={i}
              className="paper"
              style={{
                width: paperW + "mm",
                height: paperH + "mm",
                padding: settings.margin + "mm",
              }}
            >
              <span className="paper-label">
                {i + 1} / {pages.length}
              </span>
              {page.type === "one" ? (
                <div className="tpl">{renderTemplate(settings.template, page.rows[0].data)}</div>
              ) : (
                <table className="grid">
                  <thead>
                    <tr>
                      {fields.map((f) => (
                        <th key={f.id}>{f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((r) => (
                      <tr key={r.recordId}>
                        {fields.map((f) => (
                          <td key={f.id}>{r.data[f.name]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
