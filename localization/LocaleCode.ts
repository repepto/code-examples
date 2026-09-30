/** Supported product locales, including the social mode variant. */
export const SupportedLocales = [
    'en',
    'uk',
    'es',
    'es-mx',
    'fr',
    'de',
    'nl',
    'pt',
    'ru',
    'tr',

    'en-sc', // social casino

    'th',
    'zh',
    'zh-hant',
    'id',
    'ms',
    'vi',
    'ja',

    'bn',
    'cs',
    'da',
    'el',
    'et',
    'fi',
    'hu',
    'it',
    'ka',
    'ko',
    'lv',
    'no',
    'pl',
    'pt-br',
    'ro',
    'sk',
    'sv',
    'bg',
    'lt',
    'km',
    'hr',
] as const;

export type LocaleCode = (typeof SupportedLocales)[number];
