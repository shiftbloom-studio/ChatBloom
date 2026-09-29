export interface Debounced<Args extends unknown[]> {
    /** Schedules the call and drops the one that was still waiting. */
    (...args: Args): void;
    /** Drops the call that is waiting, if any. */
    cancel(): void;
}

/** Runs `fn` with the latest arguments once calls have stopped for `wait` milliseconds. */
export function debounce<Args extends unknown[]>(
    fn: (...args: Args) => void,
    wait: number,
): Debounced<Args> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => clearTimeout(timer);
    return Object.assign(
        (...args: Args) => {
            cancel();
            timer = setTimeout(fn, wait, ...args);
        },
        { cancel },
    );
}
