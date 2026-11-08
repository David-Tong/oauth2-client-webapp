# OAuth2 React 登录客户端

基于 React 和 Vite 的公共 OAuth2 客户端，配合 `oauth2-auth-server` 使用授权码 + S256 PKCE。包含登录、会话状态、退出和访问令牌自动更新。设计和部署注意事项见 [设计文档](DESIGNS/oauth2-client-webapp.md)。

## 本地运行

需要 Node.js 18+、npm、Java 17+，以及已配置用户的认证服务器。

1. 在 `oauth2-auth-server` 中按其 README 配置 `config/users.json`，然后启动服务器，让它监听 9001 端口，而公开 issuer 仍为 `http://localhost:9000`：

   ```powershell
   java -jar target/oauth2-auth-server-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev --server.port=9001
   ```

2. 在本项目目录启动前端：

   ```powershell
   npm install
   npm run dev
   ```

3. 打开 http://localhost:9000/app/。Vite 将 `/api/auth`、`/oauth2` 和 `/.well-known` 代理到 `http://localhost:9001`；浏览器始终使用同一来源。不要混用 `localhost` 和 `127.0.0.1`。默认客户端为 `webapp`，回调地址必须与服务器注册的 `http://localhost:9000/app/callback` 完全一致。

也可以通过 `AUTH_SERVER_PROXY_TARGET` 修改 Vite 代理目标，例如 `$env:AUTH_SERVER_PROXY_TARGET='http://localhost:9001'`。该变量不是浏览器端秘密。代理只适用于本地开发；生产环境应使用同源反向代理和 HTTPS，并配置服务器 issuer 与客户端回调地址。

## 验证

```powershell
npm test
npm run build
```

服务器不支持 refresh token。这里的自动更新是访问令牌到期前，利用现有服务器会话重新进行一次完整的 PKCE 授权码流程，期间页面会跳转；会话失效时需要重新登录。这不是 OAuth2 refresh token grant，也不会在浏览器关闭后运行。
