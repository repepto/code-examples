import type {IDevLogger} from '../../dev-kit';
import {diContainer, InjectionTokens} from '../../di-container';
import {BehaviourQueue} from '../behaviour-queue';
import type {QueuedBehaviour} from '../behaviour-queue';

export class WorkflowState extends BehaviourQueue {
    public readonly name: string;
    private readonly logger: IDevLogger = diContainer.resolve(InjectionTokens.IDevLogger);

    constructor(behaviours: readonly QueuedBehaviour[], name?: string) {
        super(behaviours);
        this.name = name ?? this.constructor.name;
    }

    public override start(index: number = 0): void {
        if (this.isRunning) {
            return;
        }

        this.logger.log('fsm', `ENTERED STATE ${this.name}.`);
        super.start(index);
    }

    public override stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.logger.log('fsm', `EXITED STATE ${this.name}.`);
        super.stop();
    }
}
