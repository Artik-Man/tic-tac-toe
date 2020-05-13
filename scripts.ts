interface State {
    id: {
        me: string;
        enemy: string;
    };
    domination: {
        me: number | null;
        enemy: number | null;
    };
    name: string;
    win: number[];
    turn: boolean;
    battlefield: string[];
    started: boolean;
    disconnect: boolean;
}

interface Message {
    connected?: string;
    disconnected?: string;
    connections?: string[];
    data?: GameData | 'ping' | 'pong';
    from: string;
    to: string;
}

interface Player {
    id: string;
    mark: boolean;
    name: string;
}

type GameData = {
    method: 'DOMINATION';
    domination: number;
    name: string;
} | {
    method: 'FIRE';
    index: number;
} | {
    method: 'NAME';
    name: string;
}

interface LocalState {
    name?: string;
    xid?: string;
}

class LocalStateStorage {
    public static get(): LocalState {
        return JSON.parse(localStorage.getItem('tic-tac-toe') || '{}');
    }

    public static set(state: LocalState) {
        const storage = LocalStateStorage.get();
        storage.name = state.name || storage.name;
        storage.xid = state.xid || storage.xid;
        localStorage.setItem('tic-tac-toe', JSON.stringify(storage));
    }
}

class Subject<T> {
    private subscriptions: ((message: T) => void)[] = [];

    public subscribe(subscriber: (message: T) => void) {
        const index = this.subscriptions.push(subscriber);
        return {
            unsubscribe: () => {
                this.subscriptions.splice(index, 1);
            }
        }
    }

    public next(message: T) {
        this.subscriptions.forEach(sub => {
            sub(message)
        })
    }

}

class API {
    private connection: WebSocket | undefined;
    public message = new Subject<Message>()
    public me: string = '';

    constructor(private xid?: string) {
        this.connect();
        setInterval(() => {
            this.ping();
        }, 20_000)
    }

    private ping() {
        this.send('SERVER', 'ping')
    }

    public send(to: string, data: GameData | 'ping') {
        this.connect(() => {
            this.connection?.send(JSON.stringify({to, data}))
        });
    }

    private connect(onReady?: () => void) {
        if (!this.connection || this.connection.readyState === WebSocket.CLOSED || this.connection.readyState === WebSocket.CLOSING) {
            delete this.connection;
            this.connection = new WebSocket('wss://ws-post.herokuapp.com/', this.xid);
            this.connection.onmessage = (event) => {
                const msg: Message = JSON.parse(event.data);
                this.me = msg.to || this.me;
                this.message.next(msg);
            }
            this.connection.onopen = () => {
                onReady && onReady();
            }
        } else {
            onReady && onReady();
        }
    }

}

class Game {
    public myName = '';
    private enemyId: string | null = null;
    private store = new Map<string, State>();
    public stateChanged = new Subject<State>();
    private players = new Set<string>();
    public playersChanged = new Subject<Player[]>();

    constructor(private api: API) {
        this.api.message.subscribe(message => {
            if (typeof message.data !== 'string') {
                if (message.data && message.data.method === 'DOMINATION') {
                    this.onDomination(message);
                } else if (message.data && message.data.method === 'NAME') {
                    this.onGetName(message);
                } else if (message.data && message.data.method === 'FIRE') {
                    this.onFire(message);
                }
                this.updatePlayerList(message);
            }
        });
    }

    private updatePlayerList(message?: Message) {
        if (message) {
            if (message.connections) {
                message.connections.forEach(player => {
                    this.players.add(player);
                    this.sendName(player);
                });
            }
            if (message.connected) {
                this.players.add(message.connected);
                this.sendName(message.connected);
            }
            if (message.disconnected) {
                this.players.delete(message.disconnected);
                const state = this.getState(message.disconnected);
                this.clear(state);
                state.disconnect = true;
                if (message.disconnected === this.enemyId) {
                    this.stateChanged.next(state);
                }
                this.store.delete(message.disconnected);
            }
            this.players.delete(this.api.me);
        }

        const players: Player[] = [];
        this.players.forEach(id => {
            const mark = this.checkMark(id);
            const name = this.getPlayerName(id);
            players.push({id, mark, name});
        });
        players.sort((a, b) => b.name.localeCompare(a.name));
        this.playersChanged.next(players);
    }

    private getPlayerName(id: string) {
        const state = this.getState(id);
        return state?.name || '';
    }

    private checkMark(enemy: string): boolean {
        const state = this.store.get(enemy);
        if (!state) {
            return false;
        }
        if (state.domination.enemy && !state.domination.me) {
            return true;
        }
        return state.turn;
    }

    private onFire(message: Message) {
        if (message.data && typeof message.data !== 'string' && message.data.method === 'FIRE') {
            const state = this.getState(message.from);
            if (state.turn || state.battlefield[message.data.index] === this.api.me) {
                console.warn('Enemy is cheater!')
            } else {
                state.turn = true;
                state.battlefield[message.data.index] = state.id.enemy;
                this.gameOver(state);
                this.stateChanged.next(state);
            }
        }
    }

    private onGetName(message: Message) {
        if (message.data && typeof message.data !== 'string' && message.data.method === 'NAME') {
            const state = this.getState(message.from);
            state.name = Game.checkName(message.data.name) || 'CHEATER!';
            this.stateChanged.next(state);
        }
    }

    private onDomination(message: Message) {
        if (message.data && typeof message.data !== 'string' && message.data.method === 'DOMINATION') {
            const state = this.getState(message.from);
            state.domination.enemy = message.data.domination;
            state.name = Game.checkName(message.data.name) || 'CHEATER!';
            this.checkStart(state);
        }
    }

    private checkStart(state: State) {
        if (state.domination.me && state.domination.enemy) {
            state.turn = (state.domination.me > state.domination.enemy);
            state.started = true;
            this.stateChanged.next(state);
        }
    }

    private static checkIWon(battlefield: string[]): number[] {
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

    private gameOver(state: State) {
        const indexes = Game.checkIWon(state.battlefield);
        if (indexes.length) {
            state.win = indexes;
            setTimeout(() => {
                this.clear(state);
            }, 5000);
        } else {
            const isOver = state.battlefield.filter(x => !!x).length === 9;
            if (isOver) {
                setTimeout(() => {
                    this.clear(state);
                }, 3000);
            }
        }
    }

    public fire(index: number) {
        if (this.enemyId) {
            const state = this.getState(this.enemyId);
            if (state.turn) {
                state.turn = false;
                state.battlefield[index] = this.api.me;
                this.gameOver(state);
                this.stateChanged.next(state);
                this.api.send(this.enemyId, {
                    method: "FIRE",
                    index
                });
                this.updatePlayerList();
            } else {
                console.warn('I am cheater');
            }
        }
    }

    public start(id: string) {
        const state = this.getState(id);
        if (!state.started) {
            state.domination.me = Math.random() * Number.MAX_SAFE_INTEGER;
            this.checkStart(state);
            this.api.send(id, {
                method: "DOMINATION",
                domination: state.domination.me,
                name: this.myName
            });
            this.updatePlayerList();
        }
    }

    private sendName(id: string) {
        const state = this.getState(id);
        if (!state.started) {
            this.api.send(id, {
                method: "NAME",
                name: this.myName
            });
            this.updatePlayerList();
        }
    }

    public clear(state: State) {
        state.battlefield.length = 0;
        state.win.length = 0;
        state.domination.me = null;
        state.started = false;
        state.turn = false;
        this.start(state.id.enemy);
    }

    public setEnemy(id: string) {
        this.enemyId = id;
        this.getState(id);
    }

    public getEnemy() {
        return this.enemyId;
    }

    public getMe() {
        return this.api.me;
    }

    public getState(id: string): State {
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
                disconnect: false,
                turn: false
            };
            this.store.set(id, state);
        }
        return state;
    }

    public static checkName(name: string): string {
        const regex = /[A-Za-zА-ЯЁа-яё0-9\s]{3,}/;
        let [match] = name.match(regex) || [''];
        match = match.replace(/\s+/, ' ').trim();
        if (match.length >= 3 && match.length <= 20) {
            return match;
        }
        return '';
    }
}

class Renderer {
    private playerListElement: HTMLElement = document.getElementById('players') as HTMLElement;
    private battlefieldElement: HTMLElement = document.getElementById('battlefield') as HTMLElement;

    constructor(game: Game) {
        this.playerListElement.addEventListener('click', event => {
            const target: HTMLElement = event.target as HTMLElement;
            const button: HTMLButtonElement = (target.closest('button') || target) as HTMLButtonElement;
            if (button) {
                const id = button.dataset.id || '';
                game.setEnemy(id);
                const state = game.getState(id);
                this.battlefield(state);
                game.start(id);
            }
        });

        this.battlefieldElement.addEventListener('click', event => {
            const target: HTMLButtonElement = event.target as HTMLButtonElement;
            if (target.closest('button')) {
                const parent: HTMLElement = target.parentElement as HTMLElement;
                const index = Array.from(parent.children).indexOf(target);
                game.fire(index);
            }
        })

        game.stateChanged.subscribe(state => {
            if (game.getEnemy() === state.id.enemy) {
                this.battlefield(state);
            }
        })
    }

    private static getChar(state: State): { me: string; enemy: string; } {
        if (state.domination.me && state.domination.enemy) {
            return state.domination.me > state.domination.enemy ? {
                me: 'X',
                enemy: 'O'
            } : {
                me: 'O',
                enemy: 'X'
            };
        } else {
            return {
                me: '',
                enemy: ''
            };
        }
    }

    private battlefield(state: State) {
        let html = '';
        if (!state.disconnect) {
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
                buttons += `<button class="${mark}" ${disabled}>${char}</button>`
            }
            const msg = state.turn ? 'data-msg="Your turn"' : '';
            html = `<div class="battlefield" ${msg}>${buttons}</div>`;
        }
        this.battlefieldElement.innerHTML = html;
    }

    public playerList(players: Player[]) {
        if (!players.length) {
            this.playerListElement.innerHTML = `<div class="empty-list">No players online :(</div>`;
        } else {
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
    const startGame = (localState: LocalState) => {
        const myName = document.getElementById('my-name') as HTMLElement;
        const myId = document.getElementById('my-id') as HTMLElement;

        const api = new API(localState.xid);
        const game = new Game(api);
        const renderer = new Renderer(game);

        game.myName = localState.name || '';
        game.playersChanged.subscribe(players => {
            renderer.playerList(players);
            myId.innerText = api.me;
            myName.innerText = game.myName;
            LocalStateStorage.set({name: game.myName, xid: api.me});
        });
    }

    const form = document.getElementById('name') as HTMLFormElement;
    const parent = form.parentElement as HTMLElement;
    const localState = LocalStateStorage.get();
    localState.name = Game.checkName(localState?.name || '');
    if (localState.name) {
        parent.remove();
        startGame(localState);
    } else {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const input = form.elements[0] as HTMLInputElement;
            if (input.validity.valid) {
                parent.remove();
                const name = Game.checkName(input.value);
                if (name) {
                    const localState = {name};
                    LocalStateStorage.set(localState)
                    startGame(localState);
                    return;
                } else {
                    input.setCustomValidity("Invalid field.");
                }
            }
            console.warn('I am cheater');
        })
    }

}

{
    // Safari 100vh fix
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
