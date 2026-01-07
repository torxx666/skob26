import React, { useState, useEffect } from 'react';
import ChkoubaGame from './game/ChkoubaGame';
import { User, Trophy, Users } from 'lucide-react';

function App() {
    const [name, setName] = useState('');
    const [gameStarted, setGameStarted] = useState(false);
    const [playerCount, setPlayerCount] = useState(2);

    // New Lobby State
    const [mode, setMode] = useState('create'); // 'create' or 'join'
    const [roomName, setRoomName] = useState('');
    const [aiCount, setAiCount] = useState(1); // Default 1 AI

    const [gameId, setGameId] = useState(null);
    const [gameList, setGameList] = useState([]);

    // Fetch games when entering 'join' mode
    useEffect(() => {
        if (mode === 'join') {
            const fetchGames = async () => {
                try {
                    // Assuming dev environment for now
                    const res = await fetch('http://localhost:8000/games');
                    if (res.ok) {
                        const data = await res.json();
                        setGameList(data);
                    }
                } catch (err) {
                    console.error("Failed to fetch games:", err);
                }
            };
            fetchGames();
            // Optional: Poll every 5s
            const interval = setInterval(fetchGames, 5000);
            return () => clearInterval(interval);
        }
    }, [mode]);

    useEffect(() => {
        const savedSession = localStorage.getItem('chkouba_session');
        if (savedSession) {
            const { name, playerCount, gameId, aiCount } = JSON.parse(savedSession);
            if (name && name.trim()) {
                setName(name);
                setPlayerCount(playerCount || 2);
                setGameId(gameId || 'default_room');
                setAiCount(aiCount !== undefined ? aiCount : 1);
                setGameStarted(true);
            } else {
                localStorage.removeItem('chkouba_session');
            }
        }
    }, []);

    const handleStart = (e) => {
        e.preventDefault();
        if (name.trim() && roomName.trim()) {
            const finalGameId = roomName.trim();
            setGameId(finalGameId);
            // In join mode, we don't change aiCount (it's ignored by backend anyway)
            localStorage.setItem('chkouba_session', JSON.stringify({ name, playerCount, gameId: finalGameId, aiCount }));
            setGameStarted(true);
        }
    };

    const handleQuit = () => {
        localStorage.removeItem('chkouba_session');
        setGameStarted(false);
        setGameId(null);
    };

    if (gameStarted) {
        return (
            <div className="game-container">
                <ChkoubaGame playerName={name} playerCount={playerCount} gameId={gameId} aiCount={aiCount} onQuit={handleQuit} />
                <button className="quit-btn" onClick={handleQuit}>Quitter</button>
            </div>
        );
    }

    return (
        <div className="lobby-container">
            <div className="glass-card">
                <h1>Chkouba Tunisienne</h1>
                <p className="subtitle">L'élégance du jeu traditionnel, redéfinie.</p>

                <form onSubmit={handleStart} style={{ width: '100%' }}>
                    {/* Common: Player Name - Moved Top */}
                    <div className="input-group" style={{ marginBottom: '20px' }}>
                        <User className="icon" />
                        <input
                            type="text"
                            placeholder="Votre Pseudo / Nom"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    {/* --- LOBBY TABS --- */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', gap: '10px' }}>
                        <button
                            type="button"
                            onClick={() => setMode('create')}
                            style={{
                                padding: '10px 20px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                                background: mode === 'create' ? '#fbbf24' : 'rgba(255,255,255,0.1)',
                                color: mode === 'create' ? '#000' : '#fff', fontWeight: 'bold'
                            }}
                        >
                            Créer une Table
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('join')}
                            style={{
                                padding: '10px 20px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                                background: mode === 'join' ? '#fbbf24' : 'rgba(255,255,255,0.1)',
                                color: mode === 'join' ? '#000' : '#fff', fontWeight: 'bold'
                            }}
                        >
                            Rejoindre
                        </button>
                    </div>

                    {/* Common: Room Name */}

                    {/* Common: Room Name */}
                    <div className="input-group">
                        <Users className="icon" />
                        <input
                            type="text"
                            placeholder="Nom de la Table (ex: MaPartie)"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            required
                        />
                    </div>

                    {/* Game List for Join Mode */}
                    {mode === 'join' && gameList.length > 0 && (
                        <div className="game-list" style={{ marginTop: '10px', maxHeight: '150px', overflowY: 'auto', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px' }}>
                            <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#94a3b8' }}>Tables disponibles :</p>
                            {gameList.map(game => (
                                <div
                                    key={game.id}
                                    onClick={() => setRoomName(game.id)}
                                    style={{
                                        padding: '8px',
                                        cursor: 'pointer',
                                        background: roomName === game.id ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                                        borderRadius: '4px',
                                        marginBottom: '4px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        fontSize: '14px'
                                    }}
                                >
                                    <span style={{ fontWeight: 'bold' }}>{game.id}</span>
                                    <span style={{ color: '#cbd5e1' }}>
                                        {game.players}/{game.max_players} • {game.status === 'playing' ? 'En cours' : 'Attente'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {mode === 'create' && (
                        // ...
                        <>
                            {/* Total Players */}
                            <div className="player-select">
                                <p>Nombre de sièges :</p>
                                <div className="radio-group">
                                    {[2, 4].map(num => (
                                        <label key={num} className={playerCount === num ? 'active' : ''}>
                                            <input
                                                type="radio"
                                                name="players"
                                                value={num}
                                                checked={playerCount === num}
                                                onChange={() => { setPlayerCount(num); setAiCount(Math.min(aiCount, num - 1)); }}
                                            />
                                            <span>{num} Joueurs</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* AI Count */}
                            <div className="player-select">
                                <p>Intelligence Artificielle (IA) :</p>
                                <div className="radio-group" style={{ flexWrap: 'wrap' }}>
                                    {[...Array(playerCount).keys()].map(num => (
                                        <label key={num} className={aiCount === num ? 'active' : ''}>
                                            <input
                                                type="radio"
                                                name="ai"
                                                value={num}
                                                checked={aiCount === num}
                                                onChange={() => setAiCount(num)}
                                            />
                                            <span>{num} AI</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <button type="submit" className="start-btn">
                        {mode === 'create' ? 'Créer la Table' : 'Rejoindre la Table'}
                    </button>
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
                        <li>Mode Création : Choisissez le nombre de joueurs et d'IA.</li>
                        <li>Mode Rejoindre : Entrez simplement le nom de la table.</li>
                        <li>Les joueurs "Waiting..." seront remplacés par les vrais joueurs.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default App;
