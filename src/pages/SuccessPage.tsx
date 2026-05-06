import { useNavigate } from 'react-router-dom';
import '../styles/Auth.css';
import BackgroundScene from '@/components/BackgroundScene';

interface SuccessPageProps {
  message: string;
  onEnterGame: () => void;
}

export default function SuccessPage({ message, onEnterGame }: SuccessPageProps) {
  const navigate = useNavigate();

  const handleEnterGame = () => {
    onEnterGame();
    navigate('/game');
  };

  return (
    <div className="auth-container">
      <BackgroundScene />
      
      <div className="auth-panel success-panel">
        <div className="success-icon">✓</div>
        <h2 className="success-message">{message}</h2>
        <p className="success-subtitle">Ready to explore the galaxy?</p>

        <button onClick={handleEnterGame} className="btn btn-primary btn-large">
          Enter Game
        </button>
      </div>
    </div>
  );
}
