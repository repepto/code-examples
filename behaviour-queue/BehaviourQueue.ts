import {Signal} from '../signals';
import type {QueuedBehaviour} from './QueuedBehaviour';

type BehaviourType = {readonly prototype: QueuedBehaviour};

export class BehaviourQueue {
    public readonly stopped: Signal<() => void> = new Signal();

    private readonly behaviourList: QueuedBehaviour[];
    private currentBehaviour: QueuedBehaviour | null = null;
    private running: boolean = false;
    private stopping: boolean = false;
    private runVersion: number = 0;

    constructor(behaviours: readonly QueuedBehaviour[]) {
        this.behaviourList = [...behaviours];
    }

    public get isRunning(): boolean {
        return this.running;
    }

    public get behaviours(): readonly QueuedBehaviour[] {
        return this.behaviourList;
    }

    public get activeBehaviour(): QueuedBehaviour | null {
        return this.currentBehaviour;
    }

    /** Redirects incoming jumps; the replacement keeps its own nextBehaviour. */
    public replaceBehaviour(
        behaviourType: BehaviourType,
        replacement: QueuedBehaviour,
        occurrence: number = 1,
    ): boolean {
        const index = this.findBehaviourIndex(behaviourType, occurrence);
        if (index === -1) {
            return false;
        }

        const previous = this.behaviourList[index];
        if (previous === replacement) {
            return true;
        }

        const queueWasRunning = this.running;
        const replacingCurrent = this.currentBehaviour === previous;
        this.behaviourList[index] = replacement;
        this.redirectIncomingTransitions(previous, replacement);

        if (replacingCurrent) {
            this.currentBehaviour = replacement;
            this.runVersion++;
        }

        const errors: unknown[] = [];
        try {
            previous.stop();
        } catch (error) {
            errors.push(error);
        }
        if (queueWasRunning) {
            try {
                previous.notifyQueueStopped();
            } catch (error) {
                errors.push(error);
            }
        }

        if (replacingCurrent && this.running && this.currentBehaviour === replacement) {
            try {
                replacement.start();
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw errors[0];
        }
        return true;
    }

    public insertAfterBehaviour(
        behaviourType: BehaviourType,
        behaviour: QueuedBehaviour,
        occurrence: number = 1,
    ): boolean {
        const index = this.findBehaviourIndex(behaviourType, occurrence);
        if (index === -1) {
            return false;
        }

        this.behaviourList.splice(index + 1, 0, behaviour);
        return true;
    }

    public swapByIndices(firstIndex: number, secondIndex: number): boolean {
        if (!this.isValidIndex(firstIndex) || !this.isValidIndex(secondIndex)) {
            console.warn('Invalid behaviour index.');
            return false;
        }

        [this.behaviourList[firstIndex], this.behaviourList[secondIndex]] = [
            this.behaviourList[secondIndex],
            this.behaviourList[firstIndex],
        ];
        return true;
    }

    public moveBehaviour(sourceIndex: number, destinationIndex: number): boolean {
        if (!this.isValidIndex(sourceIndex) || !this.isValidIndex(destinationIndex)) {
            console.warn('Invalid behaviour index.');
            return false;
        }

        const [behaviour] = this.behaviourList.splice(sourceIndex, 1);
        this.behaviourList.splice(destinationIndex, 0, behaviour);
        return true;
    }

    public prependBehaviour(behaviour: QueuedBehaviour): void {
        this.behaviourList.unshift(behaviour);
    }

    public appendBehaviour(behaviour: QueuedBehaviour): void {
        this.behaviourList.push(behaviour);
    }

    /** Removing a jump target restores sequential order for its predecessors. */
    public removeBehaviour(behaviourType: BehaviourType, occurrence: number = 1): boolean {
        const index = this.findBehaviourIndex(behaviourType, occurrence);
        if (index === -1) {
            return false;
        }

        const queueWasRunning = this.running;
        const [removed] = this.behaviourList.splice(index, 1);
        this.redirectIncomingTransitions(removed, null);

        if (removed === this.currentBehaviour) {
            // stop() retains the current object even after it leaves the array.
            this.stop();
        } else {
            const errors: unknown[] = [];
            try {
                removed.stop();
            } catch (error) {
                errors.push(error);
            }
            if (queueWasRunning) {
                try {
                    removed.notifyQueueStopped();
                } catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length > 0) {
                throw errors[0];
            }
        }

        return true;
    }

    public start(index: number = 0): void {
        if (this.running || this.stopping) {
            return;
        }

        if (!this.isValidIndex(index)) {
            throw new Error('Invalid behaviour index.');
        }

        this.currentBehaviour = this.behaviourList[index];
        this.running = true;
        this.runVersion++;
        this.currentBehaviour.start();
    }

    public update = (): void => {
        const behaviour = this.currentBehaviour;
        if (!this.running || !behaviour) {
            return;
        }

        const version = this.runVersion;
        behaviour.update();
        if (!this.isCurrentRun(version, behaviour)) {
            return;
        }

        this.onUpdate();
        if (!this.isCurrentRun(version, behaviour) || behaviour.isRunning) {
            return;
        }

        const nextIndex = behaviour.nextBehaviour
            ? this.behaviourList.indexOf(behaviour.nextBehaviour)
            : this.behaviourList.indexOf(behaviour) + 1;

        if (nextIndex < 0) {
            this.stop();
            throw new Error('The next behaviour must belong to this queue.');
        }

        if (nextIndex >= this.behaviourList.length) {
            this.stop();
            return;
        }

        this.currentBehaviour = this.behaviourList[nextIndex];
        this.runVersion++;
        this.currentBehaviour.start();
    };

    public onUpdate(): void {}

    public stop(): void {
        if (!this.running || this.stopping) {
            return;
        }

        const behaviour = this.currentBehaviour;
        const ownedBehaviours = new Set(this.behaviourList);
        if (behaviour) {
            ownedBehaviours.add(behaviour);
        }

        this.running = false;
        this.stopping = true;
        this.currentBehaviour = null;
        this.runVersion++;

        const errors: unknown[] = [];
        try {
            behaviour?.stop();
        } catch (error) {
            errors.push(error);
        }

        for (const ownedBehaviour of ownedBehaviours) {
            try {
                ownedBehaviour.notifyQueueStopped();
            } catch (error) {
                errors.push(error);
            }
        }
        this.stopping = false;

        // Observers may safely stop again or start a new run after cleanup.
        try {
            this.stopped.invoke();
        } catch (error) {
            errors.push(error);
        }

        if (errors.length > 0) {
            throw errors[0];
        }
    }

    private redirectIncomingTransitions(
        previous: QueuedBehaviour,
        replacement: QueuedBehaviour | null,
    ): void {
        for (const behaviour of this.behaviourList) {
            if (behaviour.nextBehaviour === previous) {
                behaviour.nextBehaviour = replacement;
            }
        }
    }

    private findBehaviourIndex(behaviourType: BehaviourType, occurrence: number): number {
        if (!Number.isInteger(occurrence) || occurrence < 1) {
            console.warn('Behaviour occurrence must be a positive integer.');
            return -1;
        }

        let remaining = occurrence;
        const index = this.behaviourList.findIndex(
            behaviour => Object.getPrototypeOf(behaviour) === behaviourType.prototype && --remaining === 0,
        );

        if (index === -1) {
            console.warn(`No matching behaviour: ${behaviourType.prototype.constructor.name}.`);
        }

        return index;
    }

    private isValidIndex(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index < this.behaviourList.length;
    }

    private isCurrentRun(version: number, behaviour: QueuedBehaviour): boolean {
        return this.running && this.runVersion === version && this.currentBehaviour === behaviour;
    }
}
