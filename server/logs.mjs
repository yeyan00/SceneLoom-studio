import { promises as fs } from "node:fs";
import path from "node:path";
export async function createLogger(
  directory,
  { maxBytes = 2 * 1024 * 1024, keep = 3, capacity = 2000 } = {},
) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "application.jsonl");
  let queue = Promise.resolve(),
    size = 0,
    sequence = 0,
    pending = 0,
    dropped = 0;
  const entries = [];
  for (let i = keep; i >= 0; i--) {
    try {
      const text = await fs.readFile(i ? `${file}.${i}` : file, "utf8");
      if (i === 0 && text && !text.endsWith("\n"))
        await fs.appendFile(file, "\n");
      for (const line of text.split("\n")) {
        try {
          const entry = JSON.parse(line);
          if (Number.isInteger(entry.id)) {
            sequence = Math.max(sequence, entry.id);
            entries.push(entry);
          }
        } catch {
          /* ignore interrupted final line */
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  entries.splice(0, Math.max(0, entries.length - capacity));
  try {
    size = (await fs.stat(file)).size;
  } catch {}
  function write(level, source, message, context = {}) {
    const entry = {
      id: ++sequence,
      time: new Date().toISOString(),
      level,
      source,
      message: String(message).slice(0, 8000),
      context,
    };
    entries.push(entry);
    if (entries.length > capacity) entries.shift();
    if (pending >= 256) {
      dropped++;
      return entry;
    }
    const line = JSON.stringify(entry) + "\n";
    pending++;
    queue = queue
      .then(async () => {
        if (size + Buffer.byteLength(line) > maxBytes) {
          await fs.rm(`${file}.${keep}`, { force: true });
          for (let i = keep - 1; i >= 1; i--)
            try {
              await fs.rename(`${file}.${i}`, `${file}.${i + 1}`);
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          try {
            await fs.rename(file, `${file}.1`);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          size = 0;
        }
        await fs.appendFile(file, line);
        size += Buffer.byteLength(line);
      })
      .catch((e) => {
        console.error("Log write failed:", e.message);
      })
      .finally(() => {
        pending--;
      });
    return entry;
  }
  function query({ after = 0, level = "", search = "" } = {}) {
    const term = search.toLowerCase();
    return {
      entries: entries
        .filter(
          (e) =>
            e.id > after &&
            (!level || e.level === level) &&
            (!term ||
              `${e.source} ${e.message} ${JSON.stringify(e.context)}`
                .toLowerCase()
                .includes(term)),
        )
        .slice(-500),
      cursor: sequence,
      directory,
      dropped,
    };
  }
  return {
    write,
    query,
    flush: () => queue,
    export: async () => {
      await queue;
      const chunks = [];
      for (let i = keep; i >= 0; i--)
        try {
          chunks.push(await fs.readFile(i ? `${file}.${i}` : file, "utf8"));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      return chunks.join("");
    },
  };
}
