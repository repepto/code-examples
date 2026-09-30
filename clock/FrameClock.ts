import {inject, injectable} from 'tsyringe';
import {Ticker} from 'pixi.js';
import {gsap} from 'gsap';
import {ManagersInjectionTokens} from '../../../di-container';
import type {EventContract} from '../../contracts';
import type {IEventManager} from '../events';
import {startGameTicker, stopGameTicker} from '../../../utils/time-utils';

/** Consumers can extend this registry through TypeScript module augmentation. */
export interface PauseCauseRegistry {
    tabHidden: true;
    menuOpen: true;
    betPopupOpen: true;
    buyOverlayOpen: true;
    autoplayOverlayOpen: true;
    turboPopupOpen: true;
    popupLayerOpen: true;
}

export type PauseCause = keyof PauseCauseRegistry;
export type PauseRule = Readonly<{reason: PauseCause; block: boolean}>;
export type PauseBindings<T extends EventContract> = Map<keyof T, PauseRule>;

/** Application-scoped clock: each cause blocks independently of the others. */
@injectable()
export class FrameClock<T extends EventContract = EventContract> {
    private readonly blockers = new Set<PauseCause>();
    private readonly eventRules = new Map<keyof T, PauseRule>();
    private readonly animationRate = gsap.globalTimeline.timeScale();
    private readonly frameRate = Ticker.shared.speed;
    private appliedRunningState: boolean | null = null;

    public constructor(
        @inject(ManagersInjectionTokens.IEventManager)
        private readonly events: IEventManager<T>,
    ) {}

    public subscribe(bindings: PauseBindings<T>): void {
        for (const [event, rule] of bindings) {
            const registered = this.eventRules.has(event);
            this.eventRules.set(event, {...rule});
            if (registered) continue;

            this.events.addListener(event, () => {
                const currentRule = this.eventRules.get(event);
                if (currentRule) this.setBlocked(currentRule.reason, currentRule.block);
            });
        }

        this.setBlocked('tabHidden', document.hidden);
    }

    public setTimescaleMult(multiplier: number): void {
        if (!Number.isFinite(multiplier) || multiplier < 0) {
            throw new RangeError('Time scale must be a finite non-negative number.');
        }
        gsap.globalTimeline.timeScale(this.animationRate * multiplier);
        Ticker.shared.speed = this.frameRate * multiplier;
    }

    public resetTimescaleMult(): void {
        gsap.globalTimeline.timeScale(this.animationRate);
        Ticker.shared.speed = this.frameRate;
    }

    private setBlocked(cause: PauseCause, blocked: boolean): void {
        if (blocked) this.blockers.add(cause);
        else this.blockers.delete(cause);
        this.synchronize();
    }

    private synchronize(): void {
        const shouldRun = this.blockers.size === 0;
        if (shouldRun === this.appliedRunningState) return;

        if (shouldRun) startGameTicker();
        else stopGameTicker();
        this.appliedRunningState = shouldRun;
    }
}
