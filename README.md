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

1. 将本 `Temp` 目录作为一个独立项目上传到 GitHub，或在 Vercel 导入仓库时把 Root Directory 设置为 `Temp`。
2. Framework Preset 选择 `Other`，Node.js 使用 22.x，不需要 Build Command。
3. 在 Vercel 项目的 Settings -> Environment Variables 中添加以下五项，并勾选 Production：

| 名称 | 填写内容 |
|---|---|
| `GITHUB_TOKEN` | 第 1 步创建的 GitHub Fine-grained PAT |
| `TURNSTILE_SECRET_KEY` | Turnstile 的 Secret Key |
| `UPSTASH_REDIS_REST_URL` | Upstash 的 REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash 的 REST Token |
| `ALLOWED_ORIGINS` | `https://xscnet.cn,https://www.xscnet.cn` |

4. 部署或重新部署项目。新增 `friend-pending` 接口后必须重新部署，环境变量无需增加。
5. 访问 `https://你的接口域名/api/health`，应返回 `{"ok":true,"service":"friend-apply"}`。

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

生产接口只接受两个正式博客来源。不要为了本地调试把 localhost 加入生产环境的 `ALLOWED_ORIGINS`。
