/** Synchronous snapshot iteration with reentrant-safe one-shot subscriptions. */
export class Signal<TListener extends (...args: any[]) => void> {
    private readonly persistentHandlers = new Set<TListener>();
    private readonly pendingHandlers = new Map<TListener, object>();

    public add(handler: TListener): void {
        this.persistentHandlers.add(handler);
    }

    public once(handler: TListener): void {
        if (!this.pendingHandlers.has(handler)) {
            this.pendingHandlers.set(handler, {});
        }
    }

    public remove(handler: TListener): void {
        this.persistentHandlers.delete(handler);
        this.pendingHandlers.delete(handler);
    }

    public has(handler: TListener): boolean {
        return this.persistentHandlers.has(handler) || this.pendingHandlers.has(handler);
    }

    public clear(): void {
        this.persistentHandlers.clear();
        this.pendingHandlers.clear();
    }

    public invoke(...args: Parameters<TListener>): void {
        const persistentSnapshot = [...this.persistentHandlers];
        const pendingSnapshot = [...this.pendingHandlers];

        for (const handler of persistentSnapshot) {
            if (this.persistentHandlers.has(handler)) {
                handler(...args);
            }
        }

        for (const [handler, registration] of pendingSnapshot) {
            if (this.pendingHandlers.get(handler) !== registration) continue;

            // Claim this registration before invoking user code, including nested dispatches.
            this.pendingHandlers.delete(handler);
            handler(...args);
        }
    }

    public get count(): number {
        return this.persistentHandlers.size + this.pendingHandlers.size;
    }

    public onceAsync(): Promise<Parameters<TListener>> {
        return new Promise(resolve => {
            this.once(((...args: Parameters<TListener>) => resolve(args)) as TListener);
        });
    }
}
