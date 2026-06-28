if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {
    constructor(parts, name, options = {}) {
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
      this.size = parts.reduce((acc, p) => acc + (typeof p === 'string' ? p.length : p.byteLength || p.size || 0), 0);
      this.type = options.type || '';
    }
  };
}
