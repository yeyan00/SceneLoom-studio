export async function api(url, data) {
  const response = await fetch(
    "/api" + url,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export function activity(message, level = "info", context = {}) {
  return fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, level, context }),
  }).catch(() => {});
}
