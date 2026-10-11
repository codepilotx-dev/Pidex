import { spawn } from 'node:child_process'

export type ProcessTreeKillConfirmation = 'terminated' | 'process-not-found'

export interface ProcessTreeKiller {
  kill(pid: number): Promise<void | ProcessTreeKillConfirmation>
}

export class HostProcessTreeKiller implements ProcessTreeKiller {
  async kill(pid: number): Promise<void | ProcessTreeKillConfirmation> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // The process has already exited.
        }
      }
      return
    }
    return new Promise<ProcessTreeKillConfirmation>((resolveKill, rejectKill) => {
      const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', (error) => rejectKill(error))
      child.once('exit', (code) => {
        // 0=进程树已终止；128=进程已不存在。其余返回码不能证明清理成功。
        if (code === 0) {
          resolveKill('terminated')
          return
        }
        if (code === 128) {
          resolveKill('process-not-found')
          return
        }
        rejectKill(new Error(`进程树清理失败（taskkill=${String(code)}）`))
      })
    })
  }
}
