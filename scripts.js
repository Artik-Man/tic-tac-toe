"use strict";
class Subject {
    constructor() {
        this.subscriptions = [];
    }
    subscribe(subscriber) {
        const index = this.subscriptions.push(subscriber);
        return {
            unsubscribe: () => {
                this.subscriptions.splice(index, 1);
            }
        };
    }
    next(message) {
        this.subscriptions.forEach(sub => {
            sub(message);
        });
    }
}
class API {
    constructor() {
        this.message = new Subject();
        this.me = '';
        this.connect(() => {
        });
        setInterval(() => {
            this.ping();
        }, 10000);
    }
    ping() {
        this.send('SERVER', 'ping');
    }
    send(to, data) {
        this.connect(() => {
            var _a;
            (_a = this.connection) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({ to, data }));
        });
    }
    connect(onReady) {
        if (!this.connection || this.connection.readyState === WebSocket.CLOSED || this.connection.readyState === WebSocket.CLOSING) {
            delete this.connection;
            this.connection = new WebSocket('wss://ws-post.herokuapp.com/');
            this.connection.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                this.me = msg.to || this.me;
                this.message.next(msg);
            };
            this.connection.onopen = () => {
                onReady();
            };
        }
        else {
            onReady();
        }
    }
}
class Game {
    constructor(api) {
        this.api = api;
        this.name = '';
        this.enemy = null;
        this.store = new Map();
        this.stateChanged = new Subject();
        this.players = new Set();
        this.playersChanged = new Subject();
        this.api.message.subscribe(message => {
            if (typeof message.data !== 'string') {
                if (message.data && message.data.method === 'DOMINATION') {
                    this.onDomination(message);
                }
                else if (message.data && message.data.method === 'FIRE') {
                    this.onFire(message);
                }
                this.updatePlayerList(message);
            }
        });
    }
    updatePlayerList(message) {
        if (message) {
            if (message.connections) {
                message.connections.forEach(player => {
                    this.players.add(player);
                });
            }
            if (message.connected) {
                this.players.add(message.connected);
            }
            if (message.disconnected) {
                this.players.delete(message.disconnected);
            }
            this.players.delete(this.api.me);
        }
        const players = [];
        this.players.forEach(id => {
            const mark = this.checkMark(id);
            const name = this.getPlayerName(id);
            players.push({ id, mark, name });
        });
        players.sort((a, b) => b.name.localeCompare(a.name));
        this.playersChanged.next(players);
    }
    getPlayerName(id) {
        const state = this.getState(id);
        return (state === null || state === void 0 ? void 0 : state.name) || '';
    }
    checkMark(enemy) {
        const state = this.store.get(enemy);
        if (!state) {
            return false;
        }
        if (state.domination.enemy && !state.domination.me) {
            return true;
        }
        return state.turn;
    }
    onFire(message) {
        if (message.data && typeof message.data !== 'string' && message.data.method === 'FIRE') {
            const state = this.getState(message.from);
            if (state.turn) {
                console.warn('Enemy is cheater!');
            }
            else {
                state.turn = true;
                state.battlefield[message.data.index] = state.id.enemy;
                this.gameOver(state);
                this.stateChanged.next(state);
            }
        }
    }
    onDomination(message) {
        if (message.data && typeof message.data !== 'string' && message.data.method === 'DOMINATION') {
            const state = this.getState(message.from);
            state.domination.enemy = message.data.domination;
            state.name = message.data.name;
            this.checkStart(state);
        }
    }
    checkStart(state) {
        if (state.domination.me && state.domination.enemy) {
            state.turn = (state.domination.me > state.domination.enemy);
            state.started = true;
            this.stateChanged.next(state);
        }
    }
    static checkIWon(battlefield) {
        for (let i = 0; i < 3; i++) {
            let t = i * 3;
            if (battlefield[t] && battlefield[t] === battlefield[t + 1] && battlefield[t] === battlefield[t + 2]) {
                return [t, t + 1, t + 2];
            }
            if (battlefield[i] && battlefield[i] === battlefield[i + 3] && battlefield[i] === battlefield[i + 6]) {
                return [i, i + 3, i + 6];
            }
        }
        if (battlefield[0] && battlefield[0] === battlefield[4] && battlefield[0] === battlefield[8]) {
            return [0, 4, 8];
        }
        if (battlefield[2] && battlefield[2] === battlefield[4] && battlefield[2] === battlefield[6]) {
            return [2, 4, 6];
        }
        return [];
    }
    gameOver(state) {
        const indexes = Game.checkIWon(state.battlefield);
        if (indexes.length) {
            state.win = indexes;
            setTimeout(() => {
                this.clear(state);
            }, 5000);
        }
        else {
            const isOver = state.battlefield.filter(x => !!x).length === 9;
            if (isOver) {
                setTimeout(() => {
                    this.clear(state);
                }, 3000);
            }
        }
    }
    fire(index) {
        if (this.enemy) {
            const state = this.getState(this.enemy);
            if (state.turn) {
                state.turn = false;
                state.battlefield[index] = this.api.me;
                this.gameOver(state);
                this.stateChanged.next(state);
                this.api.send(this.enemy, {
                    method: "FIRE",
                    index
                });
                this.updatePlayerList();
            }
            else {
                console.warn('I am cheater');
            }
        }
    }
    start(id) {
        const state = this.getState(id);
        if (!state.started) {
            state.domination.me = Math.random() * Number.MAX_SAFE_INTEGER;
            this.checkStart(state);
            this.api.send(id, {
                method: "DOMINATION",
                domination: state.domination.me,
                name: this.name
            });
            this.updatePlayerList();
        }
    }
    clear(state) {
        state.battlefield.length = 0;
        state.win.length = 0;
        state.domination.me = null;
        // state.domination.enemy = null;
        state.started = false;
        state.turn = false;
        this.start(state.id.enemy);
    }
    setEnemy(id) {
        this.enemy = id;
        this.getState(id);
    }
    getEnemy() {
        return this.enemy;
    }
    getMe() {
        return this.api.me;
    }
    getState(id) {
        let state = this.store.get(id);
        if (!state) {
            state = {
                id: {
                    me: this.getMe(),
                    enemy: id
                },
                domination: {
                    me: null,
                    enemy: null
                },
                name: '',
                battlefield: [],
                win: [],
                started: false,
                turn: false
            };
            this.store.set(id, state);
        }
        return state;
    }
}
class Renderer {
    constructor(game) {
        this.playerListElement = document.getElementById('players');
        this.battlefieldElement = document.getElementById('battlefield');
        this.playerListElement.addEventListener('click', event => {
            const target = event.target;
            const button = (target.closest('button') || target);
            if (button) {
                const id = button.dataset.id || '';
                game.setEnemy(id);
                const state = game.getState(id);
                this.battlefield(state);
                game.start(id);
            }
        });
        this.battlefieldElement.addEventListener('click', event => {
            const target = event.target;
            if (target.closest('button')) {
                const parent = target.parentElement;
                const index = Array.from(parent.children).indexOf(target);
                game.fire(index);
            }
        });
        game.stateChanged.subscribe(state => {
            if (game.getEnemy() === state.id.enemy) {
                this.battlefield(state);
            }
        });
    }
    static getChar(state) {
        if (state.domination.me && state.domination.enemy) {
            return state.domination.me > state.domination.enemy ? {
                me: 'X',
                enemy: 'O'
            } : {
                me: 'O',
                enemy: 'X'
            };
        }
        else {
            return {
                me: '',
                enemy: ''
            };
        }
    }
    battlefield(state) {
        const chars = Renderer.getChar(state);
        const winner = new Set(state.win);
        let buttons = '';
        for (let i = 0; i < 9; i++) {
            let disabled = '';
            let char = '';
            if (!state.started || !state.turn || state.win.length || state.battlefield[i]) {
                disabled = 'disabled';
                if (state.battlefield[i]) {
                    char = (state.battlefield[i] === state.id.me) ? chars.me : chars.enemy;
                }
            }
            let mark = '';
            if (winner.has(i)) {
                mark = 'mark';
                disabled = 'disabled';
            }
            buttons += `<button class="${mark}" ${disabled}>${char}</button>`;
        }
        const turn = state.turn ? 'turn' : '';
        this.battlefieldElement.innerHTML = `<div class="battlefield ${turn}">${buttons}</div>`;
    }
    playerList(players) {
        if (!players.length) {
            this.playerListElement.innerHTML = `<div class="empty-list">No players online :(</div>`;
        }
        else {
            this.playerListElement.innerHTML = players.reduce((html, player) => {
                const mark = player.mark ? 'mark' : '';
                return html + `
<li class="player ${mark}">
    <button class="player__button" data-id="${player.id}">
        <span class="player__name">${player.name || 'Someone'}</span>
        <span class="player__id">${player.id}</span>
    </button>
</li>
`;
            }, '');
        }
    }
}
{
    const startGame = (name) => {
        const myName = document.getElementById('my-name');
        const myId = document.getElementById('my-id');
        const api = new API();
        const game = new Game(api);
        const renderer = new Renderer(game);
        game.name = name;
        game.playersChanged.subscribe(players => {
            renderer.playerList(players);
            myId && (myId.innerHTML = api.me);
            myName && (myName.innerHTML = game.name);
        });
    };
    const checkName = (name) => {
        const regex = /[A-Za-zА-ЯЁа-яё0-9]{3,}/;
        const [match] = name.match(regex) || [''];
        if (match.length < 3 || match.length > 20) {
            return '';
        }
        return match;
    };
    const form = document.getElementById('name');
    const parent = form.parentElement;
    const storage = JSON.parse(localStorage.getItem('tic-tac-toe') || '{}');
    if ((storage === null || storage === void 0 ? void 0 : storage.name) && checkName(storage.name)) {
        parent.remove();
        startGame(storage.name);
    }
    else {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const input = form.elements[0];
            if (input.validity.valid) {
                parent.remove();
                const name = checkName(input.value);
                if (name) {
                    const storage = { name };
                    localStorage.setItem('tic-tac-toe', JSON.stringify(storage));
                    startGame(storage.name);
                    return;
                }
            }
            console.warn('I am cheater');
        });
    }
}
{
    // Safari 100vh fix
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
