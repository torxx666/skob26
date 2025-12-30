
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

        // Callbacks
        this.onPlayCard = null; // (playerIndex, cardId, comboIndex) => void
    }

    preload() {
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

    create(data) {
        if (data && data.onPlayCard) {
            this.onPlayCard = data.onPlayCard;
        }

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
            if (this.lastState) this.renderState(this.lastState, this.currentPlayerName);
        });
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

    // --- CORE LOGIC (Originally renderState) ---
    renderState(state, playerName) {
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

        // --- DETECT NEW AI PLAY ---
        let aiPlayedCardId = null;
        if (opponent && this.lastState) {
            const prevOpp = this.lastState.players.find(p => p.name !== playerName);
            const currentOpp = opponent;
            if (prevOpp && prevOpp.hand.length > currentOpp.hand.length) {
                if (currentOpp.captured_cards.length > prevOpp.captured_cards.length) {
                    const diff = currentOpp.captured_cards.filter(c => !prevOpp.captured_cards.some(pc => pc.id === c.id));
                    const capturedFromHand = diff.find(c => prevOpp.hand.some(h => h.id === c.id));
                    if (capturedFromHand) aiPlayedCardId = capturedFromHand.id;
                } else {
                    const prevHandIds = new Set(prevOpp.hand.map(c => c.id));
                    const lastTableIds = new Set(this.lastState.table.map(c => c.id));
                    const droppedCard = state.table.find(c => prevHandIds.has(c.id) && !lastTableIds.has(c.id));
                    if (droppedCard) aiPlayedCardId = droppedCard.id;
                }
            }
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

        // Player Hand - SAFE ZONE BOTTOM
        if (player) {
            player.hand.forEach((card, i) => {
                validIds.add(card.id);
                if (this.draggingCardId === card.id) return;

                const total = player.hand.length;
                const radius = width * 0.5;
                const angleStep = 0.15;
                const startAngle = -Math.PI / 2 - ((total - 1) * angleStep) / 2;
                const currentAngle = startAngle + i * angleStep;

                // Position relative to bottom, keeping gap from table
                const yBase = height - (handCardH * 0.6);
                const x = width / 2 + Math.cos(currentAngle) * radius;
                // Adjust curve slightly
                const y = yBase + Math.sin(currentAngle) * (radius * 0.1);

                const rotation = (currentAngle + Math.PI / 2) * 50;

                let dealDelay = 0;
                const wasPresent = this.lastState?.players.find(p => p.name === playerName)?.hand.some(c => c.id === card.id);
                if (!wasPresent && aiPlayedCardId) dealDelay = 3500;

                const sprite = this.syncCard(card.id, x, y, rotation, true, 'player', handCardW, handCardH, handCardH, dealDelay);
                sprite.setInteractive();
                sprite.card_id = card.id;
                sprite.player_index = state.players.indexOf(player);
                this.input.setDraggable(sprite);
            });
        }

        // Opponent Hand - SAFE ZONE TOP
        if (opponent) {
            opponent.hand.forEach((card, i) => {
                validIds.add(card.id); // <--- CRITICAL FIX
                const total = opponent.hand.length;
                // Compact fan for opponent
                const x = (width / 2) + (i - (total - 1) / 2) * (handCardW * 0.5);
                const y = 100; // As requested ~50-100 zone
                const angle = (i - (total - 1) / 2) * -5;

                if (this.aiAnimatingCards.has(card.id)) return;

                let dealDelay = 0;
                const wasPresent = this.lastState?.players.find(p => p.name !== playerName)?.hand.some(c => c.id === card.id);
                if (!wasPresent && aiPlayedCardId) dealDelay = 3500;

                this.syncCard(card.id, x, y, angle, false, 'opponent', handCardW * 0.7, handCardH * 0.7, handCardH, dealDelay);
            });
        }

        // AI Animation Logic
        if (aiPlayedCardId && !this.aiAnimatingCards.has(aiPlayedCardId)) {
            this.runAiSequence(aiPlayedCardId, capturedTableIds, state, width, height, handCardH, tableCardW, tableCardH, pileAlignX);
        }

        // Cleanup
        this.cleanupRemovedCards(validIds, player, opponent, width, height, pileAlignX);

        // Piles
        if (player) this.renderPile(player, true, height, pileAlignX, handCardW);
        if (opponent) this.renderPile(opponent, false, height, pileAlignX, handCardW);
    }

    runAiSequence(aiPlayedCardId, capturedTableIds, state, width, height, handCardH, tableCardW, tableCardH, pileAlignX) {
        this.aiAnimatingCards.add(aiPlayedCardId);
        capturedTableIds.forEach(id => this.aiAnimatingCards.add(id));

        let playedSprite = this.cardMap.get(aiPlayedCardId);
        if (!playedSprite) {
            playedSprite = this.createCardSprite(width / 2, handCardH * 0.4, aiPlayedCardId, false, tableCardW, tableCardH);
            playedSprite.setAlpha(1);
            this.cardMap.set(aiPlayedCardId, playedSprite);
            this.tableCards.add(playedSprite);
        }
        this.children.bringToTop(playedSprite);

        // Sequence
        this.tweens.add({
            targets: playedSprite, x: width / 2, y: height * 0.35, duration: 800, ease: 'Cubic.easeOut',
            onComplete: () => {
                this.tweens.add({
                    targets: playedSprite, scaleX: 0, duration: 300,
                    onComplete: () => {
                        this.updateCardTexture(playedSprite, aiPlayedCardId, true, tableCardW, tableCardH);
                        this.tweens.add({
                            targets: playedSprite, scaleX: 1, duration: 300,
                            onComplete: () => {
                                this.time.delayedCall(1000, () => {
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
                                                duration: 400,
                                                yoyo: true,
                                                repeat: 2
                                            });
                                        });
                                        this.time.delayedCall(800, () => {
                                            this.tweens.add({
                                                targets: playedSprite, x: width / 2, y: height / 2, duration: 600, ease: 'Back.easeOut',
                                                onComplete: () => {
                                                    this.time.delayedCall(600, () => {
                                                        const allSprites = [playedSprite, ...capturedTableIds.map(id => this.cardMap.get(id)).filter(x => x)];
                                                        // Fix: Bring to top so they don't slide under other table cards
                                                        allSprites.forEach(s => s.setDepth(100));
                                                        this.tweens.add({
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
                                        // Drop
                                        const finalCoords = this.getTableCoords(state.table.findIndex(c => c.id === aiPlayedCardId), state.table.length);
                                        this.tweens.add({
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

    cleanupRemovedCards(validIds, player, opponent, width, height, pileAlignX) {
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

                this.children.bringToTop(sprite);
                sprite.setDepth(100); // Fix: Ensure they float over everything

                // Classy Gold Highlight for Player Captures too
                const pileW = 56; // Approx pile width (handCardW * 0.7)
                const pileH = 84;
                const glow = this.add.rectangle(0, 0, pileW + 16, pileH + 16, 0xFFD700, 0.25);
                glow.setStrokeStyle(4, 0xFFD700, 1);
                sprite.addAt(glow, 0);

                // Pulse effect
                this.tweens.add({
                    targets: glow,
                    alpha: 0.6,
                    scale: 1.05,
                    duration: 400,
                    yoyo: true,
                    repeat: 2
                });

                this.tweens.add({
                    targets: sprite, x: targetPileX, y: targetPileY, scale: 0.3, alpha: 0, duration: 1000, ease: 'Back.easeIn', // Increased duration slightly for effect
                    onComplete: () => { sprite.destroy(); this.cardMap.delete(id); }
                });
            }
        });
    }

    renderPile(p, isPlayer, height, pileAlignX, handCardW) {
        const group = isPlayer ? this.playerCapturedPile : this.opponentCapturedPile;
        group.clear(true, true);

        const count = Math.ceil(p.captured_cards.length / 2);
        const pileW = handCardW * 0.7;
        const pileH = pileW * 1.5;
        const pileX = pileAlignX;
        const pileY = isPlayer ? height - 200 : 200;

        for (let i = 0; i < count; i++) {
            const back = this.add.image(pileX + (Math.random() - 0.5) * 6, pileY - (i * 2), 'card_back').setDisplaySize(pileW, pileH);
            back.setAngle((Math.random() - 0.5) * 15);
            group.add(back);
        }
        for (let i = 0; i < (p.chkoubas || 0); i++) {
            const cardId = p.captured_cards.length > 0 ? p.captured_cards[i % p.captured_cards.length].id : '1H';
            const chkoubaCard = this.add.image(pileX + (i * 15) - 10, pileY - (count * 2) - 10, cardId).setDisplaySize(pileW, pileH);
            chkoubaCard.setAngle(45 + (i * 5));
            group.add(chkoubaCard);
        }
    }

    syncCard(id, x, y, angle, isFaceUp, location, w, h, handH, delay = 0) {
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
        this.tweens.add({ targets: sprite, x: x, y: y, angle: angle, scale: 1, alpha: 1, duration: 600, delay: delay, ease: 'Cubic.easeOut' });
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

    getTableCoords(i, total) {
        const { width, height } = this.scale;
        const tableCardW = Math.min(width * 0.14, 80);
        const spacing = tableCardW * 1.1;
        const totalWidth = (total - 1) * spacing;
        const startX = (width / 2) - (totalWidth / 2);
        return { x: startX + i * spacing, y: height / 2, angle: 0 };
    }
}
