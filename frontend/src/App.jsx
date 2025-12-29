import React, { useState } from 'react';
import ChkoubaGame from './game/ChkoubaGame';
import { User, Trophy, Users } from 'lucide-react';

function App() {
    const [name, setName] = useState('');
    const [gameStarted, setGameStarted] = useState(false);
    const [playerCount, setPlayerCount] = useState(2);

    useEffect(() => {
        const savedSession = localStorage.getItem('chkouba_session');
        if (savedSession) {
            const { name, playerCount } = JSON.parse(savedSession);
            setName(name);
            setPlayerCount(playerCount);
            setGameStarted(true);
        }
    }, []);

    const handleStart = (e) => {
        e.preventDefault();
        if (name.trim()) {
            localStorage.setItem('chkouba_session', JSON.stringify({ name, playerCount }));
            setGameStarted(true);
        }
    };

    const handleQuit = () => {
        localStorage.removeItem('chkouba_session');
        setGameStarted(false);
    };

    if (gameStarted) {
        return (
            <div className="game-container">
                <ChkoubaGame playerName={name} playerCount={playerCount} onQuit={handleQuit} />
                <button className="quit-btn" onClick={handleQuit}>Quitter</button>
            </div>
        );
    }

    return (
        <div className="lobby-container">
            <div className="glass-card">
                <h1>Chkouba Tunisienne</h1>
                <p className="subtitle">L'élégance du jeu traditionnel, redéfinie.</p>

                <form onSubmit={handleStart}>
                    <div className="input-group">
                        <User className="icon" />
                        <input
                            type="text"
                            placeholder="Votre Nom"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="player-select">
                        <p>Nombre de joueurs :</p>
                        <div className="radio-group">
                            {[2, 4].map(num => (
                                <label key={num} className={playerCount === num ? 'active' : ''}>
                                    <input
                                        type="radio"
                                        name="players"
                                        value={num}
                                        checked={playerCount === num}
                                        onChange={() => setPlayerCount(num)}
                                    />
                                    <span>{num} Joueurs</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className="start-btn">Jouer maintenant</button>
                </form>

                <div className="stats-preview">
                    <div className="stat-item">
                        <Trophy size={20} />
                        <span>Leaderboard</span>
                    </div>
                </div>

                <div className="how-to-play">
                    <h3>Comment jouer ?</h3>
                    <ul>
                        <li>Faites glisser une carte vers le centre pour jouer.</li>
                        <li>L'IA joue automatiquement après vous.</li>
                        <li>Capturez les 7 et les Deniers !</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default App;
