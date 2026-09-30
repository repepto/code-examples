import type {Application} from 'pixi.js';
import type {IDevLogger} from '../../dev-kit';
import {diContainer, InjectionTokens} from '../../di-container';
import type {WorkflowState} from './WorkflowState';
import {StateRoute} from './StateRoute';

/** @deprecated Use numeric priorities instead; lower numbers take precedence. */
export enum RoutePriority {
    Highest = 0,
    Middle200 = 200,
    Middle400 = 400,
    Middle600 = 600,
    Middle800 = 800,
    Fallback = 1000,
}

type PrioritizedRoute = {route: StateRoute; priority: number};

type PendingMutation =
    | {type: 'removeState'; state: WorkflowState}
    | {type: 'removeRoute'; source: WorkflowState; destination: WorkflowState};

export class WorkflowController {
    private static readonly controllers = new Map<string, WorkflowController>();

    private readonly name: string;
    private readonly logger: IDevLogger = diContainer.resolve(InjectionTokens.IDevLogger);
    private readonly application: Application = diContainer.resolve(InjectionTokens.Application);
    private readonly routes = new Map<WorkflowState, PrioritizedRoute[]>();
    private readonly pendingMutations: PendingMutation[] = [];
    private readonly statesToRemove = new Set<WorkflowState>();
    private currentState: WorkflowState | null = null;
    private entryState: WorkflowState | null = null;
    private running: boolean = false;
    private stopping: boolean = false;
    private runVersion: number = 0;

    constructor(name: string = 'Default') {
        this.name = name;
        WorkflowController.controllers.set(name, this);

        if (window.isDev && !window.logFsm) {
            window.logFsm = (requestedName?: string): void => {
                const controllers = requestedName
                    ? [WorkflowController.controllers.get(requestedName)]
                    : Array.from(WorkflowController.controllers.values());

                for (const controller of controllers) {
                    if (!controller) {
                        continue;
                    }

                    controller.logger.log('fsm', `WORKFLOW: ${controller.name}`);
                    controller.logStatus();
                    controller.logRoutes();
                }
            };
        }
    }

    public get isRunning(): boolean {
        return this.running;
    }

    public setEntryState(state: WorkflowState): this {
        this.entryState = state;
        return this;
    }

    public clearEntryState(): this {
        this.entryState = null;
        return this;
    }

    public addRoute(
        source: WorkflowState,
        destination: WorkflowState,
        priority: number = Infinity,
        guard?: () => boolean,
    ): this {
        if (!this.entryState) {
            this.entryState = source;
        }

        const entries = this.routes.get(source) ?? [];

        if (!guard) {
            priority = Infinity;
            const fallbackIndex = entries.findIndex(entry => !entry.route.guard);
            const fallback = {route: new StateRoute(destination), priority};

            if (fallbackIndex !== -1) {
                this.logger.warn(
                    'fsm',
                    `Fallback from "${source.name}" replaced: ` +
                        `"${entries[fallbackIndex].route.destination.name}" -> "${destination.name}".`,
                );
                entries[fallbackIndex] = fallback;
            } else {
                entries.push(fallback);
            }
        } else {
            if (!Number.isFinite(priority)) {
                this.logger.warn('fsm', `Non-finite route priority from "${source.name}"; using 0.`);
                priority = 0;
            }

            entries.push({route: new StateRoute(destination, guard), priority});
        }

        entries.sort((first, second) => first.priority - second.priority);
        this.routes.set(source, entries);
        return this;
    }

    public removeRoute(source: WorkflowState, destination: WorkflowState): this {
        this.pendingMutations.push({type: 'removeRoute', source, destination});
        if (!this.running) {
            this.applyPendingMutations();
        }
        return this;
    }

    public removeState(state: WorkflowState): void {
        this.pendingMutations.push({type: 'removeState', state});
        if (!this.running) {
            this.applyPendingMutations();
        }
    }

    public start(entryState?: WorkflowState): void {
        if (this.running || this.stopping) {
            return;
        }

        this.applyPendingMutations();
        const state = entryState ?? this.entryState;
        if (!state) {
            throw new Error(`Workflow "${this.name}": set an entry state or pass one to start().`);
        }

        this.logger.log('fsm', `Workflow "${this.name}" started with "${state.name}".`);
        this.currentState = state;
        this.running = true;
        this.runVersion++;
        this.application.ticker.add(this.update);

        try {
            state.start();
        } catch (error) {
            this.stop();
            throw error;
        }
    }

    public stop(): void {
        if (this.stopping) {
            return;
        }

        const state = this.currentState;
        this.running = false;
        this.stopping = true;
        this.currentState = null;
        this.runVersion++;
        this.application.ticker.remove(this.update);

        try {
            state?.stop();
        } finally {
            this.applyPendingMutations();
            this.stopping = false;
        }

        this.logger.log('fsm', `Workflow "${this.name}" stopped; final state: ${state?.name ?? 'none'}.`);
    }

    public logRoutes(): void {
        this.logger.log('fsm', 'ROUTES:');

        for (const [source, entries] of this.routes) {
            for (const {route, priority} of entries) {
                const condition = route.guard ? `(guard: ${route.guard.name || 'λ'})` : '(fallback)';
                this.logger.log(
                    'fsm',
                    `  ${source.name} → ${route.destination.name} ${condition} [${priority}]`,
                );
            }
        }
    }

    public logStatus(): void {
        this.logger.log('fsm', `Running: ${this.running}`);
        this.logger.log('fsm', `Current state: ${this.currentState?.name}`);
        this.logger.log('fsm', `Current behaviour: ${this.currentState?.activeBehaviour?.constructor.name}`);
    }

    private update = (): void => {
        const state = this.currentState;
        if (!this.running || !state) {
            this.applyPendingMutations();
            return;
        }

        const version = this.runVersion;
        state.update();
        this.applyPendingMutations();

        if (this.isCurrentRun(version, state) && !state.isRunning) {
            this.advanceFrom(state, version);
            this.applyPendingMutations();
        }
    };

    private advanceFrom(state: WorkflowState, version: number): void {
        const availableRoutes = [...(this.routes.get(state) ?? [])];

        for (const entry of availableRoutes) {
            const allowed = !entry.route.guard || entry.route.guard();
            this.applyPendingMutations();

            if (!this.isCurrentRun(version, state)) {
                return;
            }

            if (!allowed || !this.routes.get(state)?.includes(entry)) {
                continue;
            }

            const destination = entry.route.destination;
            this.logger.log('fsm', `Workflow "${this.name}": "${state.name}" → "${destination.name}".`);
            this.currentState = destination;
            this.runVersion++;
            this.flushStateRemovals();

            try {
                destination.start();
            } catch (error) {
                this.stop();
                throw error;
            }
            return;
        }

        this.logger.log('fsm', `Workflow "${this.name}": no valid routes from "${state.name}".`);
        this.stop();
    }

    private applyPendingMutations(): void {
        const mutations = this.pendingMutations.splice(0);

        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'removeRoute':
                    this.removeRouteNow(mutation.source, mutation.destination);
                    break;
                case 'removeState':
                    if (this.running && this.currentState === mutation.state) {
                        this.statesToRemove.add(mutation.state);
                        this.logger.warn(
                            'fsm',
                            `Removal of current state "${mutation.state.name}" deferred.`,
                        );
                    } else {
                        this.removeStateNow(mutation.state);
                    }
                    break;
            }
        }

        // Flush even with no new commands: stop() may release a previously deferred state.
        this.flushStateRemovals();
    }

    private flushStateRemovals(): void {
        for (const state of this.statesToRemove) {
            if (this.running && this.currentState === state) {
                continue;
            }

            this.statesToRemove.delete(state);
            this.logger.log('fsm', `Removing deferred state "${state.name}".`);
            this.removeStateNow(state);
        }
    }

    private removeRouteNow(source: WorkflowState, destination: WorkflowState): void {
        const entries = this.routes.get(source);
        if (!entries) {
            return;
        }

        const index = entries.findIndex(entry => entry.route.destination === destination);
        if (index !== -1) {
            entries.splice(index, 1);
        }

        if (entries.length === 0) {
            this.routes.delete(source);
        }
    }

    private removeStateNow(state: WorkflowState): void {
        this.routes.delete(state);

        for (const [source, entries] of this.routes) {
            const retained = entries.filter(entry => entry.route.destination !== state);
            if (retained.length === 0) {
                this.routes.delete(source);
            } else {
                this.routes.set(source, retained);
            }
        }

        if (this.entryState === state) {
            this.entryState = null;
        }
        if (this.currentState === state) {
            this.currentState = null;
        }
    }

    private isCurrentRun(version: number, state: WorkflowState): boolean {
        return this.running && this.runVersion === version && this.currentState === state;
    }
}
