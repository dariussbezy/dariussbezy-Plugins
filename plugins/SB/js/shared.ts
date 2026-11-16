export interface Settings {
	blocked: boolean
	ignored: boolean
	groupChats: boolean
	directMessages: boolean
	pings: boolean
	/** User IDs whose messages keep Discord's blocked/ignored look. */
	excluded: string[]
}

export const DefaultSettings: Settings = {
	blocked: true,
	ignored: true,
	groupChats: true,
	directMessages: true,
	pings: true,
	excluded: [],
}
