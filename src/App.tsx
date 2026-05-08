import { BrowserRouter as Router } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import SuccessPage from './pages/SuccessPage';
import GamePage from './pages/GamePage';
import HomePage from './pages/HomePage';
import { LoadingScreen } from './components/LoadingScreen';
import BackgroundScene from './components/BackgroundScene';
import { preloadAuthAssets } from './utils/preloadAuthAssets';
import type { GalaxyPerspective } from './data/Factions';

export interface AuthState {
  isLoggedIn: boolean;
  username: string;
  mode: 'login' | 'signup' | 'email-verify' | 'success' | 'home';
}

interface HomeTransitionState {
  isActive: boolean;
  isVisible: boolean;
  username: string;
  source: 'login' | 'signup' | 'verify' | 'success';
  progress: number;
  detail: string;
}

const homeVisualAssets = [
  '/textures/galaxy_bg.png',
  '/textures/planets/Methane/Methane_03-1024x512.png',
  '/textures/planets/Snowy/Snowy_02-1024x512.png',
  '/textures/planets/Gaseous/Gaseous_08-1024x512.png',
  '/textures/planets/Arid/Arid_04-1024x512.png',
  '/textures/planets/Tundra/Tundra_04-1024x512.png',
  '/textures/planets/Methane/Methane_04-1024x512.png',
  '/textures/planets/Martian/Martian_03-1024x512.png',
  '/textures/planets/Gaseous/Gaseous_12-1024x512.png',
];

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

function preloadHomeVisualAssets(): Promise<void> {
  return Promise.all(homeVisualAssets.map((src) => preloadImage(src))).then(() => undefined);
}

function getAuthLoadingDetail(detail: string): string {
  if (detail.includes('starbase')) return 'Assembling orbital backdrop';
  if (detail.includes('fighter')) return 'Warming hangar lighting';
  if (detail.includes('planet')) return 'Decoding planetary textures';
  if (detail.includes('star glow') || detail.includes('surface')) return 'Decoding stellar textures';
  if (detail.includes('cameras') || detail.includes('lighting')) return 'Calibrating cameras and lighting';
  if (detail.includes('background scene')) return 'Creating login backdrop';
  if (detail.includes('ready')) return 'Login station is ready';
  if (detail.includes('auth assets')) return 'Preparing login assets';
  return detail;
}

function App() {
  const [authLoadingProgress, setAuthLoadingProgress] = useState(0);
  const [authAssetProgress, setAuthAssetProgress] = useState(0);
  const [authSceneProgress, setAuthSceneProgress] = useState(0);
  const [authLoadingDetail, setAuthLoadingDetail] = useState('Preparing login assets');
  const [authBackgroundReady, setAuthBackgroundReady] = useState(false);
  const [showAuthStartupLoading, setShowAuthStartupLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    isLoggedIn: false,
    username: '',
    mode: 'login',
  });
  const [homeTransition, setHomeTransition] = useState<HomeTransitionState>({
    isActive: false,
    isVisible: false,
    username: '',
    source: 'login',
    progress: 0,
    detail: 'Confirming command credentials',
  });
  const [selectedPerspective, setSelectedPerspective] = useState<GalaxyPerspective | null>(null);

  useEffect(() => {
    let cancelled = false;

    void preloadAuthAssets((state) => {
      if (cancelled) return;
      setAuthAssetProgress(state.progress);
      setAuthLoadingDetail(getAuthLoadingDetail(state.detail));
    }).then(() => {
      if (cancelled) return;
      setAuthAssetProgress(1);
      setAuthLoadingDetail('Login assets are ready');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authBackgroundReady) {
      setAuthLoadingProgress(100);
      return;
    }

    const weightedProgress = (authAssetProgress * 0.35 + authSceneProgress * 0.65) * 100;
    setAuthLoadingProgress(Math.min(98, weightedProgress));
  }, [authAssetProgress, authBackgroundReady, authSceneProgress]);

  const handleAuthBackgroundProgress = useCallback((progress: number, detail: string) => {
    setAuthSceneProgress(progress);
    setAuthLoadingDetail(getAuthLoadingDetail(detail));
  }, []);

  const handleAuthBackgroundReady = useCallback(() => {
    setAuthBackgroundReady(true);
    setAuthSceneProgress(1);
    setAuthLoadingProgress(100);
    setAuthLoadingDetail('Login station is ready');
  }, []);

  const handleAuthStartupLoadingHidden = useCallback(() => {
    setShowAuthStartupLoading(false);
  }, []);

  useEffect(() => {
    if (!homeTransition.isActive) return;
    let cancelled = false;

    const transitionSteps = [
      { delay: 120, progress: 24, detail: 'Confirming command credentials' },
      { delay: 420, progress: 52, detail: 'Syncing commander profile' },
      { delay: 760, progress: 82, detail: 'Loading home command visuals' },
    ];

    const timers = transitionSteps.map((step) => window.setTimeout(() => {
      if (cancelled) return;
      setHomeTransition((prev) => ({
        ...prev,
        progress: step.progress,
        detail: step.detail,
      }));
    }, step.delay));

    timers.push(window.setTimeout(() => {
      void preloadHomeVisualAssets().then(() => {
        if (cancelled) return;

        setHomeTransition((prev) => ({
          ...prev,
          detail: 'Opening command center',
          progress: 100,
        }));

        window.setTimeout(() => {
          if (cancelled) return;
          setHomeTransition((prev) => ({
            ...prev,
            isVisible: false,
          }));
        }, 500);
      });
    }, 960));

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [homeTransition.isActive, homeTransition.username]);

  const startHomeTransition = (
    username: string,
    source: HomeTransitionState['source'],
    initialDetail = 'Confirming command credentials',
  ) => {
    setHomeTransition({
      isActive: true,
      isVisible: true,
      username,
      source,
      progress: 8,
      detail: initialDetail,
    });
  };

  const handleLoginSuccess = (username: string) => {
    startHomeTransition(username, 'login', 'Login accepted');
  };

  const handleSignupClick = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'signup',
    }));
  };

  const handleBackToLogin = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'login',
    }));
  };

  const handleSignupSubmit = (_email: string, username: string) => {
    startHomeTransition(username, 'signup', 'Account created');
  };

  const handleEmailVerified = () => {
    startHomeTransition(auth.username, 'verify', 'Email verified');
  };

  const handleEnterGame = () => {
    setAuth((prev) => ({
      ...prev,
      isLoggedIn: true,
    }));
  };

  const handleOpenHome = () => {
    startHomeTransition(auth.username, 'success', 'Preparing command center');
  };

  const handleStartGameFromHome = (perspective: GalaxyPerspective) => {
    setSelectedPerspective(perspective);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/game');
    }
    setAuth((prev) => ({
      ...prev,
      isLoggedIn: true,
      mode: 'home',
    }));
  };

  const isGameRoute = typeof window !== 'undefined' && window.location.pathname === '/game';
  const homeTransitionTitle = homeTransition.source === 'signup'
    ? 'Creating command profile'
    : homeTransition.source === 'verify'
      ? 'Finalizing account'
      : 'Opening command center';

  const handleHomeTransitionHidden = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/home');
    }

    setAuth({
      isLoggedIn: true,
      username: homeTransition.username,
      mode: 'home',
    });

    setHomeTransition((prev) => ({
      ...prev,
      isActive: false,
    }));
  };

  const authScreen = auth.mode === 'signup'
    ? (
      <SignupPage
        onSignupSubmit={handleSignupSubmit}
        onBackToLogin={handleBackToLogin}
      />
    )
    : auth.mode === 'email-verify'
      ? (
        <EmailVerificationPage
          onVerified={handleEmailVerified}
          username={auth.username}
        />
      )
      : auth.mode === 'success'
        ? (
          <SuccessPage
            message={auth.isLoggedIn ? `Welcome back, ${auth.username}!` : 'Account created successfully!'}
            onEnterGame={handleOpenHome}
          />
        )
        : (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onSignupClick={handleSignupClick}
          />
        );

  if (isGameRoute && auth.isLoggedIn && selectedPerspective) {
    return (
      <Router>
        <GamePage username={auth.username} selectedPerspective={selectedPerspective} />
      </Router>
    );
  }

  if (homeTransition.isActive) {
    return (
      <Router>
        <LoadingScreen
          theme="auth"
          subtitle="Command Link"
          title={homeTransitionTitle}
          progress={homeTransition.progress}
          detail={homeTransition.detail}
          isVisible={homeTransition.isVisible}
          onHidden={handleHomeTransitionHidden}
          zIndex={240}
        />
      </Router>
    );
  }

  if (auth.isLoggedIn && auth.mode === 'home') {
    return (
      <Router>
        <HomePage username={auth.username} onContinuePlaying={handleStartGameFromHome} />
      </Router>
    );
  }

  return (
    <Router>
      <div className="auth-container">
        <BackgroundScene
          onLoadProgress={handleAuthBackgroundProgress}
          onReady={handleAuthBackgroundReady}
        />

        {showAuthStartupLoading && (
          <LoadingScreen
            theme="auth"
            subtitle="Login Station"
            title="StellarFronts Login"
            progress={authLoadingProgress}
            detail={authLoadingDetail}
            isVisible={!authBackgroundReady}
            onHidden={handleAuthStartupLoadingHidden}
            zIndex={220}
          />
        )}

        {authBackgroundReady && authScreen}
      </div>
    </Router>
  );
}

export default App;
