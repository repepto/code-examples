import type {IDevLogger} from '../../dev-kit';
import {diContainer, InjectionTokens} from '../../di-container';

export abstract class QueuedBehaviour {
    public stoppedCallback?: () => void;
    protected queueStoppedCallback?: (args?: unknown[]) => void;
    public stopsParentOnCompletion: boolean = false;
    /** Overrides sequential order for top-level behaviours; ignored for children. */
    public nextBehaviour: QueuedBehaviour | null = null;
    protected readonly children: QueuedBehaviour[] = [];

    private running: boolean = false;
    private stopping: boolean = false;
    private runVersion: number = 0;

    public get isRunning(): boolean {
        return this.running;
    }

    public start(): void {
        if (this.running || this.stopping) {
            return;
        }

        const logger: IDevLogger = diContainer.resolve(InjectionTokens.IDevLogger);
        logger.log('fsm', 'ENTERED BEHAVIOUR:', this.constructor.name);

        this.running = true;
        const version = ++this.runVersion;
        this.onStart();

        for (const child of [...this.children]) {
            if (!this.isCurrentRun(version)) {
                return;
            }

            child.start();

            if (this.isCurrentRun(version) && !child.isRunning && child.stopsParentOnCompletion) {
                this.stop();
                return;
            }
        }
    }

    public stop = (): void => {
        if (!this.running || this.stopping) {
            return;
        }

        this.running = false;
        this.stopping = true;
        this.runVersion++;

        const errors: unknown[] = [];
        try {
            this.onStop();
        } catch (error) {
            errors.push(error);
        }

        for (const child of [...this.children]) {
            try {
                child.stop();
            } catch (error) {
                errors.push(error);
            }
        }
        this.stopping = false;

        try {
            const logger: IDevLogger = diContainer.resolve(InjectionTokens.IDevLogger);
            logger.log('fsm', 'EXITED BEHAVIOUR:', this.constructor.name);
        } catch (error) {
            errors.push(error);
        }
        try {
            this.stoppedCallback?.();
        } catch (error) {
            errors.push(error);
        }

        // Finish cleanup before returning the original failure to the caller.
        if (errors.length > 0) {
            throw errors[0];
        }
    };

    /** Notifies every child when its owning queue ends, including unstarted children. */
    public notifyQueueStopped(): void {
        const errors: unknown[] = [];
        try {
            this.queueStoppedCallback?.();
        } catch (error) {
            errors.push(error);
        }

        for (const child of [...this.children]) {
            try {
                child.notifyQueueStopped();
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw errors[0];
        }
    }

    public update(): void {
        if (!this.running) {
            return;
        }

        const version = this.runVersion;
        this.onUpdate();

        for (const child of [...this.children]) {
            if (!this.isCurrentRun(version)) {
                return;
            }

            child.update();

            if (this.isCurrentRun(version) && !child.isRunning && child.stopsParentOnCompletion) {
                this.stop();
                return;
            }
        }
    }

    public addChild(child: QueuedBehaviour): this {
        this.children.push(child);
        return this;
    }

    private isCurrentRun(version: number): boolean {
        return this.running && this.runVersion === version;
    }

    protected abstract onStart(): void;

    protected onStop(): void {}

    protected onUpdate(): void {}
}
