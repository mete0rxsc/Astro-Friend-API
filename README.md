# Mete0r 友链申请 Vercel API

这是一个独立的 Vercel Serverless Function 项目。它接收博客友链申请表单，在服务端完成人机验证、来源校验、频率限制和重复检查，最后在 `mete0rxsc/HexoBlogFriends` 创建带“审核中”标签的 Issue。

浏览器不会接触 GitHub Token，申请人不需要登录 GitHub。Issue 创建者会显示为 Fine-grained PAT 所属的 GitHub 账号。

## 一、准备 GitHub Fine-grained PAT

1. 登录 GitHub，进入 `Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens`。
2. 点击 `Generate new token`。
3. `Resource owner` 选择 `mete0rxsc`。
4. `Repository access` 选择 `Only select repositories`，只勾选 `HexoBlogFriends`。
5. 在 `Repository permissions` 中设置：
   - `Issues`: `Read and write`
   - `Metadata`: `Read-only`，GitHub 通常会自动授予。
6. 设置合理的过期时间并生成 Token。
7. 立即保存生成的 `github_pat_...`；GitHub 不会再次完整显示它。
8. 确认 `HexoBlogFriends` 仓库已经存在名为“审核中”的标签。

这个 Token 只填写到 Vercel 的 `GITHUB_TOKEN` 环境变量，不要写入代码、README 或 `.env.example`。

## 二、准备 Cloudflare Turnstile

1. 打开 Cloudflare 控制台，进入 `Turnstile` 并创建 Widget。
2. Widget Mode 选择 `Managed`。
3. Hostnames 添加：
   - `xscnet.cn`
   - `www.xscnet.cn`
4. 创建后会得到两项内容：
   - `Site Key`：公开值，稍后填入博客 `_mete0r.config.yml`。
   - `Secret Key`：私密值，填入 Vercel 的 `TURNSTILE_SECRET_KEY`。

注意：Vercel API 域名不需要加入 Turnstile Hostnames，因为验证组件实际显示在博客页面上。

## 三、准备 Upstash Redis

1. 登录 Upstash，创建一个 Redis 数据库。
2. 打开数据库详情页的 REST API 区域。
3. 保存：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

API 使用 Redis 对来源 IP 的 SHA-256 截断哈希进行计数，不保存表单正文或明文 IP。默认限制为每小时 3 次，可在 `config.mjs` 修改。

## 四、部署到 Vercel

### 方法 A：通过 Git 仓库导入

1. 将本目录内容作为一个独立 Git 仓库提交并推送。
2. 在 Vercel 点击 `Add New -> Project`，导入该仓库。
3. `Framework Preset` 选择 `Other`。
4. 不需要填写 Build Command、Output Directory 或 Install Command。
5. 在 `Environment Variables` 添加下表中的五项变量。

### 方法 B：通过 Vercel CLI

在当前目录执行：

```bash
npx vercel
npx vercel --prod
```

首次执行时按提示创建新项目，Framework 选择 `Other`。环境变量建议仍在 Vercel 项目网页的 `Settings -> Environment Variables` 中填写，然后重新部署。

## 五、Vercel 环境变量

| Name | Value | Environment |
|---|---|---|
| `GITHUB_TOKEN` | 上一步创建的 `github_pat_...` | Production、Preview |
| `TURNSTILE_SECRET_KEY` | Turnstile Secret Key | Production、Preview |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL | Production、Preview |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST Token | Production、Preview |
| `ALLOWED_ORIGINS` | `https://xscnet.cn,https://www.xscnet.cn` | Production、Preview |

变量名区分大小写。修改环境变量后必须重新部署，已经完成的部署不会自动读取新值。

生产环境不要把 `localhost`、局域网地址或 Vercel Preview 地址加入 `ALLOWED_ORIGINS`。需要本地联调时，可只在 Vercel Development 环境临时增加对应 origin。

## 六、检查部署结果

部署完成后访问：

```text
https://<你的项目域名>/api/health
```

正常响应：

```json
{"ok":true,"service":"friend-apply"}
```

`GET /api/friend-apply` 返回 `405` 是正常的，该接口只接受 `POST` 和浏览器 CORS 预检使用的 `OPTIONS`。

## 七、回填博客配置

部署成功并取得 Vercel 项目域名、Turnstile Site Key 后，修改博客根目录 `_mete0r.config.yml`：

```yaml
friendApply:
  enabled: true
  endpoint: "https://<你的项目域名>/api/friend-apply"
  turnstile:
    enabled: true
    siteKey: "<Turnstile Site Key>"
```

然后重新执行博客构建并发布。`Site Key` 是公开值，可以放在博客配置中；`Secret Key` 只能存在 Vercel 环境变量里。

## 八、安全与故障说明

- GitHub、Turnstile 或 Upstash 配置缺失时，接口会失败关闭，不会绕过验证继续创建 Issue。
- API 不记录表单日志，不持久化 Turnstile Token 或 GitHub Token。
- 重复检查会读取最近最多 300 条 GitHub Issue，并比较申请网址。
- 当限流触发时返回 HTTP `429` 和 `Retry-After: 3600`。
- 稳定错误码包括 `INVALID_REQUEST`、`ORIGIN_FORBIDDEN`、`TURNSTILE_FAILED`、`DUPLICATE_URL`、`RATE_LIMITED`、`CONFIG_ERROR` 和 `GITHUB_ERROR`。

## 九、本地测试

本项目没有第三方运行时依赖，直接执行：

```bash
npm test
```

测试使用模拟的 GitHub、Turnstile 和 Upstash 响应，不会创建真实 Issue，也不会消耗真实 Token。
