/**
 * dsh-opencode-go-usage — host half.
 *
 * Registers one loopback HTTP route (`GET /dsh-opencode-go-usage`) that resolves
 * the OpenCode Go API key from the credential seam (`ctx.credentials`, ref
 * `OPENCODE_GO_API_KEY`, overridable via `config.apiKeyEnv`) and proxies the
 * official OpenCode Go quota endpoint (`GET https://opencode.ai/zen/go/v1/usage`,
 * with a few fallbacks) so the browser never holds the key and never hits
 * OpenCode's CORS policy.
 *
 * The browser half (lib/client.js) renders the result into the sidebar footer.
 *
 * Alongside the quota windows it also asks the V2 console API for real usage
 * aggregates (requests / tokens / USD), which `/zen/go/v1/usage` never returns.
 * The quota `percent` is the endpoint's own value, and that endpoint computes it
 * with `Math.floor` while the console page rounds — see the note in client.js.
 */

const DEFAULT_API_KEY_REF = "OPENCODE_GO_API_KEY";

/**
 * V2 console API base — the surface the official console page
 * (`https://opencode.ai/console/go`) is built on. Its usage aggregates carry
 * real request/token/dollar figures that `/zen/go/v1/usage` does not expose.
 */
const CONSOLE_BASE = "https://opencode.ai/console";

/** Usage ranges requested alongside the quota windows. */
const CONSOLE_RANGES = ["24h", "7d"];

const USAGE_CANDIDATES = [
  "https://opencode.ai/zen/go/v1/usage",
  "https://opencode.ai/zen/go/usage",
  "https://opencode.ai/api/usage",
  "https://opencode.ai/api/v1/usage",
];

export const name = "dsh-opencode-go-usage";
export const inject = ["webServer", "credentials"];

function send(res, status, payload) {
  if (!res.headersSent) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
  }
  res.end(JSON.stringify(payload));
}

/**
 * Best-effort normalization of the OpenCode Go usage payload.
 *
 * The official endpoint returns `{ usage: { <window>: { status, percent,
 * resetsAt }, ... } }` — one entry per quota window (rolling / weekly /
 * monthly). Array-shaped payloads (`[{ window, used, limit, remaining }]`)
 * are also understood.
 */
function summarize(body) {
  const rows = [];
  const push = (label, used, limit, remaining, percent, resetsAt, status) => {
    if (used === undefined && limit === undefined && remaining === undefined && percent === undefined) {
      return;
    }
    rows.push({
      label,
      used: used ?? null,
      limit: limit ?? null,
      remaining: remaining ?? null,
      percent: percent ?? (used != null && limit ? (used / limit) * 100 : null),
      resetsAt: resetsAt ?? null,
      status: status ?? null,
    });
  };

  const source = body && typeof body === "object" ? body : {};
  const usage = source.usage;

  if (Array.isArray(usage)) {
    for (const entry of usage) {
      if (entry && typeof entry === "object") {
        push(
          entry.window ?? entry.period ?? entry.label ?? "usage",
          entry.used,
          entry.limit ?? entry.total ?? entry.quota,
          entry.remaining,
          entry.percent ?? entry.percentage,
          entry.resetsAt ?? entry.resetAt,
          entry.status
        );
      }
    }
  } else if (usage && typeof usage === "object") {
    const keys = Object.keys(usage);
    const windowStyle = keys.some(
      (key) =>
        usage[key] &&
        typeof usage[key] === "object" &&
        ("percent" in usage[key] || "resetsAt" in usage[key] || "status" in usage[key])
    );
    if (windowStyle) {
      // { rolling: { status, percent, resetsAt }, weekly: …, monthly: … }
      for (const key of keys) {
        const entry = usage[key];
        if (entry && typeof entry === "object") {
          push(
            key,
            entry.used,
            entry.limit ?? entry.total ?? entry.quota,
            entry.remaining,
            entry.percent ?? entry.percentage,
            entry.resetsAt ?? entry.resetAt,
            entry.status
          );
        }
      }
    } else {
      push(
        "usage",
        usage.used,
        usage.limit ?? usage.total ?? usage.quota,
        usage.remaining,
        usage.percent ?? usage.percentage,
        usage.resetsAt ?? usage.resetAt,
        usage.status
      );
    }
  }

  if (rows.length === 0) {
    push(
      "usage",
      source.used,
      source.limit ?? source.total ?? source.quota,
      source.remaining,
      source.percent ?? source.percentage,
      source.resetsAt ?? source.resetAt,
      source.status
    );
  }

  return rows;
}

/**
 * Read the V2 console's own usage aggregates for a few ranges.
 *
 * Best-effort by design: the console API is a separate surface with its own
 * permissions, so any refusal, 404 or network failure yields
 * `{ ok: false, ... }` and never affects the quota answer the plugin exists for.
 *
 * @param apiKey - the resolved OpenCode Go / console service key.
 * @returns `{ ok, ranges, attempts? }`, where each range carries
 *   `totalRequests`, per-kind token counts and `totalCostMicroCents`.
 */
async function fetchConsoleUsage(apiKey) {
  const ranges = {};
  const attempts = [];

  for (const range of CONSOLE_RANGES) {
    const url = `${CONSOLE_BASE}/api/usage/summary?range=${range}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        attempts.push({ range, status: response.status });
        continue;
      }
      const body = await response.json().catch(() => null);
      if (body && typeof body === "object") {
        ranges[range] = body;
      } else {
        attempts.push({ range, error: "unreadable_body" });
      }
    } catch (error) {
      attempts.push({ range, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const ok = Object.keys(ranges).length > 0;
  return { ok, ranges, ...(attempts.length > 0 ? { attempts } : {}) };
}

export function apply(ctx, config) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "exact",
      path: "/dsh-opencode-go-usage",
      handler: async (req, res) => {
        try {
          if (req.method !== "GET" && req.method !== "HEAD") {
            send(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }

          const apiKeyRef = config?.apiKeyEnv ?? DEFAULT_API_KEY_REF;

          let credential;
          try {
            credential = await ctx.credentials.resolve(apiKeyRef);
          } catch (error) {
            send(res, 200, {
              ok: false,
              error: "credential_error",
              message: error instanceof Error ? error.message : String(error),
            });
            return;
          }

          const apiKey = credential?.value || process.env[apiKeyRef];
          if (!apiKey) {
            send(res, 200, {
              ok: false,
              error: "no_api_key",
              message: `${apiKeyRef} 未配置（请在 $DSH_HOME/.credentials.yaml 中设置）`,
            });
            return;
          }

          // Started in parallel: the console call must never delay the quota answer.
          const consoleUsage = fetchConsoleUsage(apiKey);

          const candidates = config?.upstream
            ? [config.upstream, ...USAGE_CANDIDATES.filter((u) => u !== config.upstream)]
            : USAGE_CANDIDATES;

          const attempts = [];
          for (const url of candidates) {
            try {
              const upstream = await fetch(url, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(15000),
              });
              const body = await upstream.json().catch(() => null);

              attempts.push({ url, status: upstream.status });

              if (upstream.ok) {
                send(res, 200, {
                  ok: true,
                  data: {
                    upstream: url,
                    status: upstream.status,
                    summary: summarize(body),
                    raw: body,
                    console: await consoleUsage,
                  },
                });
                return;
              }

              if (upstream.status === 401 || upstream.status === 403) {
                attempts[attempts.length - 1].auth = true;
                // Wrong key: trying more endpoints with the same key won't help.
                break;
              }
            } catch (error) {
              attempts.push({
                url,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          send(res, 200, {
            ok: false,
            error: "upstream_error",
            attempts,
            console: await consoleUsage,
            message: `OpenCode Go usage 查询失败（已尝试 ${attempts.length} 个端点）`,
          });
        } catch (error) {
          send(res, 200, {
            ok: false,
            error: "handler_crashed",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      },
    });

    return dispose;
  }, "dsh-opencode-go-usage: http route");
}
