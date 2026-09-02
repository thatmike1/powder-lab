/**
 * who owns the `Simulation` object, and when the host may replace it.
 *
 * outside a room the host builds its own simulation freely. inside one the
 * simulation is the ROOM's: it was built on the server's seed and has been
 * stepped in lockstep with every peer, so replacing it with a fresh instance
 * would silently desync this client from a room it is still connected to.
 */

/**
 * whether the host's mount effect may build a fresh simulation.
 *
 * false means "keep the one you have": the effect re-ran (a dependency changed,
 * or React remounted it) while a room is live, and the live simulation must
 * survive that.
 *
 * @param connected whether a room is currently joined
 * @param existing the simulation the host already holds, if any
 */
export function shouldBuildSim(connected: boolean, existing: object | null): boolean {
  return !connected || existing === null
}
