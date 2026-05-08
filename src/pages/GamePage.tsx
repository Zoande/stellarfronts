import { useEffect, useRef, useState } from 'react';
import type { GalaxyPerspective } from '@/data/Factions';
import { LoadingScreen } from '@/components/LoadingScreen';
import '../styles/Game.css';

interface GamePageProps {
  username: string;
  selectedPerspective: GalaxyPerspective;
}

export default function GamePage({ username, selectedPerspective }: GamePageProps) {
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
          perspective: selectedPerspective,
          onProgress: (progress, detail) => {
            if (cancelled) return;
            setBootProgress(progress * 100);
            setBootDetail(detail);
          },
        })
          .catch((error: unknown) => {
            if (cancelled) return;
            bootFailed = true;
            setBootError(error instanceof Error ? error.message : 'Failed to start game');
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
        setBootError(error instanceof Error ? error.message : 'Failed to load game boot module');
        hideBootLoading(0);
      });

    return () => {
      cancelled = true;
      clearBootHideTimer();
    };
  }, [selectedPerspective]);

  return (
    <div className="game-container" ref={containerRef}>
      <canvas id="renderCanvas"></canvas>
      {showBootLoading && (
        <LoadingScreen
          theme="game"
          subtitle="Galaxy Command"
          title={`Entering ${selectedPerspective?.mode === 'observer' ? 'Observer' : 'Faction'} View`}
          progress={bootProgress}
          detail={bootDetail}
          isVisible={isBooting}
          onHidden={() => setShowBootLoading(false)}
          zIndex={210}
        />
      )}
      {bootError && (
        <div className="game-error-banner">{bootError}</div>
      )}
      <div className="game-username">{username}</div>
    </div>
  );
}
