# App 代码阅读指南

这份指南按当前代码结构，带你从页面入口追踪到登录、授权回调、令牌更新和退出。说明使用中文，代码中的命名和界面文案保持英文。协议约束和部署要求可以配合阅读 [客户端设计](oauth2-client-webapp.md)。

## 1. 先看文件之间的关系

```text
index.html
  src/main.tsx                 Mount React and load styles
    src/App.tsx                Select the view and connect callbacks
      components/AuthLayout.tsx
      components/LoginForm.tsx
      components/AccountDetails.tsx
      hooks/useAuth.ts         Manage state and authentication lifecycle
        src/auth.ts           Handle HTTP, PKCE, storage, and navigation
```

组件负责展示，`useAuth` 负责把认证过程变成 React 状态，`auth.ts` 负责具体执行协议操作。先理解每一层做什么，再深入函数内部，会更容易跟上代码。

## 2. 建议的阅读顺序

| 顺序 | 文件 | 阅读时关注的问题 |
| --- | --- | --- |
| 1 | [main.tsx](../src/main.tsx) | React 挂载到哪里？样式从哪里加载？ |
| 2 | [App.tsx](../src/App.tsx) | 当前显示哪个页面？事件交给谁处理？ |
| 3 | [AuthLayout.tsx](../src/components/AuthLayout.tsx) | 哪些布局是共用的？`children` 放在哪里？ |
| 4 | [LoginForm.tsx](../src/components/LoginForm.tsx) | 如何读取表单、调用父层传入的函数？ |
| 5 | [AccountDetails.tsx](../src/components/AccountDetails.tsx) | 账号数据如何显示？按钮如何通知父层？ |
| 6 | [useAuth.ts](../src/hooks/useAuth.ts) | 初始化、登录、自动更新和退出怎样改变状态？ |
| 7 | [auth.ts](../src/auth.ts) | 网络请求、PKCE 校验和存储具体如何实现？ |
| 8 | [vite.config.ts](../vite.config.ts) | 前端请求怎样到达认证服务器？ |
| 9 | [auth.test.js](../test/auth.test.js) | 哪些成功和失败场景已有验证？ |

第一次阅读 `App.tsx` 时，把 `useAuth()` 暂时理解成“返回当前状态和可执行操作的函数”即可，不必立刻展开所有细节。

## 3. 用 React 的数据流理解组件

`App` 调用 `useAuth()`，拿到状态和操作，再通过 props 交给子组件。例如：

```jsx
<LoginForm busy={busy} onSignIn={signIn} />
```

这里 `busy` 从父层流向表单，决定按钮是否禁用。`onSignIn` 是一个函数；表单提交时调用它，把用户名和密码传回认证逻辑。

`LoginForm` 的 `handleSubmit` 会阻止浏览器默认提交，用 `FormData` 读取输入，并等待 `onSignIn`。只有返回真值时才重置表单。表单本身不发送认证请求，也不决定登录后显示哪个页面。

`AuthLayout` 接收 `title`、`subtitle` 和 `children`。`App` 写在 `<AuthLayout>...</AuthLayout>` 中间的内容就是 `children`，因此不同视图可以共用卡片、标题和底部说明。

`AccountDetails` 也是通过 props 接收数据和操作。它显示 `user`、`token`，并在点击时调用 `onAuthorize` 或 `onSignOut`。

## 4. 理解 useAuth 的状态

| 状态 | 用途 |
| --- | --- |
| `view` | 决定展示 `loading`、`welcome`、`login` 或 `account` |
| `error` | 保存要显示的错误信息 |
| `user` | 保存会话接口返回的身份信息 |
| `token` | 保存访问令牌、到期时间和令牌寿命 |
| `busy` | 控制按钮禁用状态和处理中提示 |
| `operation` | 用 `useRef` 保存操作锁，防止重复发起认证操作 |

`useState` 的 setter 会触发重新渲染，因此调用 `setView('account')` 后，`App` 会显示账号组件。`operation.current` 的修改不会触发渲染，它用于同步判断是否已有操作正在进行；`busy` 则负责让界面反映这一状态。

这个 hook 有两个 `useEffect`：第一个在挂载时根据 URL 初始化认证状态；第二个在账号视图且有令牌时安排令牌更新，并在清理时移除定时器和事件监听。

## 5. 跟踪一次完整登录

### 从欢迎页发起授权

1. 用户点击 `App` 中的登录按钮，调用 hook 的 `authorize()`。
2. `authorize()` 设置操作锁和 `busy`，再调用 `auth.ts` 的 `beginAuthorization()`。
3. `beginAuthorization()` 生成随机 `state` 和 `verifier`，计算 S256 challenge，把本次事务存入 `sessionStorage`，并清除旧的本地令牌。
4. 浏览器通过 `window.location.assign()` 前往 `/oauth2/authorize`。这是整页导航。

`state` 用来把回调与当前标签页发起的请求对应起来。`verifier` 留在当前标签页，授权请求发送由它计算出的 challenge，之后换取令牌时再提交 verifier。

### 输入用户名和密码

根据现有设计，服务器在需要登录时跳转到 `/app/login`。页面重新加载后，`useAuth` 的初始化逻辑识别这个路径，清除旧访问令牌并切换到 `login` 视图。这里保留了 PKCE 事务，供稍后的回调使用。

提交表单时，调用链是：

```text
LoginForm.handleSubmit
  -> useAuth.signIn(username, password)
    -> auth.login(username, password)
      -> GET /api/auth/csrf
      -> POST /api/auth/login
      -> navigate to continueUrl, or beginAuthorization()
```

`login()` 先获取 CSRF token，再携带指定的 CSRF header 提交凭据。如果服务器给出继续地址，代码仅接受符合预期的本地 `/api/auth/continue?id=...` 地址；如果 `continueUrl` 为 `null`，则重新发起授权。

### 处理授权回调

浏览器回到 `/app/callback` 后，仍然加载同一个 React app。当前代码没有使用 React Router，而是在初始化时直接检查 `window.location.pathname`。

初始化逻辑先保存查询参数，再用 `history.replaceState()` 把地址改为 `/app/`，移除地址栏中的授权参数。这个调用不会重新加载页面。

接着 `finishAuthorization(search)` 会：

1. 读取并立即移除本次 PKCE 事务，避免重复消费。
2. 校验事务结构、创建时间和回调中的唯一 `state`；事务有效期为 10 分钟。
3. 检查授权错误，以及是否存在唯一且非空的 `code`。
4. 向 `/oauth2/token` 提交授权码和 `code_verifier`。
5. 校验令牌响应，计算绝对到期时间并保存到 `sessionStorage`。

随后 hook 调用 `getSession()` 获取用户身份。成功时设置 `user`、`token` 和 `view = 'account'`；会话已失效或初始化出错时，会清理本地认证数据并显示欢迎页及错误信息。

注意，账号身份来自会话接口，当前代码没有解析访问令牌来生成用户资料，也没有演示携带令牌调用业务 API。

## 6. 刷新页面与令牌自动更新

普通进入 `/app/` 时，初始化逻辑通过 `readToken()` 恢复当前标签页保存的令牌，再检查服务器会话。`readToken()` 校验数据结构，但不会在这里拒绝一个结构合法、已经到期的令牌；进入账号视图后，更新逻辑会立即安排重新授权。

`renewalDelay()` 计算距离下一次授权还有多久：通常提前 30 秒，短期令牌则提前其寿命的一半，结果最小为零。

第二个 effect 根据这个延迟设置定时器，并监听 `visibilitychange` 重新检查时间。时间到后调用的仍然是 `authorize()`，因此会再次经过完整授权码流程和页面导航。若服务器会话仍有效，可能无需再次输入密码；若会话失效，则需要重新登录。

这里没有 refresh token grant。关闭页面后，这个 React 定时器也不会继续运行。

## 7. 退出和错误如何处理

退出链路是 `AccountDetails` → `useAuth.signOut()` → `auth.logout()`。`logout()` 重新获取 CSRF token，调用 `/api/auth/logout`，成功后清除本地令牌和 PKCE 事务。hook 随后清空身份和令牌状态，回到欢迎页。

退出请求失败时，本地认证数据会保留，错误会显示在界面上。认证模块通过抛出异常报告协议或网络错误，hook 捕获异常并更新 `error`，`App` 用 `role="alert"` 渲染它。

## 8. 区分三种存储位置

| 位置 | 保存什么 | 为什么需要 |
| --- | --- | --- |
| React state | 当前视图、身份、令牌、错误、忙碌状态 | 驱动当前页面渲染；整页导航后需要重新初始化 |
| `sessionStorage` | `oauth2.transaction` 和 `oauth2.token` | 在当前标签页刷新及授权往返时恢复数据 |
| 服务器会话与浏览器 Cookie | 服务器登录状态 | 同源请求携带 Cookie，让服务器识别会话 |

本地令牌和服务器会话是不同的数据。`getSession()` 检查的是服务器会话；它不是通过提交访问令牌完成本地令牌有效性验证。

## 9. 理解本地代理

`package.json` 中的开发命令让 Vite 监听 `http://localhost:9001`，`vite.config.ts` 把前端基础路径设为 `/app/`，并把以下请求代理到认证服务器，默认目标为 `http://localhost:9000`：

- `/api/auth`
- `/oauth2`
- `/.well-known`

因此 `auth.ts` 可以使用 `/api/auth/session` 这样的相对地址，浏览器看到的仍是前端同源请求。`AUTH_SERVER_PROXY_TARGET` 可以改变开发代理目标。Vite 的开发代理不随静态构建自动部署；生产路由要求见客户端设计文档。

## 10. 带着问题检查代码

打开浏览器开发者工具的 Network，启用 Preserve log，再完成一次登录。对照代码查找授权导航、CSRF 请求、登录请求、回调、令牌请求和会话请求。已登录的服务器会话可能跳过输入密码的步骤。

在 Application 中查看当前来源的 Session Storage，可以观察 `oauth2.transaction` 在发起授权时出现、在回调处理时被消费，以及 `oauth2.token` 在成功换取令牌后出现。不要把令牌或密码复制进日志和截图。

最后阅读 `test/auth.test.js`：它使用模拟的浏览器对象、存储和 `fetch` 验证协议函数，涵盖 PKCE 交换、无效或重复 state、令牌响应校验、继续地址限制、退出失败和会话错误。它没有覆盖 React 组件渲染，也没有替代真实服务器的端到端验证。

修改时可以按责任定位：页面排版看组件和 `style.css`，视图切换及定时器看 `useAuth.ts`，认证请求和校验看 `auth.ts`，本地代理看 `vite.config.ts`。
