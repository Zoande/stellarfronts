import { BrowserRouter as Router } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import GamePage from './pages/GamePage';
import HomePage from './pages/HomePage';
import { LoadingScreen } from './components/LoadingScreen';
import { useAppFlow } from './hooks/useAppFlow';

function App() {
  const {
    authLoadingProgress,
    authLoadingDetail,
    authBackgroundReady,
    authSessionReady,
    showAuthStartupLoading,
    auth,
    homeTransition,
    handleAuthStartupLoadingHidden,
    handleLoginSubmit,
    handleGuestMode,
    handleSignupClick,
    handleBackToLogin,
    handleSignupSubmit,
    handleLogout,
    handleStartGameFromHome,
    homeTransitionTitle,
    handleHomeTransitionHidden,
  } = useAppFlow();

  const isGameRoute = typeof window !== 'undefined' && window.location.pathname === '/game';

  if (isGameRoute && auth.isLoggedIn && auth.account) {
    return (
      <Router>
        <GamePage username={auth.account.username} onLogout={handleLogout} />
        <Analytics />
      </Router>
    );
  }

  if (homeTransition.isActive) {
    const shouldRenderHomeBehindLoader = homeTransition.progress >= 68;

    return (
      <Router>
        {shouldRenderHomeBehindLoader && (
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
        )}
        <LoadingScreen
          theme="game"
          subtitle="Transit Corridor"
          title={homeTransitionTitle}
          progress={homeTransition.progress}
          detail={homeTransition.detail}
          isVisible={homeTransition.isVisible}
          onHidden={handleHomeTransitionHidden}
          zIndex={240}
          exitDurationMs={760}
        />
        <Analytics />
      </Router>
    );
  }

  if (auth.isLoggedIn && auth.mode === 'home') {
    return (
      <Router>
        <HomePage
          account={auth.account ?? { id: 0, username: '', accountType: 'observer', factionId: null, createdAt: 0, updatedAt: 0 }}
          onContinuePlaying={handleStartGameFromHome}
        />
        <Analytics />
      </Router>
    );
  }

  return (
    <Router>
      <div className="auth-container">
        {showAuthStartupLoading && (
          <LoadingScreen
            theme="auth"
            subtitle="Docking Relay"
            title="Aligning Command Uplink"
            progress={authLoadingProgress}
            detail={authLoadingDetail}
            isVisible={!(authBackgroundReady && authSessionReady)}
            onHidden={handleAuthStartupLoadingHidden}
            zIndex={220}
            exitDurationMs={760}
          />
        )}

        {authBackgroundReady && (auth.mode === 'signup'
          ? (
            <SignupPage
              onSignupSubmit={handleSignupSubmit}
              onBackToLogin={handleBackToLogin}
            />
          )
          : (
            <LoginPage
              onLoginSubmit={handleLoginSubmit}
              onSignupClick={handleSignupClick}
              onGuestMode={handleGuestMode}
            />
          ))}
      </div>
      <Analytics />
    </Router>
  );
}

export default App;
