/**
 * The compile-time exhaustiveness check, in one place.
 *
 * A `switch` whose `default` calls this only type-checks while every member of the
 * discriminated union has its own `case`: the narrowed value reaching `default` is `never`,
 * and `never` is the only type assignable to the parameter. Add a fifth member to a union and
 * every switch over it that forgot a branch fails to compile — which is the whole point, and
 * the reason the readout's four states are a union rather than four string literals.
 *
 * It throws as well as failing to compile, because a value arriving from outside the type
 * system (a decoded message, a hand-written test double) can still be a shape the compiler was
 * promised did not exist. Silently painting nothing would be the worse failure on a wall panel.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new TypeError(`unhandled ${what}: ${JSON.stringify(value)}`);
}
