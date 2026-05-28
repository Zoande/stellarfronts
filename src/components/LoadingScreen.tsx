import { useEffect, useState } from 'react';
import '../styles/LoadingScreen.css';

interface LoadingScreenProps {
  title: string;
  subtitle: string;
  detail: string;
  progress: number;
  theme?: 'auth' | 'game';
  isVisible?: boolean;
  onHidden?: () => void;
  zIndex?: number;
  exitDurationMs?: number;
}

export function LoadingScreen({
  title,
  subtitle,
  detail,
  progress,
  theme = 'auth',
  isVisible = true,
  onHidden,
  zIndex,
  exitDurationMs = 520,
}: LoadingScreenProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const [shouldRender, setShouldRender] = useState(true);
  const stages = theme === 'auth'
    ? ['Decode assets', 'Align relay', 'Warm models', 'Open bridge']
    : ['Connect', 'Synchronize', 'Load systems', 'Enter sector'];
  const activeStageIndex = Math.min(stages.length - 1, Math.floor((clampedProgress / 100) * stages.length));

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false);
      onHidden?.();
    }, exitDurationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [exitDurationMs, isVisible, onHidden]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`loading-screen loading-screen--${theme} ${isVisible ? 'loading-screen--visible' : 'loading-screen--exiting'}`}
      style={zIndex !== undefined ? { zIndex } : undefined}
      aria-hidden={!isVisible}
    >
      <div className="loading-screen__backdrop">
        <div className="loading-screen__stars" />
        <div className="loading-screen__route loading-screen__route--wide" />
        <div className="loading-screen__route loading-screen__route--near" />
        <div className="loading-screen__grid" />
      </div>
      <div className="loading-screen__panel">
        <div className="loading-screen__visual" aria-hidden="true">
          <img
            className="loading-screen__insignia"
            src="/branding/stellarfrontslogonotext-transparent.png"
            alt=""
            width="160"
            height="160"
          />
          <div className="loading-screen__relay" />
          <img
            className="loading-screen__ship"
            src="/textures/own_ship_icon.webp"
            alt=""
            width="160"
            height="100"
          />
          <div className="loading-screen__scan" />
          <div className="loading-screen__beacon loading-screen__beacon--one" />
          <div className="loading-screen__beacon loading-screen__beacon--two" />
        </div>
        <div className="loading-screen__content">
          <div className="loading-screen__eyebrow">{subtitle}</div>
          <h1 className="loading-screen__title">{title}</h1>
          <div className="loading-screen__meta" aria-label="Loading status">
            <span>Secure relay</span>
            <span>Asset stream</span>
            <span>Command UI</span>
          </div>
          <div
            className="loading-screen__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clampedProgress)}
          >
            <div className="loading-screen__fill" style={{ width: `${clampedProgress}%` }} />
          </div>
          <div className="loading-screen__detail">{detail}</div>
          <div className="loading-screen__percent">{Math.round(clampedProgress)}%</div>
          <ol className="loading-screen__stages" aria-label="Loading stages">
            {stages.map((stage, index) => (
              <li
                key={stage}
                className={index <= activeStageIndex ? 'loading-screen__stage loading-screen__stage--active' : 'loading-screen__stage'}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {stage}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
