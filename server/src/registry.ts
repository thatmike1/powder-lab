import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './codes.ts'
import {
  type ClientMessage,
  EMPTY_ROOM_GRACE_MS,
  errorTo,
  type Outbound,
  type PeerId,
} from './protocol.ts'
import { Room } from './room.ts'

/**
 * the set of live rooms plus the peer -> room mapping. like `Room` this is pure:
 * it takes a wall clock and returns messages to deliver, so the whole relay is
 * testable without a socket.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>()
  private readonly peerRooms = new Map<PeerId, string>()

  constructor(private readonly rng: () => number = Math.random) {}

  get roomCount(): number {
    return this.rooms.size
  }

  room(code: string): Room | undefined {
    return this.rooms.get(code)
  }

  roomOf(peerId: PeerId): Room | undefined {
    const code = this.peerRooms.get(peerId)
    return code === undefined ? undefined : this.rooms.get(code)
  }

  /** create a room with a fresh unused code and a fresh random seed */
  createRoom(now: number): Room {
    let code = generateRoomCode(this.rng)
    while (this.rooms.has(code)) code = generateRoomCode(this.rng)
    const seed = Math.floor(this.rng() * 0x1_0000_0000) >>> 0 || 1
    const room = new Room(code, seed, now)
    this.rooms.set(code, room)
    return room
  }

  /**
   * put a peer into a room. an empty or absent code creates a room; a known code
   * joins it; an unknown code is an error rather than a silent create.
   */
  join(peerId: PeerId, requested: string | undefined, name: string, now: number): Outbound[] {
    if (this.peerRooms.has(peerId)) return [errorTo(peerId, 'already in a room', now)]
    let room: Room
    if (requested === undefined || requested.trim() === '') {
      room = this.createRoom(now)
    } else {
      const code = normalizeRoomCode(requested)
      if (!isValidRoomCode(code)) return [errorTo(peerId, 'malformed room code', now)]
      const existing = this.rooms.get(code)
      if (existing === undefined) return [errorTo(peerId, `no such room: ${code}`, now)]
      if (existing.isFull()) return [errorTo(peerId, 'room is full', now)]
      room = existing
    }
    this.peerRooms.set(peerId, room.code)
    return room.join(peerId, name, now)
  }

  /** drop a peer from whatever room it is in; safe to call for unknown peers */
  leave(peerId: PeerId, now: number): Outbound[] {
    const room = this.roomOf(peerId)
    this.peerRooms.delete(peerId)
    return room === undefined ? [] : room.leave(peerId, now)
  }

  /** route one parsed client message to its room */
  handle(peerId: PeerId, msg: ClientMessage, now: number): Outbound[] {
    if (msg.type === 'join') return this.join(peerId, msg.room, sanitizeName(msg.name), now)
    const room = this.roomOf(peerId)
    if (room === undefined) return [errorTo(peerId, 'join a room first', now)]
    switch (msg.type) {
      case 'input':
        return room.input(peerId, msg.event, now)
      case 'cursor':
        return room.cursor(peerId, msg.x, msg.y, now)
      case 'checksum':
        return room.checksum(peerId, msg.tick, msg.hash, now)
      case 'state':
        return room.state(peerId, msg.state, now)
    }
  }

  /** periodic upkeep across every room, and disposal of rooms empty past the grace period */
  maintain(now: number): Outbound[] {
    const out: Outbound[] = []
    for (const [code, room] of this.rooms) {
      if (room.size === 0) {
        if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_GRACE_MS) {
          this.rooms.delete(code)
        }
        continue
      }
      out.push(...room.maintain(now))
    }
    return out
  }
}

/** clamp a display name to something safe to echo back to other peers */
export function sanitizeName(name: string | undefined): string {
  const trimmed = (name ?? '').replace(/\p{C}/gu, '').trim()
  return trimmed.length === 0 ? 'anon' : trimmed.slice(0, 24)
}
