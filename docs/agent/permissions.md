# 统一权限控制

权限范围、审批策略与审批者独立配置。共享预设位于 `packages/shared/src/thread/Permission.ts`：请求批准为 workspace-write/on-request/user，帮我批准只切换 Reviewer，完全访问为 danger-full-access/never/user。已存储的 untrusted/on-failure 继续使用现有兼容读取。

## 执行链

注册元数据声明能力和审批策略；inspectInput 返回宿主 permissionFacts 与 authorizationScope。PermissionDecisionEngine 先处理硬拒绝、Plan、文件范围与禁用能力，再按实际额外范围、规则、Hook 和强制审批判断。never 禁止等待新审批；never-review 不能绕过这些条件。新电脑应用授权由用户确认。

Hook 改写输入后重新走注册 schema、路径检查和统一判权。新审批预览返回操作指纹；恢复时检查指纹。保留旧 checkpoint 的无指纹读取路径及 SDK RunState 绑定；已审批的 Hook 结果不重复执行，以保留中断恢复语义。

临时授权复用 PermissionGrantStore。内建文件工具根据实际目标匹配授权，WorkspaceService 只给本次调用授权路径；预览不消费，执行前才消费。读取授权不能写入，写入授权包含必要的读取；多文件补丁全部预检查。显式只读根、Plan、受保护资源与硬拒绝始终有效。

文件范围只约束内建文件工具。Shell 是宿主进程，没有 OS 沙箱；网络授权表示审批范围，没有网络隔离。

## 来源与适配

参考 ZCode 提交 `872ad96` 的 `apps/zcode-cli/packages/core/src/tool/executor/permission-capability.ts`、`permission-input-recheck.ts` 和 `permission-rules.ts`，适配其宿主能力事实、来源不可由模型覆盖、输入变更重新判权的实现方式。对应改动位于 Pidex 的 ToolRegistry、ToolExecutor 和 PermissionDecisionEngine，继续复用已有命令解析器与审批存储；没有搬入整套 ZCode 权限系统，也没有采用 yolo 提前跳过 deny 的顺序。

ZCode 使用 Apache-2.0，保留[许可证](../licenses/ZCode-Apache-2.0.txt)。Pidex 的新增实现及改动不代表 ZCode 上游原版。
