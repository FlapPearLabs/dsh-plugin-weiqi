export const GO_VIEW_SLOT = 'conversation.view' as const

export type ConversationViewEntry = {
  readonly name: typeof GO_VIEW_SLOT
  readonly id: string
  readonly order: number
  readonly label: string
}

export type ConversationViewProps = {
  readonly sessionId: string
}

export type ConversationViewComponent = (props: ConversationViewProps) => unknown

export type ConversationViewSlotRegistry = {
  inject(name: typeof GO_VIEW_SLOT, setup: () => void): void
  register(entry: ConversationViewEntry, component: ConversationViewComponent): void
}

export const GO_VIEW_REGISTRATION = Object.freeze({
  id: 'go',
  order: 20,
  label: 'Go',
} as const)

export function registerGoView(
  registry: ConversationViewSlotRegistry,
  component: ConversationViewComponent,
): void {
  registry.inject(GO_VIEW_SLOT, () => {
    registry.register(Object.freeze({ name: GO_VIEW_SLOT, ...GO_VIEW_REGISTRATION }), component)
  })
}
