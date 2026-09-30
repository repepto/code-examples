import Big from 'big.js';
import {injectable} from 'tsyringe';
import {diContainer, ManagersInjectionTokens} from '../../../di-container';
import type {CurrencySettingsDTO} from '../../../games/common/dto/game';
import type {BetsDescriptor} from '../../../games/common/dto/game/DTOs';
import type {EventContract} from '../../contracts';
import {CurrencyAmount} from '../value-objects';
import type {IEventManager} from '../events';
import {initializeCurrencyCatalog} from './CurrencyCatalog';

export interface IWalletModel {
    initialize(): Promise<void>;
    setCurrencySettings(settings: CurrencySettingsDTO): void;
    getCurrencySettings(): CurrencySettingsDTO;
    setBalance(amount: string | number | CurrencyAmount, silent?: boolean): void;
    getBalance(): CurrencyAmount;
    setBet(amount: string | number | CurrencyAmount, silent?: boolean): void;
    getBet(): CurrencyAmount;
    setLastFreeBetValue(amount: string | number | CurrencyAmount): void;
    isFreeBetAmount(bet?: CurrencyAmount): boolean;
    setAvailableBets(amounts: (string | number | CurrencyAmount)[] | BetsDescriptor): void;
    getAvailableBets(): CurrencyAmount[];
    getAvailableBetsFormatted(): string[];
    getAvailableBetStrings(): string[];
    getAvailableBetCompactStrings(): string[];
    getAvailableBetNumbers(): number[];
    canAfford(amount: CurrencyAmount): boolean;
    addToBalance(amount: string | number | CurrencyAmount): void;
    subFromBalance(amount: string | number | CurrencyAmount): void;
    createAmount(amount: string | number): CurrencyAmount;
    getPreviousBet(): CurrencyAmount | undefined;
}

@injectable()
export class WalletModel implements IWalletModel {
    private currentBalance!: CurrencyAmount;
    private selectedBet!: CurrencyAmount;
    private priorBet: CurrencyAmount | undefined;
    private freeBetAmount: CurrencyAmount | undefined;
    private betOptions: CurrencyAmount[] = [];
    private settings!: CurrencySettingsDTO;
    private balanceListenerRegistered = false;
    private readonly events: IEventManager<EventContract> = diContainer.resolve(
        ManagersInjectionTokens.IEventManager,
    );

    public async initialize(): Promise<void> {
        await initializeCurrencyCatalog();
    }

    public setCurrencySettings(settings: CurrencySettingsDTO): void {
        const nextSettings = {...settings, short: settings.short ?? false};
        if (
            this.settings &&
            (this.settings.currency !== nextSettings.currency ||
                this.settings.currencyDecimals !== nextSettings.currencyDecimals ||
                this.settings.short !== nextSettings.short)
        ) {
            throw new Error('Currency settings are fixed for the lifetime of a wallet.');
        }

        this.settings = nextSettings;
        if (!this.balanceListenerRegistered) {
            this.events.addListener('ui:balance:request', () => this.publishBalance());
            this.balanceListenerRegistered = true;
        }
    }

    public getCurrencySettings(): CurrencySettingsDTO {
        return {...this.settings};
    }

    public setBalance(amount: string | number | CurrencyAmount, silent: boolean = false): void {
        this.currentBalance = this.toAmount(amount);
        if (!silent) {
            this.publishBalance();
        }
    }

    public getBalance(): CurrencyAmount {
        return this.currentBalance.clone();
    }

    public setBet(amount: string | number | CurrencyAmount, silent: boolean = false): void {
        let nextBet = this.toAmount(amount);
        if (!this.betOptions.some(option => option.eq(nextBet))) {
            if (!this.betOptions.length) {
                throw new Error('Bets array is empty.');
            }
            console.warn(`Bet ${nextBet.getValueAsCompactString()} does not exist. Set to first available.`);
            nextBet = this.betOptions[0].clone();
        }

        this.priorBet = this.selectedBet?.clone();
        this.selectedBet = nextBet;
        if (!silent) {
            this.events.dispatch('money:bet:changed', {bet: this.selectedBet.clone()});
        }
    }

    public getBet(): CurrencyAmount {
        return this.selectedBet.clone();
    }

    public setLastFreeBetValue(amount: string | number | CurrencyAmount): void {
        this.freeBetAmount = this.toAmount(amount);
    }

    public isFreeBetAmount(bet?: CurrencyAmount): boolean {
        return this.freeBetAmount?.eq(bet ?? this.selectedBet) ?? false;
    }

    public getPreviousBet(): CurrencyAmount | undefined {
        return this.priorBet?.clone();
    }

    public getAvailableBets(): CurrencyAmount[] {
        return this.betOptions.map(option => option.clone());
    }

    public getAvailableBetNumbers(): number[] {
        return this.betOptions.map(option => option.getValue().toNumber());
    }

    public getAvailableBetsFormatted(): string[] {
        return this.betOptions.map(option => option.getFormatted());
    }

    public getAvailableBetStrings(): string[] {
        return this.betOptions.map(option => option.getValueAsString());
    }

    public getAvailableBetCompactStrings(): string[] {
        return this.betOptions.map(option => option.getValueAsCompactString());
    }

    public setAvailableBets(amounts: (string | number | CurrencyAmount)[] | BetsDescriptor): void {
        if (Array.isArray(amounts)) {
            this.betOptions = amounts.map(amount => this.toAmount(amount));
            return;
        }

        const minimum = new Big(amounts.min);
        const maximum = new Big(amounts.max);
        const increment = new Big(amounts.step);
        if (increment.lte(0) || minimum.gt(maximum)) {
            throw new RangeError('Bet range requires a positive step and min <= max.');
        }

        const options: CurrencyAmount[] = [];
        for (let value = minimum; value.lte(maximum); value = value.plus(increment)) {
            options.push(this.createAmount(value.toString()));
        }
        this.betOptions = options;
    }

    public canAfford(amount: CurrencyAmount): boolean {
        return !this.currentBalance.lt(amount);
    }

    public addToBalance(amount: string | number | CurrencyAmount): void {
        this.currentBalance = this.currentBalance.add(this.toAmount(amount));
        this.publishBalance();
    }

    public subFromBalance(amount: string | number | CurrencyAmount): void {
        this.currentBalance = this.currentBalance.sub(this.toAmount(amount));
        this.publishBalance();
    }

    public createAmount(amount: string | number): CurrencyAmount {
        return new CurrencyAmount(
            amount,
            this.settings.currency,
            this.settings.currencyDecimals,
            this.settings.short ?? false,
        );
    }

    private toAmount(amount: string | number | CurrencyAmount): CurrencyAmount {
        if (!(amount instanceof CurrencyAmount)) {
            return this.createAmount(amount);
        }
        if (amount.currency !== this.settings.currency) {
            throw new Error(`Currency mismatch: expected ${this.settings.currency}, got ${amount.currency}`);
        }
        return amount.clone();
    }

    private publishBalance(): void {
        if (this.currentBalance) {
            this.events.dispatch('ui:balance:update', {balance: this.currentBalance.clone()});
        }
    }
}
