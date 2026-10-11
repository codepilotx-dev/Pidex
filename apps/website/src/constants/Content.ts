export const GITHUB_REPO_URL = 'https://github.com/codepilotx-dev/Pidex'
export const GITHUB_RELEASES_URL = 'https://github.com/codepilotx-dev/Pidex/releases'
export const GITHUB_LICENSE_URL = 'https://github.com/codepilotx-dev/Pidex/blob/main/LICENSE'
export const GITHUB_README_URL = 'https://github.com/codepilotx-dev/Pidex#readme'
export const GITHUB_SECURITY_URL = 'https://github.com/codepilotx-dev/Pidex/blob/main/SECURITY.md'

export interface NavLink {
  label: string
  href: string
}

export const NAV_LINKS: NavLink[] = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'FAQ', href: '#faq' },
]

export const HERO_CONTENT = {
  eyebrow: 'AI coding, on your terms',
  headline: 'Give every coding task a place to move forward.',
  subhead:
    'Pidex gives developers one focused desktop workspace for agent tasks, model choice, tool approvals, and code review — all grounded in local projects.',
  primaryCta: 'View on GitHub',
  secondaryCta: 'Explore the product',
  metaBadges: ['Windows x64 Native', 'Local SQLite WAL', 'Open-Source (MIT)', 'Zero Telemetry'],
}

export const PRODUCT_OVERVIEW = {
  sectionTitle: 'Built for the Real Coding Cycle',
  sectionSubtitle:
    'Instead of tossing code fragments into transient chat boxes or juggling disconnected terminals, Pidex gives your work a durable home rooted in your actual filesystem.',
  narrativeLead:
    'A dedicated desktop workspace where projects, agent tasks, model reasoning, tools, and code review converge without losing your working context.',
  pillars: [
    {
      title: 'Local Workspace Grounding',
      description:
        'Operates directly inside your repository. SQLite WAL persistence, state outboxes, and atomic checkpoints ensure task history survives reboots without sending your proprietary code to intermediate cloud proxies.',
      tag: 'Filesystem-First',
    },
    {
      title: 'Multi-Model Freedom',
      description:
        'Switch seamlessly between Anthropic Claude, OpenAI, DeepSeek, MiniMax, or any OpenAI-compatible custom endpoint. Tune reasoning effort and system harness parameters per task.',
      tag: 'Model Agnostic',
    },
    {
      title: 'Deterministic Control & Review',
      description:
        'Every tool invocation—file edits, shell commands, or test runs—respects your configured permission boundaries. Inspect unified and split diffs and comment inline before landing changes.',
      tag: 'Human in the Loop',
    },
  ],
}

export interface FeatureTabItem {
  id: string
  label: string
  title: string
  summary: string
  points: string[]
  previewLabel: string
  aspectRatio: '16:10' | '16:9' | '4:3' | '3:2'
}

export const FEATURE_TABS: FeatureTabItem[] = [
  {
    id: 'projects',
    label: 'Projects',
    title: 'Multi-Folder Workspaces & Managed Worktrees',
    summary:
      'Manage multiple repositories and independent worktrees simultaneously. Isolate experimental tasks from your daily working tree without dirtying untracked edits or context switching.',
    points: [
      'Parallel branch workspaces with isolated execution contexts',
      'Automatic worktree lifecycle cleanup and branch tracking',
      'Seamless multi-root repository navigation and quick switching',
    ],
    previewLabel: 'Projects & Worktree Manager',
    aspectRatio: '16:10',
  },
  {
    id: 'agent-tasks',
    label: 'Agent tasks',
    title: 'Structured Execution with Interruption Recovery',
    summary:
      'Break high-level goals into transparent phases. The agent plans, inspects code, proposes atomic edits, and executes shell diagnostics with crash-resilient checkpoints.',
    points: [
      'Interactive question checkpoints for underspecified requirements',
      'Non-destructive crash recovery with transactional event outbox',
      'Strict rollback protections for uncommitted user changes',
    ],
    previewLabel: 'Agent Task Timeline & Tool Execution',
    aspectRatio: '16:10',
  },
  {
    id: 'models',
    label: 'Models',
    title: 'Bring Any Model, Endpoint, or Custom Provider',
    summary:
      'Connect Claude 3.7 Sonnet, GPT-4o, DeepSeek-V3 / R1, or self-hosted Ollama endpoints. API keys are kept strictly in local memory and secure OS storage—never written to SQLite databases or telemetry.',
    points: [
      'Pi provider engine supporting standard OpenAI & Anthropic wire protocols',
      'Granular thinking budget & temperature configuration',
      'Instant connection diagnostics and endpoint health checks',
    ],
    previewLabel: 'Model Center & Provider Configuration',
    aspectRatio: '16:10',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Comprehensive Diff & In-Line Code Review',
    summary:
      'Inspect changes with the same rigor you expect in production code reviews. Review unified or split diffs, leave line-level feedback, stage or revert specific chunks, and author Git commits.',
    points: [
      'Syntax-highlighted unified and side-by-side diff viewers',
      'Line-level review comments fed back directly into the agent context',
      'Native Git staging, un-staging, discarding, and branch publishing',
    ],
    previewLabel: 'Unified Diff & Code Review Workbench',
    aspectRatio: '16:10',
  },
  {
    id: 'automations',
    label: 'Automations',
    title: 'Extensible Skills, Plugins, and Scheduled Runs',
    summary:
      'Equip your workbench with custom Model Context Protocol (MCP) servers, community plugins, and recurring cron-style background jobs for continuous test monitoring and code quality checks.',
    points: [
      'Full Model Context Protocol (MCP) client over stdio and SSE',
      'Integrated sandboxed Chromium browser for UI testing & verification',
      'Scheduled background timers and automated repo health checks',
    ],
    previewLabel: 'Skills, Plugins & Automation Center',
    aspectRatio: '16:10',
  },
]

export const ALTERNATING_FEATURES = [
  {
    badge: 'WORKSPACE ARCHITECTURE',
    title: 'Work across projects without cross-contamination',
    description:
      'Software engineering rarely happens in a single linear branch. Pidex lets you spin up isolated tasks across multiple repos and managed worktrees. Your active working files remain untouched while the agent tests hypotheses in an isolated workspace.',
    highlights: [
      'Dedicated sidecar process per project workspace',
      'Zero collision with user uncommitted modifications',
      'Automatic sync back to target branches when approved',
    ],
    previewLabel: 'Multi-Project & Worktree Architecture',
    aspectRatio: '16:10' as const,
    reverse: false,
  },
  {
    badge: 'SAFETY & CONTROL',
    title: 'Stay in control of every file edit and shell command',
    description:
      'Autonomous power requires clear guardrails. Pidex features strict permission tiers—from read-only inspection to approval-required execution. High-impact operations like filesystem modifications or terminal commands can pause for explicit user sign-off.',
    highlights: [
      'Fail-closed permission checks on every tool dispatch',
      'Credential isolation: API keys are never stored in plain SQLite',
      'Interactive multi-choice question prompts for clarifying intent',
    ],
    previewLabel: 'Permission Boundary & Approval Checkpoint',
    aspectRatio: '16:10' as const,
    reverse: true,
  },
  {
    badge: 'INTEGRATED GIT FLOW',
    title: 'Review what changed before landing into your branch',
    description:
      'Stop guessing what an AI modified. Pidex features a full-fledged diff review workbench with file change trees, added/deleted line statistics, and line-level comment threads that let you steer the agent directly where adjustments are needed.',
    highlights: [
      'Side-by-side and unified diffs with syntax highlighting',
      'Direct line-level commenting to trigger focused revisions',
      'Stage, unstage, commit, push, and create GitHub Pull Requests',
    ],
    previewLabel: 'Line-by-Line Diff & Review Workbench',
    aspectRatio: '16:10' as const,
    reverse: false,
  },
]

export const WORKFLOW_STEPS = [
  {
    step: '01',
    name: 'Describe',
    title: 'Specify Intent & Constraints',
    description:
      'Provide your task description, reference specific files or error traces, and choose the optimal model and permission mode for the job.',
    previewLabel: 'Step 1: Task Prompt & Configuration',
  },
  {
    step: '02',
    name: 'Build',
    title: 'Autonomous Exploration & Implementation',
    description:
      'The agent navigates your codebase, parses types, drafts implementation plans, and applies targeted edits while capturing diagnostic logs.',
    previewLabel: 'Step 2: Agent Execution & File Edits',
  },
  {
    step: '03',
    name: 'Review',
    title: 'Interactive Inspection & Iteration',
    description:
      'Inspect every modified line on the built-in diff viewer. Leave inline comments or request refinements before anything gets merged.',
    previewLabel: 'Step 3: Line-Level Diff Inspection',
  },
  {
    step: '04',
    name: 'Ship',
    title: 'Commit, Push, and Collaborate',
    description:
      'Stage verified chunks, write conventional commit messages, and push directly to your remote or open a pull request without leaving the app.',
    previewLabel: 'Step 4: Git Commit & Branch Publishing',
  },
]

export const CAPABILITIES = [
  {
    title: 'Model Providers',
    category: 'INTELLIGENCE',
    description:
      'Connect directly to Anthropic, OpenAI, DeepSeek, MiniMax, or custom OpenAI-compatible proxies. Configure per-model reasoning effort and system prompts.',
  },
  {
    title: 'Skills, Plugins & MCP',
    category: 'EXTENSIBILITY',
    description:
      'Seamlessly mount Model Context Protocol (MCP) servers via stdio or SSE. Install custom workflow skills and domain-specific tool plugins.',
  },
  {
    title: 'Browser & Computer Use',
    category: 'VERIFICATION',
    description:
      'Built-in sandboxed browser automation allows the agent to navigate local web servers, verify rendered UIs, capture screenshots, and read browser console logs.',
  },
  {
    title: 'Scheduled Tasks',
    category: 'AUTOMATION',
    description:
      'Set one-shot timers or recurring cron triggers for repository health checks, background test runs, or periodic code smell sweeps.',
  },
  {
    title: 'Subagents & Handoff',
    category: 'ORCHESTRATION',
    description:
      'Spawn lightweight read-only research subagents to survey large codebases concurrently without polluting your main conversation context.',
  },
]

export const FAQS = [
  {
    question: 'Which operating systems are supported?',
    answer:
      'Pidex is currently in Beta and specifically designed Windows-first for Windows 10 and 11 (x64). It integrates closely with Windows native titlebars, PowerShell/pwsh, and native terminal emulators.',
  },
  {
    question: 'Is Pidex open source?',
    answer:
      'Yes. Pidex is 100% open source under the permissive MIT License. You can inspect all code, run it locally, and contribute on GitHub.',
  },
  {
    question: 'Where is my source code and task data stored?',
    answer:
      'All your session histories, task checkpoints, logs, and settings reside 100% locally on your machine in a robust SQLite database (with WAL mode enabled). Pidex includes zero telemetry, zero analytics scripts, and never routes your code through intermediate servers.',
  },
  {
    question: 'How do API keys and model credentials work?',
    answer:
      'You bring your own API keys. Keys are handled with extreme security: they are kept strictly in memory and native desktop storage, and are never written to SQLite, event outboxes, log files, or error dumps.',
  },
  {
    question: 'How can I install and run Pidex today?',
    answer:
      'Because Pidex is currently in Beta, official distributions are provided as source code packages via GitHub Releases. You clone the repository or download the source archive, install dependencies with Bun (1.3.14), and build the Windows installer locally via "bun run package:win" or run in dev mode.',
  },
]
