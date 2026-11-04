# Computer Use JavaScript API

`mcp__node_repl__js` 是电脑控制唯一的模型可见入口，由宿主提供。本页是参数与返回字段参考；流程与纪律见 `skills/computer-use/SKILL.md`。

## 调用约定

- 每次调用在独立子进程中执行，超时或取消会被终止；globals、imports 与模块缓存不跨调用保留。
- 只暴露 `computer` 和 `nodeRepl`。没有任意模块导入、Shell、文件、网络或原生 Helper 凭据。
- 支持顶层 `await`。脚本抛出的错误作为工具错误返回；`nodeRepl.write` 的文本进入工具结果。

## nodeRepl

```ts
nodeRepl.write(value: unknown): void
nodeRepl.emitImage(data: Uint8Array | string, mimeType?: string): void
```

`computer.read` 的截图已通过既有模型图片结果链返回，不需要再 `emitImage` 一次；同一次结果里出现第二张栅格会导致图片被整体移除。

## computer

```ts
await computer.apps(): { windows: { ref: string; name: string; appId?: string; pid?: number }[] }
await computer.read(windowRef: string): {
  text: string
  observationId?: string
  token?: string
  images?: { data: string; mimeType: string }[]
  code?: string
  isError?: boolean
}
await computer.action(
  windowRef: string,
  observationId: string,
  operation: ComputerOperation,
): { text: string; code?: string; isError?: boolean; images?: ... }
```

### ComputerOperation

```ts
type ComputerOperation = {
  action:
    | 'click'
    | 'double_click'
    | 'right_click'
    | 'type_text'
    | 'press_key'
    | 'hotkey'
    | 'scroll'
    | 'drag'
  elementToken?: string
  x?: number
  y?: number
  endX?: number
  endY?: number
  text?: string
  key?: string
  keys?: string[]
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  delivery?: 'background' | 'foreground'
}
```

约束与三个内建电脑工具一致：`type_text` 需要 `text`，`press_key` 需要 `key`，`hotkey` 需要 `keys`，`scroll` 需要 `direction`；点击类操作需要 `elementToken` 或 `x`/`y`；`drag` 始终需要 `x`、`y`、`endX`、`endY`。

## 权限与审批

- `computer.apps()` 与 `computer.read()` 只观察；`computer.action()` 声明外部状态与用户交互，Plan 模式不可用。
- 每次电脑 API 调用都回到宿主注册、校验、hooks、判权与审批链，并按内建 `ComputerApps`/`ComputerRead`/`ComputerAction` 记录审计。
- `computer.read` 首次访问需要聊天审批。需要批准时当前脚本结束，被阻塞的读取写入审批 checkpoint；批准后只执行该读取并把结果作为本次 `mcp__node_repl__js` 调用的结果返回，原脚本其余部分不执行。
