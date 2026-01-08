export const route = {
  kind: 'procedure',
  handler: async (input: { name: string }) => {
    return { id: `user-${input.name}` }
  },
}
