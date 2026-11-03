import { describe, expect, test } from 'bun:test'
import { safeTurnError } from '../src/Errors'

describe('safeTurnError', () => {
  test('allows safe and clean error messages through', () => {
    expect(safeTurnError('模型上下文超限，请开启压缩或新建会话')).toBe(
      '模型上下文超限，请开启压缩或新建会话',
    )
    expect(safeTurnError('Rate limit exceeded: 429 Too Many Requests')).toBe(
      'Rate limit exceeded: 429 Too Many Requests',
    )
    expect(safeTurnError('Network timeout after 30000ms\nPlease try again.')).toBe(
      'Network timeout after 30000ms\nPlease try again.',
    )
    expect(safeTurnError(new Error('Git rebase conflict in file: src/index.ts'))).toBe(
      'Git rebase conflict in file: src/index.ts',
    )
  })

  test('returns null for null, undefined, empty, or whitespace', () => {
    expect(safeTurnError(null)).toBeNull()
    expect(safeTurnError(undefined)).toBeNull()
    expect(safeTurnError('')).toBeNull()
    expect(safeTurnError('   \n  \t ')).toBeNull()
    expect(safeTurnError(new Error(''))).toBeNull()
  })

  test('rejects oversized messages without scanning them', () => {
    // 超长输入既没有展示价值，也会让栈帧正则有回溯风险。
    const started = performance.now()
    expect(safeTurnError('x'.repeat(200_001))).toBeNull()
    expect(safeTurnError(`${'x.'.repeat(100_000)}`)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  test('rejects messages containing stack traces', () => {
    // V8 / Node format
    expect(
      safeTurnError(
        'Error: fail\n    at Object.<anonymous> (F:\\CodeProject\\test.ts:1:1)\n    at Module._compile (internal/modules/cjs/loader.js:1063:30)',
      ),
    ).toBeNull()

    // Single line at
    expect(safeTurnError('Failure occurred at Object.run')).toBeNull()

    // Bun / WebKit format
    expect(safeTurnError('Error: fail\nrunTask@file:///app/index.js:12:34')).toBeNull()

    // Source location with line and column
    expect(safeTurnError('compile failure at parser.ts:42:15')).toBeNull()

    // Python traceback format
    expect(
      safeTurnError('Traceback (most recent call last):\n  File "app.py", line 1, in <module>'),
    ).toBeNull()
  })

  test('rejects messages containing credentials and sensitive tokens', () => {
    // OpenAI-style secret key
    expect(safeTurnError('Failed with key sk-abcdef1234567890abcdef1234567890')).toBeNull()

    // GitHub token
    expect(safeTurnError('Invalid ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toBeNull()

    // AWS Access Key
    expect(safeTurnError('Access denied for AKIAIOSFODNN7EXAMPLE')).toBeNull()

    // Bearer token
    expect(safeTurnError('Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBeNull()

    // Key / password assignments
    expect(safeTurnError('auth failed: api_key=secret_dummy_value')).toBeNull()
    expect(safeTurnError('auth failed: password: super_secret_dummy')).toBeNull()
    expect(safeTurnError('Missing credentials: secret_key=abcdef123456789')).toBeNull()
    expect(safeTurnError('{"access_token": "my_secret_token_123"}')).toBeNull()
    expect(safeTurnError('{"secret_key": "my_secret_key_456"}')).toBeNull()
  })

  test('rejects messages containing Windows absolute paths or sensitive Unix paths', () => {
    // Windows drive path
    expect(safeTurnError('File not found: C:\\Users\\XiaoHi\\secret.txt')).toBeNull()
    expect(safeTurnError('Failed to access D:/Projects/Code/repo')).toBeNull()

    // UNC path
    expect(safeTurnError('Cannot read \\\\server\\share\\data')).toBeNull()

    // Sensitive Unix directories
    expect(safeTurnError('Permission denied: /Users/username/docs')).toBeNull()
    expect(safeTurnError('Cannot open /etc/passwd')).toBeNull()
    expect(safeTurnError('Write failed at /home/deploy/project')).toBeNull()

    // Quoted sensitive Unix directories
    expect(safeTurnError("Cannot open '/etc/passwd'")).toBeNull()
    expect(safeTurnError('Cannot open "/etc/shadow"')).toBeNull()
    expect(safeTurnError("Permission denied: '/Users/admin/.ssh/id_rsa'")).toBeNull()
    expect(safeTurnError('File missing: (/home/user/workspace/file)')).toBeNull()
  })

  test('rejects internal RPC methods and database details', () => {
    expect(safeTurnError('RpcError: method failed')).toBeNull()
    expect(safeTurnError('AgentRpcError: connection closed')).toBeNull()
    expect(safeTurnError('Failed during turn/start')).toBeNull()
    expect(safeTurnError('Operation failed on thread/create')).toBeNull()

    // SQLite details
    expect(safeTurnError('SqliteError: no such table: agent_executions')).toBeNull()
    expect(safeTurnError('CHECK constraint failed: status IN (...)')).toBeNull()
    expect(safeTurnError('database locked')).toBeNull()
    expect(safeTurnError('database is locked')).toBeNull()
    expect(safeTurnError('SQLITE_BUSY: database is locked')).toBeNull()
    expect(safeTurnError('SQLITE_CONSTRAINT: UNIQUE constraint failed: turns.id')).toBeNull()
  })
})
