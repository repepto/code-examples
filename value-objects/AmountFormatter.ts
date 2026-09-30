import Big from 'big.js';
import {diContainer, ManagersInjectionTokens} from '../../di-container';
import type {TranslationCatalog} from '../localization';
import type {CurrencyAmount} from './CurrencyAmount';

const microUnitScale = new Big(1_000_000);
const thousand = new Big(1_000);
const million = new Big(1_000_000);
const billion = new Big(1_000_000_000);

export class AmountFormatter {
    public constructor(private readonly getLocale: () => string) {}

    public format(amount: CurrencyAmount, withCurrencySign: boolean = true): string {
        const value = this.getDisplayValue(amount);
        const decimals = amount.isCrypto ? 2 : amount.currencyDecimals;
        const formatted = amount.short
            ? this.formatCompact(amount)
            : this.formatDecimal(value.toFixed(decimals));
        const suffix = withCurrencySign && amount.currency ? ` ${this.getDisplayCurrency(amount)}` : '';
        return formatted + suffix;
    }

    public formatExact(amount: CurrencyAmount): string {
        return `${this.formatDecimal(this.getDisplayValue(amount).toFixed())} ${this.getDisplayCurrency(amount)}`;
    }

    public formatCompact(amount: CurrencyAmount): string {
        const value = this.getDisplayValue(amount);
        const magnitude = value.abs();

        if (magnitude.lt(thousand)) {
            return this.formatDecimal(
                value.toFixed(amount.isCrypto ? 2 : amount.currencyDecimals, Big.roundDown),
                false,
            );
        }

        let divisor: Big;
        let suffix: string;
        let decimals: number;

        if (magnitude.gte(billion)) {
            divisor = billion;
            suffix = 'B';
            decimals = magnitude.lt('10000000000') ? 2 : 1;
        } else if (magnitude.gte(million)) {
            divisor = million;
            suffix = 'M';
            decimals = magnitude.lt('10000000') ? 2 : 1;
        } else {
            divisor = thousand;
            suffix = 'K';
            decimals = magnitude.lt('10000') ? 3 : magnitude.lt('100000') ? 2 : 1;
        }

        const scaled = value.div(divisor).toFixed(decimals, Big.roundDown);
        return this.formatDecimal(this.trimTrailingZeros(scaled), false) + suffix;
    }

    private formatDecimal(decimal: string, useGrouping: boolean = true): string {
        const [integer, fraction = ''] = decimal.split('.');
        const locale = this.getLocale();
        const formatter = new Intl.NumberFormat(locale, {
            useGrouping,
            minimumFractionDigits: fraction.length ? 1 : 0,
            maximumFractionDigits: fraction.length ? 1 : 0,
        });
        const digitFormatter = new Intl.NumberFormat(locale, {useGrouping: false});
        const digits = Array.from({length: 10}, (_, digit) => digitFormatter.format(digit));
        const localizedFraction = fraction.replace(/\d/g, digit => digits[Number(digit)]);
        // BigInt retains all integer digits; -0 preserves the sign of negative fractions.
        const integralValue = integer === '-0' ? -0 : BigInt(integer);

        return formatter
            .formatToParts(integralValue)
            .map(part => (part.type === 'fraction' ? localizedFraction : part.value))
            .join('');
    }

    private getDisplayValue(amount: CurrencyAmount): Big {
        const value = amount.getValue();
        return amount.isCrypto ? value.mul(microUnitScale) : value;
    }

    private getDisplayCurrency(amount: CurrencyAmount): string {
        return amount.isCrypto ? `µ${amount.currency}` : amount.currency;
    }

    private trimTrailingZeros(value: string): string {
        return value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    }
}

export const defaultAmountFormatter = new AmountFormatter(() => {
    const translations = diContainer.resolve<TranslationCatalog>(ManagersInjectionTokens.LocalizationManager);
    return translations.language;
});
