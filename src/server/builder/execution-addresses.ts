import type {
  FrontDoorProtocolAddress,
  ProtocolAddress,
  ServerAddresses,
} from '../types.js'
import type { MutableRef } from './state.js'

type AddressesRef = MutableRef<ServerAddresses | null>

function updateAddresses(
  ref: AddressesRef,
  updater: (current: ServerAddresses) => ServerAddresses
): ServerAddresses | null {
  const current = ref.value
  if (!current) {
    return null
  }

  const next = updater(current)
  ref.value = next
  return next
}

export function setProtocolAddress(
  ref: AddressesRef,
  name: string,
  address: ProtocolAddress
): ServerAddresses | null {
  return updateAddresses(ref, (current) => ({
    ...current,
    protocols: {
      ...(current.protocols ?? {}),
      [name]: address,
    },
  }))
}

export function setGrpcAddress(
  ref: AddressesRef,
  address: FrontDoorProtocolAddress
): ServerAddresses | null {
  return updateAddresses(ref, (current) => ({
    ...current,
    grpc: address,
  }))
}

export function setUdpAddressIfMissing(
  ref: AddressesRef,
  address: FrontDoorProtocolAddress
): ServerAddresses | null {
  return updateAddresses(ref, (current) => current.udp
    ? current
    : {
        ...current,
        udp: address,
      })
}
