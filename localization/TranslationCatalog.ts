import {inject, injectable} from 'tsyringe';
import {DataInjectionTokens, ManagersInjectionTokens} from '../../../di-container';
import type {AssetsManager} from '../assets';
import {type LocaleCode, SupportedLocales} from './LocaleCode';

export type TranslationTable = Record<string, string>;

@injectable()
export class TranslationCatalog {
    private readonly assetPrefix = 'i18n_';
    private readonly socialSuffix = '-sc';
    private readonly defaultLocale: LocaleCode = 'en';
    private readonly defaultScope = 'default';

    private entries: TranslationTable = {};
    private selectedScope = this.defaultScope;
    private selectedLocale: LocaleCode = this.readInitialLocale();
    private loadedLocale: LocaleCode = this.selectedLocale;
    private selectionVersion = 0;

    public constructor(
        @inject(ManagersInjectionTokens.AssetsManager)
        private readonly assets: AssetsManager,
        @inject(DataInjectionTokens.TranslationReplacementConfig, {isOptional: true})
        private readonly namedValues?: Readonly<Record<string, string>>,
    ) {}

    public get language(): LocaleCode {
        return this.selectedLocale;
    }

    public get scope(): string {
        return this.selectedScope;
    }

    /** Language of the loaded text, which can differ from the requested locale on fallback. */
    public get contentLanguage(): LocaleCode {
        return this.loadedLocale;
    }

    public getTranslationBundleName(scope: string | null): string {
        return this.assetPrefix + this.normalizeScope(scope);
    }

    public isSocial(): boolean {
        return this.selectedLocale.endsWith(this.socialSuffix);
    }

    public async use(scope: string | null, language: LocaleCode | null = null): Promise<void> {
        const version = ++this.selectionVersion;
        const requestedLocale = language ? this.normalizeLocale(language) : this.selectedLocale;
        const requestedScope = this.normalizeScope(scope);
        let contentLocale = requestedLocale;
        const alias = this.getAssetAlias(requestedScope, requestedLocale);
        let source = this.assets.getJson<TranslationTable>(alias);

        if (!source) {
            console.warn(`[i18n] Missing: ${alias}. Loading default translations.`);
            await this.assets.loadBundles(this.getTranslationBundleName(this.defaultScope));
            if (version !== this.selectionVersion) return;

            const fallbackAlias = this.getAssetAlias(this.defaultScope, this.defaultLocale);
            source = this.assets.getJson<TranslationTable>(fallbackAlias);
            if (!source) throw new Error(`[i18n] Fallback translations not found: ${fallbackAlias}`);
            contentLocale = this.defaultLocale;
        }

        if (version !== this.selectionVersion) return;
        const entries = this.applyNamedValues(source);
        this.entries = entries;
        this.selectedLocale = requestedLocale;
        this.selectedScope = requestedScope;
        this.loadedLocale = contentLocale;
        document.documentElement.lang = contentLocale.replace(this.socialSuffix, '');
    }

    /** Keeps placeholders escaped for consumers that render translation markup. */
    public format(key: string, ...values: (string | number)[]): string {
        return this.interpolate(key, values, value => this.escapeHTML(value));
    }

    /** Plain text for textContent, canvas labels and other non-HTML consumers. */
    public formatText(key: string, ...values: (string | number)[]): string {
        return this.interpolate(key, values, value => value);
    }

    public escapeHTML(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public updateElementText(
        target: string | HTMLElement,
        key: string,
        ...values: (string | number)[]
    ): void {
        const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
        if (!element) {
            console.warn(`[i18n] Element not found: ${target}`);
            return;
        }
        element.textContent = this.formatText(key, ...values);
    }

    public getTranslations(): TranslationTable {
        return {...this.entries};
    }

    private interpolate(key: string, values: (string | number)[], encode: (value: string) => string): string {
        if (!Object.prototype.hasOwnProperty.call(this.entries, key)) {
            console.error(`[i18n] Translation key "${key}" not found.`);
            return key;
        }
        return this.entries[key].replace(/\{(\d+)}/g, (placeholder, index: string) => {
            const value = values[Number(index)];
            return value === undefined ? placeholder : encode(String(value));
        });
    }

    private applyNamedValues(source: TranslationTable): TranslationTable {
        return Object.fromEntries(
            Object.entries(source).map(([key, template]) => [
                key,
                template.replace(/\{(\w+)}/g, (placeholder, name: string) => {
                    if (!this.namedValues || !Object.prototype.hasOwnProperty.call(this.namedValues, name)) {
                        return placeholder;
                    }
                    return this.namedValues[name];
                }),
            ]),
        );
    }

    private getAssetAlias(scope: string, locale: LocaleCode): string {
        return `${this.getTranslationBundleName(scope)}/${locale}/texts.json`;
    }

    private normalizeScope(scope: string | null | undefined): string {
        return scope || this.defaultScope;
    }

    private normalizeLocale(locale: string | null): LocaleCode {
        const candidate = locale?.trim().toLowerCase() as LocaleCode | undefined;
        return candidate && SupportedLocales.includes(candidate) ? candidate : this.defaultLocale;
    }

    private readInitialLocale(): LocaleCode {
        const query = typeof window === 'undefined' ? '' : window.location.search;
        return this.normalizeLocale(new URLSearchParams(query).get('language'));
    }
}
