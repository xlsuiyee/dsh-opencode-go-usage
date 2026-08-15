# dsh-opencode-go-usage

> DeepSeek Harness (dsh web) 客户端插件:在侧边栏实时显示 **OpenCode Go 套餐用量 / 余量**,点击弹出图表面板。

![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- 📊 **侧边栏常驻按钮**:显示 OpenCode Go 用量(月度优先),如 `Go 0%`
- 🔍 **悬停详情**:滚动 / 周 / 月三个配额窗口的用量百分比与重置时间
- 🎨 **图表面板**:点击按钮弹出 —— 主窗口环形图 + 每窗口进度条,颜色随用量变化(绿 <50% / 黄 50–80% / 红 ≥80%)
- ⏱️ **自动刷新**:后台每 60s,面板打开时每 15s;也可随时手动刷新(↻)
- 🔐 **密钥安全**:API Key 由宿主端从 `$DSH_HOME/.credentials.yaml` 读取并代理请求,浏览器不接触 Key,无 CORS 问题
- 🌓 **主题适配**:全部使用 dsh 主题 CSS 变量,深色 / 浅色主题均可

## 数据来源

官方接口(无需抓取页面,稳定可靠):

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OPENCODE_GO_API_KEY>
```

返回每个配额窗口的已用百分比与重置时间:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 0, "resetsAt": "2026-08-15T05:28:51.929Z" },
    "weekly":  { "status": "ok", "percent": 0, "resetsAt": "2026-08-17T00:00:00.929Z" },
    "monthly": { "status": "ok", "percent": 0, "resetsAt": "2026-09-14T15:34:23.929Z" }
  }
}
```

> 注意:官方接口只返回**百分比 + 重置时间**,不返回精确的 token 用量数字;如需「已用 X / 限额 Y」需要抓取 opencode.ai 工作区页面,方案更脆弱。

## 安装

前置条件:已安装 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)(web 模式),并在 `$DSH_HOME/.credentials.yaml` 中配置了 OpenCode Go 的 API Key:

```yaml
OPENCODE_GO_API_KEY: sk-xxxxxxxx
```

### 1. 克隆到本地

```bash
git clone https://github.com/xlsuiyee/dsh-opencode-go-usage.git
```

### 2. 接入插件目录

在 `$DSH_HOME/profiles/node_modules` 下创建指向本仓库的链接:

**Windows(PowerShell):**

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-opencode-go-usage" `
  -Target "C:\path\to\dsh-opencode-go-usage"
```

**macOS / Linux:**

```bash
ln -s /path/to/dsh-opencode-go-usage ~/.dsh/profiles/node_modules/dsh-opencode-go-usage
```

### 3. 注册插件

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`,在 `insert` 列表中加入:

```yaml
- insert:
    - id: dsh-opencode-go-usage
      name: dsh-opencode-go-usage
```

### 4. 重启 / 刷新

重启 `dsh web` 服务(或刷新浏览器页面)。侧边栏底部出现 `Go 0%` 即安装成功。

## 可选配置

在 `cordis.patch.yml` 的插件条目中可覆盖默认值:

```yaml
- id: dsh-opencode-go-usage
  name: dsh-opencode-go-usage
  config:
    apiKeyEnv: MY_CUSTOM_KEY_REF   # 默认 OPENCODE_GO_API_KEY(credentials.yaml 中的键名)
    upstream: https://opencode.ai/zen/go/v1/usage   # 默认官方接口,可指向代理
```

## 工作原理

- **宿主端**(`lib/index.js`):注册 loopback 路由 `GET /dsh-opencode-go-usage`,从凭据缝(`ctx.credentials`)解析 Key 并代理官方接口;失败时依次回退几个候选端点
- **浏览器端**(`lib/client.js`):通过 `sidebar.footer.action` 插槽渲染按钮与图表面板,`fetch` 相对路径即可,零跨域
- 无任何第三方运行时依赖(宿主端零 import,浏览器端仅使用 dsh 提供的 `react`)

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 按钮显示 `‒` | 查询失败,悬停按钮查看具体错误(通常是 Key 未配置) |
| 按钮显示 `—` | 接口返回 200 但未识别到用量字段,悬停查看原始响应 |
| 只有百分比没有具体 token 数 | 官方接口设计如此,见上文「数据来源」 |

## 许可

[MIT](./LICENSE)
