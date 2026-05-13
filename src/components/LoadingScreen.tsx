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
  const operationLabel = theme === 'game' ? 'Cygnus Transit' : 'Kepler Docking';
  const stageLabel = clampedProgress < 30
    ? 'Calibrating'
    : clampedProgress < 65
      ? 'Synchronizing'
      : clampedProgress < 100
        ? 'Clearing approach'
        : 'Ready';
  const telemetry = theme === 'game'
    ? ['Route', 'Escort', 'Signal']
    : ['Relay', 'Identity', 'Signal'];
  const telemetryValues = theme === 'game'
    ? ['Cygnus Prime', 'Helios Wing', 'Stable']
    : ['Dock Seven', 'Commander Sync', 'Stable'];

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
        <div className="loading-screen__orb loading-screen__orb--one" />
        <div className="loading-screen__orb loading-screen__orb--two" />
        <div className="loading-screen__grid" />
      </div>
      <div className="loading-screen__panel">
        <div className="loading-screen__visual" aria-hidden="true">
          <div className="loading-screen__visual-grid" />
          <div className="loading-screen__planet" />
          <div className="loading-screen__ring" />
          <div className="loading-screen__carrier loading-screen__carrier--one" />
          <div className="loading-screen__carrier loading-screen__carrier--two" />
          <div className="loading-screen__spark loading-screen__spark--one" />
          <div className="loading-screen__spark loading-screen__spark--two" />
        </div>
        <div className="loading-screen__content">
          <div className="loading-screen__topline">
            <div className="loading-screen__eyebrow">{subtitle}</div>
            <div className="loading-screen__status">{stageLabel}</div>
          </div>
          <h1 className="loading-screen__title">{title}</h1>
          <div className="loading-screen__operation">
            <span>Operation</span>
            <strong>{operationLabel}</strong>
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
          <div className="loading-screen__footer">
            <div className="loading-screen__telemetry">
              {telemetry.map((label, index) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{telemetryValues[index]}</strong>
                </div>
              ))}
            </div>
            <div className="loading-screen__percent">{Math.round(clampedProgress)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
