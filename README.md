# TypeScript design examples

A selection of TypeScript excerpts for reviewing code structure, interfaces and lifecycle handling. These files are intended for reading; they do not constitute a standalone application.

## Suggested reading order

1. `signals/Signal.ts` — typed synchronous subscriptions and one-shot listeners.
2. `clock/FrameClock.ts` — coordinating independent reasons to pause a shared clock.
3. `behaviour-queue/` and `workflow/` — composable behaviours, sequential execution and guarded state transitions.
4. `value-objects/` and `wallet/` — decimal amounts, currency checks, formatting and balance/bet state.
5. `localization/` — translation selection, fallback and interpolation.

## Example: a game round

The workflow code supports game sequences that reuse behaviours and choose their next state from the current result. A behaviour owns its subscriptions and cleanup; a queue runs behaviours in order; a workflow chooses the next state after that queue finishes.

This example assumes the host has registered its logger and Pixi application in the dependency injection container. Game callbacks set `hasWin` and invoke the corresponding signals; transitions are processed by the application ticker.

```ts
import {Signal} from './signals';
import {QueuedBehaviour} from './behaviour-queue';
import {WorkflowController, WorkflowState} from './workflow';

class AwaitSignal extends QueuedBehaviour {
    constructor(private readonly signal: Signal<() => void>) {
        super();
    }

    protected onStart(): void {
        this.signal.once(this.stop);
    }

    protected onStop(): void {
        this.signal.remove(this.stop);
    }
}

const spinRequested = new Signal<() => void>();
const reelsStopped = new Signal<() => void>();
const presentationFinished = new Signal<() => void>();
let hasWin = false;

const idle = new WorkflowState([new AwaitSignal(spinRequested)], 'idle');
const spinning = new WorkflowState([new AwaitSignal(reelsStopped)], 'spinning');
const presenting = new WorkflowState([new AwaitSignal(presentationFinished)], 'presenting');

const workflow = new WorkflowController('round')
    .setEntryState(idle)
    .addRoute(idle, spinning)
    .addRoute(spinning, presenting, 0, () => hasWin)
    .addRoute(spinning, idle)
    .addRoute(presenting, idle);

workflow.start();
```

The guarded route handles a winning result; the fallback returns directly to idle. A state can contain several behaviours to sequence multiple steps. Nested behaviours and changes to the queue support more involved scenarios without requiring a new state for every step.

## Behavioural contracts

- A signal invokes subscriptions synchronously. One-shot registrations are removed before their callbacks run. A one-shot callback can register another one-shot callback without the current dispatch clearing that new registration.
- A queue owns the lifecycle of its current behaviour. Replacing a behaviour redirects incoming jumps to its replacement; removing one resets those jumps to sequential execution. Cleanup attempts every child and propagates the first error afterwards. Nested behaviours can finish their parent; explicit jumps apply to the top-level queue.
- Currency amounts use `big.js` for arithmetic. Addition, subtraction and comparison reject mismatched currencies. Formatting is implemented by a separate formatter; convenience methods remain on the amount type.
- Automatic cryptocurrency detection requires a successfully loaded currency catalog. Await `WalletModel.initialize()` or `initializeCurrencyCatalog()` before creating amounts; initialization failures reject and can be retried. An explicit `isCrypto` constructor argument bypasses automatic detection.
- A wallet keeps one currency configuration for its lifetime. Repeating the same settings is allowed; changing them requires a new wallet. Compact amounts use the selected locale's digits and decimal separator with the suffixes `K`, `M` and `B`.
- Translation `format()` escapes placeholder values for markup consumers; `formatText()` produces plain text. `updateElementText()` uses the latter. Translation markup itself must come from trusted assets.
- A frame clock is application-scoped. The host supplies events for visibility and other pause causes through `subscribe()`.

## Integration boundaries

External libraries used by the excerpts are `big.js`, `pixi.js`, `gsap` and `tsyringe`. Project-specific dependency injection tokens, logger, event/asset services, DTOs and clock utilities are intentionally omitted. Their imports mark integration boundaries. Local imports refer to the files in this collection.
