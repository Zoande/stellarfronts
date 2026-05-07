import { useState } from 'react';
import '../styles/Auth.css';

interface EmailVerificationPageProps {
  onVerified: () => void;
  username: string;
}

export default function EmailVerificationPage({
  onVerified,
  username,
}: EmailVerificationPageProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!code.trim()) {
      setError('Please enter the verification code');
      return;
    }

    setError('');
    onVerified();
  };

  return (
    <div className="auth-panel">
      <div className="auth-header">
        <h1 className="stellar-title">Verify Email</h1>
        <p className="auth-subtitle">Check your inbox for a verification code</p>
      </div>

      <div className="verify-message">
        <p>We've sent a verification code to your email.</p>
        <p>Enter the code below to activate your account.</p>
      </div>

      <form onSubmit={handleVerify} className="auth-form">
        <div className="form-group">
          <label htmlFor="verification-code">Verification Code</label>
          <input
            id="verification-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter 6-digit code"
            maxLength={6}
            className="form-input code-input"
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn btn-primary">
          Verify
        </button>
      </form>

      <div className="auth-footer">
        <p className="text-muted">
          Didn't receive a code?{' '}
          <button type="button" className="link-button">
            Resend
          </button>
        </p>
      </div>
    </div>
  );
}
