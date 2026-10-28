class BrowserPool {
  on() {
    return this;
  }

  async query() {
    throw new Error('PostgreSQL is unavailable in the browser bundle.');
  }

  async connect() {
    throw new Error('PostgreSQL is unavailable in the browser bundle.');
  }

  async end() {
    return undefined;
  }
}

export default { Pool: BrowserPool };
