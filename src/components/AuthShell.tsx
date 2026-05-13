import type { ReactNode } from 'react';
import loginBackdrop from '../../background login.png';
import stellarLogo from '../../logosteller.png';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  copy: string;
  highlights: string[];
  children: ReactNode;
}

export function AuthShell({ eyebrow, title, subtitle, copy, highlights, children }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <div className="auth-shell__backdrop" aria-hidden="true">
        <img src={loginBackdrop} alt="" />
      </div>
      <div className="auth-shell__starfield" aria-hidden="true">
        <span className="auth-shell__star auth-shell__star--one" />
        <span className="auth-shell__star auth-shell__star--two" />
        <span className="auth-shell__star auth-shell__star--three" />
        <span className="auth-shell__star auth-shell__star--four" />
      </div>
      <div className="auth-shell__traffic" aria-hidden="true">
        <span className="auth-shell__traffic-lane auth-shell__traffic-lane--alpha">
          <span className="auth-shell__ship" />
        </span>
        <span className="auth-shell__traffic-lane auth-shell__traffic-lane--beta">
          <span className="auth-shell__ship" />
        </span>
        <span className="auth-shell__traffic-lane auth-shell__traffic-lane--gamma">
          <span className="auth-shell__ship" />
        </span>
      </div>
      <div className="auth-shell__veil" aria-hidden="true" />

      <div className="auth-shell__grid">
        <section className="auth-hero" aria-label={`${title} introduction`}>
          <p className="auth-hero-eyebrow">{eyebrow}</p>

          <img
            src={stellarLogo}
            alt={title}
            className="auth-hero-logo"
          />

          <p className="auth-hero-tagline">The frontier is yours</p>
          <p className="auth-hero-subtitle">{subtitle}</p>
          <p className="auth-hero-copy">{copy}</p>

          <div className="auth-hero-highlights" aria-label="Frontier highlights">
            {highlights.map((item) => (
              <div key={item} className="auth-hero-highlight">
                <span className="auth-hero-highlight-dot" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="auth-hero-status" aria-label="Frontier status">
            <div>
              <span>Sector</span>
              <strong>Kepler Veil</strong>
            </div>
            <div>
              <span>Traffic</span>
              <strong>Convoys inbound</strong>
            </div>
            <div>
              <span>Condition</span>
              <strong>Blue alert</strong>
            </div>
          </div>
        </section>

        <section className="auth-panel auth-panel--landing">
          {children}
        </section>
      </div>
    </div>
  );
}
