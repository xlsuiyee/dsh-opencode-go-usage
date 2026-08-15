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
 */

const DEFAULT_API_KEY_REF = "OPENCODE_GO_API_KEY";

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
