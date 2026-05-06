import { useEffect, useRef } from 'react';
import '../styles/Game.css';

interface GamePageProps {
  username: string;
}

export default function GamePage({ username }: GamePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Dynamically import and run the game
    import('../game/boot').then(({ boot }) => {
      if (containerRef.current) {
        boot(containerRef.current);
      }
    });
  }, []);

  return (
    <div className="game-container" ref={containerRef}>
      <canvas id="renderCanvas"></canvas>
      <div className="game-username">{username}</div>
    </div>
  );
}
