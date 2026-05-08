import { BrowserRouter as Router } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import SuccessPage from './pages/SuccessPage';
import GamePage from './pages/GamePage';
import { LoadingScreen } from './components/LoadingScreen';
import BackgroundScene from './components/BackgroundScene';
import { preloadAuthAssets } from './utils/preloadAuthAssets';

export interface AuthState {
  isLoggedIn: boolean;
  username: string;
  mode: 'login' | 'signup' | 'email-verify' | 'success';
}

function App() {
  const [authLoadingProgress, setAuthLoadingProgress] = useState(0);
  const [authLoadingDetail, setAuthLoadingDetail] = useState('Preparing auth assets');
  const [authAssetsReady, setAuthAssetsReady] = useState(false);
  const [authBackgroundReady, setAuthBackgroundReady] = useState(false);
  const [showAuthStartupLoading, setShowAuthStartupLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    isLoggedIn: false,
    username: '',
    mode: 'login',
  });

  useEffect(() => {
    let cancelled = false;

    void preloadAuthAssets((state) => {
      if (cancelled) return;
      setAuthLoadingProgress(state.progress * 100);
      setAuthLoadingDetail(state.detail);
    }).then(() => {
      if (cancelled) return;
      setAuthAssetsReady(true);
      setAuthLoadingProgress(100);
      setAuthLoadingDetail('Auth background assets are ready');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthBackgroundProgress = useCallback((progress: number, detail: string) => {
    setAuthLoadingProgress(progress * 100);
    setAuthLoadingDetail(detail);
  }, []);

  const handleAuthBackgroundReady = useCallback(() => {
    setAuthBackgroundReady(true);
    setAuthLoadingProgress(100);
    setAuthLoadingDetail('Login background is ready');
  }, []);

  const handleAuthStartupLoadingHidden = useCallback(() => {
    setShowAuthStartupLoading(false);
  }, []);

  const handleLoginSuccess = (username: string) => {
    setAuth({
      isLoggedIn: true,
      username,
      mode: 'success',
    });
  };

  const handleSignupClick = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'signup',
    }));
  };

  const handleBackToLogin = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'login',
    }));
  };

  const handleSignupSubmit = (email: string, username: string) => {
    setAuth({
      isLoggedIn: false,
      username,
      mode: 'email-verify',
    });
  };

  const handleEmailVerified = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'success',
      isLoggedIn: true,
    }));
  };

  const handleEnterGame = () => {
    setAuth((prev) => ({
      ...prev,
      isLoggedIn: true,
    }));
  };

  const isGameRoute = typeof window !== 'undefined' && window.location.pathname === '/game';

  const authScreen = auth.mode === 'signup'
    ? (
      <SignupPage
        onSignupSubmit={handleSignupSubmit}
        onBackToLogin={handleBackToLogin}
      />
    )
    : auth.mode === 'email-verify'
      ? (
        <EmailVerificationPage
          onVerified={handleEmailVerified}
          username={auth.username}
        />
      )
      : auth.mode === 'success'
        ? (
          <SuccessPage
            message={auth.isLoggedIn ? `Welcome back, ${auth.username}!` : 'Account created successfully!'}
            onEnterGame={handleEnterGame}
          />
        )
        : (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onSignupClick={handleSignupClick}
          />
        );

  if (isGameRoute && auth.isLoggedIn) {
    return (
      <Router>
        <GamePage username={auth.username} />
      </Router>
    );
  }

  return (
    <Router>
      <div className="auth-container">
        <BackgroundScene
          onLoadProgress={handleAuthBackgroundProgress}
          onReady={handleAuthBackgroundReady}
        />

        {showAuthStartupLoading && (
          <LoadingScreen
            theme="auth"
            subtitle="Startup"
            title="Loading login environment"
            progress={authLoadingProgress}
            detail={authLoadingDetail}
            isVisible={!authBackgroundReady}
            onHidden={handleAuthStartupLoadingHidden}
            zIndex={220}
          />
        )}

        {authBackgroundReady && authScreen}
      </div>
    </Router>
  );
}

export default App;
