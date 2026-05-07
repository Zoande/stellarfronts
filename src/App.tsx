import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import SuccessPage from './pages/SuccessPage';
import GamePage from './pages/GamePage';
import { LoadingScreen } from './components/LoadingScreen';
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

  if (!authAssetsReady) {
    return (
      <LoadingScreen
        theme="auth"
        subtitle="Startup"
        title="Loading login environment"
        progress={authLoadingProgress}
        detail={authLoadingDetail}
      />
    );
  }

  return (
    <Router>
      <Routes>
        {auth.isLoggedIn ? (
          <Route path="/game" element={<GamePage username={auth.username} />} />
        ) : null}

        {/* Auth pages */}
        {auth.mode === 'login' && (
          <Route
            path="/"
            element={
              <LoginPage
                onLoginSuccess={handleLoginSuccess}
                onSignupClick={handleSignupClick}
              />
            }
          />
        )}

        {auth.mode === 'signup' && (
          <Route
            path="/"
            element={
              <SignupPage
                onSignupSubmit={handleSignupSubmit}
                onBackToLogin={handleBackToLogin}
              />
            }
          />
        )}

        {auth.mode === 'email-verify' && (
          <Route
            path="/"
            element={
              <EmailVerificationPage
                onVerified={handleEmailVerified}
                username={auth.username}
              />
            }
          />
        )}

        {auth.mode === 'success' && !auth.isLoggedIn && (
          <Route
            path="/"
            element={
              <SuccessPage
                message="Account created successfully!"
                onEnterGame={handleEnterGame}
              />
            }
          />
        )}

        {auth.isLoggedIn && auth.mode === 'success' && (
          <Route
            path="/"
            element={
              <SuccessPage
                message={`Welcome back, ${auth.username}!`}
                onEnterGame={handleEnterGame}
              />
            }
          />
        )}

        {auth.isLoggedIn && (
          <Route path="/game" element={<GamePage username={auth.username} />} />
        )}

        {/* Catch all - redirect to home or game */}
        <Route
          path="*"
          element={<Navigate to={auth.isLoggedIn ? '/game' : '/'} replace />}
        />
      </Routes>
    </Router>
  );
}

export default App;
