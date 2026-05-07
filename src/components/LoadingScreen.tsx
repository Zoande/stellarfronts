import '../styles/LoadingScreen.css';

interface LoadingScreenProps {
  title: string;
  subtitle: string;
  detail: string;
  progress: number;
  theme?: 'auth' | 'game';
}

export function LoadingScreen({
  title,
  subtitle,
  detail,
  progress,
  theme = 'auth',
}: LoadingScreenProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className={`loading-screen loading-screen--${theme}`}>
      <div className="loading-screen__backdrop">
        <div className="loading-screen__orb loading-screen__orb--one" />
        <div className="loading-screen__orb loading-screen__orb--two" />
        <div className="loading-screen__grid" />
      </div>
      <div className="loading-screen__panel">
        <div className="loading-screen__visual" aria-hidden="true">
          <div className="loading-screen__planet" />
          <div className="loading-screen__ring" />
          <div className="loading-screen__spark loading-screen__spark--one" />
          <div className="loading-screen__spark loading-screen__spark--two" />
        </div>
        <div className="loading-screen__content">
          <div className="loading-screen__eyebrow">{subtitle}</div>
          <h1 className="loading-screen__title">{title}</h1>
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
        </div>
      </div>
    </div>
  );
}