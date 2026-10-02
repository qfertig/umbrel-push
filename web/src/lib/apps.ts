import type {App, Lifecycle} from './types'

export type SourceId = 'all' | 'official' | 'community' | 'custom'

export const SOURCES: readonly {id: SourceId; label: string}[] = [
	{id: 'all', label: 'All'},
	{id: 'official', label: 'Official'},
	{id: 'community', label: 'Community'},
	{id: 'custom', label: 'Custom'},
]

export type Tone = 'ok' | 'muted' | 'warn'

export type AppInfo = {
	name: string
	kind: string
	modified: boolean
	notice: string
	stateText: string
	tone: Tone
	note: string
}

/** What the list and the details dialog both say about an app's source and state. */
export function describe(app: App): AppInfo {
	const kind = app.origin?.kind ?? 'existing'
	const modified = Boolean(app.origin?.modified)
	const state = (app.state ?? 'unknown').toLowerCase()
	const running = state === 'ready' || state === 'running'
	return {
		name: app.name || app.id,
		kind,
		modified,
		notice: app.origin?.notice ?? '',
		stateText: running ? 'Running' : state.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
		tone: running ? 'ok' : state === 'stopped' ? 'muted' : 'warn',
		note: kind === 'custom' ? 'Managed here' : modified ? 'Edited locally' : '',
	}
}

export function filterApps(apps: readonly App[], source: SourceId, query: string): App[] {
	const needle = query.trim().toLowerCase()
	return apps.filter((app) => {
		const kind = app.origin?.kind
		if (source !== 'all' && kind !== source) return false
		return !needle || `${app.name ?? ''} ${app.id}`.toLowerCase().includes(needle)
	})
}

export function countBySource(apps: readonly App[]): Record<SourceId, number> {
	const count = (kind: string) => apps.filter((app) => app.origin?.kind === kind).length
	return {all: apps.length, official: count('official'), community: count('community'), custom: count('custom')}
}

/** The transparent 1px image the core writes when an app has no icon (catalog.NO_ICON) */
export const NO_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

/** Icons come from the Umbrel as data URIs or https URLs; the transparent placeholder counts as none. */
export function usableIcon(app: App): string | null {
	const icon = app.icon
	if (!icon || icon === NO_ICON) return null
	return icon.startsWith('data:image/') || icon.startsWith('https://') ? icon : null
}

/** The actions that make sense from the app's current state; the server and the Umbrel-side worker enforce the same table. */
export function lifecycleActions(app: App): Lifecycle[] {
	const state = (app.state ?? '').toLowerCase()
	if (state === 'stopped') return ['start']
	if (state === 'ready' || state === 'running') return ['restart', 'stop']
	return []
}

export const lifecycleCopy: Record<Lifecycle, {label: string; doing: string; done: string; confirm: (name: string) => string | null}> = {
	start: {label: 'Start', doing: 'Starting', done: 'started', confirm: () => null},
	stop: {label: 'Stop', doing: 'Stopping', done: 'stopped', confirm: (name) => `Stop ${name}? It stays off until you start it.`},
	restart: {label: 'Restart', doing: 'Restarting', done: 'restarted', confirm: (name) => `Restart ${name}? It is unavailable while it restarts.`},
}

/**
 * 'ghcr.io/org/app:1.2' becomes ['ghcr.io/org/app', '1.2']. A digest stays in the tag part, after the tag:
 * 'org/app:1.2@sha256:...' becomes ['org/app', '1.2@sha256:...'] and 'org/app@sha256:...' becomes ['org/app', '@sha256:...'].
 */
export function splitImage(image: string): [string, string] {
	const at = image.indexOf('@')
	const named = at >= 0 ? image.slice(0, at) : image
	const digest = at >= 0 ? image.slice(at) : ''
	const colon = named.lastIndexOf(':')
	if (colon > named.lastIndexOf('/')) return [named.slice(0, colon), named.slice(colon + 1) + digest]
	return [named, digest]
}

/** The tag name alone, without any digest: '1.2@sha256:...' gives '1.2' */
export function tagName(tag: string): string {
	const at = tag.indexOf('@')
	return at >= 0 ? tag.slice(0, at) : tag
}

export function joinImage(repository: string, tag: string): string {
	const repo = repository.trim()
	const rest = tag.trim()
	if (!rest) return repo
	return repo + (rest.startsWith('@') ? rest : `:${rest}`)
}

/** An app ID from a name: lowercase letters, numbers and hyphens */
export function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
}
