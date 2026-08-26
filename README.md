# 友链申请 Vercel API

这是可独立部署的最小 Vercel 项目，提供三个接口：

- `POST /api/friend-apply`：校验表单并创建带“审核中”标签的 GitHub Issue。
- `GET /api/friend-pending`：返回公开的审核中 Issue 摘要，不返回 Issue 正文或任何密钥。
- `GET /api/health`：只检查服务是否存活。

## 1. 准备 GitHub 令牌

在 GitHub 创建 Fine-grained personal access token：

1. Resource owner 选择 `mete0rxsc`。
2. Repository access 选择 `Only select repositories`，只勾选 `HexoBlogFriends`。
3. Repository permissions 中，`Metadata` 保持只读，`Issues` 设为 `Read and write`。
4. 生成后立即保存令牌；GitHub 只显示一次。
5. 确认仓库中已经存在名为“审核中”的标签。

## 2. 准备防刷服务

Cloudflare Turnstile 用于判断提交者是否像真人。创建 Managed Widget，允许域名：

- `xscnet.cn`
- `www.xscnet.cn`

控制台会给出两个值：Site Key 是公开值，填到博客 `_mete0r.config.yml`；Secret Key 是私钥，只填到 Vercel。

Upstash Redis 只保存匿名限流计数，用于限制同一来源每小时最多提交 3 次。在 Upstash 创建 Redis 数据库后，从 REST API 区域取得 REST URL 和 REST Token。

## 3. 部署到 Vercel

1. 将本 `Temp` 目录的内容作为独立项目上传到 GitHub。如果这些文件已经位于独立仓库根目录，Vercel 的 Root Directory 保持留空；只有从博客主仓库部署时才把 Root Directory 设置为 `Temp`。
2. Framework Preset 选择 `Other`，不填写 Build Command；Node.js 22.x 由 `package.json` 的 `engines.node` 自动指定。
3. 不要在 `vercel.json` 的 `functions.runtime` 中填写 `nodejs22.x`。内置 Node.js 函数会由 Vercel 自动识别，该字段只用于带完整版本号的第三方运行时。
4. 在 Vercel 项目的 Settings -> Environment Variables 中添加以下五项，并勾选 Production：

| 名称 | 填写内容 |
|---|---|
| `GITHUB_TOKEN` | 第 1 步创建的 GitHub Fine-grained PAT |
| `TURNSTILE_SECRET_KEY` | Turnstile 的 Secret Key |
| `UPSTASH_REDIS_REST_URL` | Upstash 的 REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash 的 REST Token |
| `ALLOWED_ORIGINS` | `https://xscnet.cn,https://www.xscnet.cn` |

5. 部署或重新部署项目。环境变量无需增加。
6. 访问 `https://你的接口域名/api/health`，应返回 `{"ok":true,"service":"friend-apply"}`。

## 4. 回填博客配置

博客 `_mete0r.config.yml` 中应保持：

```yaml
friendApply:
  endpoint: "https://friend.apply.xscnet.cn/api/friend-apply"
  pending:
    endpoint: "https://friend.apply.xscnet.cn/api/friend-pending"
  turnstile:
    siteKey: "你的 Turnstile Site Key"
```

Site Key 可以公开；GitHub Token、Turnstile Secret Key 和 Upstash Token 绝不能写入博客配置或提交到 Git。

## 5. 本地测试

本项目没有第三方运行时依赖，Node.js 22 下直接执行：

```bash
npm test
```

## Upstash keepalive

Vercel Cron invokes `GET /api/keepalive` automatically once every day. The
schedule `0 0 * * *` is UTC, which is 08:00 in China Standard Time. The
function runs on Vercel and is not called by the blog browser. This schedule
works on the Hobby plan, whose restriction is one execution per day.

It writes the current timestamp to the separate Redis key
`friend-apply:keepalive` with a 30-day expiry. This key is independent from
the friend-apply rate-limit keys and does not consume a user's submission
quota.

After changing `vercel.json`, redeploy the Vercel Production project. You can
verify the daily executions in Vercel Production Logs by searching for
`/api/keepalive`. The existing five environment variables are sufficient; no
additional secret is required.

生产接口只接受两个正式博客来源。不要为了本地调试把 localhost 加入生产环境的 `ALLOWED_ORIGINS`。
