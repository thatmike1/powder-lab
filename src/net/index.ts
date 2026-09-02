// client netcode for deterministic-lockstep multiplayer. the UI only ever needs
// `useNet` and the `NetApi` shape; the rest is exported for tests and for the
// simulation loop in useSimulation.
export { TickClock } from './clock'
export {
  CHECKSUM_INTERVAL_TICKS,
  INPUT_DELAY,
  INPUT_LOG_TICKS,
  type InputEvent,
  type PaintEvent,
  type PeerId,
  type PeerInfo,
  parseInputEvent,
  parseServerMessage,
  type StampedInput,
  TICK_MS,
} from './protocol'
export { InputScheduler } from './scheduler'
export {
  type ConnectionStatus,
  NetSession,
  type NetSessionOptions,
  type PeerCursor,
  type SessionHooks,
  type SimLike,
} from './session'
export {
  base64ToBytes,
  bytesToBase64,
  decodeStateEnvelope,
  encodeStateEnvelope,
} from './state-envelope'
export { FLUSH_MS, StrokeBatcher } from './stroke-batcher'
export { type Connect, connectWebSocket, defaultRelayUrl, type Transport } from './transport'
export { type NetApi, useNet } from './useNet'
