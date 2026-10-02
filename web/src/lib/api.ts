import type {
	App,
	ConnectRequest,
	ConnectResult,
	HubResult,
	Lifecycle,
	PackageFiles,
	PackageView,
	PortCheck,
	Session,
	Settings,
	TagList,
	Usage,
} from './types'

const TOKEN_KEY = 'umbrel-push-token'

export class ApiError extends Error {
	status: number
	code: string

	constructor(status: number, message: string, code = '') {
		super(message)
		this.status = status
		this.code = code
	}
}

/** A value the server put in the page itself. It does this only when it runs behind Umbrel's login, as an Umbrel app. */
export function metaContent(name: string): string {
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? ''
}

/** The server prints a link ending in #token=…; keep the token for this tab only and take it out of the address bar. */
export function readToken(): string {
	let stored = ''
	try {
		stored = sessionStorage.getItem(TOKEN_KEY) ?? ''
	} catch {
		stored = ''
	}
	const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token')
	if (!fromHash) return stored || metaContent('umbrel-push-token')
	try {
		sessionStorage.setItem(TOKEN_KEY, fromHash)
	} catch {
		// the token still works for this page load
	}
	window.history.replaceState(null, '', window.location.pathname + window.location.search)
	return fromHash
}

let token = readToken()

export function setToken(value: string) {
	token = value
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	if (!token) throw new ApiError(401, 'No session token. Open the link the server printed, which ends in #token=…', 'token')
	let response: Response
	try {
		response = await fetch(path, {
			...init,
			headers: {'X-Umbrel-Push-Token': token, ...(init.body ? {'Content-Type': 'application/json'} : {}), ...init.headers},
		})
	} catch {
		throw new ApiError(0, 'The local Umbrel Push server did not answer. Check that it is still running.', 'network')
	}
	const body = await response.json().catch(() => ({}))
	if (!response.ok) throw new ApiError(response.status, body.error ?? `Request failed (${response.status}).`, body.code ?? '')
	return body as T
}

const post = (body: unknown): RequestInit => ({method: 'POST', body: JSON.stringify(body)})
const app = (id: string) => `/api/apps/${encodeURIComponent(id)}`

export const api = {
	state: () => request<Session>('/api/state'),
	apps: () => request<{apps: App[]; refreshedAt: string}>('/api/apps'),
	logs: (id: string) => request<{appId: string; text: string}>(`/api/apps/${encodeURIComponent(id)}/logs`),
	/** Memory per app and in total. Cheap; the server keeps a reading for a few seconds. */
	usage: () => request<Usage>('/api/usage'),
	/** Storage per app and in total. Slow on the Umbrel, so the server keeps it for minutes unless `refresh` is set. */
	storage: (refresh = false) => request<Usage>(`/api/storage${refresh ? '?refresh=1' : ''}`),
	lifecycle: (id: string, action: Lifecycle) =>
		request<{appId: string; action: Lifecycle; state: string}>(`/api/apps/${encodeURIComponent(id)}/${action}`, {method: 'POST', body: '{}'}),
	// -- editing a package. The files live in the browser while they are edited; the server returns new ones.
	retrieve: (id: string) => request<PackageView>(`${app(id)}/retrieve`, post({})),
	review: (id: string, files: PackageFiles, baseline: string | null) => request<{diff: string}>(`${app(id)}/review`, post({files, baseline})),
	ports: (id: string, files: PackageFiles) => request<PortCheck>(`${app(id)}/ports`, post({files})),
	push: (id: string, files: PackageFiles, baseline: string | null, pull: boolean) =>
		request<PackageView>(`${app(id)}/push`, post({files, baseline, pull})),
	readSettings: (files: PackageFiles) => request<{settings: Settings | null; error: string | null}>('/api/package/settings', post({files})),
	writeSettings: (files: PackageFiles, settings: Settings) => request<{files: PackageFiles}>('/api/package/settings/write', post({files, settings})),
	validate: (files: PackageFiles) => request<{manifest: Record<string, unknown>; warnings: string[]}>('/api/package/validate', post({files})),
	replacePort: (files: PackageFiles, from: number, to: number) => request<{files: PackageFiles}>('/api/package/port', post({files, old: from, new: to})),
	generate: (body: {id: string; name: string; image: string; containerPort: number; port: number; dataPath: string; icon: string | null}) =>
		request<{files: PackageFiles}>('/api/package/generate', post(body)),
	// -- public lookups, made by the local server
	tags: (image: string) => request<TagList>(`/api/images/tags?image=${encodeURIComponent(image)}`),
	searchImages: (query: string) => request<{results: HubResult[]}>(`/api/images/search?q=${encodeURIComponent(query)}`),
	autoIcon: (image: string) => request<{icon: string | null}>('/api/icons/auto', post({image})),
	embedIcon: (data: string) => request<{icon: string}>('/api/icons/embed', post({data})),
	connect: (body: ConnectRequest) => request<ConnectResult>('/api/connect', {method: 'POST', body: JSON.stringify(body)}),
	disconnect: () => request<Session>('/api/disconnect', {method: 'POST'}),
}
