import { useEffect, useCallback, useState } from "react";
import { supportedLocales, translate } from "./locales/translate.mjs";
export function useI18n() {
  const [locale, setLocale] = useState(() => {
    try {
      const saved = localStorage.getItem("sceneloom.locale");
      return supportedLocales.includes(saved) ? saved : "zh-CN";
    } catch {
      return "zh-CN";
    }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "en" ? "SceneLoom Studio" : "SceneLoom Studio · 景织";
    try {
      localStorage.setItem("sceneloom.locale", locale);
    } catch {
      /* preferences are optional when storage is unavailable */
    }
  }, [locale]);
  const t = useCallback(
    (key, params) => translate(locale, key, params),
    [locale],
  );
  const format = useCallback(
    (n) => new Intl.NumberFormat(locale).format(n || 0),
    [locale],
  );
  return { locale, setLocale, t, format };
}
