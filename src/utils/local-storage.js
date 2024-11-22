const fs = require('fs');
const path = require('path');

/**
 * Simple localStorage implementation before it becomes widely available in NodeJS.
 * https://github.com/nodejs/node/blob/main/doc/api/globals.md#localstorage
 */
class LocalStorage {
  constructor() {
    this.filePath = path.resolve(__dirname, '..', '..', 'local-storage.json');
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  #save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
  }

  /** Lazy-load reading from disk. */
  get store() {
    return (this.store = this.#load());
  }
  set store(value) {
    Object.defineProperty(this, 'store', { value });
  }

  getItem(key) {
    return this.store[key];
  }

  setItem(key, value) {
    this.store[key] = JSON.stringify(value);
    this.#save();
  }

  removeItem(key) {
    delete this.store[key];
    this.#save();
  }

  clear() {
    this.store = {};
    this.#save();
  }

  key(index) {
    return Object.keys(this.store)[index];
  }

  get length() {
    return Object.keys(this.store).length;
  }
}

const localStorage = new LocalStorage();

module.exports = {
  localStorage,
};
