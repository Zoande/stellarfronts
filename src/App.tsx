import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import SuccessPage from './pages/SuccessPage';
import GamePage from './pages/GamePage';

export interface AuthState {
  isLoggedIn: boolean;
  username: string;
  mode: 'login' | 'signup' | 'email-verify' | 'success';
}

function App() {
  const [auth, setAuth] = useState<AuthState>({
    isLoggedIn: false,
    username: '',
    mode: 'login',
  });

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
