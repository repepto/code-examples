import Big from 'big.js';
import {isDigitalCurrency} from '../wallet/CurrencyCatalog';
import {defaultAmountFormatter} from './AmountFormatter';

type AmountOperand = string | number | Big | CurrencyAmount;

export class CurrencyAmount {
    private readonly decimalValue: Big;
    public readonly currency: string;
    public readonly currencyDecimals: number;
    public readonly short: boolean;
    public readonly isCrypto: boolean;

    public constructor(
        amount: string | number | Big,
        currency: string,
        currencyDecimals: number,
        short: boolean = false,
        isCrypto: boolean = isDigitalCurrency(currency),
    ) {
        this.decimalValue = new Big(amount);
        this.currency = currency;
        this.currencyDecimals = currencyDecimals;
        this.short = short;
        this.isCrypto = isCrypto;
    }

    public getValueAsString(): string {
        return this.decimalValue.toFixed(this.currencyDecimals);
    }

    public getValueAsCompactString(): string {
        return defaultAmountFormatter.formatCompact(this);
    }

    public getValue(): Big {
        return new Big(this.decimalValue);
    }

    public getFormatted(withCurrencySign: boolean = true): string {
        return defaultAmountFormatter.format(this, withCurrencySign);
    }

    public getExactFormatted(): string {
        return defaultAmountFormatter.formatExact(this);
    }

    public add(delta: AmountOperand): CurrencyAmount {
        return this.withValue(this.decimalValue.plus(this.getCompatibleValue(delta)));
    }

    public sub(delta: AmountOperand): CurrencyAmount {
        return this.withValue(this.decimalValue.minus(this.getCompatibleValue(delta)));
    }

    public multiply(multiplier: AmountOperand): CurrencyAmount {
        return this.withValue(this.decimalValue.mul(this.getScalarValue(multiplier)));
    }

    public divide(divisor: AmountOperand): CurrencyAmount {
        return this.withValue(this.decimalValue.div(this.getScalarValue(divisor)));
    }

    public eq(other: AmountOperand | undefined): boolean {
        return other !== undefined && this.decimalValue.eq(this.getCompatibleValue(other));
    }

    public gt(other: AmountOperand): boolean {
        return this.decimalValue.gt(this.getCompatibleValue(other));
    }

    public lt(other: AmountOperand): boolean {
        return this.decimalValue.lt(this.getCompatibleValue(other));
    }

    public clone(): CurrencyAmount {
        return this.withValue(this.decimalValue);
    }

    private withValue(value: Big): CurrencyAmount {
        return new CurrencyAmount(value, this.currency, this.currencyDecimals, this.short, this.isCrypto);
    }

    private getCompatibleValue(operand: AmountOperand): string | number | Big {
        if (operand instanceof CurrencyAmount && operand.currency !== this.currency) {
            throw new Error(`Currency mismatch: ${this.currency} vs ${operand.currency}`);
        }
        return this.getScalarValue(operand);
    }

    private getScalarValue(operand: AmountOperand): string | number | Big {
        return operand instanceof CurrencyAmount ? operand.decimalValue : operand;
    }
}
