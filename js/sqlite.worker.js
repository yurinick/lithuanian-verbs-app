// This is the entry point for an SQLite worker thread
import { installHttpVfs } from './vfs-http.js';
import { installSyncHttpVfs } from './vfs-sync-http.js';
import { debug } from './vfs-http-types.js';
// Binary version of the classic xmlhttprequest (for Node.js)
import { XMLHttpRequest as _XMLHttpRequest } from '#XMLHttpRequest.cjs';
debug['threads']('SQLite worker started');
globalThis.onmessage = ({ data }) => {
    debug['threads']('SQLite received green light', data);
    const msg = data;
    import('#sqlite3.js')
        .then((mod) => mod.default())
        .then((sqlite3) => {
        debug['threads']('SQLite init');
        sqlite3.initWorker1API();
        if (typeof msg.httpChannel === 'object') {
            installHttpVfs(sqlite3, msg.httpChannel, msg.httpOptions);
        }
        else if (msg.httpChannel === true) {
            if (typeof globalThis.XMLHttpRequest === 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                globalThis.XMLHttpRequest = class XMLHttpRequest extends _XMLHttpRequest {
                    get response() {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const r = Uint8Array.from(this.responseText.split('')
                            .map((x) => x.charCodeAt(0))).buffer;
                        return r;
                    }
                };
            }
            installSyncHttpVfs(sqlite3, msg.httpOptions);
        }
    });
};
//# sourceMappingURL=sqlite-worker.js.map