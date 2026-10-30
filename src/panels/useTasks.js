import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export const taskRunning = (job) =>
  ["queued", "running", "cancelling"].includes(job.status);

// The backend owns task state; the UI keeps all tasks rather than replacing the
// previous job when another tool starts. Old completions are not replayed.
export function useTasks({ onComplete, onFailure, onError }) {
  const [tasks, setTasks] = useState([]);
  const known = useRef(new Map()),
    notified = useRef(new Set()),
    callbacks = useRef();
  const completions = useRef(Promise.resolve());
  callbacks.current = { onComplete, onFailure, onError };
  const merge = useCallback((incoming) => {
    for (const task of incoming) {
      const previous = known.current.get(task.id);
      // A launch response can arrive after a poll already observed completion.
      if (previous && !taskRunning(previous) && taskRunning(task)) continue;
      known.current.set(task.id, { ...previous, ...task });
      if (!taskRunning(task) && !notified.current.has(task.id)) {
        notified.current.add(task.id);
        if (previous && taskRunning(previous)) {
          completions.current = completions.current
            .then(async () => {
              if (task.status === "succeeded")
                await callbacks.current.onComplete(task);
              else if (task.status === "failed")
                callbacks.current.onFailure(task);
            })
            .catch((error) => callbacks.current.onError(error));
        }
      }
    }
    setTasks(
      [...known.current.values()].sort(
        (a, b) => (b.startedAt || 0) - (a.startedAt || 0),
      ),
    );
  }, []);
  const refresh = useCallback(async () => {
    const result = await api("/jobs");
    merge(result.jobs);
  }, [merge]);
  useEffect(() => {
    refresh().catch((error) => callbacks.current.onError(error));
  }, [refresh]);
  const running = tasks.filter(taskRunning).length;
  useEffect(() => {
    if (!running) return;
    let polling = false,
      stopped = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await api("/jobs");
        if (!stopped) merge(result.jobs);
      } catch (error) {
        if (!stopped) callbacks.current.onError(error);
      } finally {
        polling = false;
      }
    }, 750);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, merge]);
  const track = useCallback((task) => merge([task]), [merge]);
  const cancel = useCallback(
    async (id) => merge([await api(`/jobs/${id}/cancel`, {})]),
    [merge],
  );
  return { tasks, running, track, refresh, cancel };
}
