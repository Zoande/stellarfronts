import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { buildFactions, colorToCss, type GalaxyPerspective } from '@/data/Factions';
import { GALAXY_MAP } from '@/data/GalaxyMap';
import { generateStarMap } from '@/data/StarMap';
import '../styles/Game.css';

interface GamePageProps {
  username: string;
}

export default function GamePage({ username }: GamePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);
  const [selectedPerspective, setSelectedPerspective] = useState<GalaxyPerspective | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [bootError, setBootError] = useState('');

  const factions = useMemo(() => {
    const cfg = GALAXY_MAP;
    const initialStars = generateStarMap(
      cfg.width,
      cfg.height,
      cfg.starCount,
      cfg.seed,
      cfg.minStarSpacing,
      cfg.shape,
    );
    return buildFactions(initialStars, cfg);
  }, []);

  useEffect(() => {
    if (!selectedPerspective || bootedRef.current || !containerRef.current) return;

    let cancelled = false;
    setIsBooting(true);
    setBootError('');

    import('../game/boot').then(({ boot }) => {
      if (cancelled || !containerRef.current) return;
      bootedRef.current = true;
      void boot(containerRef.current, { perspective: selectedPerspective })
        .catch((error: unknown) => {
          if (cancelled) return;
          setBootError(error instanceof Error ? error.message : 'Failed to start game');
          bootedRef.current = false;
        })
        .finally(() => {
          if (!cancelled) {
            setIsBooting(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPerspective]);

  const choosePerspective = (perspective: GalaxyPerspective) => {
    if (selectedPerspective || isBooting) return;
    setSelectedPerspective(perspective);
  };

  return (
    <div className="game-container" ref={containerRef}>
      <canvas id="renderCanvas"></canvas>
      {!selectedPerspective && !isBooting && (
        <div className="game-start-overlay">
          <div className="game-start-panel">
            <div className="game-start-eyebrow">Choose Perspective</div>
            <div className="game-start-title">Pick a color or observer mode</div>
            <div className="game-start-grid">
              <button
                type="button"
                className="game-start-choice game-start-observer"
                onClick={() => choosePerspective({ mode: 'observer' })}
              >
                Observer
              </button>
              {factions.map((faction) => (
                <button
                  key={faction.id}
                  type="button"
                  className="game-start-choice"
                  style={{ '--faction-color': colorToCss(faction.color) } as CSSProperties}
                  onClick={() => choosePerspective({ mode: 'faction', factionId: faction.id })}
                >
                  <span className="game-start-swatch" />
                  <span>{faction.name}</span>
                </button>
              ))}
            </div>
            <div className="game-start-hint">Fog of war uses the selected faction. Observer shows everything.</div>
          </div>
        </div>
      )}
      {isBooting && (
        <div className="game-start-overlay">
          <div className="game-start-panel game-start-loading">
            <div className="game-start-eyebrow">Loading</div>
            <div className="game-start-title">Starting {selectedPerspective?.mode === 'observer' ? 'Observer' : 'Faction'} view</div>
          </div>
        </div>
      )}
      {bootError && (
        <div className="game-error-banner">{bootError}</div>
      )}
      <div className="game-username">{username}</div>
    </div>
  );
}
