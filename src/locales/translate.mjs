import english from "./en.mjs";
export const supportedLocales = ["zh-CN", "en"];
export function translate(locale, key, params = {}) {
  const template = locale === "en" ? (english[key] ?? key) : key;
  return String(template).replace(
    /\{(\w+)\}/g,
    (match, name) => params[name] ?? match,
  );
}
