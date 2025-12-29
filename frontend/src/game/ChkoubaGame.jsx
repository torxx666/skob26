import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';

const ChkoubaGame = ({ playerName, playerCount, onQuit }) => {
    const gameRef = useRef(null);
    const socketRef = useRef(null);
    const [gameState, setGameState] = useState(null);

    useEffect(() => {
        const preventDefault = (e) => e.preventDefault();
        document.addEventListener('touchmove', preventDefault, { passive: false });

        const gameId = 'game-1';
        socketRef.current = new WebSocket(`ws://${window.location.hostname}:8000/ws/${gameId}/${playerName}`);

        let pendingState = null;

        socketRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'INIT' || data.type === 'UPDATE') {
                setGameState(data.state);
                if (gameRef.current && gameRef.current.scene.scenes[0] && gameRef.current.scene.scenes[0].renderState) {
                    gameRef.current.scene.scenes[0].renderState(data.state, data.type === 'INIT');
                } else {
                    pendingState = data.state;
                }
            }
        };

        const config = {
            type: Phaser.AUTO,
            parent: 'phaser-container',
            width: window.innerWidth,
            height: window.innerHeight,
            transparent: true,
            audio: { noAudio: true },
            physics: { default: 'arcade' },
            scene: {
                preload: preload,
                create: function () {
                    create.call(this);
                    if (socketRef.current.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: 'GET_STATE' }));
                    }
                    if (pendingState) {
                        setTimeout(() => {
                            if (this.renderState) this.renderState(pendingState);
                            pendingState = null;
                        }, 100);
                    }
                },
                update: update,
            },
        };

        const game = new Phaser.Game(config);
        gameRef.current = game;

        function preload() {
            this.load.crossOrigin = 'anonymous';
            this.load.image('card_back', '/assets/chkouba_card_back.png');
            const suits = ['H', 'S', 'D', 'C'];
            for (let s of suits) {
                for (let v = 1; v <= 10; v++) {
                    const id = `${v}${s}`;
                    this.load.image(id, `/assets/cards/${id}.png`);
                }
            }
        }

        function create() {
            const scene = this;
            const { width, height } = this.scale;

            const matW = Math.min(width * 0.85, 800);
            const matH = Math.min(height * 0.35, 400);
            const mat = this.add.graphics();
            mat.lineStyle(4, 0x10b981, 0.1);
            mat.strokeRoundedRect((width - matW) / 2 - 5, (height - matH) / 2 - 5, matW + 10, matH + 10, 35);
            mat.fillStyle(0x064e3b, 0.2);
            mat.fillRoundedRect((width - matW) / 2, (height - matH) / 2, matW, matH, 30);
            mat.lineStyle(2, 0xffd700, 0.15);
            mat.strokeRoundedRect((width - matW) / 2, (height - matH) / 2, matW, matH, 30);

            this.tableCards = this.add.group();
            this.playerHand = this.add.group();
            this.opponentArea = this.add.group();
            this.playerCapturedPile = this.add.group();
            this.opponentCapturedPile = this.add.group();
            this.deckPile = this.add.group();

            const deckX = 60;
            const deckY = 220;
            for (let i = 0; i < 5; i++) {
                const b = this.add.image(deckX + i, deckY - i, 'card_back').setDisplaySize(60, 90);
                this.deckPile.add(b);
            }

            this.statusText = this.add.text(width / 2, 25, "En attente...", {
                fontSize: '14px', fill: '#ffd700', fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.3)', padding: { x: 10, y: 5 }
            }).setOrigin(0.5).setAlpha(0.6);

            this.cardMap = new Map();
            this.lastState = null;

            // --- STATE LOCKS ---
            this.aiAnimatingCards = new Set();    // IDs controlled by AI Sequence
            this.draggingCardId = null;           // ID currently being dragged by player
            this.pendingPlayCardId = null;        // ID played by player, waiting for server confirmation

            const getTableCoords = (i, total) => {
                const tableCardW = Math.min(width * 0.14, 80);
                const spacing = tableCardW * 1.1;
                const totalWidth = (total - 1) * spacing;
                const startX = (width / 2) - (totalWidth / 2);
                return { x: startX + i * spacing, y: height / 2, angle: 0 };
            };

            this.renderState = (state, isReset = false) => {
                if (isReset) {
                    this.cardMap.forEach(s => s.destroy());
                    this.cardMap.clear();
                    this.aiAnimatingCards.clear();
                    this.draggingCardId = null;
                    this.pendingPlayCardId = null;
                    this.tableCards.clear(true, true);
                    this.playerHand.clear(true, true);
                    this.opponentArea.clear(true, true);
                    this.playerCapturedPile.clear(true, true);
                    this.opponentCapturedPile.clear(true, true);
                    this.lastState = null;
                }

                const player = state.players.find(p => p.name === playerName) || state.players[0];
                const opponent = state.players.find(p => p.name !== playerName);
                const tableCardW = Math.min(width * 0.14, 80);
                const tableCardH = tableCardW * 1.5;
                const handCardW = Math.min(width * 0.22, 120);
                const handCardH = handCardW * 1.5;
                const matW = Math.min(width * 0.85, 800);
                const matRightX = (width + matW) / 2;
                const pileAlignX = matRightX + 50;

                // --- DETECT NEW AI PLAY ---
                let aiPlayedCardId = null;
                let capturedTableIds = [];
                const prevOpp = this.lastState ? this.lastState.players.find(p => p.name !== playerName) : null;
                const currentOpp = state.players.find(p => p.name !== playerName);

                if (prevOpp && currentOpp) {
                    const prevCapCount = prevOpp.captured_cards.length;
                    const currentCapCount = currentOpp.captured_cards.length;

                    if (currentCapCount > prevCapCount) {
                        const prevCapSet = new Set(prevOpp.captured_cards.map(c => c.id));
                        const newCaptures = currentOpp.captured_cards.filter(c => !prevCapSet.has(c.id));
                        const lastTableIds = new Set(this.lastState.table.map(c => c.id));
                        capturedTableIds = newCaptures.filter(c => lastTableIds.has(c.id)).map(c => c.id);
                        const playedObj = newCaptures.find(c => !lastTableIds.has(c.id));
                        aiPlayedCardId = playedObj ? playedObj.id : null;
                    } else if (prevOpp.hand.length > currentOpp.hand.length && currentOpp.hand.length < 3) {
                        const prevHandIds = new Set(prevOpp.hand.map(c => c.id));
                        const droppedCard = state.table.find(c => prevHandIds.has(c.id));
                        if (droppedCard) aiPlayedCardId = droppedCard.id;
                    }
                }

                const validIds = new Set();
                state.table.forEach(c => validIds.add(c.id));
                if (player) player.hand.forEach(c => validIds.add(c.id));
                if (opponent) opponent.hand.forEach(c => validIds.add(c.id));

                // --- 1. SYNC STATIC CARDS ---
                // Table
                state.table.forEach((card, i) => {
                    const coords = getTableCoords(i, state.table.length);
                    if (this.aiAnimatingCards.has(card.id)) return;
                    syncCard(card.id, coords.x, coords.y, 0, true, 'table', tableCardW, tableCardH, handCardH);
                });

                // Player Hand
                if (player) {
                    player.hand.forEach((card, i) => {
                        // Skip if actively dragging OR waiting for server confirmation (prevents bounce)
                        if (this.draggingCardId === card.id || this.pendingPlayCardId === card.id) return;

                        const total = player.hand.length;
                        const angle = (i - (total - 1) / 2) * 8;
                        const radius = handCardH * 1.5;
                        const rad = Phaser.Math.DegToRad(angle - 90);
                        const x = (width / 2) + Math.cos(rad) * (radius * 1.2);
                        const y = height + Math.sin(rad) * radius + (handCardH * 0.1);

                        const sprite = syncCard(card.id, x, y, angle, true, 'player', handCardW, handCardH, handCardH);
                        sprite.setInteractive();
                        sprite.card_id = card.id;
                        sprite.player_index = state.players.indexOf(player);
                        scene.input.setDraggable(sprite);
                    });
                }

                // Opponent Hand
                if (opponent) {
                    opponent.hand.forEach((card, i) => {
                        const total = opponent.hand.length;
                        const x = (width / 2) + (i - (total - 1) / 2) * (handCardW * 0.6);
                        const y = handCardH * 0.4;
                        const angle = (i - (total - 1) / 2) * -5;
                        if (this.aiAnimatingCards.has(card.id)) return;
                        syncCard(card.id, x, y, angle, false, 'opponent', handCardW * 0.7, handCardH * 0.7, handCardH);
                    });
                }

                // --- 2. TRIGGER NEW AI PLAY SEQUENCE ---
                if (aiPlayedCardId && !this.aiAnimatingCards.has(aiPlayedCardId)) {
                    this.aiAnimatingCards.add(aiPlayedCardId);
                    capturedTableIds.forEach(id => this.aiAnimatingCards.add(id));

                    let playedSprite = this.cardMap.get(aiPlayedCardId);
                    if (!playedSprite) {
                        playedSprite = createCardSprite(scene, width / 2, handCardH * 0.4, aiPlayedCardId, false, tableCardW, tableCardH);
                        playedSprite.setAlpha(1);
                        this.cardMap.set(aiPlayedCardId, playedSprite);
                        scene.tableCards.add(playedSprite);
                    }
                    scene.children.bringToTop(playedSprite);

                    // S1: Move to Presentation
                    scene.tweens.add({
                        targets: playedSprite, x: width / 2, y: height * 0.35, duration: 800, ease: 'Cubic.easeOut',
                        onComplete: () => {
                            // S2: Reveal (Flip)
                            scene.tweens.add({
                                targets: playedSprite, scaleX: 0, duration: 300,
                                onComplete: () => {
                                    updateCardTexture(playedSprite, aiPlayedCardId, true, tableCardW, tableCardH);
                                    scene.tweens.add({
                                        targets: playedSprite, scaleX: 1, duration: 300,
                                        onComplete: () => {
                                            // S3: Long Reveal Delay
                                            scene.time.delayedCall(1000, () => {
                                                if (capturedTableIds.length > 0) {
                                                    // CAPTURE
                                                    capturedTableIds.forEach(id => {
                                                        const s = this.cardMap.get(id);
                                                        if (s) {
                                                            const glow = scene.add.rectangle(0, 0, tableCardW + 12, tableCardH + 12, 0x10b981, 0.8);
                                                            s.addAt(glow, 0);
                                                        }
                                                    });
                                                    // S4: Contact
                                                    scene.time.delayedCall(800, () => {
                                                        scene.tweens.add({
                                                            targets: playedSprite, x: width / 2, y: height / 2, duration: 600, ease: 'Back.easeOut',
                                                            onComplete: () => {
                                                                // S5: Collect
                                                                scene.time.delayedCall(600, () => {
                                                                    const allSprites = [playedSprite, ...capturedTableIds.map(id => this.cardMap.get(id)).filter(x => x)];
                                                                    scene.tweens.add({
                                                                        targets: allSprites, x: pileAlignX, y: 200, scale: 0.3, alpha: 0, duration: 1000, ease: 'Back.easeIn',
                                                                        onComplete: () => {
                                                                            allSprites.forEach(s => { if (s) { s.destroy(); if (s.card_id) this.cardMap.delete(s.card_id); } });
                                                                            this.aiAnimatingCards.delete(aiPlayedCardId);
                                                                            capturedTableIds.forEach(id => this.aiAnimatingCards.delete(id));
                                                                            this.cardMap.delete(aiPlayedCardId);
                                                                            capturedTableIds.forEach(id => this.cardMap.delete(id));
                                                                        }
                                                                    });
                                                                });
                                                            }
                                                        });
                                                    });
                                                } else {
                                                    // DROP
                                                    const finalCoords = getTableCoords(state.table.findIndex(c => c.id === aiPlayedCardId), state.table.length);
                                                    scene.tweens.add({
                                                        targets: playedSprite, x: finalCoords.x, y: finalCoords.y, duration: 800, ease: 'Cubic.easeOut',
                                                        onComplete: () => { this.aiAnimatingCards.delete(aiPlayedCardId); }
                                                    });
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                }

                // --- 3. CLEANUP REMOVED CARDS ---
                this.cardMap.forEach((sprite, id) => {
                    if (this.aiAnimatingCards.has(id)) return;

                    if (!validIds.has(id)) {
                        let targetPileX = width - 220;
                        let targetPileY = height - 200;
                        const inPlayerPile = player.captured_cards.some(c => c.id === id);
                        const inOpponentPile = opponent && opponent.captured_cards.some(c => c.id === id);

                        if (inOpponentPile) { targetPileX = pileAlignX; targetPileY = 200; }
                        else if (inPlayerPile) { targetPileX = pileAlignX; targetPileY = height - 200; }
                        else { sprite.destroy(); this.cardMap.delete(id); return; }

                        scene.children.bringToTop(sprite);
                        scene.tweens.add({
                            targets: sprite, x: targetPileX, y: targetPileY, scale: 0.3, alpha: 0, duration: 800, ease: 'Back.easeIn',
                            onComplete: () => { sprite.destroy(); this.cardMap.delete(id); }
                        });
                    }
                });

                // --- 4. RENDER STATIC PILES ---
                const renderPile = (p, isPlayer) => {
                    if (isPlayer) scene.playerCapturedPile.clear(true, true);
                    else scene.opponentCapturedPile.clear(true, true);
                    const count = Math.ceil(p.captured_cards.length / 2);
                    const pileW = handCardW * 0.7;
                    const pileH = pileW * 1.5;
                    const pileX = pileAlignX;
                    const pileY = isPlayer ? height - 200 : 200;
                    for (let i = 0; i < count; i++) {
                        const back = scene.add.image(pileX + (Math.random() - 0.5) * 6, pileY - (i * 2), 'card_back').setDisplaySize(pileW, pileH);
                        back.setAngle((Math.random() - 0.5) * 15);
                        if (isPlayer) scene.playerCapturedPile.add(back);
                        else scene.opponentCapturedPile.add(back);
                    }
                    // Chkouba Markers
                    for (let i = 0; i < (p.chkoubas || 0); i++) {
                        const cardId = p.captured_cards.length > 0 ? p.captured_cards[i % p.captured_cards.length].id : '1H';
                        const chkoubaCard = scene.add.image(pileX + (i * 15) - 10, pileY - (count * 2) - 10, cardId).setDisplaySize(pileW, pileH);
                        chkoubaCard.setAngle(45 + (i * 5));
                        if (isPlayer) scene.playerCapturedPile.add(chkoubaCard);
                        else scene.opponentCapturedPile.add(chkoubaCard);
                    }
                };
                if (player) renderPile(player, true);
                if (opponent) renderPile(opponent, false);

                this.lastState = state;
            };

            const syncCard = (id, x, y, angle, isFaceUp, location, w, h, handH) => {
                let sprite = this.cardMap.get(id);
                if (!sprite) {
                    let spawnX = deckX;
                    let spawnY = deckY;
                    let startScale = 0.5;
                    let startAlpha = 0;
                    const wasInTable = this.lastState?.table.find(c => c.id === id);
                    const wasInPlayer = this.lastState?.players.find(p => p.name === playerName)?.hand.find(c => c.id === id);
                    if (location === 'table' && !wasInTable && !wasInPlayer) { spawnX = width / 2; spawnY = handH * 0.4; startScale = 0.7; startAlpha = 1; }
                    sprite = createCardSprite(scene, spawnX, spawnY, id, isFaceUp, w, h);
                    sprite.setAlpha(startAlpha);
                    sprite.setScale(startScale);
                    sprite.card_id = id;
                    this.cardMap.set(id, sprite);
                    if (location === 'table') scene.tableCards.add(sprite);
                    else if (location === 'player') scene.playerHand.add(sprite);
                    else scene.opponentArea.add(sprite);
                }
                updateCardTexture(sprite, id, isFaceUp, w, h);
                scene.tweens.add({ targets: sprite, x: x, y: y, angle: angle, scale: 1, alpha: 1, duration: 600, ease: 'Cubic.easeOut' });
                return sprite;
            };

            const updateCardTexture = (container, label, isFaceUp, w, h) => {
                const img = container.getAt(1);
                if (img) {
                    if (isFaceUp && img.texture.key === 'card_back') img.setTexture(label);
                    img.setDisplaySize(w, h);
                    container.getAt(0).setDisplaySize(w, h);
                    container.setSize(w, h);
                }
            };

            function createCardSprite(scene, x, y, label, isFaceUp, w = 80, h = 120) {
                const container = scene.add.container(x, y);
                container.add(scene.add.rectangle(4, 4, w, h, 0x000000, 0.4).setOrigin(0.5));
                if (isFaceUp && scene.textures.exists(label)) container.add(scene.add.image(0, 0, label).setDisplaySize(w, h));
                else if (!isFaceUp && scene.textures.exists('card_back')) container.add(scene.add.image(0, 0, 'card_back').setDisplaySize(w, h));
                else {
                    container.add([scene.add.rectangle(0, 0, w, h, isFaceUp ? 0xffffff : 0x1e293b), scene.add.text(0, 0, label, { color: isFaceUp ? '#000000' : '#ffffff', fontSize: (w * 0.2) + 'px', fontStyle: 'bold' }).setOrigin(0.5)]);
                }
                container.setSize(w, h);
                return container;
            }

            this.input.on('dragstart', (pointer, gameObject) => {
                this.draggingCardId = gameObject.card_id;
            });

            this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
                gameObject.x = dragX;
                gameObject.y = dragY;
            });

            this.input.on('dragend', (pointer, gameObject) => {
                this.draggingCardId = null;
                this.pendingPlayCardId = gameObject.card_id;

                if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ type: 'PLAY_CARD', player_index: gameObject.player_index, card_id: gameObject.card_id, combo_index: 0 }));
                }

                // Snapback Failsafe (if server never accepts, reset after 1s)
                setTimeout(() => {
                    if (this.pendingPlayCardId === gameObject.card_id) {
                        this.pendingPlayCardId = null;
                        // Force a re-render/sync logic could be triggered here if needed, 
                        // but next heartbeat usually catches it.
                    }
                }, 1000);
            });

            this.input.on('gameobjectup', (pointer, gameObject) => {
                if (pointer.getDuration() < 200) { // Click
                    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: 'PLAY_CARD', player_index: gameObject.player_index, card_id: gameObject.card_id, combo_index: 0 }));
                    }
                }
            });
        }

        function update() { }
        const handleResize = () => { if (gameRef.current) gameRef.current.scale.resize(window.innerWidth, window.innerHeight); };
        window.addEventListener('resize', handleResize);
        return () => { window.removeEventListener('resize', handleResize); if (gameRef.current) gameRef.current.destroy(true); };
    }, [playerName, playerCount]);

    return (
        <div className="game-wrapper" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div id="phaser-container" style={{ width: '100%', height: '100%' }} />
            {gameState && (
                <>
                    <div className="hud-container">
                        <div className="hud-item"><span className="hud-label">{playerName}</span><span className="hud-value">{gameState.scores[playerName] || 0}</span></div>
                        <div className="hud-item"><span className="hud-label">AI Suspect</span><span className="hud-value">{gameState.scores["AI 1"] || 0}</span></div>
                    </div>
                    <div className="turn-indicator" style={{ display: gameState.players[gameState.current_player_index].name === playerName ? 'block' : 'none' }}>C'est à vous de jouer !</div>
                    <button onClick={() => { if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'RESET' })); }} style={{ position: 'absolute', top: '70px', left: '20px', width: 'fit-content', padding: '6px 16px', fontSize: '14px', fontWeight: 'bold', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(5px)', zIndex: 2000 }}>Nouvelle Partie</button>
                </>
            )}
            <button className="quit-btn" onClick={() => onQuit ? onQuit() : window.location.reload()} style={{ zIndex: 2000 }}>Quitter</button>
        </div>
    );
};

export default ChkoubaGame;
