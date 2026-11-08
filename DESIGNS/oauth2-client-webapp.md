# 客户端设计

## 约束与流程

认证服务器仅注册了授权码 grant，要求 S256 PKCE，不签发 refresh token；默认客户端 `webapp` 是无密钥公共客户端。服务器不提供前端页面。客户端和认证端点通过反向代理处于同一来源，因而同源 Cookie、CSRF 和固定回调地址均能工作。

1. 使用 Web Crypto 生成独立随机 state 和 verifier，将它们与创建时间放入当前标签页的 sessionStorage，计算 S256 challenge，然后导航至 `/oauth2/authorize`。
2. 未登录时，服务器保存授权请求并跳转至 `/app/login`。登录页先获取 CSRF，再提交 JSON 凭据；只接受服务器返回的本地 `/api/auth/continue?id=...` 地址。没有待处理授权时，登录成功后主动发起授权。
3. `/app/callback` 立即移除地址栏的查询参数，核对一次性 state 和事务有效期，使用 verifier 换取访问令牌。授权码和 verifier 不会重复使用；错误展示给用户。
4. 令牌及绝对到期时间保存在 sessionStorage，以便跨授权导航、刷新页面并供当前标签页使用。成功后读取 `/api/auth/session` 显示身份。页面在到期前 30 秒（短期令牌为其寿命的一半）再次发起完整授权；标签页恢复可见时也重新检查时间。若服务器会话已过期，授权会进入登录页。网络或协议错误不会伪装成成功，用户可重新发起登录。
5. 退出时重新获取 CSRF，调用服务器退出接口，成功后清除本地令牌。服务端退出或撤销不会立即使已签发的 JWT 在本地验证的资源服务器失效。

这个方案不是 refresh token grant：每次更新都会发生顶层页面跳转，并依赖服务器会话；关闭页面后没有后台刷新。多标签页共享服务器 Cookie，但各自的 PKCE 事务和令牌隔离；服务器每个会话仅保留一个未登录授权请求，多个标签页同时登录可能互相覆盖，需要重新开始。

## 安全与部署

不要在浏览器配置客户端密钥。生产环境必须使用 HTTPS，认证服务器 issuer、注册地址和前端实际公开来源必须一致。将 `/app/**` 路由到构建后的 SPA（包括 `/app/login` 和 `/app/callback` 的历史路由回退），将 `/api/auth/**`、`/oauth2/**` 和 `/.well-known/**` 原路径代理到认证服务器。令牌请求和会话请求不能缓存；静态页面应设置 `Referrer-Policy: no-referrer`、合理的 CSP 和安全响应头。不要把令牌放入 URL、日志或 localStorage。

sessionStorage 可被同源 JavaScript 读取，不能防御 XSS；应严格控制同源脚本及依赖。服务端会话失效后客户端不能保证已颁发的 JWT 立即失效；资源服务器仍必须验证 JWT 的签名、issuer、audience、有效期和 scope。生产中如需真正无跳转的 refresh token 更新，应另行设计服务器端支持和相应安全策略，不能假装现有服务器提供该能力。
