import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '..')
const packageWorkflow = readWorkflow('windows-x64-package.yml')
const ciWorkflow = readWorkflow('ci.yml')
const prRulesWorkflow = readWorkflow('pr-rules.yml')
const performanceWorkflow = readWorkflow('windows-desktop-performance.yml')
const scripts = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')).scripts

function readWorkflow(name: string): string {
  return readFileSync(resolve(repositoryRoot, '.github', 'workflows', name), 'utf8')
}

function actionReferences(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1])
}

function job(workflow: string, name: string): string {
  const normalized = workflow.replaceAll('\r\n', '\n')
  const match = normalized.match(
    new RegExp(`^  ${name}:\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|(?![\\s\\S]))`, 'm'),
  )
  if (!match) throw new Error(`Missing workflow job ${name}`)
  return match[0]
}

describe('release workflows', () => {
  test('quality uses the local preflight and leaves builds to package smoke', () => {
    const quality = job(ciWorkflow, 'quality')
    expect(quality).toContain('bun run check:quality')
    expect(quality).not.toContain('RunSuite.ts')
    expect(quality).not.toContain('build:agent')
    expect(quality).not.toContain('build:renderer')
    expect(quality).not.toContain('build:desktop')
    expect(job(packageWorkflow, 'unsigned-smoke')).toContain('bun run package:win')
    expect(job(packageWorkflow, 'release-parity')).toContain('test:a11y')
    for (const command of [
      'version:check',
      'typecheck',
      'format:check',
      'lint',
      'sync:check',
      'desktop:css:check',
    ]) {
      expect(scripts['check:quality']).toContain(command)
    }
    for (const command of [
      'check:quality',
      'test:unit',
      'security:audit',
      'test:a11y',
      'package:win',
    ]) {
      expect(scripts['check:release']).toContain(command)
    }
  })

  test('performance observation has its own PR job and retains failure evidence', () => {
    expect(performanceWorkflow).toContain('types: [opened, synchronize, reopened]')
    const observation = job(performanceWorkflow, 'renderer-observation')
    expect(observation).toContain('RunSuite.ts --suite=renderer')
    expect(observation).not.toContain('--enforce')
    expect(observation).not.toContain('continue-on-error')
    expect(observation).toContain('if: always()')
    expect(observation).toContain('performance-results/raw/renderer/')
    expect(observation).toContain('apps/desktop/renderer/test-results/performance/')
    expect(job(performanceWorkflow, 'packaged-electron')).toContain(
      "if: github.event_name != 'pull_request'",
    )
  })

  test('ordinary pull requests never enter a self-hosted release runner', () => {
    expect(job(packageWorkflow, 'unsigned-smoke')).toContain('runs-on: windows-latest')
    expect(job(packageWorkflow, 'unsigned-smoke')).not.toContain('pidex-release')
    expect(job(packageWorkflow, 'release-parity')).toContain('runs-on: windows-latest')
    expect(job(packageWorkflow, 'release-parity')).not.toContain('pidex-release')
  })

  test('release-parity actually runs synthetic signing, verifier and cleanup', () => {
    const parity = job(packageWorkflow, 'release-parity')
    expect(parity).toContain('New-SelfSignedCertificate')
    expect(parity).toContain('scripts/SignWinAgent.ts')
    expect(parity).toContain('scripts/AgentRuntimeVerifier.ts')
    expect(parity).toContain('--require-authenticode')
    expect(parity).toContain('--authenticode-trust-anchor')
    expect(parity).toContain('Cert:\\CurrentUser\\My')
    expect(parity).toContain('X509Store("My", "CurrentUser")')
    expect(parity).toContain('$store.Remove($c)')
    expect(parity).toContain('bun scripts/ReleaseRunContext.ts create')
    expect(parity).toContain('bun scripts/ReleaseRunContext.ts dispose')
    expect(parity).not.toContain('needs.release-pr-policy')
    expect(parity).not.toContain('Accept verified Release PR receipt')
    expect(parity).not.toContain('RELEASE_BOT_TOKEN')
    expect(parity).not.toContain('name: beta-release')
  })

  test('source-release creates v* releases before manual Windows uploads', () => {
    const sourceRelease = job(packageWorkflow, 'source-release')
    expect(sourceRelease).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    )
    expect(sourceRelease).toContain('runs-on: ubuntu-latest')
    expect(sourceRelease).toContain('Verify tag target belongs to main')
    expect(sourceRelease).toContain('bun run version:check -- --tag')
    expect(sourceRelease).toContain('scripts/WriteReleaseNotes.ts')
    expect(sourceRelease).toContain('gh release create')
    expect(sourceRelease).toContain('--verify-tag')
    expect(sourceRelease).toContain('--prerelease')
    expect(sourceRelease).not.toContain('asset_count')
    expect(sourceRelease).not.toContain('self-hosted')
    expect(sourceRelease).not.toContain('package:win')
    expect(sourceRelease).not.toContain('PIDEX_REQUIRE_SIGNING')
    expect(sourceRelease).not.toContain('Pidex-Desktop-*-x64.exe')
    expect(sourceRelease).not.toContain('upload-artifact')
    expect(sourceRelease).not.toContain('attest-')
  })

  test('tag publishing no longer references binary or Release PR automation', () => {
    const sourceRelease = job(packageWorkflow, 'source-release')
    for (const removedMarker of [
      'Verify trusted Release PR identity',
      'automation/release-v',
      'automation:beta-release',
      'pidex-beta-release',
      'verify-release-pr-policy',
      'beta-preflight.allowed_signers',
      'release-pr-policy',
      'SHA256SUMS.txt',
      'spdx.json',
      'blockmap',
      'beta.yml',
    ]) {
      expect(sourceRelease).not.toContain(removedMarker)
    }
  })

  test('ordinary PR CI jobs are preserved and run for every pull request', () => {
    for (const requiredJob of ['quality', 'unit-tests', 'dependency-audit']) {
      const required = job(ciWorkflow, requiredJob)
      expect(required).not.toContain('needs: release-pr-policy')
      expect(required).not.toContain('needs.release-pr-policy')
      expect(required).not.toContain('Accept verified Release PR receipt')
    }
    for (const workflow of [ciWorkflow, prRulesWorkflow, packageWorkflow]) {
      expect(workflow).toContain('types: [opened, synchronize, reopened]')
      expect(workflow).not.toContain('labeled')
    }
    expect(prRulesWorkflow).toContain('changelog-check:')
    expect(prRulesWorkflow).not.toContain('release-pr-policy')
    expect(prRulesWorkflow).not.toContain('RELEASE_BOT_LOGIN')
    expect(packageWorkflow).not.toContain('release-pr-policy:')
    expect(packageWorkflow).not.toContain('pull-requests: read')
  })

  test('all actions are pinned to full commit SHAs', () => {
    for (const workflow of [packageWorkflow, ciWorkflow, prRulesWorkflow, performanceWorkflow]) {
      for (const reference of actionReferences(workflow)) {
        expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/)
      }
    }
  })
})
