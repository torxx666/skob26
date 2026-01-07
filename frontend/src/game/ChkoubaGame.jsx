import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import ChkoubaScene from './scenes/ChkoubaScene';

const ChkoubaGame = ({ playerName, playerCount, gameId, aiCount = 1, onQuit }) => {
    const gameRef = useRef(null);
    const socketRef = useRef(null);
    const [gameState, setGameState] = useState(null);
    const [connectionError, setConnectionError] = useState(false);
    const [isMuted, setIsMuted] = useState(false);

    // Safeguard for missing name
    useEffect(() => {
        if (!playerName || !playerName.trim()) {
            if (onQuit) onQuit();
        }
    }, [playerName, onQuit]);

    // Prevent default touch actions
    useEffect(() => {
        const preventDefault = (e) => e.preventDefault();
        document.addEventListener('touchmove', preventDefault, { passive: false });
        return () => document.removeEventListener('touchmove', preventDefault);
    }, []);

    // Initial Setup: Game and Socket
    useEffect(() => {
        setConnectionError(false);

        // --- PHASER CONFIG ---
        const config = {
            type: Phaser.AUTO,
            parent: 'phaser-container',
            width: window.innerWidth,
            height: window.innerHeight,
            transparent: true,
            // audio: { noAudio: true }, // FIXED: Enable Audio!
            physics: { default: 'arcade' },
            scene: [ChkoubaScene]
        };

        const game = new Phaser.Game(config);
        gameRef.current = game;

        // --- WEBSOCKET CONNECTION ---
        // Use 127.0.0.1 to avoid potential IPv6 localhost issues in WSL
        const items = playerName.trim();
        // Use prop for config
        const wsUrl = `ws://127.0.0.1:8000/ws/${gameId}/${items}?count=${playerCount}&ai=${aiCount}`;
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        // Expose send function to Phaser Scene via Registry
        game.registry.set('sendMessage', (data) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(data));
            }
        });

        socket.onopen = () => {
            console.log("WS Connected to", gameId);
            // Small delay to ensure backend registration is complete
            setTimeout(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'GET_STATE' }));
                }
            }, 500);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'INIT' || data.type === 'UPDATE') {
                    setGameState(data.state); // Update React State
                }
            } catch (e) { console.error("WS Parse Error", e); }
        };

        socket.onerror = (error) => {
            console.error("WS Error:", error);
            // Don't set error immediately, wait for close to confirm connection loss
        };

        socket.onclose = (e) => {
            console.log("WS Closed", e.code, e.reason);
            // If close wasn't clean, show error UI
            if (!e.wasClean) {
                setConnectionError(true);
            }
        };

        const handleResize = () => { if (gameRef.current) gameRef.current.scale.resize(window.innerWidth, window.innerHeight); };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (socketRef.current) socketRef.current.close();
            if (gameRef.current) gameRef.current.destroy(true);
        };
    }, [playerName, playerCount]);

    // Sync React State -> Phaser Scene
    useEffect(() => {
        if (!gameState || !gameRef.current) return;

        const scene = gameRef.current.scene.getScene('ChkoubaScene');
        if (scene) {
            // Function to sync state and callback
            const syncScene = () => {
                scene.updateGameState(gameState, playerName.trim());
                scene.onPlayCard = (playerIndex, cardId, comboIndex) => {
                    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: 'PLAY_CARD', player_index: playerIndex, card_id: cardId, combo_index: comboIndex }));
                    }
                };
            };

            if (scene.scene.isActive()) {
                syncScene();
            } else {
                // If scene not ready, wait for create
                scene.events.once('create', syncScene);
            }
        }
    }, [gameState, playerName]); // Re-run when new state or player name arrives

    // Retry Handler
    const handleRetry = () => {
        // Clear session to force new Game ID
        localStorage.removeItem('chkouba_session');
        window.location.reload();
    };

    if (connectionError) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'white', background: '#0f172a', fontFamily: 'sans-serif' }}>
                <h2>Connexion Perdue</h2>
                <p style={{ marginBottom: '20px', color: '#94a3b8' }}>Impossible de rejoindre la partie (ID expiré ou serveur redémarré).</p>
                <button onClick={handleRetry} style={{ padding: '12px 24px', borderRadius: '8px', background: '#eab308', border: 'none', fontWeight: 'bold', cursor: 'pointer', color: '#000', fontSize: '16px' }}>
                    Nouvelle Partie
                </button>
            </div>
        );
    }

    // Waiting Logic
    const waitingPlayers = gameState ? gameState.players.filter(p => p.name.startsWith('Waiting...')) : [];
    // Check 'started' flag. If undefined (legacy backend?), assume true if no waiting players.
    // But since we updated backend, 'started' should be reliable.
    const gameStarted = gameState?.started ?? true;
    const showOverlay = gameState && !gameStarted;

    // Determine if I am Host (Player index 0 is Host)
    const hostPlayer = gameState && gameState.players.length > 0 ? gameState.players[0] : null;
    const amIHost = hostPlayer && hostPlayer.name === playerName.trim();

    // Can Start? 
    // CRITICAL FIX: Must allow start ONLY if NO waiting players remain.
    // Otherwise "Waiting..." players (who are treated as humans) will softlock the game on their turn.
    const canStart = amIHost && waitingPlayers.length === 0;

    // Handle Start Game
    const handleStartGame = () => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'START_GAME' }));
        }
    };

    return (
        <div className="game-wrapper" style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Waiting/Start Overlay */}
            {showOverlay && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'white', zIndex: 5000
                }}>
                    <h2 style={{ fontSize: '2rem', marginBottom: '10px' }}>
                        {waitingPlayers.length > 0 ? "En attente de joueurs..." : "Prêt à commencer !"}
                    </h2>

                    {waitingPlayers.length > 0 && (
                        <p style={{ fontSize: '1.2rem', marginBottom: '20px' }}>
                            Il manque <strong>{waitingPlayers.length}</strong> joueur(s).
                        </p>
                    )}

                    <div style={{ background: '#334155', padding: '20px', borderRadius: '10px', textAlign: 'center', marginBottom: '30px' }}>
                        <p style={{ color: '#94a3b8', marginBottom: '5px' }}>Table :</p>
                        <h1 style={{ color: '#fbbf24', margin: 0, fontSize: '3rem', letterSpacing: '2px' }}>{gameId}</h1>
                        {hostPlayer && (
                            <p style={{ marginTop: '10px', color: '#34d399', fontSize: '0.9rem' }}>
                                Hôte (Créateur) : <strong>{hostPlayer.name}</strong>
                            </p>
                        )}
                    </div>

                    {amIHost ? (
                        <>
                            <button
                                onClick={handleStartGame}
                                disabled={!canStart}
                                style={{
                                    padding: '15px 40px', fontSize: '1.5rem', fontWeight: 'bold', borderRadius: '12px',
                                    background: canStart ? '#22c55e' : '#475569',
                                    color: canStart ? '#fff' : '#94a3b8',
                                    border: 'none', cursor: canStart ? 'pointer' : 'not-allowed',
                                    boxShadow: canStart ? '0 0 20px rgba(34, 197, 94, 0.4)' : 'none',
                                    transition: 'all 0.2s',
                                    marginBottom: '20px'
                                }}
                            >
                                {canStart ? "COMMENCER LA PARTIE" : "En attente de joueurs..."}
                            </button>
                            <button
                                onClick={onQuit}
                                style={{
                                    padding: '10px 20px', fontSize: '1rem', fontWeight: 'bold', borderRadius: '8px',
                                    background: 'transparent', border: '2px solid #ef4444', color: '#ef4444',
                                    cursor: 'pointer', transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => { e.target.style.background = '#ef4444'; e.target.style.color = '#fff'; }}
                                onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#ef4444'; }}
                            >
                                Annuler la table
                            </button>
                        </>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                            <div style={{ fontStyle: 'italic', color: '#94a3b8' }}>
                                {waitingPlayers.length === 0
                                    ? `En attente de ${hostPlayer?.name} pour lancer la partie...`
                                    : "Veuillez patienter..."}
                            </div>
                            <button
                                onClick={onQuit}
                                style={{
                                    padding: '8px 16px', fontSize: '0.9rem', borderRadius: '6px',
                                    background: '#334155', border: '1px solid #475569', color: '#94a3b8',
                                    cursor: 'pointer'
                                }}
                            >
                                &larr; Quitter la table
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div id="phaser-container" style={{ width: '100%', height: '100%' }} />
            {gameState && (
                <>
                    {/* GAME OVER / ROUND SUMMARY MODAL */}
                    {(gameState.game_over || gameState.round_finished) && (
                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'monospace' }}>
                            <h1 style={{ fontSize: '3rem', color: '#fbbf24', marginBottom: '20px' }}>
                                {gameState.game_over ? "GAME OVER" : "FIN DE MANCHE"}
                            </h1>

                            <div style={{ background: '#1e293b', padding: '20px', borderRadius: '15px', border: '2px solid #fbbf24', minWidth: '400px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                                    <thead style={{ borderBottom: '1px solid #475569', color: '#94a3b8' }}>
                                        <tr>
                                            <th style={{ padding: '10px' }}>Category</th>
                                            {gameState.players.map(p => <th key={p.name} style={{ padding: '10px', color: p.name === playerName ? '#34d399' : '#f87171' }}>{p.name}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody style={{ fontSize: '1.2rem' }}>
                                        {['Carta', 'Dinari', 'Sebaa', 'Chkouba'].map(cat => (
                                            <tr key={cat} style={{ borderBottom: '1px solid #334155' }}>
                                                <td style={{ padding: '8px', textAlign: 'left', color: '#cbd5e1' }}>{cat}</td>
                                                {gameState.players.map(p => {
                                                    const details = gameState.score_details?.[p.name] || {};
                                                    const amt = details[`${cat}_Amt`] || 0;
                                                    const pt = details[`${cat}_Pt`] || 0;
                                                    // Format: "Count (Pts)" e.g. "23 (1)"
                                                    const display = (cat === 'Sebaa') ? (amt ? "YES (1)" : "-") : `${amt} (${pt})`;
                                                    return <td key={p.name} style={{ padding: '8px' }}>{display}</td>
                                                })}
                                            </tr>
                                        ))}
                                        {/* Bermila */}
                                        <tr>
                                            <td style={{ padding: '8px', textAlign: 'left', color: '#fbbf24', fontWeight: 'bold' }}>Bermila</td>
                                            {gameState.players.map(p => {
                                                const details = gameState.score_details?.[p.name] || {};
                                                const pt = details[`Bermila_Pt`] || 0;
                                                return <td key={p.name} style={{ padding: '8px', color: '#fbbf24', fontWeight: 'bold' }}>{pt > 0 ? `+${pt}` : '-'}</td>
                                            })}
                                        </tr>
                                        <tr style={{ borderTop: '2px solid #fbbf24' }}>
                                            <td style={{ padding: '15px', textAlign: 'left', fontWeight: 'bold' }}>TOTAL</td>
                                            {gameState.players.map(p => <td key={p.name} style={{ padding: '15px', fontWeight: 'bold', fontSize: '1.5rem', color: p.name === playerName ? '#34d399' : 'white' }}>{gameState.scores[p.name] || 0}</td>)}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Reset / Next Round Actions */}
                            <div style={{ marginTop: '30px', display: 'flex', gap: '20px' }}>
                                <button
                                    onClick={() => {
                                        if (socketRef.current) socketRef.current.send(JSON.stringify({ type: 'RESET' }));
                                    }}
                                    style={{ padding: '15px 30px', fontSize: '1.2rem', borderRadius: '10px', border: 'none', background: '#eab308', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Nouvelle Partie
                                </button>
                            </div>
                        </div>
                    )}

                    {/* existing UI elements below... */}
                    {/* Player Name and Score - Bottom Right */}
                    <div style={{ position: 'absolute', bottom: '40px', right: '350px', background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '12px', color: '#fff', fontWeight: 'bold', fontSize: '16px', zIndex: 1000, pointerEvents: 'none' }}>
                        {playerName}: {gameState.scores[playerName] || 0} pts
                    </div>

                    {/* Deck Count Display - Positioned under the deck */}
                    <div style={{ position: 'absolute', top: '280px', left: '40px', color: 'white', fontWeight: 'bold', fontSize: '14px', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px', textAlign: 'center', width: '100px' }}>
                        {gameState.deck ? gameState.deck.length : 0} cartes
                    </div>

                    <div className="turn-indicator" style={{ display: gameState.players[gameState.current_player_index].name === playerName ? 'block' : 'none' }}>C'est à vous de jouer !</div>
                    <button onClick={() => {
                        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                            const scene = gameRef.current.scene.getScene('ChkoubaScene');
                            if (scene) scene.isResetting = true;
                            socketRef.current.send(JSON.stringify({ type: 'RESET' }));
                        }
                    }} style={{ position: 'absolute', top: '70px', left: '20px', width: 'fit-content', padding: '6px 16px', fontSize: '14px', fontWeight: 'bold', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(5px)', zIndex: 2000 }}>Nouvelle Partie</button>
                </>
            )}

            {/* Mute Toggle (React Overlay) */}
            <button
                onClick={() => {
                    const scene = gameRef.current?.scene.getScene('ChkoubaScene');
                    if (scene) {
                        const muted = scene.toggleMute();
                        setIsMuted(muted);
                    }
                }}
                style={{
                    position: 'absolute', top: '20px', right: '20px',
                    fontSize: '2rem', background: 'rgba(0,0,0,0.5)',
                    border: 'none', borderRadius: '50%', width: '50px', height: '50px',
                    cursor: 'pointer', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
            >
                {isMuted ? '🔇' : '🔊'}
            </button>

            <button className="quit-btn" onClick={() => onQuit ? onQuit() : window.location.reload()} style={{ zIndex: 2000 }}>Quitter</button>
        </div>
    );
};

export default ChkoubaGame;
