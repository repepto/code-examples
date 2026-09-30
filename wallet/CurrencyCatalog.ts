const catalogUrl = './configs/cryptocurrencies.json';

let digitalCurrencyCodes = new Set<string>();
let catalogLoaded = false;
let pendingLoad: Promise<void> | undefined;

export async function initializeCurrencyCatalog(): Promise<void> {
    if (catalogLoaded) {
        return;
    }

    pendingLoad ??= loadCatalog().finally(() => {
        pendingLoad = undefined;
    });
    await pendingLoad;
}

export function isDigitalCurrency(currency: string): boolean {
    if (!catalogLoaded) {
        throw new Error('Initialize the currency catalog before creating currency amounts.');
    }
    return digitalCurrencyCodes.has(normalizeCode(currency));
}

async function loadCatalog(): Promise<void> {
    const response = await fetch(catalogUrl, {cache: 'no-cache'});
    if (!response.ok) {
        throw new Error(`Currency catalog request failed: ${response.status} ${response.statusText}`);
    }

    const payload: unknown = await response.json();
    digitalCurrencyCodes = new Set(parseCurrencyCodes(payload));
    catalogLoaded = true;
}

function parseCurrencyCodes(payload: unknown): string[] {
    if (typeof payload !== 'object' || payload === null || !('cryptoCurrencies' in payload)) {
        throw new Error('Currency catalog must contain a cryptoCurrencies array.');
    }

    const codes = payload.cryptoCurrencies;
    if (!Array.isArray(codes)) {
        throw new Error('Currency catalog must contain a cryptoCurrencies array.');
    }

    return codes
        .filter((code): code is string => typeof code === 'string')
        .map(normalizeCode)
        .filter(Boolean);
}

function normalizeCode(currency: string): string {
    return currency.trim().toUpperCase();
}
