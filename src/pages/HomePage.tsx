import { useMemo, useState, type CSSProperties } from 'react';
import { buildFactions, colorToCss, type GalaxyPerspective } from '@/data/Factions';
import { GALAXY_MAP } from '@/data/GalaxyMap';
import { generateStarMap } from '@/data/StarMap';
import '../styles/Home.css';

interface HomePageProps {
  username: string;
  onContinuePlaying: (perspective: GalaxyPerspective) => void;
}

export default function HomePage({ username, onContinuePlaying }: HomePageProps) {
  const [showPerspectiveOverlay, setShowPerspectiveOverlay] = useState(false);
  const [pendingPerspective, setPendingPerspective] = useState<GalaxyPerspective>({ mode: 'observer' });

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
    return buildFactions(initialStars, cfg).slice(0, 8);
  }, []);

  const openContinueOverlay = () => {
    setPendingPerspective({ mode: 'observer' });
    setShowPerspectiveOverlay(true);
  };

  const launchSelectedPerspective = () => {
    onContinuePlaying(pendingPerspective);
    setShowPerspectiveOverlay(false);
  };

  return (
    <div className="home-page">
      <div className="home-shell">
        <header className="home-top-nav">
          <button type="button" className="home-top-link is-active">Home</button>
          <button type="button" className="home-top-link">Fleet</button>
          <button type="button" className="home-top-link">Ranking</button>
          <button type="button" className="home-top-link">Alliance</button>
          <button type="button" className="home-top-link">Shop</button>
        </header>

        <section className="home-tabs">
          <button type="button" className="home-tab is-active">Overview</button>
          <button type="button" className="home-tab">News</button>
          <button type="button" className="home-tab">Messages</button>
        </section>

        <main className="home-grid">
          <section className="home-card home-profile">
            <h2 className="home-card-title">Command Overview</h2>
            <div className="home-profile-row">
              <div className="home-avatar">
                <div className="home-avatar-icon">◆</div>
                <div className="home-avatar-name">{username}</div>
              </div>
              <div className="home-stat">
                <div className="home-stat-label">Navigator Rank</div>
                <div className="home-stat-value">Stellar Vanguard</div>
                <div className="home-progress">
                  <span style={{ width: '48%' }} />
                </div>
                <div className="home-progress-meta">4,820 / 10,000</div>
              </div>
              <div className="home-stat">
                <div className="home-stat-label">Survey Contracts</div>
                <div className="home-stat-value">12 Complete</div>
                <div className="home-progress">
                  <span style={{ width: '66%' }} />
                </div>
                <div className="home-progress-meta">66 / 100</div>
              </div>
            </div>
          </section>

          <section className="home-card home-action">
            <h2 className="home-card-title">Ready For Launch?</h2>
            <p className="home-action-subtitle">Warp into your assigned sector and resume command.</p>
            <button type="button" className="home-launch-btn" onClick={openContinueOverlay}>
              Continue Playing
            </button>
          </section>

          <section className="home-card home-continue">
            <h2 className="home-card-title">Continue Playing</h2>
            <div className="home-server-row">
              <div>
                <div className="home-server-name">EU-Cygnus Prime</div>
                <div className="home-server-meta">Status: Online - 124 Commanders Active</div>
              </div>
              <button type="button" className="home-secondary-btn" onClick={openContinueOverlay}>
                Continue
              </button>
            </div>
          </section>

          <section className="home-card home-events">
            <h2 className="home-card-title">Events</h2>
            <div className="home-event-grid">
              <article className="home-event">
                <div className="home-event-header">Current Event</div>
                <div className="home-event-name">Nebula Frontline</div>
                <div className="home-event-meta">Ends in 02:13:34:58</div>
              </article>
              <article className="home-event">
                <div className="home-event-header">Rotation</div>
                <div className="home-event-name">Outer Rim Siege</div>
                <div className="home-event-meta">Ends in 02:13:34:58</div>
              </article>
            </div>
          </section>
        </main>
      </div>

      {showPerspectiveOverlay && (
        <div className="home-overlay-backdrop">
          <div className="home-overlay">
            <h3>Select Perspective</h3>
            <p>Choose observer or a faction color before entering the game.</p>
            <div className="home-perspective-grid">
              <button
                type="button"
                className={`home-perspective-btn ${pendingPerspective.mode === 'observer' ? 'is-selected' : ''}`}
                onClick={() => setPendingPerspective({ mode: 'observer' })}
              >
                Observer
              </button>
              {factions.map((faction) => (
                <button
                  key={faction.id}
                  type="button"
                  className={`home-perspective-btn ${pendingPerspective.mode === 'faction' && pendingPerspective.factionId === faction.id ? 'is-selected' : ''}`}
                  style={{ '--faction-color': colorToCss(faction.color) } as CSSProperties}
                  onClick={() => setPendingPerspective({ mode: 'faction', factionId: faction.id })}
                >
                  <span className="home-perspective-swatch" />
                  {faction.name}
                </button>
              ))}
            </div>
            <div className="home-overlay-actions">
              <button type="button" className="home-secondary-btn" onClick={() => setShowPerspectiveOverlay(false)}>
                Cancel
              </button>
              <button type="button" className="home-launch-btn" onClick={launchSelectedPerspective}>
                Enter Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
