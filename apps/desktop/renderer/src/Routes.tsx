import { GitBoardPageFallback } from './features/git-board/GitBoardSkeleton.js'
import { ProvidersPageFallback } from './features/models/ModelCenterInitialSkeleton.js'
import { lazy, Suspense, type ReactNode } from 'react'
import { GitBoardProvider } from './features/git-board/GitBoardContext.js'
import { createHashRouter, Navigate, useLocation } from 'react-router-dom'
import { DesktopSettingsProvider } from './features/settings/UseDesktopSettings.js'
import { DesktopLayout } from './features/layout/shell/DesktopLayout.js'
import { QuickChatView } from './features/session/QuickChatView.js'
import { NotFoundPage } from './features/routing/NotFoundPage.js'
import { RouteErrorPage } from './features/routing/RouteErrorPage.js'
import { RequireConfiguredModel } from './features/models/setup/RequireConfiguredModel.js'
import { AutomationView } from './features/automation/AutomationView.js'
import { ConversationPage } from './features/session/conversation/ConversationPage.js'
import { PendingSubmissionPage } from './features/session/conversation/PendingSubmissionPage.js'
import { PluginsView } from './features/plugins/PluginsView.js'
import { ProjectsView } from './features/projects/ProjectsView.js'
import { PullRequestsPlaceholder } from './features/pull-requests/PullRequestsPlaceholder.js'
import { ModelSetupPage } from './features/models/setup/ModelSetupPage.js'
import { SettingsLayout } from './features/settings/SettingsLayout.js'
import { PetCatalogPage } from './features/pet/PetCatalogPage.js'
import { PetCatalogProvider } from './features/pet/PetCatalogProvider.js'
import { SessionGroupsView } from './features/session-groups/SessionGroupsView.js'
import { legacyWorkflowRedirectPath } from './features/routing/WorkflowRoutes.js'
import { providerWorkspaceTarget } from './features/models/ModelCenterState.js'

const GitBoardView = lazy(() =>
  import('./features/git-board/GitBoardView.js').then((module) => ({
    default: module.GitBoardView,
  })),
)

const PetOverlayPage = lazy(() =>
  import('./features/pet/PetOverlayPage.js').then((module) => ({
    default: module.PetOverlayPage,
  })),
)

const ProvidersView = lazy(() =>
  import('./features/models/ProvidersView.js').then((module) => ({
    default: module.ProvidersView,
  })),
)

function LegacyModelsRedirect(): ReactNode {
  const location = useLocation()
  return <Navigate replace to={providerWorkspaceTarget(location.search)} />
}

function LegacySettingsProvidersRedirect(): ReactNode {
  const location = useLocation()
  return <Navigate replace to={providerWorkspaceTarget(location.search)} />
}

function LegacyWorkflowRedirect(): ReactNode {
  const location = useLocation()
  return <Navigate replace to={legacyWorkflowRedirectPath(location.pathname, location.search)} />
}

const routeErrorElement = <RouteErrorPage />

const router = createHashRouter([
  {
    path: '/pet-overlay',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-only">
        <Suspense fallback={null}>
          <PetOverlayPage />
        </Suspense>
      </DesktopSettingsProvider>
    ),
  },
  {
    path: '/setup',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-write">
        <ModelSetupPage />
      </DesktopSettingsProvider>
    ),
  },
  {
    path: '/',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-write">
        <RequireConfiguredModel />
      </DesktopSettingsProvider>
    ),
    children: [
      {
        element: (
          <PetCatalogProvider>
            <GitBoardProvider>
              <DesktopLayout />
            </GitBoardProvider>
          </PetCatalogProvider>
        ),
        children: [
          { index: true, element: <Navigate to="/new" replace /> },
          { path: 'new', element: <QuickChatView /> },
          { path: 'threads/:threadId', element: <ConversationPage /> },
          { path: 'pending/:submissionId', element: <PendingSubmissionPage /> },
          { path: 'projects', element: <ProjectsView /> },
          { path: 'projects/:projectId', element: <ProjectsView /> },
          { path: 'workflows', element: <SessionGroupsView /> },
          { path: 'workflows/:groupId', element: <SessionGroupsView /> },
          { path: 'session-groups', element: <LegacyWorkflowRedirect /> },
          { path: 'session-groups/:groupId', element: <LegacyWorkflowRedirect /> },
          { path: 'models', element: <LegacyModelsRedirect /> },
          {
            path: 'providers',
            element: (
              <Suspense fallback={<ProvidersPageFallback />}>
                <ProvidersView />
              </Suspense>
            ),
          },
          {
            path: 'git',
            element: (
              <Suspense fallback={<GitBoardPageFallback />}>
                <GitBoardView />
              </Suspense>
            ),
          },
          { path: 'plugins', element: <PluginsView /> },
          { path: 'pull-requests', element: <PullRequestsPlaceholder /> },
          { path: 'automations', element: <AutomationView /> },
          { path: 'pets', element: <PetCatalogPage /> },
          {
            path: 'settings/providers',
            element: <LegacySettingsProvidersRedirect />,
          },
          {
            path: 'settings/environment/:projectId',
            element: <SettingsLayout />,
          },
          { path: 'settings/:tab', element: <SettingsLayout /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

export { router }
