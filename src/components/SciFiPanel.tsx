import React from 'react';
import '../styles/SciFiPanel.css';

interface SciFiPanelProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'alert';
  glow?: boolean;
  className?: string;
}

/**
 * A sci-fi style panel component for space-themed UI elements
 * Used in both auth screens and game UI
 */
export const SciFiPanel: React.FC<SciFiPanelProps> = ({
  title,
  children,
  variant = 'primary',
  glow = true,
  className = ''
}) => {
  return (
    <div className={`scifi-panel scifi-panel--${variant} ${glow ? 'scifi-panel--glow' : ''} ${className}`}>
      {title && <div className="scifi-panel__header">{title}</div>}
      <div className="scifi-panel__content">{children}</div>
    </div>
  );
};

interface SciFiButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'small' | 'medium' | 'large';
  pulse?: boolean;
}

export const SciFiButton: React.FC<SciFiButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  pulse = false,
  className = '',
  ...props
}) => {
  const classes = [
    'scifi-button',
    `scifi-button--${variant}`,
    `scifi-button--${size}`,
    pulse && 'scifi-button--pulse',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={classes} {...props} />;
};

interface SciFiBarProps {
  label?: string;
  value: number;
  max?: number;
  variant?: 'health' | 'energy' | 'shield' | 'standard';
  showValue?: boolean;
}

export const SciFiBar: React.FC<SciFiBarProps> = ({
  label,
  value,
  max = 100,
  variant = 'standard',
  showValue = false,
}) => {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className="scifi-bar">
      {label && <div className="scifi-bar__label">{label}</div>}
      <div className={`scifi-bar__container scifi-bar__container--${variant}`}>
        <div
          className={`scifi-bar__fill scifi-bar__fill--${variant}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showValue && <div className="scifi-bar__value">{value}</div>}
    </div>
  );
};

interface SciFiBadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  pulse?: boolean;
}

export const SciFiBadge: React.FC<SciFiBadgeProps> = ({
  children,
  variant = 'primary',
  pulse = false,
}) => {
  return (
    <span
      className={`scifi-badge scifi-badge--${variant} ${pulse ? 'scifi-badge--pulse' : ''}`}
    >
      {children}
    </span>
  );
};

interface SciFiGridProps {
  children: React.ReactNode;
  columns?: number;
  gap?: 'small' | 'medium' | 'large';
}

export const SciFiGrid: React.FC<SciFiGridProps> = ({
  children,
  columns = 2,
  gap = 'medium',
}) => {
  return (
    <div
      className={`scifi-grid scifi-grid--${columns}col scifi-grid--${gap}gap`}
    >
      {children}
    </div>
  );
};
