import { useEffect, useRef, useState } from 'react';
import { GameLogoutButton } from '@/components/GameLogoutButton';
import { LoadingScreen } from '@/components/LoadingScreen';
import '../styles/Game.css';

interface GamePageProps {
  username: string;
  onLogout: () => void;
}

export default function GamePage({ username, onLogout }: GamePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);
  const bootStartedAtRef = useRef(0);
  const bootHideTimerRef = useRef<number | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [showBootLoading, setShowBootLoading] = useState(false);
  const [bootError, setBootError] = useState('');
  const [bootProgress, setBootProgress] = useState(0);
  const [bootDetail, setBootDetail] = useState('Preparing galaxy map');

  const clearBootHideTimer = () => {
    if (bootHideTimerRef.current !== null) {
      window.clearTimeout(bootHideTimerRef.current);
      bootHideTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (bootedRef.current || !containerRef.current) return;

    let cancelled = false;
    let bootFailed = false;
    let cleanupBoot: (() => void) | null = null;
    clearBootHideTimer();
    bootStartedAtRef.current = window.performance.now();
    setIsBooting(true);
    setShowBootLoading(true);
    setBootError('');
    setBootProgress(0);
    setBootDetail('Preparing galaxy map');

    const hideBootLoading = (delayMs = 500) => {
      clearBootHideTimer();
      bootHideTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setIsBooting(false);
      }, delayMs);
    };

    import('../game/boot')
      .then(({ boot }) => {
        if (cancelled || !containerRef.current) return;
        bootedRef.current = true;
        void boot(containerRef.current, {
          onProgress: (progress, detail) => {
            if (cancelled) return;
            setBootProgress(progress * 100);
            setBootDetail(detail);
          },
        })
          .then((cleanup) => {
            cleanupBoot = cleanup;
            if (cancelled) {
              cleanupBoot?.();
              cleanupBoot = null;
            }
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            bootFailed = true;
            const errorMsg = error instanceof Error ? error.message : 'Failed to start game';
            console.error('Game boot error:', errorMsg, error);
            setBootError(errorMsg);
            bootedRef.current = false;
            hideBootLoading(0);
          })
          .finally(() => {
            if (!cancelled && !bootFailed) hideBootLoading(500);
          });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        bootFailed = true;
        const errorMsg = error instanceof Error ? error.message : 'Failed to load game boot module';
        console.error('Game module load error:', errorMsg, error);
        setBootError(errorMsg);
        hideBootLoading(0);
      });

    return () => {
      cancelled = true;
      clearBootHideTimer();
      cleanupBoot?.();
    };
  }, []);

  return (
    <div className="game-container" ref={containerRef}>
      <canvas id="renderCanvas"></canvas>
      <GameLogoutButton onLogout={onLogout} />
      {showBootLoading && (
        <LoadingScreen
          theme="game"
          subtitle="Galaxy Command"
          title="Entering Command View"
          progress={bootProgress}
          detail={bootDetail}
          isVisible={isBooting}
          onHidden={() => setShowBootLoading(false)}
          zIndex={210}
        />
      )}
      {bootError && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#1a1a2e',
          border: '2px solid #ff4444',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '500px',
          color: '#ffffff',
          zIndex: 300,
          fontFamily: 'monospace',
          fontSize: '14px',
          lineHeight: '1.6',
          boxShadow: '0 0 20px rgba(255, 68, 68, 0.3)',
        }}>
          <div style={{ marginBottom: '12px', fontWeight: 'bold', color: '#ff6666' }}>⚠ Game Launch Error</div>
          <div style={{ marginBottom: '16px', wordBreak: 'break-word' }}>{bootError}</div>
          <div style={{ fontSize: '12px', color: '#aaaaaa' }}>
            Make sure you've run: <code style={{ backgroundColor: '#0f0f1e', padding: '2px 6px' }}>npm run dev:all</code>
          </div>
        </div>
      )}
      <div className="game-username">{username}</div>
    </div>
  );
}
