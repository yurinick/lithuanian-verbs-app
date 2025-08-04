var sqlite3Worker1PromiserBundlerFriendly = {};

/*
  2022-08-24

  The author disclaims copyright to this source code.  In place of a
  legal notice, here is a blessing:

  *   May you do good and not evil.
  *   May you find forgiveness for yourself and forgive others.
  *   May you share freely, never taking more than you give.

  ***********************************************************************

  This file implements a Promise-based proxy for the sqlite3 Worker
  API #1. It is intended to be included either from the main thread or
  a Worker, but only if (A) the environment supports nested Workers
  and (B) it's _not_ a Worker which loads the sqlite3 WASM/JS
  module. This file's features will load that module and provide a
  slightly simpler client-side interface than the slightly-lower-level
  Worker API does.

  This script necessarily exposes one global symbol, but clients may
  freely `delete` that symbol after calling it.
*/

var hasRequiredSqlite3Worker1PromiserBundlerFriendly;

function requireSqlite3Worker1PromiserBundlerFriendly () {
	if (hasRequiredSqlite3Worker1PromiserBundlerFriendly) return sqlite3Worker1PromiserBundlerFriendly;
	hasRequiredSqlite3Worker1PromiserBundlerFriendly = 1;
	/**
	   Configures an sqlite3 Worker API #1 Worker such that it can be
	   manipulated via a Promise-based interface and returns a factory
	   function which returns Promises for communicating with the worker.
	   This proxy has an _almost_ identical interface to the normal
	   worker API, with any exceptions documented below.

	   It requires a configuration object with the following properties:

	   - `worker` (required): a Worker instance which loads
	   `sqlite3-worker1.js` or a functional equivalent. Note that the
	   promiser factory replaces the worker.onmessage property. This
	   config option may alternately be a function, in which case this
	   function re-assigns this property with the result of calling that
	   function, enabling delayed instantiation of a Worker.

	   - `onready` (optional, but...): this callback is called with no
	   arguments when the worker fires its initial
	   'sqlite3-api'/'worker1-ready' message, which it does when
	   sqlite3.initWorker1API() completes its initialization. This is
	   the simplest way to tell the worker to kick off work at the
	   earliest opportunity.

	   - `onunhandled` (optional): a callback which gets passed the
	   message event object for any worker.onmessage() events which
	   are not handled by this proxy. Ideally that "should" never
	   happen, as this proxy aims to handle all known message types.

	   - `generateMessageId` (optional): a function which, when passed an
	   about-to-be-posted message object, generates a _unique_ message ID
	   for the message, which this API then assigns as the messageId
	   property of the message. It _must_ generate unique IDs on each call
	   so that dispatching can work. If not defined, a default generator
	   is used (which should be sufficient for most or all cases).

	   - `debug` (optional): a console.debug()-style function for logging
	   information about messages.

	   This function returns a stateful factory function with the
	   following interfaces:

	   - Promise function(messageType, messageArgs)
	   - Promise function({message object})

	   The first form expects the "type" and "args" values for a Worker
	   message. The second expects an object in the form {type:...,
	   args:...}  plus any other properties the client cares to set. This
	   function will always set the `messageId` property on the object,
	   even if it's already set, and will set the `dbId` property to the
	   current database ID if it is _not_ set in the message object.

	   The function throws on error.

	   The function installs a temporary message listener, posts a
	   message to the configured Worker, and handles the message's
	   response via the temporary message listener. The then() callback
	   of the returned Promise is passed the `message.data` property from
	   the resulting message, i.e. the payload from the worker, stripped
	   of the lower-level event state which the onmessage() handler
	   receives.

	   Example usage:

	   ```
	   const config = {...};
	   const sq3Promiser = sqlite3Worker1Promiser(config);
	   sq3Promiser('open', {filename:"/foo.db"}).then(function(msg){
	     console.log("open response",msg); // => {type:'open', result: {filename:'/foo.db'}, ...}
	   });
	   sq3Promiser({type:'close'}).then((msg)=>{
	     console.log("close response",msg); // => {type:'close', result: {filename:'/foo.db'}, ...}
	   });
	   ```

	   Differences from Worker API #1:

	   - exec's {callback: STRING} option does not work via this
	   interface (it triggers an exception), but {callback: function}
	   does and works exactly like the STRING form does in the Worker:
	   the callback is called one time for each row of the result set,
	   passed the same worker message format as the worker API emits:

	     {type:typeString,
	      row:VALUE,
	      rowNumber:1-based-#,
	      columnNames: array}

	   Where `typeString` is an internally-synthesized message type string
	   used temporarily for worker message dispatching. It can be ignored
	   by all client code except that which tests this API. The `row`
	   property contains the row result in the form implied by the
	   `rowMode` option (defaulting to `'array'`). The `rowNumber` is a
	   1-based integer value incremented by 1 on each call into the
	   callback.

	   At the end of the result set, the same event is fired with
	   (row=undefined, rowNumber=null) to indicate that
	   the end of the result set has been reached. Note that the rows
	   arrive via worker-posted messages, with all the implications
	   of that.

	   Notable shortcomings:

	   - This API was not designed with ES6 modules in mind. Neither Firefox
	     nor Safari support, as of March 2023, the {type:"module"} flag to the
	     Worker constructor, so that particular usage is not something we're going
	     to target for the time being:

	     https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
	*/
	globalThis.sqlite3Worker1Promiser = function callee(config = callee.defaultConfig){
	  // Inspired by: https://stackoverflow.com/a/52439530
	  if(1===arguments.length && 'function'===typeof arguments[0]){
	    const f = config;
	    config = Object.assign(Object.create(null), callee.defaultConfig);
	    config.onready = f;
	  }else {
	    config = Object.assign(Object.create(null), callee.defaultConfig, config);
	  }
	  const handlerMap = Object.create(null);
	  const noop = function(){};
	  const err = config.onerror
	        || noop /* config.onerror is intentionally undocumented
	                   pending finding a less ambiguous name */;
	  const debug = config.debug || noop;
	  const idTypeMap = config.generateMessageId ? undefined : Object.create(null);
	  const genMsgId = config.generateMessageId || function(msg){
	    return msg.type+'#'+(idTypeMap[msg.type] = (idTypeMap[msg.type]||0) + 1);
	  };
	  const toss = (...args)=>{throw new Error(args.join(' '))};
	  if(!config.worker) config.worker = callee.defaultConfig.worker;
	  if('function'===typeof config.worker) config.worker = config.worker();
	  let dbId;
	  config.worker.onmessage = function(ev){
	    ev = ev.data;
	    debug('worker1.onmessage',ev);
	    let msgHandler = handlerMap[ev.messageId];
	    if(!msgHandler){
	      if(ev && 'sqlite3-api'===ev.type && 'worker1-ready'===ev.result) {
	        /*fired one time when the Worker1 API initializes*/
	        if(config.onready) config.onready();
	        return;
	      }
	      msgHandler = handlerMap[ev.type] /* check for exec per-row callback */;
	      if(msgHandler && msgHandler.onrow){
	        msgHandler.onrow(ev);
	        return;
	      }
	      if(config.onunhandled) config.onunhandled(arguments[0]);
	      else err("sqlite3Worker1Promiser() unhandled worker message:",ev);
	      return;
	    }
	    delete handlerMap[ev.messageId];
	    switch(ev.type){
	        case 'error':
	          msgHandler.reject(ev);
	          return;
	        case 'open':
	          if(!dbId) dbId = ev.dbId;
	          break;
	        case 'close':
	          if(ev.dbId===dbId) dbId = undefined;
	          break;
	    }
	    try {msgHandler.resolve(ev);}
	    catch(e){msgHandler.reject(e);}
	  }/*worker.onmessage()*/;
	  return function(/*(msgType, msgArgs) || (msgEnvelope)*/){
	    let msg;
	    if(1===arguments.length){
	      msg = arguments[0];
	    }else if(2===arguments.length){
	      msg = Object.create(null);
	      msg.type = arguments[0];
	      msg.args = arguments[1];
	    }else {
	      toss("Invalid arugments for sqlite3Worker1Promiser()-created factory.");
	    }
	    if(!msg.dbId) msg.dbId = dbId;
	    msg.messageId = genMsgId(msg);
	    msg.departureTime = performance.now();
	    const proxy = Object.create(null);
	    proxy.message = msg;
	    let rowCallbackId /* message handler ID for exec on-row callback proxy */;
	    if('exec'===msg.type && msg.args){
	      if('function'===typeof msg.args.callback){
	        rowCallbackId = msg.messageId+':row';
	        proxy.onrow = msg.args.callback;
	        msg.args.callback = rowCallbackId;
	        handlerMap[rowCallbackId] = proxy;
	      }else if('string' === typeof msg.args.callback){
	        toss("exec callback may not be a string when using the Promise interface.");
	        /**
	           Design note: the reason for this limitation is that this
	           API takes over worker.onmessage() and the client has no way
	           of adding their own message-type handlers to it. Per-row
	           callbacks are implemented as short-lived message.type
	           mappings for worker.onmessage().

	           We "could" work around this by providing a new
	           config.fallbackMessageHandler (or some such) which contains
	           a map of event type names to callbacks. Seems like overkill
	           for now, seeing as the client can pass callback functions
	           to this interface (whereas the string-form "callback" is
	           needed for the over-the-Worker interface).
	        */
	      }
	    }
	    //debug("requestWork", msg);
	    let p = new Promise(function(resolve, reject){
	      proxy.resolve = resolve;
	      proxy.reject = reject;
	      handlerMap[msg.messageId] = proxy;
	      debug("Posting",msg.type,"message to Worker dbId="+(dbId||'default')+':',msg);
	      config.worker.postMessage(msg);
	    });
	    if(rowCallbackId) p = p.finally(()=>delete handlerMap[rowCallbackId]);
	    return p;
	  };
	}/*sqlite3Worker1Promiser()*/;
	globalThis.sqlite3Worker1Promiser.defaultConfig = {
	  worker: function(){
	    return new Worker(new URL("sqlite3-worker1-bundler-friendly.mjs", import.meta.url),{
	      type: 'module'
	    });
	  }
	  ,
	  onerror: (...args)=>console.error('worker1 promiser error',...args)
	};
	return sqlite3Worker1PromiserBundlerFriendly;
}

requireSqlite3Worker1PromiserBundlerFriendly();

var _a;
const defaultOptions = {
    timeout: 20000};
// These must be different from any SQLite CAPI codes
var SYNC;
(function (SYNC) {
    SYNC[SYNC["WORKMSG"] = 16777215] = "WORKMSG";
    SYNC[SYNC["HANDSHAKE"] = 16777214] = "HANDSHAKE";
})(SYNC = SYNC || (SYNC = {}));
const debugOptions = (typeof SQLITE_DEBUG !== 'undefined' && SQLITE_DEBUG) ||
    (typeof process !== 'undefined' && typeof ((_a = process === null || process === void 0 ? void 0 : process.env) === null || _a === void 0 ? void 0 : _a.SQLITE_DEBUG) !== 'undefined' && process.env.SQLITE_DEBUG) ||
    '';
const debugSys = ['threads', 'vfs', 'cache', 'http'];
const debug = {};
for (const d of debugSys) {
    debug[d] = debugOptions.includes(d) ?
        console.debug.bind(console) :
        () => undefined;
}

// Procedures for changing the byte sex
// SQLite is always Big-Endian, JS follows the platform, which is Little-Endian on x86
((function () {
    const ab = new ArrayBuffer(2);
    const u8 = new Uint8Array(ab);
    const u16 = new Uint16Array(ab);
    u8[0] = 0xF0;
    u8[1] = 0x0D;
    // Big
    if (u16[0] == 0xF00D) {
        debug['threads']('System is Big-Endian');
        return false;
    }
    // Little
    if (u16[0] == 0x0DF0) {
        debug['threads']('System is Little-Endian');
        return true;
    }
    throw new Error(`Failed determining endianness: ${u16}`);
}))();

var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/**
 * Creates a new SQLite worker thread, can accept an optional HTTP backend for HTTP support.
 *
 * The sync backend is particularly inefficient in Node.js and should never be used except for unit-testing browser
 * code.
 *
 * @param {SQLiteOptions} [options] Options object
 * @param {VFSHTTP.Backend | true} [options.http] Optional HTTP backend, either a shared one or a dedicated sync one
 * @returns {Promise<SQLite.Promiser>}
 */
function createSQLiteThread(options) {
    debug['threads']('Creating new SQLite thread', options);
    let worker;
    const r = new Promise((resolve, reject) => {
        const promiser = sqlite3Worker1Promiser({
            onready: () => {
                resolve(promiser);
            },
            worker: () => {
                try {
                    worker = new Worker(new URL('./sqlite-worker.js', import.meta.url));
                    worker.onerror = (event) => console.error('Worker bootstrap failed', event);
                    const backend = options === null || options === void 0 ? void 0 : options.http;
                    // This is the SQLite worker green light
                    if ((backend === null || backend === void 0 ? void 0 : backend.type) === 'shared') {
                        backend.createNewChannel()
                            .then((channel) => {
                            worker.postMessage({ httpChannel: channel, httpOptions: backend.options }, [channel.port]);
                        });
                    }
                    else if ((backend === null || backend === void 0 ? void 0 : backend.type) === 'sync') {
                        worker.postMessage({ httpChannel: true, httpOptions: backend.options });
                    }
                    else {
                        worker.postMessage({});
                    }
                    return worker;
                }
                catch (e) {
                    console.error('Failed to create SQLite worker', e);
                    reject(e);
                }
            }
        });
    }).then((p) => {
        p.close = () => {
            worker.terminate();
        };
        return p;
    });
    return r;
}
const noSharedBufferMsg = 'SharedArrayBuffer is not available. ' +
    'If your browser supports it, the webserver must send ' +
    '"Cross-Origin-Opener-Policy: same-origin "' +
    'and "Cross-Origin-Embedder-Policy: require-corp" headers. ' +
    'Alternatively, if you do not intend to use concurrent connections, ' +
    'pass `sync` to `createHttpBackend` to explicitly create a synchronous ' +
    'HTTP backend and suppress this warning message.';
/**
 * Creates a new HTTP backend worker that can support multiple SQLite threads.
 * The cache is shared only if the environment supports SharedArrayBuffer.
 *
 * This is always the case in Node.js, but it requires a cross-origin isolated
 * environment in the browser.
 *
 * @param {VFSHTTP.Options} [options] Options object
 * @returns {VFSHTTP.Backend}
 */
function createHttpBackend(options) {
    debug['threads']('Creating new HTTP VFS backend thread');
    if (typeof SharedArrayBuffer === 'undefined' || (options === null || options === void 0 ? void 0 : options.backendType) === 'sync') {
        if ((options === null || options === void 0 ? void 0 : options.backendType) === 'shared')
            throw new Error(noSharedBufferMsg);
        if ((options === null || options === void 0 ? void 0 : options.backendType) !== 'sync')
            console.warn(noSharedBufferMsg + ' Falling back to the legacy HTTP backend.');
        return {
            type: 'sync',
            worker: null,
            options,
            createNewChannel: () => {
                throw new Error('Sync backend does not support channels');
            },
            close: () => Promise.resolve(),
            terminate: () => undefined
        };
    }
    let nextId = 1;
    const worker = new Worker(new URL('./vfs-http-worker.js', import.meta.url));
    worker.postMessage({ msg: 'init', options });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consumers = {};
    worker.onmessage = ({ data }) => {
        debug['threads']('Received control message reply', data);
        switch (data.msg) {
            case 'ack':
                if (!consumers[data.id]) {
                    console.error('Invalid response received from backend', data);
                    return;
                }
                debug['threads']('New HTTP VFS channel created', consumers);
                consumers[data.id].resolve({
                    port: consumers[data.id].channel.port2,
                    shm: data.shm
                });
                clearTimeout(consumers[data.id].timeout);
                delete consumers[data.id].resolve;
                delete consumers[data.id].timeout;
                return;
        }
    };
    return {
        type: 'shared',
        worker,
        options,
        createNewChannel: function () {
            debug['threads']('Creating a new HTTP VFS channel');
            const channel = new MessageChannel();
            const id = nextId++;
            worker.postMessage({ msg: 'handshake', port: channel.port1, id }, [channel.port1]);
            return new Promise((resolve, reject) => {
                var _a;
                const timeout = setTimeout(() => {
                    delete consumers[id];
                    reject('Timeout while waiting on backend');
                }, (_a = options === null || options === void 0 ? void 0 : options.timeout) !== null && _a !== void 0 ? _a : defaultOptions.timeout);
                consumers[id] = { id, channel, resolve, timeout };
            });
        },
        terminate: function () {
            worker.terminate();
        },
        close: function () {
            debug['threads']('Closing the HTTP VFS channel');
            worker.postMessage({ msg: 'close' });
            return new Promise((resolve, reject) => {
                var _a;
                const timeout = setTimeout(() => {
                    reject('Timeout while waiting on backend');
                }, (_a = options === null || options === void 0 ? void 0 : options.timeout) !== null && _a !== void 0 ? _a : defaultOptions.timeout);
                worker.onmessage = ({ data }) => {
                    debug['threads']('Received close response', data);
                    if (data.msg === 'ack' && data.id === undefined) {
                        resolve();
                        clearTimeout(timeout);
                    }
                };
            });
        },
    };
}
/**
 * Higher-level API for working with a pool
 * @param {number} [opts.workers] Number of concurrent workers to spawn, @default 1
 * @param {VFSHTTP.Options} [opts.httpOptions] Options to pass to the HTTP backend
 */
function createSQLiteHTTPPool(opts) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const backend = createHttpBackend(opts === null || opts === void 0 ? void 0 : opts.httpOptions);
        const workers = [];
        const startq = [];
        for (let i = 0; i < ((_a = opts.workers) !== null && _a !== void 0 ? _a : 1); i++) {
            startq.push(createSQLiteThread({ http: backend })
                .then((worker) => workers.push({
                worker,
                busy: null
            }))
                .then(() => undefined));
        }
        yield Promise.all(startq);
        return {
            backendType: backend.type,
            open: (url) => Promise.all(workers.map((w) => w.worker('open', {
                filename: 'file:' + encodeURI(url),
                vfs: 'http'
            })))
                .then(() => undefined),
            close: () => Promise.all(workers.map((w) => w.worker.close()))
                .then(() => backend.close()),
            exec: function (sql, bind, opts) {
                return __awaiter(this, void 0, void 0, function* () {
                    let w;
                    do {
                        w = workers.find((w) => !w.busy);
                        if (!w)
                            yield Promise.race(workers.map((w) => w.busy)).catch(() => undefined);
                    } while (!w);
                    const results = [];
                    w.busy = w.worker('exec', {
                        sql,
                        bind,
                        rowMode: opts === null || opts === void 0 ? void 0 : opts.rowMode,
                        callback: (row) => {
                            if (row.row)
                                results.push(row);
                        }
                    })
                        .then(() => undefined)
                        .finally(() => {
                        if (!w)
                            throw new Error('Lost worker pool');
                        w.busy = null;
                    });
                    yield w.busy;
                    return results;
                });
            }
        };
    });
}

window.addEventListener('load', async () => {
    
    let pool;
    const DB_URL = 'https://yurinick.github.io/lithuanian-verbs-app/verbs.sqlite';
    const TENSE_TRANSLATIONS = {
        "Present tense": "Настоящее время", "Past tense": "Прошедшее время",
        "Future tense": "Будущее время", "Conditional mood": "Сослагательное наклонение",
        "Imperative mood": "Повелительное наклонение", "Past freq. tense": "Прошедшее многократное время"
    };
    const mainTableHeaders = ['id_num', 'p_val', 'hash_val', 'infinitive', 'present_3rd', 'past_3rd', 'question', 'translation'];

    // DOM elements
    const searchInput = document.getElementById('searchInput');
    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const loadingIndicator = document.getElementById('loading-indicator');
    const noResultsMessage = document.getElementById('no-results-message');
    const errorContainer = document.getElementById('error-container');
    const recordCount = document.getElementById('record-count');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalCloseButton = document.getElementById('modal-close-button');
    const showError = (message) => { errorContainer.textContent = message; errorContainer.classList.remove('hidden'); };

    // Telegram
    try {
        const tg = window.Telegram.WebApp;
        tg.ready();
        const applyTheme = () => document.body.classList.toggle('dark', tg.colorScheme === 'dark');
        tg.onEvent('themeChanged', applyTheme);
        applyTheme();
        tg.MainButton.setText('Закрыть').setTextColor('#ffffff').setColor('#0ea5e9').show();
        tg.onEvent('mainButtonClicked', () => tg.close());
    } catch (e) { console.log("Not in Telegram environment."); }

    
    async function startApp() {
        try {
            loadingIndicator.textContent = 'Connecting to database...';
            
            pool = await createSQLiteHTTPPool({
                httpOptions: {
                    url: DB_URL,
                    workerUrl: new URL("./sqlite.worker.js", import.meta.url).toString(),
                    wasmUrl: new URL("./sql-wasm.wasm", import.meta.url).toString()
                }
            });

            await pool.open(DB_URL);

            loadingIndicator.textContent = 'Loading initial data...';
            const initialData = await pool.exec('SELECT * FROM verbs ORDER BY id_num LIMIT 500;');
            renderTable(initialData);

        } catch (e) {
            console.error('Database initialization failed:', e);
            showError('Failed to initialize database. Please check console for details.');
        } finally {
            loadingIndicator.classList.add('hidden');
        }
    }
    
    // ... all other functions
    let debounceTimer;
    searchInput.addEventListener('input', (event) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            if (!pool) return;
            const searchTerm = event.target.value.trim();
            if (!searchTerm) {
                const initialData = await pool.exec('SELECT * FROM verbs ORDER BY id_num LIMIT 500;');
                renderTable(initialData); return;
            }
            const searchQuery = searchTerm.split(' ').filter(Boolean).map(word => `${word}*`).join(' ');
            const results = await pool.exec(
                `SELECT v.* FROM verbs_fts fts JOIN verbs v ON fts.rowid = v.rowid WHERE fts.verbs_fts MATCH ? ORDER BY rank`, 
                [searchQuery]
            );
            renderTable(results);
        }, 300);
    });

    function renderTable(dataToRender) {
        tableHead.innerHTML = ''; tableBody.innerHTML = '';
        const headerRow = document.createElement('tr');
        const displayHeaders = ['№', 'P', '#', 'Инфинитив', '3 л. наст. вр.', '3 л. прош. вр.', 'Вопрос', 'Перевод'];
        displayHeaders.forEach((headerText) => {
            const th = document.createElement('th');
            th.className = 'px-2 py-3 text-center text-xs font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wider';
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        tableHead.appendChild(headerRow);
        dataToRender.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 even:bg-gray-50 dark:even:bg-gray-700';
            if (row.conjugations) {
                tr.classList.add('cursor-pointer');
                tr.addEventListener('click', () => showModalForVerb(row));
            }
            mainTableHeaders.forEach(headerKey => {
                const td = document.createElement('td');
                td.className = 'px-2 py-2 text-center text-gray-700 dark:text-gray-300 break-words';
                if (['infinitive', 'present_3rd', 'past_3rd', 'translation'].includes(headerKey)) {
                    td.classList.add('text-left');
                }
                td.textContent = row[headerKey] || '';
                tr.appendChild(td);
            });
            tableBody.appendChild(tr);
        });
        noResultsMessage.classList.toggle('hidden', dataToRender.length === 0);
        recordCount.textContent = `Showing ${dataToRender.length} results.`;
    }

    const normalizeForMatch = (str) => str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    const getPreferredForm = (formsArray) => {
        if (!formsArray || formsArray.length === 0) return '-';
        const formWithDiacritics = formsArray.find(form => form !== normalizeForMatch(form));
        return formWithDiacritics || formsArray[0];
    };

    function showModalForVerb(rowData) {
        const verbInfo = JSON.parse(rowData.conjugations || '{}');
        modalTitle.textContent = `${rowData.infinitive} - ${rowData.translation}`;
        modalBody.innerHTML = '';
        const tenses = {
            "Present tense": verbInfo["Present tense"], "Past tense": verbInfo["Past tense"],
            "Future tense": verbInfo["Future tense"], "Conditional mood": verbInfo["Conditional mood"],
            "Imperative mood": verbInfo["Imperative mood"], "Past freq. tense": verbInfo["Past freq. tense"]
        };
        const mainTenses = ["Present tense", "Past tense", "Future tense", "Conditional mood"];
        const persons = ["Aš", "Tu", "Jis/ji", "Mes", "Jūs", "Jie/jos"];
        persons.forEach((person, personIndex) => {
            mainTenses.forEach(tense => {
                const tenseData = tenses[tense];
                const item = tenseData && tenseData[personIndex] ? tenseData[personIndex] : null;
                item ? getPreferredForm(item.forms) : '-';
            });
        });
        ["Imperative mood", "Past freq. tense"].forEach(tense => {
            if (tenses[tense] && tenses[tense].length > 0) {
                let tenseHTML = `<h3 class="text-lg font-semibold mt-4 mb-2 text-sky-600 dark:text-sky-400">${TENSE_TRANSLATIONS[tense] || tense}</h3>`;
                tenseHTML += `<table class="min-w-full text-sm"><tbody class="divide-y divide-gray-200 dark:divide-gray-700">`;
                tenses[tense].forEach(row => {
                    tenseHTML += `<tr class="hover:bg-gray-100 dark:hover:bg-gray-600 even:bg-gray-50 dark:even:bg-gray-600"><td class="px-2 py-1 w-1/4 font-semibold">${row.person}</td><td class="px-2 py-1">${getPreferredForm(row.forms)}</td></tr>`;
                });
                tenseHTML += `</tbody></table>`;
                modalBody.innerHTML += tenseHTML;
            }
        });
        modalOverlay.classList.remove('hidden');
    }

    function closeModal() { modalOverlay.classList.add('hidden'); }
    modalCloseButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeModal(); });

    startApp();
});
