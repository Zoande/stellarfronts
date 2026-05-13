import { useMemo, useState } from 'react';
import { buildFactions } from '@/data/Factions';
import { GALAXY_MAP } from '@/data/GalaxyMap';
import { generateStarMap } from '@/data/StarMap';
import type { AuthAccount } from '@/auth/types';
import lobbyBackdrop from '../../backgroudn lobby.png';
import stellarLogo from '../../logosteller.png';
import '../styles/Home.css';

interface HomePageProps {
  account: AuthAccount;
  onContinuePlaying: () => void;
}

type NavId = 'home' | 'missions' | 'hangar' | 'market' | 'faction' | 'leaderboards';
type ModeId = 'play' | 'campaign' | 'multiplayer' | 'events' | 'faction' | 'map';

interface NavItem {
  id: NavId;
  label: string;
  status: string;
}

interface ModeCard {
  id: ModeId;
  title: string;
  subtitle: string;
  kicker: string;
  headline: string;
  description: string;
  primaryAction: string;
  secondaryAction: string;
  brief: string;
  sector: string;
  fleetStatus: string;
  threat: string;
  icon: ModeId;
  newsId: string;
  navId: NavId;
  launchesGame?: boolean;
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', status: 'Frontier overview' },
  { id: 'missions', label: 'Missions', status: 'Operational queue' },
  { id: 'hangar', label: 'Hangar', status: 'Fleet readiness' },
  { id: 'market', label: 'Market', status: 'Supply exchange' },
  { id: 'faction', label: 'Faction', status: 'Alliance directives' },
  { id: 'leaderboards', label: 'Leaderboards', status: 'Command standings' },
];

const navToModeMap: Record<NavId, ModeId> = {
  home: 'play',
  missions: 'campaign',
  hangar: 'multiplayer',
  market: 'events',
  faction: 'faction',
  leaderboards: 'map',
};

const modeCards = [
  {
    id: 'play',
    title: 'Play',
    subtitle: 'Deploy to live space',
    kicker: 'Rapid deployment',
    headline: 'Launch through the Cygnus lane',
    description: 'Task force Helios is fueled, the breach corridor is stable, and the bridge is cleared for immediate command access.',
    primaryAction: 'Enter Command View',
    secondaryAction: 'Inspect Alerts',
    brief: 'Observer access is active. You can launch straight into the galaxy map and inspect every active system before issuing orders.',
    sector: 'Kepler Veil',
    fleetStatus: '3 wings on standby',
    threat: 'Elevated',
    icon: 'play',
    newsId: 'riftwatch',
    navId: 'home',
    launchesGame: true,
  },
  {
    id: 'campaign',
    title: 'Campaign',
    subtitle: 'Story operations',
    kicker: 'Narrative chain',
    headline: 'Resume the Shadows of the Rift arc',
    description: 'Escort failures near the Morrow Gap have opened a hole in the line. Story directives are stacked and waiting for a commander.',
    primaryAction: 'Review Operation',
    secondaryAction: 'Open Briefing',
    brief: 'Campaign routes are pinned to the Kepler corridor, with archived intel packets and mission debriefs ready for the next sortie.',
    sector: 'Morrow Gap',
    fleetStatus: 'Flagship refitting',
    threat: 'Critical',
    icon: 'campaign',
    newsId: 'rift-brief',
    navId: 'missions',
  },
  {
    id: 'multiplayer',
    title: 'Multiplayer',
    subtitle: 'PvP and co-op',
    kicker: 'Open squadron nets',
    headline: 'Squadrons are forming in the relay lanes',
    description: 'Public strike groups are filling fast and rival task forces are contesting mining rights across the outer systems.',
    primaryAction: 'Review Squadrons',
    secondaryAction: 'Check Queue',
    brief: 'Matchmaking telemetry shows fast queue times and active co-op wings staging from EU-Cygnus Prime.',
    sector: 'Cygnus Prime',
    fleetStatus: 'Queue is instant',
    threat: 'Contested',
    icon: 'multiplayer',
    newsId: 'squadron-net',
    navId: 'hangar',
  },
  {
    id: 'events',
    title: 'Events',
    subtitle: 'Limited-time operations',
    kicker: 'Live frontier event',
    headline: 'Convoy alarms are drawing every hunter to the breach',
    description: 'An emergency alloy stipend is live, hostile scouts have been sighted, and timed contracts are paying above standard rates.',
    primaryAction: 'View Event Board',
    secondaryAction: 'Read Dispatch',
    brief: 'Timed operations are rotating through the frontier with boosted payouts for commanders who clear escort and extraction contracts.',
    sector: 'Argent Rift',
    fleetStatus: 'Event contracts live',
    threat: 'Active',
    icon: 'events',
    newsId: 'alloy-stipend',
    navId: 'market',
  },
  {
    id: 'faction',
    title: 'Faction',
    subtitle: 'Join. Fight. Conquer.',
    kicker: 'Alliance channels',
    headline: 'Faction emissaries want commitments before dawnshift',
    description: 'Border charters are shifting again. Alliances are gathering signatures, moving resources, and calling pilots back to the line.',
    primaryAction: 'Open Faction Brief',
    secondaryAction: 'Scan Politics',
    brief: 'Faction influence is climbing around the Kepler Veil as commanders reinforce starbases and pressure neutral lanes.',
    sector: 'Helios March',
    fleetStatus: 'Treaties under review',
    threat: 'Volatile',
    icon: 'faction',
    newsId: 'treaty-summit',
    navId: 'faction',
  },
  {
    id: 'map',
    title: 'Map',
    subtitle: 'Explore the galaxy',
    kicker: 'Cartography uplink',
    headline: 'Star charts are updating with new wake signatures',
    description: 'Prospecting drones near the Veil are tagging unknown engine trails. The cartography deck is marking fresh points of interest.',
    primaryAction: 'View Chart Update',
    secondaryAction: 'Cycle Bulletin',
    brief: 'Survey beacons are reporting stable warp routes, hidden contacts, and fresh anomaly signatures across the frontier map.',
    sector: 'Outer Reach',
    fleetStatus: 'Survey probes deployed',
    threat: 'Unknown',
    icon: 'map',
    newsId: 'wake-signatures',
    navId: 'leaderboards',
  },
] satisfies ModeCard[];

const resourceStats = [
  { label: 'Credits', value: '128,450' },
  { label: 'Alloys', value: '2,840' },
  { label: 'Influence', value: '985' },
];

const objectives = [
  { label: 'Complete 3 Missions', progress: 66, meta: '2 / 3', reward: '5,000' },
  { label: 'Destroy 10 Enemy Ships', progress: 60, meta: '6 / 10', reward: '7,500' },
  { label: 'Mine 2,000 Units of Resources', progress: 58, meta: '1,200 / 2,000', reward: '4,000' },
];

const newsFeed = [
  {
    id: 'riftwatch',
    title: 'Riftwatch Escorts Diverted',
    text: 'Freighter escorts are rerouting around the breach after two wake flares near Kepler Veil.',
    detail: 'Traffic control has narrowed the corridor to military priority lanes. Civilian haulers are stacking outside the shield perimeter until the flare pattern settles.',
    image: '/textures/planets/Methane/Methane_04-1024x512.png',
    age: '14m ago',
    priority: 'Priority high',
    channel: 'Traffic control',
  },
  {
    id: 'rift-brief',
    title: 'Shadows Brief Updated',
    text: 'Command archivists appended fresh coordinates to the Morrow Gap operation chain.',
    detail: 'Recovered blackbox fragments now place the missing convoy inside a pocket of unstable space. Campaign packets have been revised with new threat markers.',
    image: '/textures/planets/Martian/Martian_03-1024x512.png',
    age: '39m ago',
    priority: 'Priority medium',
    channel: 'Story archive',
  },
  {
    id: 'squadron-net',
    title: 'Squadron Net Reopened',
    text: 'Strike teams are filling quickly on the Cygnus relay with instant co-op queue times.',
    detail: 'Open wings are broadcasting for escorts, skirmish pilots, and salvage crews. Queue telemetry remains stable across the current prime-time window.',
    image: '/textures/planets/Gaseous/Gaseous_12-1024x512.png',
    age: '1h ago',
    priority: 'Priority medium',
    channel: 'Squadron net',
  },
  {
    id: 'alloy-stipend',
    title: 'Emergency Alloy Stipend',
    text: 'Quartermasters approved a short-run alloy bonus for breach response contracts.',
    detail: 'Frontline depots are issuing extra payout chits to commanders who clear timed escort routes or extract damaged rigs before next cycle.',
    image: '/textures/planets/Barren/Barren_03-1024x512.png',
    age: '3h ago',
    priority: 'Priority high',
    channel: 'Quartermaster',
  },
  {
    id: 'treaty-summit',
    title: 'Treaty Summit at Helios March',
    text: 'Faction envoys are negotiating border access after last night’s fuel convoy dispute.',
    detail: 'No shots have been fired, but every house in attendance has moved security wings within sensor range of the summit decks.',
    image: '/textures/planets/Grassland/Grassland_04-1024x512.png',
    age: '5h ago',
    priority: 'Priority low',
    channel: 'Diplomatic relay',
  },
  {
    id: 'wake-signatures',
    title: 'Unknown Wake Signatures',
    text: 'Prospecting drones tagged six unregistered engine wakes beyond the mapped edge.',
    detail: 'Cartographers believe the signatures belong to ships using masked drive bursts. Survey commanders are requesting additional eyes on the frontier map.',
    image: '/textures/planets/Tundra/Tundra_03-1024x512.png',
    age: '7h ago',
    priority: 'Priority high',
    channel: 'Survey command',
  },
];

function ModeIcon({ icon }: { icon: ModeId }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {icon === 'play' && (
        <>
          <circle cx="24" cy="24" r="12" />
          <path d="M24 7v8M24 33v8M7 24h8M33 24h8" />
          <path d="M16 24h16M24 16v16" />
        </>
      )}
      {icon === 'campaign' && (
        <>
          <path d="M16 10v28" />
          <path d="M18 12h14l-4 6 4 6H18z" />
          <path d="M16 35h16" />
        </>
      )}
      {icon === 'multiplayer' && (
        <>
          <path d="M14 16l20 16" />
          <path d="M34 16L14 32" />
          <path d="M12 14l4 2-2 4" />
          <path d="M36 14l-4 2 2 4" />
          <path d="M12 34l4-2-2-4" />
          <path d="M36 34l-4-2 2-4" />
        </>
      )}
      {icon === 'events' && (
        <>
          <path d="M24 8l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
          <circle cx="24" cy="24" r="3.5" />
        </>
      )}
      {icon === 'faction' && (
        <>
          <path d="M24 9l11 4v9c0 7-4.4 12.2-11 16-6.6-3.8-11-9-11-16v-9z" />
          <path d="M24 16v15M18 23h12" />
        </>
      )}
      {icon === 'map' && (
        <>
          <path d="M12 15l10-4 8 3 6-2v21l-8 3-8-3-8 3z" />
          <path d="M22 11v22M30 14v22" />
          <circle cx="30" cy="22" r="2.5" />
        </>
      )}
    </svg>
  );
}

export default function HomePage({ account, onContinuePlaying }: HomePageProps) {
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
  const [activeNavId, setActiveNavId] = useState<NavId>('home');
  const [activeModeId, setActiveModeId] = useState<ModeId>('play');
  const [selectedNewsId, setSelectedNewsId] = useState(newsFeed[0].id);

  const commanderName = account.username.trim() || 'Commander';
  const primaryFaction = account.accountType === 'seeded-faction' && account.factionId !== null
    ? factions.find((faction) => faction.id === account.factionId) ?? factions[0]
    : null;
  const commanderRole = account.accountType === 'seeded-faction'
    ? primaryFaction?.name ?? 'Faction Commander'
    : 'Observer Command';
  const activeNav = navItems.find((item) => item.id === activeNavId) ?? navItems[0];
  const activeMode = modeCards.find((card) => card.id === activeModeId) ?? modeCards[0];
  const selectedNews = newsFeed.find((item) => item.id === selectedNewsId) ?? newsFeed[0];
  const selectedNewsIndex = Math.max(0, newsFeed.findIndex((item) => item.id === selectedNews.id));

  const handleNavSelect = (navId: NavId) => {
    const linkedModeId = navToModeMap[navId];
    const linkedMode = modeCards.find((card) => card.id === linkedModeId) ?? modeCards[0];
    setActiveNavId(navId);
    setActiveModeId(linkedMode.id);
    setSelectedNewsId(linkedMode.newsId);
  };

  const handleModeSelect = (mode: ModeCard) => {
    setActiveModeId(mode.id);
    setActiveNavId(mode.navId);
    setSelectedNewsId(mode.newsId);
  };

  const handlePrimaryAction = () => {
    if (activeMode.launchesGame) {
      onContinuePlaying();
      return;
    }

    setSelectedNewsId(activeMode.newsId);
  };

  const handleNewsStep = (direction: 'next' | 'prev') => {
    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (selectedNewsIndex + delta + newsFeed.length) % newsFeed.length;
    setSelectedNewsId(newsFeed[nextIndex].id);
  };

  const handleSecondaryAction = () => {
    handleNewsStep('next');
  };

  return (
    <div
      className="home-page"
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(2, 6, 15, 0.28), rgba(1, 4, 10, 0.92)), url(${lobbyBackdrop})`,
      }}
    >
      <div className="home-page__veil" aria-hidden="true" />
      <div className="home-page__shell">
        <header className="home-topbar">
          <div className="home-brand">
            <img src={stellarLogo} alt="StellarFronts" />
          </div>

          <nav className="home-nav" aria-label="Primary navigation">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`home-nav__item ${activeNavId === item.id ? 'is-active' : ''}`}
                onClick={() => handleNavSelect(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="home-topbar__meta">
            <div className="home-resource-row">
              {resourceStats.map((stat) => (
                <div key={stat.label} className="home-resource-pill">
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>

            <div className="home-commander-pill">
              <div className="home-commander-pill__avatar">{commanderName.charAt(0).toUpperCase()}</div>
              <div className="home-commander-pill__body">
                <span className="home-commander-pill__label">Commander</span>
                <strong>{commanderName}</strong>
              </div>
              <span className="home-commander-pill__level">27</span>
            </div>
          </div>
        </header>

        <main className="home-layout">
          <aside className="home-left-rail home-frame">
            <div className="home-rail-header">
              <span>Launch Grid</span>
              <strong>{activeNav.status}</strong>
            </div>

            {modeCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`home-mode-card ${activeModeId === card.id ? 'is-active' : ''}`}
                onClick={() => handleModeSelect(card)}
              >
                <span className="home-mode-card__icon" aria-hidden="true">
                  <ModeIcon icon={card.icon} />
                </span>
                <span className="home-mode-card__body">
                  <em>{card.kicker}</em>
                  <strong>{card.title}</strong>
                  <small>{card.subtitle}</small>
                </span>
              </button>
            ))}
          </aside>

          <section className="home-center-stage">
            <article className="home-hero-panel home-frame">
              <img src={lobbyBackdrop} alt="" className="home-hero-panel__image" />
              <div className="home-hero-panel__shade" />
              <div className="home-hero-panel__scanline" />

              <div className="home-hero-panel__content">
                <div className="home-hero-panel__tags">
                  <span className="home-hero-panel__tag">{activeNav.status}</span>
                  <span className="home-hero-panel__tag">{activeMode.kicker}</span>
                </div>
                <div className="home-hero-panel__kicker">Featured Operation</div>
                <h1>{activeMode.headline}</h1>
                <p>{activeMode.description}</p>

                <div className="home-hero-panel__actions">
                  <button type="button" className="home-primary-btn" onClick={handlePrimaryAction}>
                    {activeMode.primaryAction}
                  </button>
                  <button type="button" className="home-secondary-btn" onClick={handleSecondaryAction}>
                    {activeMode.secondaryAction}
                  </button>
                </div>
              </div>

              <div className="home-feature-card">
                <span className="home-feature-card__eyebrow">Commander Status</span>
                <h2>{commanderName}</h2>
                <p>{commanderRole}</p>
                <div className="home-feature-card__stats">
                  <div>
                    <span>Sector</span>
                    <strong>{activeMode.sector}</strong>
                  </div>
                  <div>
                    <span>Fleet Status</span>
                    <strong>{activeMode.fleetStatus}</strong>
                  </div>
                  <div>
                    <span>Threat</span>
                    <strong>{activeMode.threat}</strong>
                  </div>
                </div>
              </div>
            </article>

            <div className="home-center-grid">
              <section className="home-surface-card home-frame">
                <div className="home-surface-card__header">
                  <span>Command Brief</span>
                  <strong>Last sync 18 min ago</strong>
                </div>
                <p>
                  {primaryFaction
                    ? `${primaryFaction.name} holds priority lanes across ${activeMode.sector}. ${activeMode.brief}`
                    : activeMode.brief}
                </p>
              </section>

              <section className="home-surface-card home-surface-card--signal home-frame">
                <div className="home-surface-card__header">
                  <span>{selectedNews.channel}</span>
                  <button type="button" className="home-inline-action" onClick={handleSecondaryAction}>
                    Cycle Bulletin
                  </button>
                </div>
                <h3>{selectedNews.title}</h3>
                <p>{selectedNews.detail}</p>
                <div className="home-status-grid">
                  <div>
                    <span>Priority</span>
                    <strong>{selectedNews.priority}</strong>
                  </div>
                  <div>
                    <span>Signal Age</span>
                    <strong>{selectedNews.age}</strong>
                  </div>
                  <div>
                    <span>Account</span>
                    <strong>{account.accountType === 'seeded-faction' ? 'Faction-bound' : 'Observer'}</strong>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <aside className="home-right-rail">
            <section className="home-side-card home-frame">
              <div className="home-side-card__header">
                <span>Daily Objectives</span>
                <strong>07:42:18</strong>
              </div>

              <div className="home-objective-list">
                {objectives.map((objective) => (
                  <article key={objective.label} className="home-objective">
                    <div className="home-objective__head">
                      <span>{objective.label}</span>
                      <strong>{objective.meta}</strong>
                    </div>
                    <div className="home-objective__bar">
                      <span style={{ width: `${objective.progress}%` }} />
                    </div>
                    <div className="home-objective__reward">{objective.reward}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="home-side-card home-frame">
              <div className="home-side-card__header">
                <span>News Feed</span>
                <div className="home-news-pager-meta">
                  <strong>{selectedNewsIndex + 1} / {newsFeed.length}</strong>
                </div>
              </div>

              <article className="home-news-feature">
                <img src={selectedNews.image} alt="" className="home-news-feature__image" />
                <div className="home-news-feature__body">
                  <div className="home-news-feature__channel">
                    <span>{selectedNews.channel}</span>
                    <strong>{selectedNews.priority}</strong>
                  </div>
                  <h3>{selectedNews.title}</h3>
                  <p>{selectedNews.text}</p>
                  <div className="home-news-feature__detail">{selectedNews.detail}</div>
                  <div className="home-news-feature__footer">
                    <span>{selectedNews.age}</span>
                    <div className="home-news-pager">
                      <button
                        type="button"
                        className="home-side-action"
                        onClick={() => handleNewsStep('prev')}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="home-side-action"
                        onClick={() => handleNewsStep('next')}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </article>

              <div className="home-news-dots" aria-label="News pages">
                {newsFeed.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`home-news-dot ${index === selectedNewsIndex ? 'is-active' : ''}`}
                    onClick={() => setSelectedNewsId(item.id)}
                    aria-label={`Open news page ${index + 1}`}
                  />
                ))}
              </div>
            </section>
          </aside>
        </main>

        <footer className="home-bottom-bar home-frame">
          <div className="home-bottom-bar__label">Global Chat</div>
          <div className="home-bottom-bar__input">Press Enter to open fleet comms...</div>
        </footer>
      </div>
    </div>
  );
}
