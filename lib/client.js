/**
 * dsh-opencode-go-usage — browser half.
 *
 * Registers a small readout into the sidebar footer (`sidebar.footer.action`)
 * that fetches `GET /dsh-opencode-go-usage` (served by the host half) and shows
 * the OpenCode Go plan usage / remaining quota. Clicking the readout opens a
 * small chart panel (donut + per-window bars); the panel has its own refresh.
 */

window.__ModuleLoader__.load({
  id: "dsh-opencode-go-usage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    const inject = ["slots"];

    const WINDOW_LABEL = {
      rolling: "滚动",
      weekly: "周",
      monthly: "月度",
    };

    function windowLabel(label) {
      return WINDOW_LABEL[String(label || "").toLowerCase()] || label || "Go";
    }

    /** Compact number formatting: 1234 -> "1.2k", 1500000 -> "1.5M". */
    function compact(value) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "?";
      }
      const n = Number(value);
      if (n >= 1e6) {
        return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
      }
      if (n >= 1e3) {
        return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
      }
      return String(Math.round(n));
    }

    function fmtPercent(value) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return null;
      }
      const n = Number(value);
      if (n > 100) return `${Math.round(n)}%`;
      return `${Math.round(n * 10) / 10}%`;
    }

    /** ISO timestamp -> local "M/D HH:mm". */
    function fmtReset(iso) {
      if (!iso) return null;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return null;
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** microcents -> "$0.96" (100,000,000 microcents per USD). */
    function fmtCost(microCents) {
      const n = Number(microCents);
      if (!Number.isFinite(n)) return null;
      if (n === 0) return "$0.00";
      return `$${(n / 1e8).toFixed(n >= 1e8 ? 2 : 4)}`;
    }

    /** Sum every token kind the console reports for one range. */
    function factTokens(data) {
      const keys = [
        "totalInputTokens",
        "totalOutputTokens",
        "totalCacheReadTokens",
        "totalCacheWrite5mTokens",
        "totalCacheWrite1hTokens",
      ];
      let total = 0;
      let seen = false;
      for (const key of keys) {
        const value = Number(data?.[key]);
        if (Number.isFinite(value)) {
          total += value;
          seen = true;
        }
      }
      return seen ? total : null;
    }

    /** One console range -> "326 次请求 · 39.2M tokens · $0.96". */
    function factText(data) {
      const parts = [];
      const requests = Number(data?.totalRequests);
      if (Number.isFinite(requests)) parts.push(`${requests.toLocaleString("en-US")} 次请求`);
      const tokens = factTokens(data);
      if (tokens !== null) parts.push(`${compact(tokens)} tokens`);
      const cost = fmtCost(data?.totalCostMicroCents);
      if (cost) parts.push(cost);
      return parts.join(" · ") || "—";
    }

    /** Percent of a row (explicit percent, else used/limit). */
    function rowPercent(row) {
      if (row?.percent != null && !Number.isNaN(Number(row.percent))) return Number(row.percent);
      if (row?.used != null && row?.limit) return (Number(row.used) / Number(row.limit)) * 100;
      return null;
    }

    /** Color by usage: green < 50%, amber < 80%, red >= 80%. */
    function usageColor(percent) {
      if (percent === null || percent === undefined) return "var(--dsw-alias-label-tertiary)";
      if (percent >= 80) return "#ef4444";
      if (percent >= 50) return "#f59e0b";
      return "#22c55e";
    }

    /** Display order: monthly > weekly > rolling > others (stable). */
    function orderRows(rows) {
      const rank = (row) => {
        const label = String(row.label || "").toLowerCase();
        if (label.includes("month") || label.includes("月")) return 0;
        if (label.includes("week") || label.includes("周")) return 1;
        if (label.includes("roll") || label.includes("滚动")) return 2;
        return 3;
      };
      const indexed = rows.map((row, index) => ({ row, rank: rank(row), index }));
      indexed.sort((a, b) => a.rank - b.rank || a.index - b.index);
      return indexed.map((entry) => entry.row);
    }

    /** Pick the most meaningful summary row: monthly > weekly > rolling > first. */
    function pickRow(rows) {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return orderRows(rows)[0];
    }

    function readUsage(data) {
      const rows = Array.isArray(data?.summary) ? data.summary : [];
      if (rows.length === 0) return null;
      return {
        rows: orderRows(rows),
        primary: pickRow(rows),
      };
    }

    /** SVG donut for the primary window. */
    function Donut({ percent, label, color }) {
      const R = 42;
      const C = 2 * Math.PI * R;
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      return React.createElement(
        "svg",
        { viewBox: "0 0 120 120", width: 120, height: 120, className: "dsh-ogu-donut" },
        React.createElement("circle", {
          cx: 60,
          cy: 60,
          r: R,
          fill: "none",
          stroke: "var(--dsw-alias-border-l2)",
          strokeWidth: 9,
        }),
        React.createElement("circle", {
          cx: 60,
          cy: 60,
          r: R,
          fill: "none",
          stroke: color,
          strokeWidth: 9,
          strokeLinecap: "round",
          strokeDasharray: `${(p / 100) * C} ${C}`,
          transform: "rotate(-90 60 60)",
        }),
        React.createElement(
          "text",
          { x: 60, y: 57, textAnchor: "middle", fontSize: 21, fontWeight: 600, fill: "var(--dsw-alias-label-primary)" },
          `${Math.round(p)}%`
        ),
        React.createElement(
          "text",
          { x: 60, y: 78, textAnchor: "middle", fontSize: 11, fill: "var(--dsw-alias-label-tertiary)" },
          label
        )
      );
    }

    /** One per-window progress bar row. */
    function WindowRow({ row }) {
      const percent = rowPercent(row);
      const pct = percent === null ? 0 : Math.max(0, Math.min(100, percent));
      const color = usageColor(percent);
      const reset = fmtReset(row.resetsAt);
      const detail = [];
      if (row.used != null) detail.push(`已用 ${compact(row.used)}`);
      if (row.limit != null) detail.push(`限额 ${compact(row.limit)}`);
      if (reset) detail.push(`${reset} 重置`);
      const detailText = detail.length > 0 ? ` · ${detail.join(" · ")}` : "";
      return React.createElement(
        "div",
        { className: "dsh-ogu-row" },
        React.createElement(
          "div",
          { className: "dsh-ogu-row-head" },
          React.createElement("span", { className: "dsh-ogu-row-label" }, windowLabel(row.label)),
          React.createElement(
            "span",
            { className: "dsh-ogu-row-pct", style: { color } },
            `${fmtPercent(percent) || "—"}${detailText}`
          )
        ),
        React.createElement(
          "div",
          { className: "dsh-ogu-track" },
          React.createElement("div", {
            className: "dsh-ogu-bar",
            style: { width: `${pct}%`, background: color },
          })
        )
      );
    }

    /** The chart popover. */
    function UsagePanel({ state, onRefresh, onClose, panelRef }) {
      const header = React.createElement(
        "div",
        { className: "dsh-ogu-panel-head" },
        React.createElement("span", { className: "dsh-ogu-panel-title" }, "OpenCode Go 用量"),
        React.createElement(
          "div",
          { className: "dsh-ogu-panel-actions" },
          React.createElement(
            "button",
            { type: "button", className: "dsh-ogu-icon-btn", onClick: onRefresh, title: "刷新", "aria-label": "刷新" },
            "↻"
          ),
          React.createElement(
            "button",
            { type: "button", className: "dsh-ogu-icon-btn", onClick: onClose, title: "关闭", "aria-label": "关闭" },
            "×"
          )
        )
      );

      let body;
      if (state.status === "loading") {
        body = React.createElement("div", { className: "dsh-ogu-panel-body" }, "查询中…");
      } else if (state.status === "error") {
        body = React.createElement(
          "div",
          { className: "dsh-ogu-panel-body dsh-ogu-error" },
          `查询失败：${state.message || ""}`
        );
      } else {
        const usage = readUsage(state.data);
        if (usage) {
          const primaryPct = rowPercent(usage.primary);
          const primaryColor = usageColor(primaryPct);
          body = React.createElement(
            "div",
            { className: "dsh-ogu-panel-body" },
            React.createElement(
              "div",
              { className: "dsh-ogu-donut-wrap" },
              React.createElement(Donut, {
                percent: primaryPct ?? 0,
                label: `${windowLabel(usage.primary.label)}窗口`,
                color: primaryColor,
              })
            ),
            React.createElement(
              "div",
              { className: "dsh-ogu-rows" },
              usage.rows.map((row, index) =>
                React.createElement(WindowRow, { key: `${row.label}-${index}`, row })
              )
            ),
            React.createElement(UsageFacts, { consoleUsage: state.data?.console })
          );
        } else {
          const raw = state.data?.raw;
          const snippet =
            raw && typeof raw === "object" ? JSON.stringify(raw).slice(0, 400) : "接口已返回但未识别到用量字段";
          body = React.createElement(
            "div",
            { className: "dsh-ogu-panel-body dsh-ogu-error" },
            `未识别到用量字段：${snippet}`
          );
        }
      }

      const footer = React.createElement(
        "div",
        { className: "dsh-ogu-panel-foot" },
        state.updatedAt
          ? `更新于 ${state.updatedAt} · 每 60s 自动刷新（面板打开时每 15s）`
          : "数据来自 opencode.ai 官方接口",
        React.createElement(
          "div",
          { className: "dsh-ogu-note" },
          "百分比是官方接口原值（向下取整）；官网控制台按四舍五入显示，同一时刻最多相差 1%。"
        )
      );

      return React.createElement(
        "div",
        { ref: panelRef, className: "dsh-ogu-panel", role: "dialog", "aria-label": "OpenCode Go 用量" },
        header,
        body,
        footer
      );
    }

    /** Real request/token/dollar figures from the V2 console API, when reachable. */
    function UsageFacts({ consoleUsage }) {
      if (!consoleUsage?.ok) return null;
      const ranges = consoleUsage.ranges || {};
      const rows = [
        { key: "24h", label: "近 24 小时" },
        { key: "7d", label: "近 7 天" },
      ].filter((entry) => ranges[entry.key]);

      if (rows.length === 0) return null;

      return React.createElement(
        "div",
        { className: "dsh-ogu-facts" },
        React.createElement("div", { className: "dsh-ogu-facts-title" }, "真实用量（控制台 API）"),
        rows.map((entry) =>
          React.createElement(
            "div",
            { className: "dsh-ogu-fact", key: entry.key },
            React.createElement("span", { className: "dsh-ogu-fact-label" }, entry.label),
            React.createElement("span", { className: "dsh-ogu-fact-value" }, factText(ranges[entry.key]))
          )
        )
      );
    }

    function UsageIndicator(props) {
      const wide = props.wide === true;
      const [state, setState] = React.useState(() => ({ status: "loading" }));
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);
      const buttonRef = React.useRef(null);
      const panelRef = React.useRef(null);

      const refresh = React.useCallback(() => {
        let cancelled = false;
        fetch("/dsh-opencode-go-usage")
          .then((resp) => resp.json())
          .then((json) => {
            if (cancelled) return;
            if (json && json.ok) {
              const now = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              setState({
                status: "ok",
                data: json.data,
                updatedAt: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
              });
            } else {
              setState({
                status: "error",
                message: (json && (json.message || json.error)) || "查询失败",
              });
            }
          })
          .catch((error) => {
            if (cancelled) return;
            setState({
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
        return () => {
          cancelled = true;
        };
      }, []);

      React.useEffect(() => refresh(), [refresh]);

      // Auto-refresh: every 60s in the background, every 15s while the panel is open.
      React.useEffect(() => {
        const interval = setInterval(() => refresh(), open ? 15000 : 60000);
        return () => clearInterval(interval);
      }, [open, refresh]);

      // Close on outside click or Escape.
      React.useEffect(() => {
        if (!open) return;
        const onDown = (event) => {
          const target = event.target;
          if (panelRef.current && panelRef.current.contains(target)) return;
          if (buttonRef.current && buttonRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("mousedown", onDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      const toggle = () => {
        if (!open && buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          setAnchor({
            left: Math.max(8, rect.left),
            bottom: window.innerHeight - rect.top + 8,
          });
          setOpen(true);
          refresh();
        } else {
          setOpen(false);
        }
      };

      let text;
      let title;
      if (state.status === "loading") {
        text = wide ? "Go 用量 …" : "…";
        title = "正在查询 OpenCode Go 用量…";
      } else if (state.status === "ok") {
        const usage = readUsage(state.data);
        if (usage) {
          const primary = usage.primary;
          const percent = fmtPercent(rowPercent(primary));
          const parts = [];
          if (primary.used != null) parts.push(`已用 ${compact(primary.used)}`);
          if (primary.limit != null) parts.push(`限额 ${compact(primary.limit)}`);
          if (percent) parts.push(percent);
          const reset = fmtReset(primary.resetsAt);
          if (reset) parts.push(`${reset} 重置`);
          const compactText = percent || (primary.used != null && primary.limit != null ? `${compact(primary.used)}/${compact(primary.limit)}` : "…");
          text = wide ? `Go ${windowLabel(primary.label)}：${parts.join(" · ")}` : `Go ${compactText}`;
          title = `OpenCode Go 用量\n${usage.rows
            .map((row) => {
              const bits = [];
              if (row.used != null) bits.push(`已用 ${compact(row.used)}`);
              if (row.limit != null) bits.push(`限额 ${compact(row.limit)}`);
              const p = fmtPercent(rowPercent(row));
              if (p) bits.push(p);
              const rs = fmtReset(row.resetsAt);
              if (rs) bits.push(`${rs} 重置`);
              return `${windowLabel(row.label)}：${bits.join(" · ") || "—"}`;
            })
            .join("\n")}\n（官网控制台四舍五入 / 官方接口向下取整，同一时刻最多差 1%）\n点击查看图表`;
        } else {
          text = wide ? "Go 用量 —" : "—";
          const raw = state.data?.raw;
          const snippet =
            raw && typeof raw === "object" ? JSON.stringify(raw).slice(0, 400) : "接口已返回但未识别到用量字段";
          title = `OpenCode Go 用量：${snippet}`;
        }
      } else {
        text = wide ? "Go ‒" : "‒";
        title = `OpenCode Go 用量查询失败：${state.message || ""}`;
      }

      const button = React.createElement(
        "button",
        {
          ref: buttonRef,
          type: "button",
          className: "dsh-opencode-go-usage-root",
          "data-collapsed": wide ? undefined : "true",
          "data-open": open ? "true" : undefined,
          title,
          "aria-label": "OpenCode Go 用量（点击查看图表）",
          onClick: toggle,
        },
        text
      );

      if (!open || !anchor) return button;

      return React.createElement(
        React.Fragment,
        null,
        button,
        React.createElement(
          "div",
          {
            style: {
              position: "fixed",
              left: anchor.left,
              bottom: anchor.bottom,
              zIndex: 1200,
            },
          },
          React.createElement(UsagePanel, {
            state,
            onRefresh: refresh,
            onClose: () => setOpen(false),
            panelRef,
          })
        )
      );
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "dsh-opencode-go-usage",
            order: 0,
          },
          UsageIndicator
        )
      );
    }

    const css =
      ".dsh-opencode-go-usage-root{" +
      "cursor:pointer;display:inline-flex;align-items:center;justify-content:center;" +
      "height:28px;padding:0 10px;gap:6px;box-sizing:border-box;" +
      "font-size:12px;line-height:1;font-family:inherit;font-variant-numeric:tabular-nums;" +
      "color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;" +
      "white-space:nowrap;transition:background .12s ease,color .12s ease;" +
      "}" +
      ".dsh-opencode-go-usage-root[data-collapsed='true']{padding:0 6px;font-size:11px;}" +
      ".dsh-opencode-go-usage-root:hover,.dsh-opencode-go-usage-root[data-open='true']{" +
      "background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}" +
      ".dsh-ogu-panel{" +
      "width:280px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);" +
      "border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv1);" +
      "padding:12px 14px 10px;display:flex;flex-direction:column;gap:10px;" +
      "color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;font-family:inherit;" +
      "}" +
      ".dsh-ogu-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}" +
      ".dsh-ogu-panel-title{font-size:13px;font-weight:600;}" +
      ".dsh-ogu-panel-actions{display:flex;gap:2px;}" +
      ".dsh-ogu-icon-btn{" +
      "cursor:pointer;display:inline-flex;align-items:center;justify-content:center;" +
      "width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;" +
      "color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;" +
      "transition:background .12s ease,color .12s ease;" +
      "}" +
      ".dsh-ogu-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);" +
      "color:var(--dsw-alias-label-primary);}" +
      ".dsh-ogu-panel-body{display:flex;flex-direction:column;align-items:center;gap:12px;}" +
      ".dsh-ogu-donut-wrap{display:flex;justify-content:center;}" +
      ".dsh-ogu-rows{width:100%;display:flex;flex-direction:column;gap:10px;}" +
      ".dsh-ogu-row{display:flex;flex-direction:column;gap:4px;}" +
      ".dsh-ogu-row-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}" +
      ".dsh-ogu-row-label{font-weight:500;}" +
      ".dsh-ogu-row-pct{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);}" +
      ".dsh-ogu-track{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden;}" +
      ".dsh-ogu-bar{height:100%;border-radius:3px;transition:width .25s ease;}" +
      ".dsh-ogu-panel-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:center;}" +
      ".dsh-ogu-facts{width:100%;display:flex;flex-direction:column;gap:6px;" +
      "border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;}" +
      ".dsh-ogu-facts-title{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;}" +
      ".dsh-ogu-fact{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}" +
      ".dsh-ogu-fact-label{color:var(--dsw-alias-label-secondary);}" +
      ".dsh-ogu-fact-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;}" +
      ".dsh-ogu-note{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.35;margin-top:4px;}" +
      ".dsh-ogu-error{color:var(--dsw-alias-state-error-primary);word-break:break-all;text-align:center;}";

    const tagId = "dsh-opencode-go-usage/style";
    if (
      typeof document !== "undefined" &&
      document.querySelector('style[data-plugin-css="' + tagId + '"]') === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-opencode-go-usage";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
