import { useState } from 'react';
import '../styles/Auth.css';

interface LoginPageProps {
  onLoginSuccess: (username: string) => void;
  onSignupClick: () => void;
}

export default function LoginPage({ onLoginSuccess, onSignupClick }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }
    setError('');
    onLoginSuccess(username);
  };

  const handleOAuthClick = (provider: string) => {
    console.log(`OAuth: ${provider}`);
    onLoginSuccess(`user_${provider}`);
  };

  return (
    <div className="auth-container">
      <div className="stars-bg"></div>
      
      <div className="auth-panel">
        <div className="auth-header">
          <h1 className="stellar-title">StellarFronts</h1>
          <p className="auth-subtitle">Command Your Destiny</p>
        </div>

        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="form-input"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary">
            Log In
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <div className="oauth-buttons">
          <button
            type="button"
            onClick={() => handleOAuthClick('google')}
            className="btn btn-oauth btn-google"
          >
            <span className="oauth-icon">🔵</span> Google
          </button>
          <button
            type="button"
            onClick={() => handleOAuthClick('outlook')}
            className="btn btn-oauth btn-outlook"
          >
            <span className="oauth-icon">📧</span> Outlook
          </button>
        </div>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <button
              type="button"
              onClick={onSignupClick}
              className="link-button"
            >
              Create one
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
