
import Phaser from 'phaser';

export default class ChkoubaScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ChkoubaScene' });

        // State
        this.cardMap = new Map();
        this.lastState = null;
        this.aiAnimatingCards = new Set();
        this.draggingCardId = null;
        this.pendingPlayCardId = null;
        this.isResetting = false;

        // Manual Audio Fallback
        this.customSounds = {}; // { key: AudioBuffer }

        // Callbacks
        this.onPlayCard = null; // (playerIndex, cardId, comboIndex) => void
    }

    preload() {
        this.load.crossOrigin = 'anonymous';
        // Debug Load Errors
        this.load.on('loaderror', (file) => {
            console.error('[Loader] Error loading file:', file.key, file.src);
        });

        this.load.image('card_back', '/assets/chkouba_card_back.png');
        const suits = ['H', 'S', 'D', 'C'];
        for (let s of suits) {
            for (let v = 1; v <= 10; v++) {
                const id = `${v}${s}`;
                this.load.image(id, `/assets/cards/${id}.png`);
            }
        }

        // Audio (Simple paths)
        this.load.audio('card_slide', '/assets/card_slide.mp3');
        this.load.audio('turn_alert', '/assets/turn_alert.wav');
        this.load.audio('game_win', '/assets/game_win.mp3');

        this.load.on('filecomplete-audio-card_slide', () => console.log('DEBUG: card_slide loaded EVENT'));
    }

    create(data) {
        if (data && data.onPlayCard) {
            this.onPlayCard = data.onPlayCard;
        }

        // Debug Audio Cache (Safe)
        if (this.cache.audio.keys) {
            console.log('DEBUG: Audio Cache Keys:', this.cache.audio.keys);
        } else if (this.cache.audio.entries) {
            console.log('DEBUG: Audio Cache Entries:', this.cache.audio.entries.keys());
        }

        // Direct Probe & Manual Load
        ['card_slide.mp3', 'turn_alert.wav', 'game_win.mp3'].forEach(file => {
            const key = file.split('.')[0];
            this.loadSoundManual(key, `/assets/${file}`);
        });

        const scene = this;
        const { width, height } = this.scale;

        this.matGraphics = this.add.graphics();
        this.matGraphics.setDepth(0); // Background lowest
        this.drawMat();

        // Groups
        this.tableCards = this.add.group();
        this.playerHand = this.add.group();
        this.opponentArea = this.add.group();
        this.playerCapturedPile = this.add.group();
        this.opponentCapturedPile = this.add.group();
        this.deckPile = this.add.group();

        // Depths
        this.tableCards.setDepth(10, 1); // Ensure visual children get depth
        this.playerHand.setDepth(20, 1);
        this.opponentArea.setDepth(20, 1);
        this.deckPile.setDepth(5, 1);
        this.playerCapturedPile.setDepth(5, 1);
        this.opponentCapturedPile.setDepth(5, 1);

        // Deck visual
        const deckX = 60;
        const deckY = 220;
        for (let i = 0; i < 5; i++) {
            const b = this.add.image(deckX + i, deckY - i, 'card_back').setDisplaySize(60, 90);
            this.deckPile.add(b);
        }

        // Input Handling
        this.input.on('dragstart', (pointer, gameObject) => {
            if (gameObject.card_id) {
                this.draggingCardId = gameObject.card_id;
            }
        });

        this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
            gameObject.x = dragX;
            gameObject.y = dragY;
        });

        this.input.on('dragend', (pointer, gameObject) => {
            this.draggingCardId = null;
            this.handleInput(gameObject);
        });

        this.input.on('gameobjectup', (pointer, gameObject) => {
            if (pointer.getDuration() < 200) { // Click
                this.handleInput(gameObject);
            }
        });

        this.scale.on('resize', (gameSize) => {
            this.drawMat();
            if (this.lastState) this.renderState(this.lastState, this.currentPlayerName, true);
        });

        // Audio Context Resume on first interaction
        this.input.once('pointerdown', () => {
            if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
                this.sound.context.resume();
            }
        });

    }

    // Public method for React UI
    toggleMute() {
        this.sound.mute = !this.sound.mute;
        return this.sound.mute;
    }

    handleInput(gameObject) {
        if (this.pendingPlayCardId) return; // Debounce

        if (this.onPlayCard) {
            this.pendingPlayCardId = gameObject.card_id;
            this.onPlayCard(gameObject.player_index, gameObject.card_id, 0);

            // Failsafe unlock
            setTimeout(() => {
                if (this.pendingPlayCardId === gameObject.card_id) {
                    this.pendingPlayCardId = null;
                }
            }, 1000);
        }
    }

    drawMat() {
        const { width, height } = this.scale;
        const matW = Math.min(width * 0.85, 800);
        const matH = Math.min(height * 0.35, 400);

        this.matGraphics.clear();
        this.matGraphics.lineStyle(4, 0x10b981, 0.1);
        this.matGraphics.strokeRoundedRect((width - matW) / 2 - 5, (height - matH) / 2 - 5, matW + 10, matH + 10, 35);
        this.matGraphics.fillStyle(0x064e3b, 0.2);
        this.matGraphics.fillRoundedRect((width - matW) / 2, (height - matH) / 2, matW, matH, 30);
        this.matGraphics.lineStyle(2, 0xffd700, 0.15);
        this.matGraphics.strokeRoundedRect((width - matW) / 2, (height - matH) / 2, matW, matH, 30);
    }

    updateGameState(state, playerName) {
        if (this.isResetting) {
            this.cleanupState();
            this.isResetting = false;
        }

        this.currentPlayerName = playerName;
        this.renderState(state, playerName);
        this.lastState = state;
    }

    cleanupState() {
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

    playSound(key) {
        // Unlock Audio Context if suspended (Browser policy)
        // Unlock Audio Context if suspended (Browser policy)
        if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
            this.sound.context.resume();
        }

        if (this.cache.audio.exists(key)) {
            // console.log(`DEBUG: Playing Sound [${key}]`);
            this.sound.play(key, { volume: 1.0 });
        } else if (this.customSounds[key]) {
            // Respect Mute for Manual Sounds
            if (this.sound.mute) return;

            // Play Manual Buffer
            try {
                const ctx = this.sound.context;
                const source = ctx.createBufferSource();
                source.buffer = this.customSounds[key];
                source.connect(ctx.destination);
                source.start(0);
            } catch (e) { console.error('Manual play failed', e); }
        } else {
            // Fallback: Beep so user knows sound SHOULD be here
            // console.warn(`WARN: Sound [${key}] missing. Playing Beep.`);
            this.playBackUpBeep();
        }
    }

    loadSoundManual(key, url) {
        if (!this.sound || !this.sound.context) return;
        fetch(url)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.sound.context.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                this.customSounds[key] = audioBuffer;
                console.log(`DEBUG: Manual Load Success [${key}]`);
            })
            .catch(e => console.error(`DEBUG: Manual Load Failed [${key}]`, e));
    }

    playBackUpBeep() {
        if (!this.sound || !this.sound.context) return;
        try {
            const ctx = this.sound.context;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.setValueAtTime(440, ctx.currentTime);
            g.gain.setValueAtTime(0.1, ctx.currentTime);
            o.start();
            o.stop(ctx.currentTime + 0.1);
        } catch (e) {
            console.error('Beep failed', e);
        }
    }
    // --- CORE LOGIC (Originally renderState) ---
    renderState(state, playerName) {
        // Play Win Sound if game just ended
        if (this.lastState && this.lastState.game_over === false && state.game_over === true) {
            this.playSound('game_win');
        }

        const scene = this;
        const { width, height } = this.scale;

        const player = state.players.find(p => p.name === playerName) || state.players[0];
        // Robust Opponent Lookup: Name mismatch fallback to index 1 or 0
        let opponent = state.players.find(p => p.name !== playerName);
        if (!opponent && state.players.length > 1) {
            opponent = state.players.find(p => p !== player);
        }


        const tableCardW = Math.min(width * 0.14, 80);
        const tableCardH = tableCardW * 1.5;
        const handCardW = Math.min(width * 0.22, 120);
        const handCardH = handCardW * 1.5;
        const matW = Math.min(width * 0.85, 800);
        const matRightX = (width + matW) / 2;
        const pileAlignX = matRightX + 50;

        // Positions config
        const positions = [
            { name: 'bottom', x: width / 2, y: height - (handCardH * 0.6), angle: 0 },
            { name: 'right', x: width - (handCardH * 0.6), y: height / 2, angle: -90 }, // Rotated 90
            { name: 'top', x: width / 2, y: handCardH * 0.6, angle: 180 },
            { name: 'left', x: handCardH * 0.6, y: height / 2, angle: 90 }
        ];

        // --- DETECT NEW AI PLAY ---
        let aiPlayedCardId = null;
        let aiPlayerIndex = -1;

        if (this.lastState) {
            // Check all players (except me) for hand size decrease
            state.players.forEach((currP, idx) => {
                if (currP.name === playerName) return; // Skip me

                const prevP = this.lastState.players.find(p => p.name === currP.name);
                if (prevP && prevP.hand.length > currP.hand.length) {
                    // This player played!
                    aiPlayerIndex = idx;

                    if (currP.captured_cards.length > prevP.captured_cards.length) {
                        // Capture
                        const diff = currP.captured_cards.filter(c => !prevP.captured_cards.some(pc => pc.id === c.id));
                        const capturedFromHand = diff.find(c => prevP.hand.some(h => h.id === c.id));
                        if (capturedFromHand) aiPlayedCardId = capturedFromHand.id;
                    } else {
                        // Drop
                        const prevHandIds = new Set(prevP.hand.map(c => c.id));
                        const lastTableIds = new Set(this.lastState.table.map(c => c.id));
                        const droppedCard = state.table.find(c => prevHandIds.has(c.id) && !lastTableIds.has(c.id));
                        if (droppedCard) aiPlayedCardId = droppedCard.id;
                    }
                }
            });
        }

        // --- TRACK CARDS ---
        const validIds = new Set();
        const capturedTableIds = [];
        if (aiPlayedCardId) {
            const prevTable = this.lastState.table;
            const currTableIds = new Set(state.table.map(c => c.id));
            prevTable.forEach(c => {
                if (!currTableIds.has(c.id) && c.id !== aiPlayedCardId) {
                    capturedTableIds.push(c.id);
                }
            });
        }

        // Table
        state.table.forEach((card, i) => {
            validIds.add(card.id);
            if (this.aiAnimatingCards.has(card.id)) return;
            // Center table cards vertically
            const { x } = this.getTableCoords(i, state.table.length);
            const y = height / 2;
            this.syncCard(card.id, x, y, 0, true, 'table', tableCardW, tableCardH, handCardH);
        });

        // Positions config (Moved up)

        // Find my index
        const myIndex = state.players.findIndex(p => p.name === this.currentPlayerName);
        const validMyIndex = myIndex === -1 ? 0 : myIndex; // Fallback

        let activeTurnPos = null;

        // Render Players
        let currentTurnName = state.players[state.current_player_index]?.name;
        // Fix: If AI is animating, keep ball on them until next state
        if (aiPlayerIndex !== -1) {
            currentTurnName = state.players[aiPlayerIndex].name;
        }

        // Update Indicator - MOVED TO END
        // this.updateTurnIndicator(currentTurnName);

        // Helper for Relative Position (Enforces 2-Player Face-to-Face)
        // Note: Defining it here is wrong if this is inside renderState. 
        // But see line 367: 'renderState(state, playerName) {'
        // The previous tool inserted 'getRelativePos' BEFORE 'renderState', but seemingly inside the previous method?
        // Let's assume we are inside 'updateTurnIndicator'? No, line 354 says 'MOVED TO END'.
        // We are likely inside 'updateGameState' or similar. 
        // Actually, let's look at the class structure.
        // It seems safer to just use 'this.getRelativePos' and define it at class level.
        // I will replace this whole block to close the previous method and start Fresh.
    }

    // Helper for Relative Position (Enforces 2-Player Face-to-Face)
    getRelativePos(targetIndex, myIndex, totalPlayers) {
        let relativePos = (targetIndex - myIndex + 4) % 4;
        // Fix for 2-Player Mode: Force ANY Opponent to TOP (Pos 2)
        // Normal logic: P1 is Right of P0, P0 is Left of P1.
        // We want Face-to-Face (Top).
        if (totalPlayers === 2 && relativePos !== 0) {
            relativePos = 2;
        }
        return relativePos;
    }

    renderState(state, playerName, silent = false) {
        // Positions (0: Bottom, 1: Right, 2: Top, 3: Left)
        const width = this.scale.width;
        const height = this.scale.height;
        const handCardW = Math.min(width * 0.22, 120);
        const handCardH = handCardW * 1.5;
        const tableCardW = Math.min(width * 0.14, 80);
        const tableCardH = tableCardW * 1.5;
        const pileAlignX = width - 100;

        const positions = [
            { x: width / 2, y: height - (handCardH * 0.6), angle: 0 },   // Bottom (Me)
            { x: width - (handCardH * 0.6), y: height / 2, angle: -90 }, // Right
            { x: width / 2, y: handCardH * 0.6, angle: 180 },          // Top
            { x: handCardH * 0.6, y: height / 2, angle: 90 }           // Left
        ];

        // Identify "My" Index
        const myIndex = state.players.findIndex(p => p.name === playerName);
        const validMyIndex = myIndex === -1 ? 0 : myIndex; // Spectator view as P0

        // --- DETECT NEW AI PLAY ---
        let aiPlayedCardId = null;
        let aiPlayerIndex = -1;
        const capturedTableIds = [];

        if (this.lastState) {
            state.players.forEach((currP, idx) => {
                if (currP.name === playerName) return; // Skip me
                const prevP = this.lastState.players.find(p => p.name === currP.name);
                if (prevP && prevP.hand.length > currP.hand.length) {
                    aiPlayerIndex = idx;
                    if (currP.captured_cards.length > prevP.captured_cards.length) {
                        // Capture
                        const diff = currP.captured_cards.filter(c => !prevP.captured_cards.some(pc => pc.id === c.id));
                        const capturedFromHand = diff.find(c => prevP.hand.some(h => h.id === c.id));
                        if (capturedFromHand) aiPlayedCardId = capturedFromHand.id;
                    } else {
                        // Drop
                        const prevHandIds = new Set(prevP.hand.map(c => c.id));
                        const lastTableIds = new Set(this.lastState.table.map(c => c.id));
                        const droppedCard = state.table.find(c => prevHandIds.has(c.id) && !lastTableIds.has(c.id));
                        if (droppedCard) aiPlayedCardId = droppedCard.id;
                    }
                }
            });
        }

        if (aiPlayedCardId) {
            // Find captured table cards
            const prevTable = this.lastState.table;
            const currTableIds = new Set(state.table.map(c => c.id));
            prevTable.forEach(c => {
                if (!currTableIds.has(c.id) && c.id !== aiPlayedCardId) {
                    capturedTableIds.push(c.id);
                }
            });

            // Trigger Animation
            if (!this.aiAnimatingCards.has(aiPlayedCardId)) {
                let startX = width / 2;
                let startY = 0;
                if (aiPlayerIndex !== -1) {
                    const relativePos = this.getRelativePos(aiPlayerIndex, validMyIndex, state.players.length);
                    const startConfig = positions[relativePos];
                    startX = startConfig.x;
                    startY = startConfig.y;
                }
                this.runAiSequence(aiPlayedCardId, capturedTableIds, state, width, height, handCardH, tableCardW, tableCardH, pileAlignX, startX, startY);
            }
        }

        // Render Table Cards
        // console.log("DEBUG: Render State Table:", state.table);
        const currentTableIds = new Set(state.table.map(c => c.id));
        this.tableCards.getChildren().forEach(sprite => {
            if (!currentTableIds.has(sprite.card_id) && !this.aiAnimatingCards.has(sprite.card_id)) {
                // Remove card if not in table and not animating
                // But wait, it might be captured? 
                // We handle removals in cleanupRemovedCards
            }
        });

        // Add New Table Cards
        state.table.forEach((card, index) => {
            if (!this.cardMap.has(card.id)) {
                const coords = this.getTableCoords(index, state.table.length);
                this.syncCard(card.id, coords.x, coords.y, 0, true, 'table', tableCardW, tableCardH, handCardH, 0, silent);
            }
        });

        // Sync Table Positions (for existing cards)
        state.table.forEach((card, index) => {
            if (!this.aiAnimatingCards.has(card.id)) {
                const sprite = this.cardMap.get(card.id);
                if (sprite) {
                    const coords = this.getTableCoords(index, state.table.length);

                    // Force Resize to Table Dimensions (Fix for "Giant Cards")
                    this.updateCardTexture(sprite, card.id, true, tableCardW, tableCardH);

                    this.tweens.add({
                        targets: sprite,
                        x: coords.x,
                        y: coords.y,
                        angle: (Math.random() * 10 - 5), // Random jitter
                        duration: 400,
                        ease: 'Cubic.easeOut'
                    });
                }
            }
        });

        // Render Players
        const validIds = new Set();
        state.table.forEach(c => validIds.add(c.id));

        // Detect AI Move (Turn just changed, was AI?)
        // Logic moved to top to prevent race conditions

        // Determine whose turn it is
        let currentTurnName = "";
        if (state.players.length > 0) {
            currentTurnName = state.players[state.current_player_index].name;
        }

        // Check if an AI just played (hacky state diff or event?)
        // For animations, we really need the event. But let's rely on standard 'sync' for now unless we have the event data.
        // The 'updateGameState' function might store previous state?

        state.players.forEach((p, index) => {
            // Use helper
            const relativePos = this.getRelativePos(index, validMyIndex, state.players.length);
            const posConfig = positions[relativePos];

            // Turn Indicator / Name Label
            const isMyTurn = (p.name === currentTurnName);
            const nameColor = isMyTurn ? '#00ff00' : '#ffffff';
            const nameSize = isMyTurn ? '20px' : '16px';
            const nameWeight = isMyTurn ? 'bold' : 'normal';

            // Offset text based on position to not overlap cards
            let textX = posConfig.x;
            let textY = posConfig.y;
            if (relativePos === 0) textY += 80; // Bottom
            else if (relativePos === 1) textX += 60; // Right
            else if (relativePos === 2) textY -= 80; // Top
            else if (relativePos === 3) textX -= 60; // Left

            // Use a persistent text object map keyed by Index (Stable)
            const textId = `name_p_${index}`;
            let nameText = this.children.getByName(textId);
            if (nameText) {
                // Update existing
                nameText.setPosition(textX, textY);
                nameText.setText(p.name);
                nameText.setStyle({ font: `${nameWeight} ${nameSize} monospace`, fill: nameColor, backgroundColor: '#00000088' });
                nameText.setDepth(200);
            } else {
                // Create new
                this.add.text(textX, textY, p.name, {
                    font: `${nameWeight} ${nameSize} monospace`, fill: nameColor, backgroundColor: '#00000088'
                }).setOrigin(0.5).setName(textId).setDepth(200);
            }

            p.hand.forEach((card, i) => {
                validIds.add(card.id);
                // Skip dragging card
                if (relativePos === 0 && this.draggingCardId === card.id) return;

                // Layout logic per position
                let x, y, angle;
                const offset = (i - (p.hand.length - 1) / 2) * 30; // Spacing

                if (relativePos === 0 || relativePos === 2) { // Horizontal (Bottom/Top)
                    x = posConfig.x + offset;
                    y = posConfig.y;
                    angle = (relativePos === 0) ? offset * 0.5 : 180 + offset * 0.5; // Fan curve
                } else { // Vertical (Right/Left)
                    x = posConfig.x;
                    y = posConfig.y + offset;
                    angle = posConfig.angle + offset * 0.5;
                }

                // Determine Texture
                const isFaceUp = (relativePos === 0);
                const dealDelay = (i * state.players.length + index) * 150;

                const sprite = this.syncCard(card.id, x, y, angle, isFaceUp, `hand_${relativePos}`, handCardW, handCardH, handCardH, dealDelay, silent);

                if (relativePos === 0) {
                    sprite.setInteractive();
                    sprite.card_id = card.id;
                    sprite.player_index = state.players.indexOf(p);
                    if (isMyTurn) {
                        this.input.setDraggable(sprite);
                    }
                }
            });

            // Render Piles (Captured Cards)
            this.renderPile(p, relativePos, width, height, handCardW);
        });

        // Removed inline ball render. Handled by updateTurnIndicator.
        // Cleanup old spotlight logic if any remains (mostly legacy)
        if (this.turnSpotlight) { this.turnSpotlight.destroy(); this.turnSpotlight = null; }

        // AI Animation Logic
        // AI Animation Logic (Moved to Top)
        // Fallback: If it's AI turn and no animation is running, trigger backend (e.g. if animation failed or state sync missed it)
        const currentP = state.players[state.current_player_index];
        if (currentP && currentP.is_ai && !this.aiAnimatingCards.size && !aiPlayedCardId) {
            // console.log("DEBUG: Triggering AI Turn (No Animation)");
            this.time.delayedCall(500, () => this.sendAnimationComplete());
        }

        // Cleanup
        const cleanupDelay = this.cleanupRemovedCards(validIds, state.players, validMyIndex, width, height);

        // Update Indicator - Delayed by capture animation
        this.time.delayedCall(cleanupDelay, () => {
            this.updateTurnIndicator(currentTurnName);
        });
    }

    runAiSequence(aiPlayedCardId, capturedTableIds, state, width, height, handCardH, tableCardW, tableCardH, pileAlignX, startX, startY) {
        this.aiAnimatingCards.add(aiPlayedCardId);
        capturedTableIds.forEach(id => this.aiAnimatingCards.add(id));

        this.playSound('card_slide');

        let playedSprite = this.cardMap.get(aiPlayedCardId);
        if (!playedSprite) {
            // Use dynamic start position
            playedSprite = this.createCardSprite(startX, startY, aiPlayedCardId, false, tableCardW, tableCardH);
            playedSprite.setAlpha(1);
            this.cardMap.set(aiPlayedCardId, playedSprite);
            this.tableCards.add(playedSprite);
        }
        this.children.bringToTop(playedSprite);

        // Sequence
        this.tweens.add({
            targets: playedSprite, x: width / 2, y: height * 0.35, angle: 0, duration: 400, ease: 'Cubic.easeOut',
            onComplete: () => {
                this.tweens.add({
                    targets: playedSprite, scaleX: 0, duration: 150,
                    onComplete: () => {
                        this.updateCardTexture(playedSprite, aiPlayedCardId, true, tableCardW, tableCardH);
                        this.tweens.add({
                            targets: playedSprite, scaleX: 1, duration: 150,
                            onComplete: () => {
                                this.time.delayedCall(300, () => {
                                    if (capturedTableIds.length > 0) {
                                        // Capture
                                        capturedTableIds.forEach(id => {
                                            const s = this.cardMap.get(id);
                                            // Classy Gold Highlight
                                            const glow = this.add.rectangle(0, 0, tableCardW + 16, tableCardH + 16, 0xFFD700, 0.25);
                                            glow.setStrokeStyle(4, 0xFFD700, 1);
                                            s.addAt(glow, 0); // Behind the card

                                            // Pulse effect
                                            this.tweens.add({
                                                targets: glow,
                                                alpha: 0.6,
                                                scale: 1.05,
                                                duration: 250,
                                                yoyo: true,
                                                repeat: 2
                                            });
                                        });
                                        this.time.delayedCall(400, () => {
                                            this.tweens.add({
                                                targets: playedSprite, x: width / 2, y: height / 2, duration: 400, ease: 'Back.easeOut',
                                                onComplete: () => {
                                                    this.time.delayedCall(200, () => {
                                                        const allSprites = [playedSprite, ...capturedTableIds.map(id => this.cardMap.get(id)).filter(x => x)];
                                                        // Fix: Bring to top so they don't slide under other table cards
                                                        allSprites.forEach(s => s.setDepth(100));

                                                        // Identify Capturer to determine Pile Position
                                                        let targetX = pileAlignX;
                                                        let targetY = 200;
                                                        // Find who captured. It's the AI who played. 
                                                        // We can find owner of aiPlayedCardId in players.captured_cards OR hand (if it bounced back? No impossible on capture).
                                                        // Actually, capturing player IS the AI who is playing. We might pass it or deduce it.
                                                        // Deduce from state: The player who has aiPlayedCardId in captured_cards or whose turn just ended?
                                                        // Safest: Look for aiPlayedCardId in captured_cards of all players.
                                                        const capturer = state.players.find(p => p.captured_cards.some(c => c.id === aiPlayedCardId));
                                                        let targetAngle = 0;

                                                        if (capturer) {
                                                            const myIndex = state.players.findIndex(p => p.name === this.currentPlayerName);
                                                            const validMyIndex = myIndex === -1 ? 0 : myIndex;
                                                            const capIndex = state.players.indexOf(capturer);
                                                            const relativePos = (capIndex - validMyIndex + 4) % 4;
                                                            const coords = this.getPileCoords(relativePos, width, height, 0);
                                                            targetX = coords.x;
                                                            targetY = coords.y;
                                                            targetAngle = coords.angle; // Use pile angle
                                                        }

                                                        this.tweens.add({
                                                            targets: allSprites, x: targetX, y: targetY, angle: targetAngle, scale: 0.3, alpha: 0, duration: 600, ease: 'Back.easeIn',
                                                            onComplete: () => {
                                                                allSprites.forEach(s => { if (s) { s.destroy(); if (s.card_id) this.cardMap.delete(s.card_id); } });
                                                                this.aiAnimatingCards.delete(aiPlayedCardId);
                                                                capturedTableIds.forEach(id => this.aiAnimatingCards.delete(id));
                                                                this.cardMap.delete(aiPlayedCardId);
                                                                capturedTableIds.forEach(id => this.cardMap.delete(id));

                                                                // Sync complete
                                                                this.sendAnimationComplete();
                                                            }
                                                        });
                                                    });
                                                }
                                            });
                                        });
                                    } else {
                                        // Drop
                                        const tableIndex = state.table.findIndex(c => c.id === aiPlayedCardId);
                                        const finalCoords = this.getTableCoords(tableIndex !== -1 ? tableIndex : state.table.length, state.table.length);
                                        // Add jitter to match table style
                                        const jitter = (Math.random() * 10 - 5);

                                        // Ensure texture size is correct (in case previous step failed)
                                        this.updateCardTexture(playedSprite, aiPlayedCardId, true, tableCardW, tableCardH);

                                        this.tweens.add({
                                            targets: playedSprite,
                                            x: finalCoords.x,
                                            y: finalCoords.y,
                                            angle: jitter,
                                            scale: 1, // Enforce scale 1
                                            duration: 400,
                                            ease: 'Cubic.easeOut',
                                            onComplete: () => {
                                                this.aiAnimatingCards.delete(aiPlayedCardId);
                                                this.sendAnimationComplete();
                                            }
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

    getPileCoords(relativePos, width, height, pileAlignX) {
        // relativePos: 0=Bottom, 1=Right, 2=Top, 3=Left
        // "A cote de la main":
        // 0: Bottom Center -> Pile to Right
        // 1: Right Center -> Pile Below 
        // 2: Top Center -> Pile to Left
        // 3: Left Center -> Pile Above
        switch (relativePos) {
            case 0: return { x: width / 2 + 200, y: height - 80, angle: 0 };
            case 1: return { x: width - 80, y: height / 2 + 200, angle: -90 };
            case 2: return { x: width / 2 - 200, y: 80, angle: 180 };
            case 3: return { x: 80, y: height / 2 - 200, angle: 90 };
            default: return { x: width / 2, y: height / 2, angle: 0 };
        }
    }

    cleanupRemovedCards(validIds, players, myIndex, width, height) {
        let maxDuration = 0;
        this.cardMap.forEach((sprite, id) => {
            if (this.aiAnimatingCards.has(id)) return;
            if (!validIds.has(id)) {

                // Find who captured it
                let capturerRelPos = -1;
                const owner = players.find(p => p.captured_cards.some(c => c.id === id));
                if (owner) {
                    const pIndex = players.indexOf(owner);
                    capturerRelPos = (pIndex - myIndex + 4) % 4;
                }

                if (capturerRelPos === -1) {
                    // Not found (maybe deck refill?), just destroy
                    sprite.destroy(); this.cardMap.delete(id); return;
                }

                const coords = this.getPileCoords(capturerRelPos, width, height, 0);
                const targetPileX = coords.x;
                const targetPileY = coords.y;

                this.children.bringToTop(sprite);
                sprite.setDepth(100);

                // Classy Gold Highlight logic (Keep same)
                const pileW = 56;
                const pileH = 84;
                const glow = this.add.rectangle(0, 0, pileW + 16, pileH + 16, 0xFFD700, 0.25);
                glow.setStrokeStyle(4, 0xFFD700, 1);
                sprite.addAt(glow, 0);

                this.tweens.add({
                    targets: glow, alpha: 0.6, scale: 1.05, duration: 250, yoyo: true, repeat: 2
                });

                const CAPTURE_DURATION = 600;
                maxDuration = Math.max(maxDuration, CAPTURE_DURATION);

                this.tweens.add({
                    targets: sprite, x: targetPileX, y: targetPileY, scale: 0.3, alpha: 0, duration: CAPTURE_DURATION, ease: 'Back.easeIn',
                    onComplete: () => { sprite.destroy(); this.cardMap.delete(id); }
                });
            }
        });
        return maxDuration;
    }

    renderPile(p, relativePos, width, height, handCardW) {
        // Dynamic Groups for piles? simpler to just draw images for now or manage an array of groups
        // If we want persistent piles we need groups. But scene only has playerCapturedPile / opponentCapturedPile.
        // For 4 players we need a Map of piles or just recreate them. 
        // Let's assume we clear and redraw piles every frame? No that's expensive for images.
        // Better: Create groups on demand.

        let groupName = `pile_${relativePos}`;
        if (!this[groupName]) {
            this[groupName] = this.add.group();
            this[groupName].setDepth(5);
        }
        const group = this[groupName];
        group.clear(true, true);

        const count = Math.ceil(p.captured_cards.length / 2);
        const pileW = handCardW * 0.7;
        const pileH = pileW * 1.5;

        const coords = this.getPileCoords(relativePos, width, height, 0);
        const pileX = coords.x;
        const pileY = coords.y;
        const pileAngle = coords.angle;

        for (let i = 0; i < count; i++) {
            const back = this.add.image(pileX + (i * 2), pileY - (i * 2), 'card_back').setDisplaySize(pileW, pileH);
            back.setAngle(pileAngle); // Match player orientation "dans le meme sens"
            group.add(back);
        }
        for (let i = 0; i < (p.chkoubas || 0); i++) {
            const cardId = p.captured_cards.length > 0 ? p.captured_cards[i % p.captured_cards.length].id : '1H';
            const chkoubaCard = this.add.image(pileX + (i * 15), pileY - (count * 2) - 10, cardId).setDisplaySize(pileW, pileH);
            chkoubaCard.setAngle(pileAngle + 45); // Tilt chkoubas slightly but relative to pile
            group.add(chkoubaCard);
        }
    }

    syncCard(id, x, y, angle, isFaceUp, location, w, h, handH, delay = 0, silent = false) {
        const { width } = this.scale;
        let sprite = this.cardMap.get(id);
        if (!sprite) {
            let spawnX = 60; // deckX
            let spawnY = 220; // deckY
            let startScale = 0.5;
            let startAlpha = 1; // Force visible immediately to prevent hidden cards
            const wasInTable = this.lastState?.table.find(c => c.id === id);
            // Rough check for "wasInPlayer", assumes playerName access via prop if needed, but for visual spawn deck is fine fallback
            if (location === 'table' && !wasInTable) { spawnX = width / 2; spawnY = handH * 0.4; startScale = 0.7; startAlpha = 1; }

            sprite = this.createCardSprite(spawnX, spawnY, id, isFaceUp, w, h);
            sprite.setAlpha(startAlpha);
            sprite.setScale(startScale);
            sprite.card_id = id;
            this.cardMap.set(id, sprite);

            if (location === 'table') { this.tableCards.add(sprite); sprite.setDepth(10); }
            else if (location === 'player') { this.playerHand.add(sprite); sprite.setDepth(20); }
            else { this.opponentArea.add(sprite); sprite.setDepth(20); }
        }
        this.updateCardTexture(sprite, id, isFaceUp, w, h);

        // Fix: If AI is animating this card, DO NOT interfere (no tween, no sound)
        if (this.aiAnimatingCards.has(id)) {
            return sprite;
        }

        // Fix: Prevent "Spinning" or Jitter if already in place
        // Kill running tweens to prevent conflict
        this.tweens.killTweensOf(sprite);

        const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, x, y);
        const angleDiff = Phaser.Math.Angle.ShortestBetween(sprite.angle, angle);

        // If "close enough", just snap
        // Fix: Removed 'delay === 0' check. If it's already there, SNAP IT.
        // We only animate if it's FAR away (i.e. just spawned at deck).
        if (dist < 50 && Math.abs(angleDiff) < 5) {
            sprite.setPosition(x, y);
            sprite.setAngle(angle);
            sprite.setScale(1);
            sprite.setAlpha(1);
        } else {
            // Fix: Use Shortest Angle for Tween
            const shortestAngle = sprite.angle + angleDiff;
            this.tweens.add({ targets: sprite, x: x, y: y, angle: shortestAngle, scale: 1, alpha: 1, duration: 600, delay: delay, ease: 'Cubic.easeOut' });

            // Play sound if not just a micro-adjust AND not silent
            if (!silent && (delay > 0 || dist > 100)) {
                this.time.delayedCall(delay, () => this.playSound('card_slide'));
            }
        }
        return sprite;
    }

    updateCardTexture(container, label, isFaceUp, w, h) {
        if (container.list.length < 2) return;
        let visual = container.getAt(1);

        // Determine what we want
        const wantsImage = isFaceUp ? this.textures.exists(label) : this.textures.exists('card_back');
        const isImage = visual.type === 'Image';

        // Check if we need to swap Sprite Type (Rectangle <-> Image)
        if (wantsImage !== isImage) {
            // Re-create visual
            visual.destroy();
            if (wantsImage) {
                const textureKey = isFaceUp ? label : 'card_back';
                visual = this.add.image(0, 0, textureKey);
            } else {
                const color = isFaceUp ? 0xffffff : 0x880000;
                visual = this.add.rectangle(0, 0, w, h, color);
            }
            container.addAt(visual, 1);
        }

        // Update Properties
        if (visual.type === 'Image') {
            const key = isFaceUp ? label : 'card_back';
            if (visual.texture.key !== key) visual.setTexture(key);
        }

        visual.setDisplaySize(w, h);
        container.getAt(0).setDisplaySize(w, h);
        container.setSize(w, h);
    }

    createCardSprite(x, y, label, isFaceUp, w = 80, h = 120) {
        const container = this.add.container(x, y);

        // 0: Shadow
        container.add(this.add.rectangle(4, 4, w, h, 0x000000, 0.4).setOrigin(0.5));

        // 1: Card Visual
        if (isFaceUp) {
            if (this.textures.exists(label)) {
                container.add(this.add.image(0, 0, label).setDisplaySize(w, h));
            } else {
                // Fallback Face
                const bg = this.add.rectangle(0, 0, w, h, 0xffffff);
                const txt = this.add.text(0, 0, label, { color: '#000', fontSize: '16px', fontStyle: 'bold' }).setOrigin(0.5);
                container.add(bg); // Note: this messes up index 1 if we add multiple. 
                container.add(txt);
                // Container now has 3 children if fallback used. updateCardTexture needs to handle this.
                // Simplified: Just add THE visual at index 1. Group fallbacks into a Container? 
                // Too complex for hotfix. Let's just use Text on Rectangle?
                // Actually, just add the Rectangle, it's index 1. Text is index 2.
            }
        } else {
            if (this.textures.exists('card_back')) {
                container.add(this.add.image(0, 0, 'card_back').setDisplaySize(w, h));
            } else {
                // Fallback Back (Red Rectangle)
                container.add(this.add.rectangle(0, 0, w, h, 0x880000));
            }
        }

        container.setSize(w, h);
        return container;
    }

    // --- HELPERS ---

    sendAnimationComplete() {
        const send = this.registry.get('sendMessage');
        if (send) {
            // console.log("DEBUG: Sending ANIMATION_COMPLETE");
            send({ type: "ANIMATION_COMPLETE" });

            // Fix: Update Turn Indicator to REAL current player (e.g. Me) now that anim is done
            if (this.lastState) {
                const realCurrentName = this.lastState.players[this.lastState.current_player_index]?.name;
                if (realCurrentName) this.updateTurnIndicator(realCurrentName);
            }
        }
    }

    updateTurnIndicator(playerName) {
        if (!this.lastState) return;
        const state = this.lastState;
        const { width, height } = this.scale;

        // Recalculate positions using helper for consistent Face-to-Face logic
        const myIndex = state.players.findIndex(p => p.name === this.currentPlayerName);
        const validMyIndex = myIndex === -1 ? 0 : myIndex;
        const targetIndex = state.players.findIndex(p => p.name === playerName);

        if (targetIndex === -1) return;

        // Use the centralized helper!
        const relativePos = this.getRelativePos(targetIndex, validMyIndex, state.players.length);

        const handCardH = Math.min(width * 0.22, 120) * 1.5;
        // Re-define positions locally or fetch from class if stored.
        // For safety, duplicating the config to match renderState exactly.
        const positions = [
            { name: 'bottom', x: width / 2, y: height - (handCardH * 0.6), angle: 0 },
            { name: 'right', x: width - (handCardH * 0.6), y: height / 2, angle: -90 },
            { name: 'top', x: width / 2, y: handCardH * 0.6, angle: 180 },
            { name: 'left', x: handCardH * 0.6, y: height / 2, angle: 90 }
        ];

        const posConfig = positions[relativePos];
        let ballX = posConfig.x;
        let ballY = posConfig.y;

        // Offset logic must match renderState text offset
        if (relativePos === 0) ballY -= 70;
        else if (relativePos === 1) ballX -= 70;
        else if (relativePos === 2) ballY += 70;
        else if (relativePos === 3) ballX += 70;

        if (!this.turnIndicatorBall) {
            this.turnIndicatorBall = this.add.circle(0, 0, 15, 0xFF4444);
            this.turnIndicatorBall.setStrokeStyle(2, 0xFFFFFF, 1);
            this.turnIndicatorBall.setDepth(3000);
            this.tweens.add({
                targets: this.turnIndicatorBall, scale: 1.8, alpha: 0.8, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        }
        this.turnIndicatorBall.setPosition(ballX, ballY);
        this.turnIndicatorBall.setVisible(true);

        // Play "Bing" if it becomes MY turn
        if (playerName === this.currentPlayerName && this.lastState) {
            // Only if previous turn wasn't me (avoid repetition)?
            // Or just always play when indicator updates to me?
            // Helper called frequently? Only call if changed?
            // Since updateTurnIndicator IS called explicitly on change or Anim End.
            // We can check if previous indicator target was different?
            // Simplest: Check if I wasnt active before?
            // Actually, `updateTurnIndicator` is idempotent. 
            // Let's just play it. If it spans repetitively, we throttle.
            // Better: Dedup by storing `lastTurnPlayer`.
            if (this.lastTurnPlayer !== playerName) {
                this.playSound('turn_alert');
                this.lastTurnPlayer = playerName;
            }
        } else {
            if (this.lastTurnPlayer !== playerName) this.lastTurnPlayer = playerName;
        }
    }

    getTableCoords(i, total) {
        const { width, height } = this.scale;
        const tableCardW = Math.min(width * 0.14, 80);
        const spacing = tableCardW * 1.1;
        const totalWidth = (total - 1) * spacing;
        const startX = (width / 2) - (totalWidth / 2);
        return { x: startX + i * spacing, y: height / 2, angle: 0 };
    }
}
