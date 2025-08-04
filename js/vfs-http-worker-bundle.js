const perf =
  typeof performance === 'object' &&
  performance &&
  typeof performance.now === 'function'
    ? performance
    : Date;

const hasAbortController = typeof AbortController === 'function';

// minimal backwards-compatibility polyfill
// this doesn't have nearly all the checks and whatnot that
// actual AbortController/Signal has, but it's enough for
// our purposes, and if used properly, behaves the same.
const AC = hasAbortController
  ? AbortController
  : class AbortController {
      constructor() {
        this.signal = new AS();
      }
      abort(reason = new Error('This operation was aborted')) {
        this.signal.reason = this.signal.reason || reason;
        this.signal.aborted = true;
        this.signal.dispatchEvent({
          type: 'abort',
          target: this.signal,
        });
      }
    };

const hasAbortSignal = typeof AbortSignal === 'function';
// Some polyfills put this on the AC class, not global
const hasACAbortSignal = typeof AC.AbortSignal === 'function';
const AS = hasAbortSignal
  ? AbortSignal
  : hasACAbortSignal
  ? AC.AbortController
  : class AbortSignal {
      constructor() {
        this.reason = undefined;
        this.aborted = false;
        this._listeners = [];
      }
      dispatchEvent(e) {
        if (e.type === 'abort') {
          this.aborted = true;
          this.onabort(e);
          this._listeners.forEach(f => f(e), this);
        }
      }
      onabort() {}
      addEventListener(ev, fn) {
        if (ev === 'abort') {
          this._listeners.push(fn);
        }
      }
      removeEventListener(ev, fn) {
        if (ev === 'abort') {
          this._listeners = this._listeners.filter(f => f !== fn);
        }
      }
    };

const warned = new Set();
const deprecatedOption = (opt, instead) => {
  const code = `LRU_CACHE_OPTION_${opt}`;
  if (shouldWarn(code)) {
    warn(code, `${opt} option`, `options.${instead}`, LRUCache);
  }
};
const deprecatedMethod = (method, instead) => {
  const code = `LRU_CACHE_METHOD_${method}`;
  if (shouldWarn(code)) {
    const { prototype } = LRUCache;
    const { get } = Object.getOwnPropertyDescriptor(prototype, method);
    warn(code, `${method} method`, `cache.${instead}()`, get);
  }
};
const deprecatedProperty = (field, instead) => {
  const code = `LRU_CACHE_PROPERTY_${field}`;
  if (shouldWarn(code)) {
    const { prototype } = LRUCache;
    const { get } = Object.getOwnPropertyDescriptor(prototype, field);
    warn(code, `${field} property`, `cache.${instead}`, get);
  }
};

const emitWarning = (...a) => {
  typeof process === 'object' &&
  process &&
  typeof process.emitWarning === 'function'
    ? process.emitWarning(...a)
    : console.error(...a);
};

const shouldWarn = code => !warned.has(code);

const warn = (code, what, instead, fn) => {
  warned.add(code);
  const msg = `The ${what} is deprecated. Please use ${instead} instead.`;
  emitWarning(msg, 'DeprecationWarning', code, fn);
};

const isPosInt = n => n && n === Math.floor(n) && n > 0 && isFinite(n);

/* istanbul ignore next - This is a little bit ridiculous, tbh.
 * The maximum array length is 2^32-1 or thereabouts on most JS impls.
 * And well before that point, you're caching the entire world, I mean,
 * that's ~32GB of just integers for the next/prev links, plus whatever
 * else to hold that many keys and values.  Just filling the memory with
 * zeroes at init time is brutal when you get that big.
 * But why not be complete?
 * Maybe in the future, these limits will have expanded. */
const getUintArray = max =>
  !isPosInt(max)
    ? null
    : max <= Math.pow(2, 8)
    ? Uint8Array
    : max <= Math.pow(2, 16)
    ? Uint16Array
    : max <= Math.pow(2, 32)
    ? Uint32Array
    : max <= Number.MAX_SAFE_INTEGER
    ? ZeroArray
    : null;

class ZeroArray extends Array {
  constructor(size) {
    super(size);
    this.fill(0);
  }
}

class Stack {
  constructor(max) {
    if (max === 0) {
      return []
    }
    const UintArray = getUintArray(max);
    this.heap = new UintArray(max);
    this.length = 0;
  }
  push(n) {
    this.heap[this.length++] = n;
  }
  pop() {
    return this.heap[--this.length]
  }
}

class LRUCache {
  constructor(options = {}) {
    const {
      max = 0,
      ttl,
      ttlResolution = 1,
      ttlAutopurge,
      updateAgeOnGet,
      updateAgeOnHas,
      allowStale,
      dispose,
      disposeAfter,
      noDisposeOnSet,
      noUpdateTTL,
      maxSize = 0,
      maxEntrySize = 0,
      sizeCalculation,
      fetchMethod,
      fetchContext,
      noDeleteOnFetchRejection,
      noDeleteOnStaleGet,
      allowStaleOnFetchRejection,
      allowStaleOnFetchAbort,
      ignoreFetchAbort,
    } = options;

    // deprecated options, don't trigger a warning for getting them if
    // the thing being passed in is another LRUCache we're copying.
    const { length, maxAge, stale } =
      options instanceof LRUCache ? {} : options;

    if (max !== 0 && !isPosInt(max)) {
      throw new TypeError('max option must be a nonnegative integer')
    }

    const UintArray = max ? getUintArray(max) : Array;
    if (!UintArray) {
      throw new Error('invalid max value: ' + max)
    }

    this.max = max;
    this.maxSize = maxSize;
    this.maxEntrySize = maxEntrySize || this.maxSize;
    this.sizeCalculation = sizeCalculation || length;
    if (this.sizeCalculation) {
      if (!this.maxSize && !this.maxEntrySize) {
        throw new TypeError(
          'cannot set sizeCalculation without setting maxSize or maxEntrySize'
        )
      }
      if (typeof this.sizeCalculation !== 'function') {
        throw new TypeError('sizeCalculation set to non-function')
      }
    }

    this.fetchMethod = fetchMethod || null;
    if (this.fetchMethod && typeof this.fetchMethod !== 'function') {
      throw new TypeError(
        'fetchMethod must be a function if specified'
      )
    }

    this.fetchContext = fetchContext;
    if (!this.fetchMethod && fetchContext !== undefined) {
      throw new TypeError(
        'cannot set fetchContext without fetchMethod'
      )
    }

    this.keyMap = new Map();
    this.keyList = new Array(max).fill(null);
    this.valList = new Array(max).fill(null);
    this.next = new UintArray(max);
    this.prev = new UintArray(max);
    this.head = 0;
    this.tail = 0;
    this.free = new Stack(max);
    this.initialFill = 1;
    this.size = 0;

    if (typeof dispose === 'function') {
      this.dispose = dispose;
    }
    if (typeof disposeAfter === 'function') {
      this.disposeAfter = disposeAfter;
      this.disposed = [];
    } else {
      this.disposeAfter = null;
      this.disposed = null;
    }
    this.noDisposeOnSet = !!noDisposeOnSet;
    this.noUpdateTTL = !!noUpdateTTL;
    this.noDeleteOnFetchRejection = !!noDeleteOnFetchRejection;
    this.allowStaleOnFetchRejection = !!allowStaleOnFetchRejection;
    this.allowStaleOnFetchAbort = !!allowStaleOnFetchAbort;
    this.ignoreFetchAbort = !!ignoreFetchAbort;

    // NB: maxEntrySize is set to maxSize if it's set
    if (this.maxEntrySize !== 0) {
      if (this.maxSize !== 0) {
        if (!isPosInt(this.maxSize)) {
          throw new TypeError(
            'maxSize must be a positive integer if specified'
          )
        }
      }
      if (!isPosInt(this.maxEntrySize)) {
        throw new TypeError(
          'maxEntrySize must be a positive integer if specified'
        )
      }
      this.initializeSizeTracking();
    }

    this.allowStale = !!allowStale || !!stale;
    this.noDeleteOnStaleGet = !!noDeleteOnStaleGet;
    this.updateAgeOnGet = !!updateAgeOnGet;
    this.updateAgeOnHas = !!updateAgeOnHas;
    this.ttlResolution =
      isPosInt(ttlResolution) || ttlResolution === 0
        ? ttlResolution
        : 1;
    this.ttlAutopurge = !!ttlAutopurge;
    this.ttl = ttl || maxAge || 0;
    if (this.ttl) {
      if (!isPosInt(this.ttl)) {
        throw new TypeError(
          'ttl must be a positive integer if specified'
        )
      }
      this.initializeTTLTracking();
    }

    // do not allow completely unbounded caches
    if (this.max === 0 && this.ttl === 0 && this.maxSize === 0) {
      throw new TypeError(
        'At least one of max, maxSize, or ttl is required'
      )
    }
    if (!this.ttlAutopurge && !this.max && !this.maxSize) {
      const code = 'LRU_CACHE_UNBOUNDED';
      if (shouldWarn(code)) {
        warned.add(code);
        const msg =
          'TTL caching without ttlAutopurge, max, or maxSize can ' +
          'result in unbounded memory consumption.';
        emitWarning(msg, 'UnboundedCacheWarning', code, LRUCache);
      }
    }

    if (stale) {
      deprecatedOption('stale', 'allowStale');
    }
    if (maxAge) {
      deprecatedOption('maxAge', 'ttl');
    }
    if (length) {
      deprecatedOption('length', 'sizeCalculation');
    }
  }

  getRemainingTTL(key) {
    return this.has(key, { updateAgeOnHas: false }) ? Infinity : 0
  }

  initializeTTLTracking() {
    this.ttls = new ZeroArray(this.max);
    this.starts = new ZeroArray(this.max);

    this.setItemTTL = (index, ttl, start = perf.now()) => {
      this.starts[index] = ttl !== 0 ? start : 0;
      this.ttls[index] = ttl;
      if (ttl !== 0 && this.ttlAutopurge) {
        const t = setTimeout(() => {
          if (this.isStale(index)) {
            this.delete(this.keyList[index]);
          }
        }, ttl + 1);
        /* istanbul ignore else - unref() not supported on all platforms */
        if (t.unref) {
          t.unref();
        }
      }
    };

    this.updateItemAge = index => {
      this.starts[index] = this.ttls[index] !== 0 ? perf.now() : 0;
    };

    this.statusTTL = (status, index) => {
      if (status) {
        status.ttl = this.ttls[index];
        status.start = this.starts[index];
        status.now = cachedNow || getNow();
        status.remainingTTL = status.now + status.ttl - status.start;
      }
    };

    // debounce calls to perf.now() to 1s so we're not hitting
    // that costly call repeatedly.
    let cachedNow = 0;
    const getNow = () => {
      const n = perf.now();
      if (this.ttlResolution > 0) {
        cachedNow = n;
        const t = setTimeout(
          () => (cachedNow = 0),
          this.ttlResolution
        );
        /* istanbul ignore else - not available on all platforms */
        if (t.unref) {
          t.unref();
        }
      }
      return n
    };

    this.getRemainingTTL = key => {
      const index = this.keyMap.get(key);
      if (index === undefined) {
        return 0
      }
      return this.ttls[index] === 0 || this.starts[index] === 0
        ? Infinity
        : this.starts[index] +
            this.ttls[index] -
            (cachedNow || getNow())
    };

    this.isStale = index => {
      return (
        this.ttls[index] !== 0 &&
        this.starts[index] !== 0 &&
        (cachedNow || getNow()) - this.starts[index] >
          this.ttls[index]
      )
    };
  }
  updateItemAge(_index) {}
  statusTTL(_status, _index) {}
  setItemTTL(_index, _ttl, _start) {}
  isStale(_index) {
    return false
  }

  initializeSizeTracking() {
    this.calculatedSize = 0;
    this.sizes = new ZeroArray(this.max);
    this.removeItemSize = index => {
      this.calculatedSize -= this.sizes[index];
      this.sizes[index] = 0;
    };
    this.requireSize = (k, v, size, sizeCalculation) => {
      // provisionally accept background fetches.
      // actual value size will be checked when they return.
      if (this.isBackgroundFetch(v)) {
        return 0
      }
      if (!isPosInt(size)) {
        if (sizeCalculation) {
          if (typeof sizeCalculation !== 'function') {
            throw new TypeError('sizeCalculation must be a function')
          }
          size = sizeCalculation(v, k);
          if (!isPosInt(size)) {
            throw new TypeError(
              'sizeCalculation return invalid (expect positive integer)'
            )
          }
        } else {
          throw new TypeError(
            'invalid size value (must be positive integer). ' +
              'When maxSize or maxEntrySize is used, sizeCalculation or size ' +
              'must be set.'
          )
        }
      }
      return size
    };
    this.addItemSize = (index, size, status) => {
      this.sizes[index] = size;
      if (this.maxSize) {
        const maxSize = this.maxSize - this.sizes[index];
        while (this.calculatedSize > maxSize) {
          this.evict(true);
        }
      }
      this.calculatedSize += this.sizes[index];
      if (status) {
        status.entrySize = size;
        status.totalCalculatedSize = this.calculatedSize;
      }
    };
  }
  removeItemSize(_index) {}
  addItemSize(_index, _size) {}
  requireSize(_k, _v, size, sizeCalculation) {
    if (size || sizeCalculation) {
      throw new TypeError(
        'cannot set size without setting maxSize or maxEntrySize on cache'
      )
    }
  }

  *indexes({ allowStale = this.allowStale } = {}) {
    if (this.size) {
      for (let i = this.tail; true; ) {
        if (!this.isValidIndex(i)) {
          break
        }
        if (allowStale || !this.isStale(i)) {
          yield i;
        }
        if (i === this.head) {
          break
        } else {
          i = this.prev[i];
        }
      }
    }
  }

  *rindexes({ allowStale = this.allowStale } = {}) {
    if (this.size) {
      for (let i = this.head; true; ) {
        if (!this.isValidIndex(i)) {
          break
        }
        if (allowStale || !this.isStale(i)) {
          yield i;
        }
        if (i === this.tail) {
          break
        } else {
          i = this.next[i];
        }
      }
    }
  }

  isValidIndex(index) {
    return (
      index !== undefined &&
      this.keyMap.get(this.keyList[index]) === index
    )
  }

  *entries() {
    for (const i of this.indexes()) {
      if (
        this.valList[i] !== undefined &&
        this.keyList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield [this.keyList[i], this.valList[i]];
      }
    }
  }
  *rentries() {
    for (const i of this.rindexes()) {
      if (
        this.valList[i] !== undefined &&
        this.keyList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield [this.keyList[i], this.valList[i]];
      }
    }
  }

  *keys() {
    for (const i of this.indexes()) {
      if (
        this.keyList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield this.keyList[i];
      }
    }
  }
  *rkeys() {
    for (const i of this.rindexes()) {
      if (
        this.keyList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield this.keyList[i];
      }
    }
  }

  *values() {
    for (const i of this.indexes()) {
      if (
        this.valList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield this.valList[i];
      }
    }
  }
  *rvalues() {
    for (const i of this.rindexes()) {
      if (
        this.valList[i] !== undefined &&
        !this.isBackgroundFetch(this.valList[i])
      ) {
        yield this.valList[i];
      }
    }
  }

  [Symbol.iterator]() {
    return this.entries()
  }

  find(fn, getOptions) {
    for (const i of this.indexes()) {
      const v = this.valList[i];
      const value = this.isBackgroundFetch(v)
        ? v.__staleWhileFetching
        : v;
      if (value === undefined) continue
      if (fn(value, this.keyList[i], this)) {
        return this.get(this.keyList[i], getOptions)
      }
    }
  }

  forEach(fn, thisp = this) {
    for (const i of this.indexes()) {
      const v = this.valList[i];
      const value = this.isBackgroundFetch(v)
        ? v.__staleWhileFetching
        : v;
      if (value === undefined) continue
      fn.call(thisp, value, this.keyList[i], this);
    }
  }

  rforEach(fn, thisp = this) {
    for (const i of this.rindexes()) {
      const v = this.valList[i];
      const value = this.isBackgroundFetch(v)
        ? v.__staleWhileFetching
        : v;
      if (value === undefined) continue
      fn.call(thisp, value, this.keyList[i], this);
    }
  }

  get prune() {
    deprecatedMethod('prune', 'purgeStale');
    return this.purgeStale
  }

  purgeStale() {
    let deleted = false;
    for (const i of this.rindexes({ allowStale: true })) {
      if (this.isStale(i)) {
        this.delete(this.keyList[i]);
        deleted = true;
      }
    }
    return deleted
  }

  dump() {
    const arr = [];
    for (const i of this.indexes({ allowStale: true })) {
      const key = this.keyList[i];
      const v = this.valList[i];
      const value = this.isBackgroundFetch(v)
        ? v.__staleWhileFetching
        : v;
      if (value === undefined) continue
      const entry = { value };
      if (this.ttls) {
        entry.ttl = this.ttls[i];
        // always dump the start relative to a portable timestamp
        // it's ok for this to be a bit slow, it's a rare operation.
        const age = perf.now() - this.starts[i];
        entry.start = Math.floor(Date.now() - age);
      }
      if (this.sizes) {
        entry.size = this.sizes[i];
      }
      arr.unshift([key, entry]);
    }
    return arr
  }

  load(arr) {
    this.clear();
    for (const [key, entry] of arr) {
      if (entry.start) {
        // entry.start is a portable timestamp, but we may be using
        // node's performance.now(), so calculate the offset.
        // it's ok for this to be a bit slow, it's a rare operation.
        const age = Date.now() - entry.start;
        entry.start = perf.now() - age;
      }
      this.set(key, entry.value, entry);
    }
  }

  dispose(_v, _k, _reason) {}

  set(
    k,
    v,
    {
      ttl = this.ttl,
      start,
      noDisposeOnSet = this.noDisposeOnSet,
      size = 0,
      sizeCalculation = this.sizeCalculation,
      noUpdateTTL = this.noUpdateTTL,
      status,
    } = {}
  ) {
    size = this.requireSize(k, v, size, sizeCalculation);
    // if the item doesn't fit, don't do anything
    // NB: maxEntrySize set to maxSize by default
    if (this.maxEntrySize && size > this.maxEntrySize) {
      if (status) {
        status.set = 'miss';
        status.maxEntrySizeExceeded = true;
      }
      // have to delete, in case a background fetch is there already.
      // in non-async cases, this is a no-op
      this.delete(k);
      return this
    }
    let index = this.size === 0 ? undefined : this.keyMap.get(k);
    if (index === undefined) {
      // addition
      index = this.newIndex();
      this.keyList[index] = k;
      this.valList[index] = v;
      this.keyMap.set(k, index);
      this.next[this.tail] = index;
      this.prev[index] = this.tail;
      this.tail = index;
      this.size++;
      this.addItemSize(index, size, status);
      if (status) {
        status.set = 'add';
      }
      noUpdateTTL = false;
    } else {
      // update
      this.moveToTail(index);
      const oldVal = this.valList[index];
      if (v !== oldVal) {
        if (this.isBackgroundFetch(oldVal)) {
          oldVal.__abortController.abort(new Error('replaced'));
        } else {
          if (!noDisposeOnSet) {
            this.dispose(oldVal, k, 'set');
            if (this.disposeAfter) {
              this.disposed.push([oldVal, k, 'set']);
            }
          }
        }
        this.removeItemSize(index);
        this.valList[index] = v;
        this.addItemSize(index, size, status);
        if (status) {
          status.set = 'replace';
          const oldValue =
            oldVal && this.isBackgroundFetch(oldVal)
              ? oldVal.__staleWhileFetching
              : oldVal;
          if (oldValue !== undefined) status.oldValue = oldValue;
        }
      } else if (status) {
        status.set = 'update';
      }
    }
    if (ttl !== 0 && this.ttl === 0 && !this.ttls) {
      this.initializeTTLTracking();
    }
    if (!noUpdateTTL) {
      this.setItemTTL(index, ttl, start);
    }
    this.statusTTL(status, index);
    if (this.disposeAfter) {
      while (this.disposed.length) {
        this.disposeAfter(...this.disposed.shift());
      }
    }
    return this
  }

  newIndex() {
    if (this.size === 0) {
      return this.tail
    }
    if (this.size === this.max && this.max !== 0) {
      return this.evict(false)
    }
    if (this.free.length !== 0) {
      return this.free.pop()
    }
    // initial fill, just keep writing down the list
    return this.initialFill++
  }

  pop() {
    if (this.size) {
      const val = this.valList[this.head];
      this.evict(true);
      return val
    }
  }

  evict(free) {
    const head = this.head;
    const k = this.keyList[head];
    const v = this.valList[head];
    if (this.isBackgroundFetch(v)) {
      v.__abortController.abort(new Error('evicted'));
    } else {
      this.dispose(v, k, 'evict');
      if (this.disposeAfter) {
        this.disposed.push([v, k, 'evict']);
      }
    }
    this.removeItemSize(head);
    // if we aren't about to use the index, then null these out
    if (free) {
      this.keyList[head] = null;
      this.valList[head] = null;
      this.free.push(head);
    }
    this.head = this.next[head];
    this.keyMap.delete(k);
    this.size--;
    return head
  }

  has(k, { updateAgeOnHas = this.updateAgeOnHas, status } = {}) {
    const index = this.keyMap.get(k);
    if (index !== undefined) {
      if (!this.isStale(index)) {
        if (updateAgeOnHas) {
          this.updateItemAge(index);
        }
        if (status) status.has = 'hit';
        this.statusTTL(status, index);
        return true
      } else if (status) {
        status.has = 'stale';
        this.statusTTL(status, index);
      }
    } else if (status) {
      status.has = 'miss';
    }
    return false
  }

  // like get(), but without any LRU updating or TTL expiration
  peek(k, { allowStale = this.allowStale } = {}) {
    const index = this.keyMap.get(k);
    if (index !== undefined && (allowStale || !this.isStale(index))) {
      const v = this.valList[index];
      // either stale and allowed, or forcing a refresh of non-stale value
      return this.isBackgroundFetch(v) ? v.__staleWhileFetching : v
    }
  }

  backgroundFetch(k, index, options, context) {
    const v = index === undefined ? undefined : this.valList[index];
    if (this.isBackgroundFetch(v)) {
      return v
    }
    const ac = new AC();
    if (options.signal) {
      options.signal.addEventListener('abort', () =>
        ac.abort(options.signal.reason)
      );
    }
    const fetchOpts = {
      signal: ac.signal,
      options,
      context,
    };
    const cb = (v, updateCache = false) => {
      const { aborted } = ac.signal;
      const ignoreAbort = options.ignoreFetchAbort && v !== undefined;
      if (options.status) {
        if (aborted && !updateCache) {
          options.status.fetchAborted = true;
          options.status.fetchError = ac.signal.reason;
          if (ignoreAbort) options.status.fetchAbortIgnored = true;
        } else {
          options.status.fetchResolved = true;
        }
      }
      if (aborted && !ignoreAbort && !updateCache) {
        return fetchFail(ac.signal.reason)
      }
      // either we didn't abort, and are still here, or we did, and ignored
      if (this.valList[index] === p) {
        if (v === undefined) {
          if (p.__staleWhileFetching) {
            this.valList[index] = p.__staleWhileFetching;
          } else {
            this.delete(k);
          }
        } else {
          if (options.status) options.status.fetchUpdated = true;
          this.set(k, v, fetchOpts.options);
        }
      }
      return v
    };
    const eb = er => {
      if (options.status) {
        options.status.fetchRejected = true;
        options.status.fetchError = er;
      }
      return fetchFail(er)
    };
    const fetchFail = er => {
      const { aborted } = ac.signal;
      const allowStaleAborted =
        aborted && options.allowStaleOnFetchAbort;
      const allowStale =
        allowStaleAborted || options.allowStaleOnFetchRejection;
      const noDelete = allowStale || options.noDeleteOnFetchRejection;
      if (this.valList[index] === p) {
        // if we allow stale on fetch rejections, then we need to ensure that
        // the stale value is not removed from the cache when the fetch fails.
        const del = !noDelete || p.__staleWhileFetching === undefined;
        if (del) {
          this.delete(k);
        } else if (!allowStaleAborted) {
          // still replace the *promise* with the stale value,
          // since we are done with the promise at this point.
          // leave it untouched if we're still waiting for an
          // aborted background fetch that hasn't yet returned.
          this.valList[index] = p.__staleWhileFetching;
        }
      }
      if (allowStale) {
        if (options.status && p.__staleWhileFetching !== undefined) {
          options.status.returnedStale = true;
        }
        return p.__staleWhileFetching
      } else if (p.__returned === p) {
        throw er
      }
    };
    const pcall = (res, rej) => {
      this.fetchMethod(k, v, fetchOpts).then(v => res(v), rej);
      // ignored, we go until we finish, regardless.
      // defer check until we are actually aborting,
      // so fetchMethod can override.
      ac.signal.addEventListener('abort', () => {
        if (
          !options.ignoreFetchAbort ||
          options.allowStaleOnFetchAbort
        ) {
          res();
          // when it eventually resolves, update the cache.
          if (options.allowStaleOnFetchAbort) {
            res = v => cb(v, true);
          }
        }
      });
    };
    if (options.status) options.status.fetchDispatched = true;
    const p = new Promise(pcall).then(cb, eb);
    p.__abortController = ac;
    p.__staleWhileFetching = v;
    p.__returned = null;
    if (index === undefined) {
      // internal, don't expose status.
      this.set(k, p, { ...fetchOpts.options, status: undefined });
      index = this.keyMap.get(k);
    } else {
      this.valList[index] = p;
    }
    return p
  }

  isBackgroundFetch(p) {
    return (
      p &&
      typeof p === 'object' &&
      typeof p.then === 'function' &&
      Object.prototype.hasOwnProperty.call(
        p,
        '__staleWhileFetching'
      ) &&
      Object.prototype.hasOwnProperty.call(p, '__returned') &&
      (p.__returned === p || p.__returned === null)
    )
  }

  // this takes the union of get() and set() opts, because it does both
  async fetch(
    k,
    {
      // get options
      allowStale = this.allowStale,
      updateAgeOnGet = this.updateAgeOnGet,
      noDeleteOnStaleGet = this.noDeleteOnStaleGet,
      // set options
      ttl = this.ttl,
      noDisposeOnSet = this.noDisposeOnSet,
      size = 0,
      sizeCalculation = this.sizeCalculation,
      noUpdateTTL = this.noUpdateTTL,
      // fetch exclusive options
      noDeleteOnFetchRejection = this.noDeleteOnFetchRejection,
      allowStaleOnFetchRejection = this.allowStaleOnFetchRejection,
      ignoreFetchAbort = this.ignoreFetchAbort,
      allowStaleOnFetchAbort = this.allowStaleOnFetchAbort,
      fetchContext = this.fetchContext,
      forceRefresh = false,
      status,
      signal,
    } = {}
  ) {
    if (!this.fetchMethod) {
      if (status) status.fetch = 'get';
      return this.get(k, {
        allowStale,
        updateAgeOnGet,
        noDeleteOnStaleGet,
        status,
      })
    }

    const options = {
      allowStale,
      updateAgeOnGet,
      noDeleteOnStaleGet,
      ttl,
      noDisposeOnSet,
      size,
      sizeCalculation,
      noUpdateTTL,
      noDeleteOnFetchRejection,
      allowStaleOnFetchRejection,
      allowStaleOnFetchAbort,
      ignoreFetchAbort,
      status,
      signal,
    };

    let index = this.keyMap.get(k);
    if (index === undefined) {
      if (status) status.fetch = 'miss';
      const p = this.backgroundFetch(k, index, options, fetchContext);
      return (p.__returned = p)
    } else {
      // in cache, maybe already fetching
      const v = this.valList[index];
      if (this.isBackgroundFetch(v)) {
        const stale =
          allowStale && v.__staleWhileFetching !== undefined;
        if (status) {
          status.fetch = 'inflight';
          if (stale) status.returnedStale = true;
        }
        return stale ? v.__staleWhileFetching : (v.__returned = v)
      }

      // if we force a refresh, that means do NOT serve the cached value,
      // unless we are already in the process of refreshing the cache.
      const isStale = this.isStale(index);
      if (!forceRefresh && !isStale) {
        if (status) status.fetch = 'hit';
        this.moveToTail(index);
        if (updateAgeOnGet) {
          this.updateItemAge(index);
        }
        this.statusTTL(status, index);
        return v
      }

      // ok, it is stale or a forced refresh, and not already fetching.
      // refresh the cache.
      const p = this.backgroundFetch(k, index, options, fetchContext);
      const hasStale = p.__staleWhileFetching !== undefined;
      const staleVal = hasStale && allowStale;
      if (status) {
        status.fetch = hasStale && isStale ? 'stale' : 'refresh';
        if (staleVal && isStale) status.returnedStale = true;
      }
      return staleVal ? p.__staleWhileFetching : (p.__returned = p)
    }
  }

  get(
    k,
    {
      allowStale = this.allowStale,
      updateAgeOnGet = this.updateAgeOnGet,
      noDeleteOnStaleGet = this.noDeleteOnStaleGet,
      status,
    } = {}
  ) {
    const index = this.keyMap.get(k);
    if (index !== undefined) {
      const value = this.valList[index];
      const fetching = this.isBackgroundFetch(value);
      this.statusTTL(status, index);
      if (this.isStale(index)) {
        if (status) status.get = 'stale';
        // delete only if not an in-flight background fetch
        if (!fetching) {
          if (!noDeleteOnStaleGet) {
            this.delete(k);
          }
          if (status) status.returnedStale = allowStale;
          return allowStale ? value : undefined
        } else {
          if (status) {
            status.returnedStale =
              allowStale && value.__staleWhileFetching !== undefined;
          }
          return allowStale ? value.__staleWhileFetching : undefined
        }
      } else {
        if (status) status.get = 'hit';
        // if we're currently fetching it, we don't actually have it yet
        // it's not stale, which means this isn't a staleWhileRefetching.
        // If it's not stale, and fetching, AND has a __staleWhileFetching
        // value, then that means the user fetched with {forceRefresh:true},
        // so it's safe to return that value.
        if (fetching) {
          return value.__staleWhileFetching
        }
        this.moveToTail(index);
        if (updateAgeOnGet) {
          this.updateItemAge(index);
        }
        return value
      }
    } else if (status) {
      status.get = 'miss';
    }
  }

  connect(p, n) {
    this.prev[n] = p;
    this.next[p] = n;
  }

  moveToTail(index) {
    // if tail already, nothing to do
    // if head, move head to next[index]
    // else
    //   move next[prev[index]] to next[index] (head has no prev)
    //   move prev[next[index]] to prev[index]
    // prev[index] = tail
    // next[tail] = index
    // tail = index
    if (index !== this.tail) {
      if (index === this.head) {
        this.head = this.next[index];
      } else {
        this.connect(this.prev[index], this.next[index]);
      }
      this.connect(this.tail, index);
      this.tail = index;
    }
  }

  get del() {
    deprecatedMethod('del', 'delete');
    return this.delete
  }

  delete(k) {
    let deleted = false;
    if (this.size !== 0) {
      const index = this.keyMap.get(k);
      if (index !== undefined) {
        deleted = true;
        if (this.size === 1) {
          this.clear();
        } else {
          this.removeItemSize(index);
          const v = this.valList[index];
          if (this.isBackgroundFetch(v)) {
            v.__abortController.abort(new Error('deleted'));
          } else {
            this.dispose(v, k, 'delete');
            if (this.disposeAfter) {
              this.disposed.push([v, k, 'delete']);
            }
          }
          this.keyMap.delete(k);
          this.keyList[index] = null;
          this.valList[index] = null;
          if (index === this.tail) {
            this.tail = this.prev[index];
          } else if (index === this.head) {
            this.head = this.next[index];
          } else {
            this.next[this.prev[index]] = this.next[index];
            this.prev[this.next[index]] = this.prev[index];
          }
          this.size--;
          this.free.push(index);
        }
      }
    }
    if (this.disposed) {
      while (this.disposed.length) {
        this.disposeAfter(...this.disposed.shift());
      }
    }
    return deleted
  }

  clear() {
    for (const index of this.rindexes({ allowStale: true })) {
      const v = this.valList[index];
      if (this.isBackgroundFetch(v)) {
        v.__abortController.abort(new Error('deleted'));
      } else {
        const k = this.keyList[index];
        this.dispose(v, k, 'delete');
        if (this.disposeAfter) {
          this.disposed.push([v, k, 'delete']);
        }
      }
    }

    this.keyMap.clear();
    this.valList.fill(null);
    this.keyList.fill(null);
    if (this.ttls) {
      this.ttls.fill(0);
      this.starts.fill(0);
    }
    if (this.sizes) {
      this.sizes.fill(0);
    }
    this.head = 0;
    this.tail = 0;
    this.initialFill = 1;
    this.free.length = 0;
    this.calculatedSize = 0;
    this.size = 0;
    if (this.disposed) {
      while (this.disposed.length) {
        this.disposeAfter(...this.disposed.shift());
      }
    }
  }

  get reset() {
    deprecatedMethod('reset', 'clear');
    return this.clear
  }

  get length() {
    deprecatedProperty('length', 'size');
    return this.size
  }

  static get AbortController() {
    return AC
  }
  static get AbortSignal() {
    return AS
  }
}

var _a;
const defaultOptions = {
    maxPageSize: 4096,
    cacheSize: 1024,
    headers: {}
};
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
const swapNeeded = (function () {
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
})();
function ntoh16(data) {
    if (swapNeeded) {
        for (let i = 0; i < data.length; i++) {
            data[i] = ((data[i] & 0xFF00) >> 8) | ((data[i] & 0x00FF) << 8);
        }
    }
}

// This is the entry point for an HTTP backend thread
// It can serve multiple SQLite worker threads
var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
let options;
// The set of sqlite Workers that use this backend
const consumers = {};
const files = new LRUCache({
    max: 32
});
// The entry for a given page can be either the page itself
// or the number of the page that has the parent super-page
// Here is an example of a cache structure (indexed by the URL + page number)
// URL|0 -> Uint8Array(page)                     # This page is in cache
// URL|1 -> undefined                            # These two
// URL|2 -> undefined                            # are not
// URL|3 -> Promise<Uint8Array(page * 2)>        # This is a currently downloading 2-page segment
// URL|4 -> Promise<3>                           # This references the previous one
// URL|5 -> 2                                    # An invalid stale entry that will be overwritten
let cache;
let nextId = 1;
const backendAsyncMethods = {
    // HTTP is a stateless protocol, so xOpen means verify if the URL is valid
    xOpen: function (msg) {
        return __awaiter(this, void 0, void 0, function* () {
            let entry = files.get(msg.url);
            if (entry instanceof Promise)
                entry = yield entry;
            if (entry !== undefined)
                return 0;
            // Set a promise for the next opener of the same file to await upon
            entry = fetch(msg.url, { method: 'HEAD', headers: Object.assign({}, options === null || options === void 0 ? void 0 : options.headers) })
                .then((head) => {
                var _a;
                if (head.headers.get('Accept-Ranges') !== 'bytes') {
                    console.warn(`Server for ${msg.url} does not advertise 'Accept-Ranges'. ` +
                        'If the server supports it, in order to remove this message, add "Accept-Ranges: bytes". ' +
                        'Additionally, if using CORS, add "Access-Control-Expose-Headers: *".');
                }
                return {
                    url: msg.url,
                    id: nextId++,
                    size: BigInt((_a = head.headers.get('Content-Length')) !== null && _a !== void 0 ? _a : 0),
                    // This will be determined on the first read
                    pageSize: null
                };
            });
            files.set(msg.url, entry);
            // Replace it with the actual entry once resolved
            files.set(msg.url, yield entry);
            return 0;
        });
    },
    // There is no real difference between xOpen and xAccess, only the semantics differ
    xAccess: function (msg, consumer) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = new Uint32Array(consumer.shm, 0, 1);
            try {
                const r = yield backendAsyncMethods.xOpen(msg, consumer);
                if (r === 0) {
                    result[0] = 1;
                }
                else {
                    result[0] = 0;
                }
            }
            catch (_a) {
                result[0] = 0;
            }
            return 0;
        });
    },
    xRead: function (msg, consumer) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            let entry = files.get(msg.url);
            if (!entry)
                throw new Error(`File ${msg.url} not open`);
            if (entry instanceof Promise)
                entry = yield entry;
            if (msg.n === undefined || msg.offset === undefined)
                throw new Error('Mandatory arguments missing');
            if (!entry.pageSize) {
                // Determine the page size if we don't know it
                // It is in two big-endian bytes at offset 16 in what is always the first page
                entry.pageSize = 1024;
                const pageDataBuffer = new ArrayBuffer(2);
                const r = yield backendAsyncMethods.xRead({ msg: 'xRead', url: msg.url, offset: BigInt(16), n: 2 }, { buffer: new Uint8Array(pageDataBuffer) });
                const pageData = new Uint16Array(pageDataBuffer);
                if (r !== 0)
                    return r;
                ntoh16(pageData);
                entry.pageSize = pageData[0];
                debug['vfs'](`page size is ${entry.pageSize}`);
                if (entry.pageSize != 1024) {
                    // If the page size is not 1024 we can't keep this "page" in the cache
                    console.warn(`Page size for ${msg.url} is ${entry.pageSize}, recommended size is 1024`);
                    cache.delete(entry.id + '|0');
                }
                if (entry.pageSize > ((_a = options === null || options === void 0 ? void 0 : options.maxPageSize) !== null && _a !== void 0 ? _a : defaultOptions.maxPageSize))
                    throw new Error(`${entry.pageSize} is over the maximum configured ` +
                        `${(_b = options === null || options === void 0 ? void 0 : options.maxPageSize) !== null && _b !== void 0 ? _b : defaultOptions.maxPageSize}`);
            }
            const pageSize = BigInt(entry.pageSize);
            const len = BigInt(msg.n);
            const page = msg.offset / pageSize;
            if (page * pageSize !== msg.offset)
                debug['vfs'](`Read chunk ${msg.offset}:${msg.n} is not page-aligned`);
            let pageStart = page * pageSize;
            if (pageStart + pageSize < msg.offset + len)
                throw new Error(`Read chunk ${msg.offset}:${msg.n} spans across a page-boundary`);
            const cacheId = entry.id + '|' + page;
            let data = cache.get(cacheId);
            if (data instanceof Promise)
                // This means that another thread has requested this segment
                data = yield data;
            if (typeof data === 'number') {
                debug['cache'](`cache hit (multi-page segment) for ${msg.url}:${page}`);
                // This page is present as a segment of a super-page
                const newPageStart = BigInt(data) * pageSize;
                data = cache.get(entry.id + '|' + data);
                if (data instanceof Promise)
                    data = yield data;
                if (data instanceof Uint8Array) {
                    // Not all subpages are valid, there are two possible cases
                    // where a non-valid superpage can be referenced:
                    // * the superpage was too big to fit in the cache
                    // * the superpage was evicted before the subsegments
                    pageStart = newPageStart;
                }
                else {
                    data = undefined;
                }
            }
            if (typeof data === 'undefined') {
                debug['cache'](`cache miss for ${msg.url}:${page}`);
                let chunkSize = entry.pageSize;
                // If the previous page is in the cache, we double the page size
                // This was the original page merging algorithm implemented by @phiresky
                let prev = page > 0 && cache.get(entry.id + '|' + (Number(page) - 1));
                if (prev) {
                    if (prev instanceof Promise)
                        prev = yield prev;
                    if (typeof prev === 'number')
                        prev = cache.get(entry.id + '|' + prev);
                    if (prev instanceof Promise)
                        prev = yield prev;
                    if (prev instanceof Uint8Array) {
                        // Valid superpage
                        chunkSize = prev.byteLength * 2;
                        debug['cache'](`downloading super page of size ${chunkSize}`);
                    }
                }
                const pages = chunkSize / entry.pageSize;
                // Download a new segment
                debug['http'](`downloading page ${page} of size ${chunkSize} starting at ${pageStart}`);
                const resp = fetch(msg.url, {
                    method: 'GET',
                    headers: Object.assign(Object.assign({}, ((_c = options === null || options === void 0 ? void 0 : options.headers) !== null && _c !== void 0 ? _c : defaultOptions.headers)), { 'Range': `bytes=${pageStart}-${pageStart + BigInt(chunkSize - 1)}` })
                })
                    .then((r) => r.arrayBuffer())
                    .then((r) => new Uint8Array(r));
                // We synchronously set a Promise in the cache in case another thread
                // tries to read the same segment
                cache.set(cacheId, resp);
                // These point to the parent super-page and resolve at the same time as resp
                for (let i = Number(page) + 1; i < Number(page) + pages; i++) {
                    cache.set(entry.id + '|' + i, resp.then(() => Number(page)));
                }
                data = yield resp;
                if (!(data instanceof Uint8Array) || data.length === 0)
                    throw new Error(`Invalid HTTP response received: ${JSON.stringify(resp)}`);
                // In case of a multiple-page segment, this is the parent super-page
                cache.set(cacheId, data);
                // These point to the parent super-page
                for (let i = Number(page) + 1; i < Number(page) + pages; i++) {
                    cache.set(entry.id + '|' + i, Number(page));
                }
            }
            else {
                debug['cache'](`cache hit for ${msg.url}:${page}`);
            }
            const pageOffset = Number(msg.offset - pageStart);
            consumer.buffer.set(data.subarray(pageOffset, pageOffset + msg.n));
            return 0;
        });
    },
    // This is cached
    xFilesize: function (msg, consumer) {
        return __awaiter(this, void 0, void 0, function* () {
            let entry = files.get(msg.url);
            if (!entry)
                throw new Error(`File ${msg.fid} not open`);
            if (entry instanceof Promise)
                entry = yield entry;
            const out = new BigInt64Array(consumer.shm, 0, 1);
            out[0] = entry.size;
            return 0;
        });
    }
};
function workMessage({ data }) {
    return __awaiter(this, void 0, void 0, function* () {
        debug['threads']('Received new work message', this, data);
        let r;
        try {
            r = yield backendAsyncMethods[data.msg](data, this);
            debug['threads']('operation successful', this, r);
            Atomics.store(this.lock, 0, r);
        }
        catch (e) {
            console.error(e);
            Atomics.store(this.lock, 0, 1);
        }
        Atomics.notify(this.lock, 0);
    });
}
globalThis.onmessage = ({ data }) => {
    var _a, _b, _c, _d;
    debug['threads']('Received new control message', data);
    switch (data.msg) {
        case 'handshake':
            {
                const shm = new SharedArrayBuffer(((_a = options === null || options === void 0 ? void 0 : options.maxPageSize) !== null && _a !== void 0 ? _a : defaultOptions.maxPageSize)
                    + Int32Array.BYTES_PER_ELEMENT);
                const lock = new Int32Array(shm, ((_b = options === null || options === void 0 ? void 0 : options.maxPageSize) !== null && _b !== void 0 ? _b : defaultOptions.maxPageSize));
                const buffer = new Uint8Array(shm, 0, ((_c = options === null || options === void 0 ? void 0 : options.maxPageSize) !== null && _c !== void 0 ? _c : defaultOptions.maxPageSize));
                Atomics.store(lock, 0, SYNC.HANDSHAKE);
                consumers[data.id] = { id: data.id, port: data.port, shm, lock, buffer };
                data.port.onmessage = workMessage.bind(consumers[data.id]);
                postMessage({ msg: 'ack', id: data.id, shm, lock });
            }
            break;
        case 'init':
            options = data.options;
            cache = new LRUCache({
                maxSize: ((_d = options === null || options === void 0 ? void 0 : options.cacheSize) !== null && _d !== void 0 ? _d : defaultOptions.cacheSize) * 1024,
                sizeCalculation: (value) => { var _a; return (_a = value.byteLength) !== null && _a !== void 0 ? _a : 4; }
            });
            break;
        case 'close':
            postMessage({ msg: 'ack' });
            close();
            break;
        default:
            throw new Error(`Invalid message received by backend: ${data}`);
    }
};
if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error('SharedArrayBuffer is not available. ' +
        'If your browser supports it, the webserver must send ' +
        '"Cross-Origin-Opener-Policy: same-origin "' +
        'and "Cross-Origin-Embedder-Policy: require-corp" headers.');
}
