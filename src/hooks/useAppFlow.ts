import { useEffect, useState } from 'react';
import { login as loginRequest, logout as logoutRequest, signup as signupRequest } from '@/auth/client';
import type { AuthAccount } from '@/auth/types';
import { preloadAuthAssets } from '@/utils/preloadAuthAssets';
import lobbyBackdrop from '../../backgroudn lobby.png';
import stellarLogo from '../../logosteller.png';

export interface AuthState {
  isLoggedIn: boolean;
  account: AuthAccount | null;
  mode: 'login' | 'signup' | 'home';
}

export interface HomeTransitionState {
  isActive: boolean;
  isVisible: boolean;
  username: string;
  source: 'login' | 'signup';
  progress: number;
  detail: string;
}

export interface UseAppFlowResult {
  authLoadingProgress: number;
  authLoadingDetail: string;
  authBackgroundReady: boolean;
  authSessionReady: boolean;
  showAuthStartupLoading: boolean;
  auth: AuthState;
  homeTransition: HomeTransitionState;
  handleAuthStartupLoadingHidden: () => void;
  handleLoginSubmit: (username: string, password: string) => Promise<void>;
  handleGuestMode: () => void;
  handleSignupClick: () => void;
  handleBackToLogin: () => void;
  handleSignupSubmit: (username: string, password: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleStartGameFromHome: () => void;
  homeTransitionTitle: string;
  handleHomeTransitionHidden: () => void;
}

const homeVisualAssets = [
  lobbyBackdrop,
  stellarLogo,
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
  if (detail.includes('launcher artwork')) return 'Synchronizing relay holos';
  if (detail.includes('command center')) return 'Charting command deck approach';
  if (detail.includes('galaxy map')) return 'Warming star chart telemetry';
  if (detail.includes('ready')) return 'Docking relay is standing by';
  return detail;
}

export function useAppFlow(): UseAppFlowResult {
  const [authLoadingProgress, setAuthLoadingProgress] = useState(0);
  const [authLoadingDetail, setAuthLoadingDetail] = useState('Acquiring docking relay');
  const [authBackgroundReady, setAuthBackgroundReady] = useState(false);
  const [authSessionReady, setAuthSessionReady] = useState(false);
  const [showAuthStartupLoading, setShowAuthStartupLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    isLoggedIn: false,
    account: null,
    mode: 'login',
  });
  const [homeTransition, setHomeTransition] = useState<HomeTransitionState>({
    isActive: false,
    isVisible: false,
    username: '',
    source: 'login',
    progress: 0,
    detail: 'Confirming command cipher',
  });

  useEffect(() => {
    let cancelled = false;

    void preloadAuthAssets((state) => {
      if (cancelled) return;
      setAuthLoadingProgress(state.progress * 100);
      setAuthLoadingDetail(getAuthLoadingDetail(state.detail));
    }).then(() => {
      if (cancelled) return;
      setAuthLoadingProgress(100);
      setAuthLoadingDetail('Docking relay is standing by');
      setAuthBackgroundReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!cancelled) setAuthSessionReady(true);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!homeTransition.isActive) return;
    let cancelled = false;

    const transitionSteps = [
      { delay: 120, progress: 16, detail: 'Verifying command cipher' },
      { delay: 360, progress: 34, detail: 'Routing through the Cygnus relay' },
      { delay: 640, progress: 58, detail: 'Syncing fleet manifests' },
      { delay: 980, progress: 78, detail: 'Charging command deck holowalls' },
      { delay: 1320, progress: 92, detail: 'Matching tactical channels' },
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
          detail: 'Unsealing the command deck',
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
    }, 1520));

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [homeTransition.isActive, homeTransition.username]);

  const startHomeTransition = (
    username: string,
    source: HomeTransitionState['source'],
    initialDetail = 'Confirming command cipher',
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

  const handleLoginSubmit = async (username: string, password: string) => {
    const account = await loginRequest({ username, password });
    startHomeTransition(account.username, 'login', 'Command clearance accepted');
    setAuth({
      isLoggedIn: true,
      account,
      mode: 'home',
    });
  };

  const handleGuestMode = () => {
    const now = Date.now();
    const guestAccount: AuthAccount = {
      id: now,
      username: 'Guest Commander',
      accountType: 'observer',
      factionId: null,
      createdAt: now,
      updatedAt: now,
    };

    startHomeTransition(guestAccount.username, 'login', 'Observer passport initialized');
    setAuth({
      isLoggedIn: true,
      account: guestAccount,
      mode: 'home',
    });
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

  const handleSignupSubmit = async (username: string, password: string) => {
    const account = await signupRequest({ username, password });
    startHomeTransition(account.username, 'signup', 'Command registry approved');
    setAuth({
      isLoggedIn: true,
      account,
      mode: 'home',
    });
  };

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } catch {
      // Clear local auth state even if the auth server is unavailable.
    }

    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }

    setAuth({
      isLoggedIn: false,
      account: null,
      mode: 'login',
    });
    setHomeTransition({
      isActive: false,
      isVisible: false,
      username: '',
      source: 'login',
      progress: 0,
      detail: 'Confirming command cipher',
    });
  };

  const handleStartGameFromHome = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/game');
    }
    setAuth((prev) => ({
      ...prev,
      mode: 'home',
    }));
  };

  const handleAuthStartupLoadingHidden = () => {
    setShowAuthStartupLoading(false);
  };

  const handleHomeTransitionHidden = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/home');
    }

    setAuth((prev) => ({
      ...prev,
      isLoggedIn: true,
      mode: 'home',
    }));

    setHomeTransition((prev) => ({
      ...prev,
      isActive: false,
    }));
  };

  const homeTransitionTitle = homeTransition.source === 'signup'
    ? 'Forging command registry'
    : 'Opening command deck';

  return {
    authLoadingProgress,
    authLoadingDetail,
    authBackgroundReady,
    authSessionReady,
    showAuthStartupLoading,
    auth,
    homeTransition,
    handleAuthStartupLoadingHidden,
    handleLoginSubmit,
    handleGuestMode,
    handleSignupClick,
    handleBackToLogin,
    handleSignupSubmit,
    handleLogout,
    handleStartGameFromHome,
    homeTransitionTitle,
    handleHomeTransitionHidden,
  };
}
