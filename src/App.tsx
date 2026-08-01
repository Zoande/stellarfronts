import { Component, lazy, Suspense } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { LoadingScreen } from './components/LoadingScreen';
import { UserErrorPage } from './components/UserErrorPage';
import { useAppFlow } from './hooks/useAppFlow';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const DevPage = lazy(() => import('./pages/DevPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
const BackgroundScene = lazy(() => import('./components/BackgroundScene'));

function RouteFallback() {
  return <div className="auth-container" aria-busy="true" />;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Client] Unhandled page error', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <UserErrorPage
          kind="unexpected"
          onPrimary={() => window.location.reload()}
          secondaryLabel="Home"
          onSecondary={() => window.location.assign('/')}
        />
      );
    }
    return this.props.children;
  }
}

function MainAppFlow() {
  const {
    authLoadingProgress,
    authLoadingDetail,
    authBackgroundReady,
    authSessionReady,
    authStartupError,
    showAuthStartupLoading,
    auth,
    homeTransition,
    handleAuthBackgroundProgress,
    handleAuthBackgroundReady,
    handleAuthStartupLoadingHidden,
    handleLoginSubmit,
    handleSignupSubmit,
    handleLogout,
    handleStartGameFromHome,
    homeTransitionTitle,
    handleHomeTransitionHidden,
  } = useAppFlow();

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const gameRouteMatch = currentPath.match(/^\/game\/([^/]+)$/);
  const gameId = gameRouteMatch?.[1] ? decodeURIComponent(gameRouteMatch[1]) : null;

  if (authStartupError) {
    return (
      <Router>
        <UserErrorPage
          kind="serviceUnavailable"
          onPrimary={() => window.location.reload()}
        />
      </Router>
    );
  }

  if ((gameId || currentPath === '/home') && authSessionReady && !auth.isLoggedIn) {
    return (
      <Router>
        <UserErrorPage
          kind="sessionExpired"
          primaryLabel="Sign In"
          onPrimary={() => window.location.assign('/')}
        />
      </Router>
    );
  }

  if (gameId && auth.isLoggedIn && auth.account) {
    return (
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <GamePage
            gameId={gameId}
            username={auth.account.username}
            accountType={auth.account.accountType}
            onLogout={handleLogout}
          />
        </Suspense>
      </Router>
    );
  }

  if (homeTransition.isActive) {
    const shouldRenderHomeBehindLoader = homeTransition.progress >= 82;

    return (
      <Router>
        {shouldRenderHomeBehindLoader && (
          <Suspense fallback={<RouteFallback />}>
            <HomePage
              account={auth.account ?? {
                id: 0,
                username: homeTransition.username,
                accountType: 'observer',
                factionId: null,
                createdAt: 0,
                updatedAt: 0,
              }}
              onContinuePlaying={handleStartGameFromHome}
            />
          </Suspense>
        )}
        <LoadingScreen
          theme="auth"
          subtitle="Command Link"
          title={homeTransitionTitle}
          progress={homeTransition.progress}
          detail={homeTransition.detail}
          isVisible={homeTransition.isVisible}
          onHidden={handleHomeTransitionHidden}
          zIndex={240}
        />
      </Router>
    );
  }

  if (auth.isLoggedIn && auth.mode === 'home') {
    return (
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <HomePage
            account={auth.account ?? { id: 0, username: '', accountType: 'observer', factionId: null, createdAt: 0, updatedAt: 0 }}
            onContinuePlaying={handleStartGameFromHome}
          />
        </Suspense>
      </Router>
    );
  }

  return (
    <Router>
      <div className="auth-container">
        <Suspense fallback={null}>
          <BackgroundScene
            onLoadProgress={handleAuthBackgroundProgress}
            onReady={handleAuthBackgroundReady}
          />
        </Suspense>

        {showAuthStartupLoading && (
          <LoadingScreen
            theme="auth"
            subtitle="Login Station"
            title="StellarFronts Login"
            progress={authLoadingProgress}
            detail={authLoadingDetail}
            isVisible={!(authBackgroundReady && authSessionReady)}
            onHidden={handleAuthStartupLoadingHidden}
            zIndex={220}
          />
        )}

        {authBackgroundReady && (
          <Suspense fallback={null}>
            <LoginPage
              onLoginSubmit={handleLoginSubmit}
              onSignupSubmit={handleSignupSubmit}
            />
          </Suspense>
        )}
      </div>
    </Router>
  );
}

function App() {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const isDevRoute = currentPath === '/dev' || currentPath.startsWith('/dev/');
  const isNewsRoute = currentPath === '/news' || currentPath.startsWith('/news/');
  const isPlayerRoute = currentPath === '/'
    || currentPath === '/home'
    || /^\/game\/[^/]+$/.test(currentPath);

  if (isDevRoute) {
    return (
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <DevPage />
        </Suspense>
      </Router>
    );
  }

  if (isNewsRoute) {
    return (
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <NewsPage />
        </Suspense>
      </Router>
    );
  }

  if (!isPlayerRoute) {
    return (
      <UserErrorPage
        kind="pageNotFound"
        primaryLabel="Go Home"
        onPrimary={() => window.location.assign('/')}
      />
    );
  }

  return <MainAppFlow />;
}

export default function AppWithErrorBoundary() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
