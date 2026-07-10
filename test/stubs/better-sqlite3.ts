// `better-sqlite3` is compiled against Electron's ABI and cannot be loaded by
// Node, so importing it in tests crashes with ERR_DLOPEN_FAILED. Nothing under
// test constructs a database through this module — tests inject their own — so
// the constructor exists only to satisfy the import.
export default class Database {
  constructor() {
    throw new Error(
      'better-sqlite3 is stubbed in tests. Inject a database instead of calling getDb().'
    );
  }
}
