const supportedLocales = new Set(["en", "zh-Hans"]);

export function resolveHostSpendLocale(search = "", browserLanguage = "") {
  const requestedLocale = new URLSearchParams(search).get("lang");
  if (supportedLocales.has(requestedLocale)) return requestedLocale;
  return /^zh(?:-|$)/i.test(browserLanguage) ? "zh-Hans" : "en";
}

function applyLocale(root, locale) {
  const copyAttribute = locale === "zh-Hans" ? "data-copy-zh" : "data-copy-en";
  root.querySelectorAll("[data-copy-en][data-copy-zh]").forEach((node) => {
    node.textContent = node.getAttribute(copyAttribute) || "";
  });

  root.querySelectorAll("[data-locale]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  });

  root.querySelectorAll("[data-hostspend-link]").forEach((link) => {
    link.href = `/hostspend/?lang=${encodeURIComponent(locale)}`;
  });

  if (root.dataset.updateDocumentLocale !== "true") return;
  document.documentElement.lang = locale;
  document.title = locale === "zh-Hans" ? root.dataset.titleZh : root.dataset.titleEn;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = locale === "zh-Hans"
      ? root.dataset.descriptionZh
      : root.dataset.descriptionEn;
  }
}

export function initHostSpendLocalization(root = document) {
  root.querySelectorAll("[data-hostspend-localized]").forEach((localizedRoot) => {
    let locale = resolveHostSpendLocale(window.location.search, navigator.language || "");
    applyLocale(localizedRoot, locale);

    localizedRoot.querySelectorAll("[data-locale]").forEach((button) => {
      button.addEventListener("click", () => {
        locale = button.dataset.locale;
        const url = new URL(window.location.href);
        url.searchParams.set("lang", locale);
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        applyLocale(localizedRoot, locale);
      });
    });
  });
}

if (typeof document !== "undefined") {
  initHostSpendLocalization(document);
}
