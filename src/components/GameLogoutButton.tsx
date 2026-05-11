import '../styles/Game.css';

interface GameLogoutButtonProps {
  onLogout: () => void;
}

export function GameLogoutButton({ onLogout }: GameLogoutButtonProps) {
  return (
    <div className="game-logout-rail">
      <button type="button" className="game-logout-btn" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}