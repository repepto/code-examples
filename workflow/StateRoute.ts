import type {WorkflowState} from './WorkflowState';

/** A route evaluated after the current state finishes; an absent guard is the fallback. */
export class StateRoute {
    constructor(
        public readonly destination: WorkflowState,
        public readonly guard?: () => boolean,
    ) {}
}
