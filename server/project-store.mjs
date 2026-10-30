import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  access,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { editSignature } from "../shared/history.mjs";
import { treeLimit, validateForestHistory } from "../shared/forestry.mjs";
import { validateLabelSession } from "../shared/label-sets.mjs";

const databases = new Map();
async function migrateDatabase(source, target) {
  const temporary = target + "." + randomUUID() + ".tmp";
  let db = databases.get(source),
    owned = false;
  if (!db) {
    db = new DatabaseSync(source, { readOnly: true });
    owned = true;
  }
  try {
    await backup(db, temporary);
    await rename(temporary, target);
  } finally {
    if (owned) db.close();
    await rm(temporary, { force: true });
  }
}
async function json(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function writeIndex(file, value) {
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}
function schema(db) {
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
  );
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 3) throw new Error("工程版本较新，请升级软件");
  if (version === 0)
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE projects(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE datasets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),source_uri TEXT NOT NULL,source_revision TEXT NOT NULL,format TEXT NOT NULL,metadata_json TEXT NOT NULL);
    CREATE TABLE edit_commands(dataset_id TEXT NOT NULL REFERENCES datasets(id),id TEXT NOT NULL,sequence INTEGER NOT NULL,parent_id TEXT,payload_version INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(dataset_id,id));
    CREATE INDEX commands_sequence ON edit_commands(dataset_id,sequence);
    CREATE TABLE snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,dataset_id TEXT NOT NULL REFERENCES datasets(id),kind TEXT NOT NULL CHECK(kind IN ('saved','recovery')),head_command_id TEXT,payload_version INTEGER NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE sessions(dataset_id TEXT PRIMARY KEY REFERENCES datasets(id),saved_snapshot_id INTEGER REFERENCES snapshots(id),recovery_snapshot_id INTEGER REFERENCES snapshots(id),revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    PRAGMA user_version=1;COMMIT;`);
  if (version < 2)
    db.exec(
      `BEGIN IMMEDIATE;CREATE TABLE entity_id_counters(dataset_id TEXT NOT NULL REFERENCES datasets(id),entity_type TEXT NOT NULL,next_id INTEGER NOT NULL,PRIMARY KEY(dataset_id,entity_type));INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));PRAGMA user_version=2;COMMIT;`,
    );
  if (version < 3)
    db.exec(
      "BEGIN IMMEDIATE;INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));PRAGMA user_version=3;COMMIT;",
    );
}
export async function openProject({
  stateDir,
  id,
  folder,
  revision,
  metadata,
  indexPath,
  projectDirectory,
  originalSource,
}) {
  const directory = indexPath
    ? path.dirname(indexPath)
    : projectDirectory || folder;
  await mkdir(directory, { recursive: true });
  const entry = indexPath || path.join(directory, "project.sceneloom.json");
  let existing = await json(entry, null);
  const legacyEntry = path.join(
    stateDir,
    "projects",
    id,
    "project.sceneloom.json",
  );
  if (!existing && !indexPath) {
    const legacy = await json(legacyEntry, null);
    if (legacy) {
      const oldPath = path.join(path.dirname(legacyEntry), legacy.database);
      if (!["project.sqlite", "project.db"].includes(legacy.database))
        throw new Error("无效的工程数据库路径");
      await migrateDatabase(oldPath, path.join(directory, "project.db"));
      existing = {
        ...legacy,
        database: "project.db",
        dataset: {
          ...legacy.dataset,
          source: path.relative(directory, folder),
        },
      };
      await writeIndex(entry, existing);
    }
  }
  if (
    existing &&
    (existing.format !== "SceneLoom" ||
      existing.version !== 1 ||
      existing.dataset.id !== id ||
      existing.dataset.sourceRevision !== revision)
  )
    throw new Error("工程数据源版本不匹配，请重新关联数据");
  // Only the project-local database is accepted; JSON is an entry point, never executable configuration.
  if (existing && !["project.sqlite", "project.db"].includes(existing.database))
    throw new Error("无效的工程数据库路径");
  const databasePath = path.join(directory, "project.db");
  if (existing?.database === "project.sqlite") {
    try {
      await access(databasePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await migrateDatabase(
        path.join(directory, "project.sqlite"),
        databasePath,
      );
    }
    existing = { ...existing, database: "project.db" };
    await writeIndex(entry, existing);
  }
  let db = databases.get(databasePath);
  if (!db) {
    db = new DatabaseSync(databasePath);
    try {
      schema(db);
    } catch (error) {
      db.close();
      throw error;
    }
    databases.set(databasePath, db);
  }
  const projectId = existing?.id || randomUUID(),
    now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO projects VALUES(?,?,?)").run(
    projectId,
    now,
    now,
  );
  db.prepare("INSERT OR IGNORE INTO datasets VALUES(?,?,?,?,?,?)").run(
    id,
    projectId,
    folder,
    revision,
    "potree",
    JSON.stringify(metadata),
  );
  db.prepare("INSERT OR IGNORE INTO sessions(dataset_id) VALUES(?)").run(id);
  const index = {
    format: "SceneLoom",
    version: 1,
    id: projectId,
    ...existing,
    database: "project.db",
    dataset: {
      ...existing?.dataset,
      id,
      source: path.relative(directory, folder),
      sourceRevision: revision,
    },
    ...(originalSource
      ? { originalSource: { path: path.relative(directory, originalSource) } }
      : {}),
  };
  if (!existing || originalSource) await writeIndex(entry, index);
  function load() {
    const state = db
      .prepare("SELECT * FROM sessions WHERE dataset_id=?")
      .get(id);
    const read = (snapshotId) =>
      snapshotId
        ? JSON.parse(
            db
              .prepare("SELECT payload_json FROM snapshots WHERE id=?")
              .get(snapshotId).payload_json,
          )
        : null;
    const saved = read(state.saved_snapshot_id) || {
      operations: [],
      cursor: 0,
      savedAt: null,
    };
    const recovery = read(state.recovery_snapshot_id);
    return {
      saved,
      session: recovery || saved,
      recovered: !!recovery && editSignature(recovery) !== editSignature(saved),
    };
  }
  function save(value, explicit) {
    validateLabelSession(value);
    validateForestHistory(value.operations, metadata);
    const next = structuredClone(value);
    next.updatedAt = new Date().toISOString();
    if (explicit) next.savedAt = next.updatedAt;
    db.exec("BEGIN IMMEDIATE");
    try {
      let parent = null;
      for (const [sequence, operation] of next.operations.entries()) {
        const commandId =
          operation.id || `legacy-${sequence}-${JSON.stringify(operation)}`;
        const payload = JSON.stringify(operation);
        const old = db
          .prepare(
            "SELECT payload_json FROM edit_commands WHERE dataset_id=? AND id=?",
          )
          .get(id, commandId);
        if (old && old.payload_json !== payload)
          throw new Error("编辑命令标识冲突");
        db.prepare(
          "INSERT OR IGNORE INTO edit_commands VALUES(?,?,?,?,?,?)",
        ).run(
          id,
          commandId,
          sequence,
          parent,
          operation.payloadVersion || 1,
          payload,
        );
        parent = commandId;
      }
      const head = next.cursor
        ? next.operations[next.cursor - 1].id || null
        : null;
      const snapshot = db
        .prepare(
          "INSERT INTO snapshots(dataset_id,kind,head_command_id,payload_version,payload_json,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          explicit ? "saved" : "recovery",
          head,
          1,
          JSON.stringify(next),
          next.updatedAt,
        );
      db.prepare(
        explicit
          ? "UPDATE sessions SET saved_snapshot_id=?,recovery_snapshot_id=NULL,revision=revision+1 WHERE dataset_id=?"
          : "UPDATE sessions SET recovery_snapshot_id=?,revision=revision+1 WHERE dataset_id=?",
      ).run(snapshot.lastInsertRowid, id);
      // Only the active saved/recovery snapshots are needed; immutable commands retain history and abandoned branches.
      db.prepare(
        "DELETE FROM snapshots WHERE dataset_id=? AND id NOT IN (SELECT saved_snapshot_id FROM sessions WHERE dataset_id=? AND saved_snapshot_id IS NOT NULL UNION SELECT recovery_snapshot_id FROM sessions WHERE dataset_id=? AND recovery_snapshot_id IS NOT NULL)",
      ).run(id, id, id);
      db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(
        next.updatedAt,
        projectId,
      );
      db.exec("COMMIT");
      return next;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const store = {
    entry,
    load,
    save,
    index,
    allocateTreeId(valueType, count = 1) {
      const max = treeLimit(valueType);
      if (!max) throw new Error("无效的单木字段类型");
      if (!Number.isInteger(count) || count < 1 || count > 200000)
        throw new Error("无效的单木数量");
      const native = metadata.attributes?.find((a) => a.name === "treeID");
      let initial = 1;
      if (native) {
        if (
          native.type !== valueType ||
          !Number.isInteger(native.max?.[0]) ||
          native.max[0] < 0
        )
          throw new Error("源 treeID 缺少有效范围，无法自动编号");
        initial = native.max[0] + 1;
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        let next = Math.max(
          initial,
          db
            .prepare(
              "SELECT next_id FROM entity_id_counters WHERE dataset_id=? AND entity_type='tree'",
            )
            .get(id)?.next_id || 1,
        );
        // Also account for imported snapshots and older histories without a counter.
        for (const row of db
          .prepare("SELECT payload_json FROM edit_commands WHERE dataset_id=?")
          .all(id)) {
          const command = JSON.parse(row.payload_json);
          if (command.type === "createTree")
            next = Math.max(next, command.treeId + 1);
          else if (command.type === "segmentTrees")
            for (const tree of command.trees)
              next = Math.max(next, tree.id + 1);
        }
        if (next + count - 1 > max)
          throw new Error("单木编号已达上限，请使用 uint32 工程字段");
        db.prepare(
          "INSERT INTO entity_id_counters VALUES(?,'tree',?) ON CONFLICT(dataset_id,entity_type) DO UPDATE SET next_id=excluded.next_id",
        ).run(id, next + count);
        db.exec("COMMIT");
        return next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async snapshotTo(file) {
      await backup(db, file);
    },
    async backupTo(target) {
      if (!path.isAbsolute(target)) throw new Error("请选择有效的绝对数据目录");
      await mkdir(target); // Refuse to overwrite an existing project directory.
      try {
        await backup(db, path.join(target, "project.db"));
        await writeIndex(path.join(target, "project.sceneloom.json"), {
          ...index,
          dataset: { ...index.dataset, source: path.relative(target, folder) },
        });
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
      return path.join(target, "project.sceneloom.json");
    },
  };
  const state = load();
  if (!state.saved.savedAt && !state.session.updatedAt) {
    const legacySaved = await json(
        path.join(stateDir, "projects", `${id}.json`),
        null,
      ),
      legacyRecovery = await json(
        path.join(stateDir, "recovery", `${id}.json`),
        null,
      );
    if (legacySaved) save(legacySaved, true);
    if (legacyRecovery) save(legacyRecovery, false);
  }
  return store;
}
export function closeProjects() {
  for (const db of databases.values()) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  }
  databases.clear();
}
