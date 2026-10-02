import {EditorView} from '@codemirror/view'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import App from './App'
import {setToken} from './lib/api'
import type {PackageView, Session, Settings} from './lib/types'

const connected: Session = {connected: true, demo: false, host: '192.168.1.104', user: 'umbrel', port: 22, version: '2.0.0', refreshedAt: null}

const compose = (tag: string) =>
	`services:\n  app_proxy:\n    environment:\n      APP_HOST: community-gladys_gladys_1\n      APP_PORT: '80'\n  gladys:\n    image: gladysassistant/gladys:${tag}\n`

const filesAt = (tag: string) => ({
	'umbrel-app.yml': {content: 'id: community-gladys\nname: Gladys Assistant\nversion: 4.48.0\nport: 9212\n', mode: 420},
	'docker-compose.yml': {content: compose(tag), mode: 420},
})

const settingsAt = (tag: string): Settings => ({
	appId: 'community-gladys', name: 'Gladys Assistant', version: '4.48.0', icon: null, dashboardPort: 9212, path: '', webPort: 80, service: 'gladys',
	image: `gladysassistant/gladys:${tag}`, containerName: '', network: 'bridge', ports: [], volumes: [], environment: [], devices: [], command: '',
	privileged: false, memoryMb: 0, cpuShares: null, restart: 'unless-stopped', capAdd: [],
})

const viewAt = (tag = 'v4.48.0', baseline = 'a'.repeat(64)): PackageView => ({
	appId: 'community-gladys', files: filesAt(tag), baseline,
	origin: {kind: 'community', notice: 'Store-managed app: store/OS updates may overwrite local edits.'},
	images: [{container: 'community-gladys_gladys_1', configuredImage: `gladysassistant/gladys:${tag}`, runningImageId: 'sha256:4f3d9b2c7a1e0000', state: 'running'}],
	settings: settingsAt(tag), error: null,
})

const apps = [
	{id: 'community-gladys', name: 'Gladys Assistant', version: '4.48.0', state: 'ready', port: 9212, origin: {kind: 'community', notice: 'Store-managed app.'}},
	{id: 'dockge', name: 'Dockge', version: '1.5.0-2', state: 'ready', port: 5001, origin: {kind: 'official'}},
]

type Call = {method: string; path: string; body: any}
type Reply = {status?: number; body: unknown}
type Handlers = Record<string, (body: any, call: Call) => Reply>

let calls: Call[] = []

/** A tiny fake of the local server. `handlers` are keyed "METHOD /path"; the list, usage and storage have defaults. */
function serve(handlers: Handlers = {}) {
	calls = []
	const defaults: Handlers = {
		'GET /api/state': () => ({body: connected}),
		'GET /api/apps': () => ({body: {apps, refreshedAt: '14:03:35'}}),
		'GET /api/usage': () => ({body: {size: 17e9, used: 6e9, apps: {'community-gladys': 3e8, dockge: 9e7}, measuredAt: '14:03:40'}}),
		'GET /api/storage': () => ({body: {size: 2e12, used: 5e11, apps: {'community-gladys': 5000, dockge: 2e8}, measuredAt: '14:03:41'}}),
	}
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const path = String(input).split('?')[0]
			const call: Call = {method, path: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined}
			calls.push(call)
			const handler = handlers[`${method} ${path}`] ?? defaults[`${method} ${path}`]
			const {status = 200, body} = handler ? handler(call.body, call) : {status: 404, body: {error: `No handler for ${method} ${path}`}}
			return {ok: status < 400, status, json: async () => body} as Response
		}),
	)
}

const sent = (method: string, path: string) => calls.filter((call) => call.method === method && call.path.split('?')[0] === path)

async function openGladys(user: ReturnType<typeof userEvent.setup>) {
	await user.click(await screen.findByRole('button', {name: 'Open configuration for Gladys Assistant'}))
	await screen.findByRole('heading', {name: 'Gladys Assistant'})
}

/** The CodeMirror view inside a labelled editor, so a test can read or change its text like a person typing */
function codeView(label: string): EditorView {
	const content = within(screen.getByRole('group', {name: label})).getByRole('textbox')
	const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement)
	if (!view) throw new Error('No code editor found')
	return view
}

describe('Editor', () => {
	beforeEach(() => setToken('test'))
	afterEach(() => vi.unstubAllGlobals())

	it('opens an installed app with its image split into repository and tag, and what is running', async () => {
		serve({'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()})})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)

		expect(screen.getByLabelText('Image')).toHaveValue('gladysassistant/gladys')
		expect(screen.getByLabelText('Tag')).toHaveValue('v4.48.0')
		expect(screen.getByText('community-gladys_gladys_1 on 4f3d9b2c7a1e')).toBeInTheDocument()
		expect(screen.getByText(/Store-managed app: store\/OS updates may overwrite local edits\./)).toBeInTheDocument()
		expect(screen.getByRole('button', {name: 'Push to Umbrel'})).toBeEnabled()
		expect(screen.getByRole('button', {name: 'Settings'})).toHaveAttribute('aria-pressed', 'true')
	})

	it('lists the versions Docker Hub knows and fills the tag when one is picked, without sending anything', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'GET /api/images/tags': () => ({body: {image: 'gladysassistant/gladys', tags: ['v4.55.0', 'v4.54.1', 'v4.48.0'], registry: 'docker-hub'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)

		await user.click(screen.getByRole('button', {name: 'Versions'}))
		const menu = await screen.findByRole('menu', {name: 'Versions'})
		expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['v4.55.0', 'v4.54.1', 'v4.48.0Current'])
		expect(sent('GET', '/api/images/tags')[0].path).toBe('/api/images/tags?image=gladysassistant%2Fgladys')
		await user.click(within(menu).getByRole('menuitem', {name: 'v4.55.0'}))

		expect(screen.getByLabelText('Tag')).toHaveValue('v4.55.0')
		expect(sent('POST', '/api/apps/community-gladys/push')).toHaveLength(0)
	})

	it('says so when the image is not on Docker Hub, and the tag can still be typed', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'GET /api/images/tags': () => ({body: {image: 'ghcr.io/org/app', tags: [], registry: 'other'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Versions'}))
		expect(await screen.findByText('Version lists come from Docker Hub only. Type a tag for this registry.')).toBeInTheDocument()
		await user.keyboard('{Escape}')
		await user.clear(screen.getByLabelText('Tag'))
		await user.type(screen.getByLabelText('Tag'), 'v9')
		expect(screen.getByLabelText('Tag')).toHaveValue('v9')
	})

	it('writes the form into the YAML, shows the change against the installed copy, and sends nothing to push', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': (body) => ({body: {files: filesAt(body.settings.image.split(':')[1])}}),
			'POST /api/apps/community-gladys/review': () => ({
				body: {diff: '--- installed/docker-compose.yml\n+++ local/docker-compose.yml\n@@ -6 +6 @@\n-    image: gladysassistant/gladys:v4.48.0\n+    image: gladysassistant/gladys:v4.55.0\n'},
			}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.clear(screen.getByLabelText('Tag'))
		await user.type(screen.getByLabelText('Tag'), 'v4.55.0')
		await user.click(screen.getByRole('button', {name: 'Review changes'}))

		await screen.findByText('Change preview ready.')
		expect(sent('POST', '/api/package/settings/write')[0].body.settings.image).toBe('gladysassistant/gladys:v4.55.0')
		expect(sent('POST', '/api/apps/community-gladys/review')[0].body.baseline).toBe('a'.repeat(64))
		expect(codeView('Changes compared with the installed copy').state.doc.toString()).toContain('+    image: gladysassistant/gladys:v4.55.0')
		expect(sent('POST', '/api/apps/community-gladys/push')).toHaveLength(0)
	})

	it('pushes only after the port check and a confirmation, then shows the installed copy and refreshes the list', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': (body) => ({body: {files: filesAt(body.settings.image.split(':')[1])}}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: []}}),
			'POST /api/apps/community-gladys/ports': () => ({body: {conflicts: [], used: {}}}),
			'POST /api/apps/community-gladys/push': () => ({body: {...viewAt('v4.55.0', 'c'.repeat(64)), backup: '20261001T120000Z-abc'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.clear(screen.getByLabelText('Tag'))
		await user.type(screen.getByLabelText('Tag'), 'v4.55.0')
		const listCalls = sent('GET', '/api/apps').length

		await user.click(screen.getByRole('button', {name: 'Push to Umbrel'}))
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByText('Push Gladys Assistant to 192.168.1.104?')).toBeInTheDocument()
		expect(within(dialog).getByText(/A configuration backup is saved first, and a running app restarts\./)).toBeInTheDocument()
		expect(sent('POST', '/api/apps/community-gladys/push')).toHaveLength(0)

		await user.click(within(dialog).getByRole('button', {name: 'Push'}))
		await screen.findByText('Applied. The editor now shows the installed copy.')
		const push = sent('POST', '/api/apps/community-gladys/push')[0].body
		expect(push).toMatchObject({baseline: 'a'.repeat(64), pull: false})
		expect(push.files['docker-compose.yml'].content).toContain('v4.55.0')
		expect(screen.getByLabelText('Tag')).toHaveValue('v4.55.0')
		await waitFor(() => expect(sent('GET', '/api/apps').length).toBeGreaterThan(listCalls))

		await user.click(screen.getByRole('button', {name: 'Activity'}))
		expect(within(screen.getByRole('list', {name: 'Activity'})).getByText('Push complete. Backup: 20261001T120000Z-abc')).toBeInTheDocument()
	})

	it('warns about data migrations and sends pull when "Pull newest images" is on', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: []}}),
			'POST /api/apps/community-gladys/ports': () => ({body: {conflicts: [], used: {}}}),
			'POST /api/apps/community-gladys/push': () => ({body: {...viewAt(), backup: 'b'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('switch', {name: 'Pull newest images'}))
		await user.click(screen.getByRole('button', {name: 'Push to Umbrel'}))
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByText('New images will be pulled. Restoring the configuration does not undo data migrations.')).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', {name: 'Push'}))
		await waitFor(() => expect(sent('POST', '/api/apps/community-gladys/push')[0].body.pull).toBe(true))
	})

	it('asks for a free port when the package clashes, rewrites the package, then confirms', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: []}}),
			'POST /api/apps/community-gladys/ports': () => ({
				body: {conflicts: [{port: 9212, owner: 'Grafana (dashboard)', kind: 'dashboard', suggestions: [9213, 9214]}], used: {'9212': 'Grafana (dashboard)', '22': 'a service on the Umbrel'}},
			}),
			'POST /api/package/port': () => ({body: {files: filesAt('v4.48.0')}}),
			'POST /api/package/settings': () => ({body: {settings: {...settingsAt('v4.48.0'), dashboardPort: 9213}, error: null}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Push to Umbrel'}))

		const ports = await screen.findByRole('dialog', {name: 'Ports in use'})
		expect(within(ports).getByText('1 port in this package is already in use on the Umbrel. Pick a free port for each, or type one.')).toBeInTheDocument()
		expect(within(ports).getByText('used by Grafana (dashboard)')).toBeInTheDocument()
		const choice = within(ports).getByLabelText('change to')
		expect(choice).toHaveValue('9213')

		await user.clear(choice)
		await user.type(choice, '22')
		await user.click(within(ports).getByRole('button', {name: 'Use these ports'}))
		expect(await within(ports).findByText('Port 22 is also in use (a service on the Umbrel).')).toBeInTheDocument()

		await user.clear(choice)
		await user.type(choice, '9213')
		await user.click(within(ports).getByRole('button', {name: 'Use these ports'}))
		expect(await screen.findByText('Push Gladys Assistant to 192.168.1.104?')).toBeInTheDocument()
		expect(sent('POST', '/api/package/port')[0].body).toMatchObject({old: 9212, new: 9213})
		await user.click(screen.getByRole('button', {name: 'Cancel'}))
		expect(sent('POST', '/api/apps/community-gladys/push')).toHaveLength(0)
		await user.click(screen.getByRole('button', {name: 'Activity'}))
		expect(screen.getByText('Port 9212 is used by Grafana (dashboard); changed to 9213.')).toBeInTheDocument()
	})

	it('stays on the form and says what is wrong when a value cannot be written', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': () => ({status: 400, body: {error: 'The container image cannot be empty.', code: 'invalid'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.clear(screen.getByLabelText('Image'))
		await user.click(screen.getByRole('button', {name: 'YAML'}))

		expect(await screen.findByText('The container image cannot be empty.')).toBeInTheDocument()
		expect(screen.getByLabelText('Image')).toBeInTheDocument() // still on the Settings tab
	})

	it('moves edits between the form and the YAML in both directions', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings': (body) => ({body: {settings: settingsAt(body.files['docker-compose.yml'].content.includes('v9.9.9') ? 'v9.9.9' : 'v4.48.0'), error: null}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'YAML'}))

		const view = codeView('Contents of docker-compose.yml')
		expect(view.state.doc.toString()).toContain('image: gladysassistant/gladys:v4.48.0')
		view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: compose('v9.9.9')}})
		await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument())

		await user.click(screen.getByRole('button', {name: 'Settings'}))
		await waitFor(() => expect(screen.getByLabelText('Tag')).toHaveValue('v9.9.9'))
		expect(sent('POST', '/api/package/settings')[0].body.files['docker-compose.yml'].content).toContain('v9.9.9')
	})

	it('validates the package from the YAML tab and reports the notices', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: ['gladys: floating image tag.']}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'YAML'}))
		await user.click(screen.getByRole('button', {name: 'Validate'}))
		expect(await screen.findByText('Valid package. gladys: floating image tag.')).toBeInTheDocument()
	})

	it('shows the YAML tab when there is no settings view', async () => {
		serve({'POST /api/apps/community-gladys/retrieve': () => ({body: {...viewAt(), settings: null, error: 'The settings view is unavailable for this package: odd compose file'}})})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		expect(screen.getByText('The settings view is unavailable')).toBeInTheDocument()
		expect(screen.getByText(/odd compose file/)).toBeInTheDocument()
		await user.click(screen.getByRole('button', {name: 'YAML'}))
		expect(codeView('Contents of docker-compose.yml').state.doc.toString()).toContain('services:')
	})

	it('edits the lists: adds an environment variable and a published port into the settings that are written', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': () => ({body: {files: filesAt('v4.48.0')}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Add an environment variable'}))
		await user.type(screen.getByLabelText('Variable 1'), 'TZ')
		await user.type(screen.getByLabelText('Value 1'), 'America/New_York')
		await user.click(screen.getByRole('button', {name: 'Add a published port'}))
		await user.type(screen.getByLabelText('Host port 1'), '19002')
		await user.type(screen.getByLabelText('Container port 1'), '8080')
		await user.selectOptions(screen.getByLabelText('Protocol 1'), 'udp')
		await user.click(screen.getByRole('button', {name: 'YAML'}))

		const written = sent('POST', '/api/package/settings/write')[0].body.settings
		expect(written.environment).toEqual([['TZ', 'America/New_York']])
		expect(written.ports).toEqual([{host: 19002, container: 8080, protocol: 'udp', ip: null}])
	})

	it('keeps a trailing comma while capabilities are typed, and sends the tidy list', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': () => ({body: {files: filesAt('v4.48.0')}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		const caps = screen.getByLabelText('Capabilities')
		await user.type(caps, 'NET_ADMIN, ')
		expect(caps).toHaveValue('NET_ADMIN, ')
		await user.type(caps, 'SYS_TIME')
		await user.click(screen.getByRole('button', {name: 'YAML'}))
		expect(sent('POST', '/api/package/settings/write')[0].body.settings.capAdd).toEqual(['NET_ADMIN', 'SYS_TIME'])
	})

	it('asks before discarding unsaved edits, and leaves cleanly when nothing changed', async () => {
		serve({'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()})})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Apps'})) // nothing edited: straight back
		expect(await screen.findByRole('button', {name: 'Open configuration for Gladys Assistant'})).toBeInTheDocument()

		await openGladys(user)
		await user.type(screen.getByLabelText('Container name'), 'gladys')
		await user.click(screen.getByRole('button', {name: 'Apps'}))
		const dialog = await screen.findByRole('dialog', {name: 'Discard your edits?'})
		await user.click(within(dialog).getByRole('button', {name: 'Keep editing'}))
		expect(screen.getByLabelText('Container name')).toHaveValue('gladys')
		await user.click(screen.getByRole('button', {name: 'Apps'}))
		await user.click(within(await screen.findByRole('dialog', {name: 'Discard your edits?'})).getByRole('button', {name: 'Discard'}))
		expect(await screen.findByRole('button', {name: 'Open configuration for Gladys Assistant'})).toBeInTheDocument()
	})

	it("shows the Umbrel's sentence when a push is refused because the installed copy changed", async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: []}}),
			'POST /api/apps/community-gladys/ports': () => ({body: {conflicts: [], used: {}}}),
			'POST /api/apps/community-gladys/push': () => ({status: 409, body: {error: 'Installed files changed since retrieval. Retrieve again and merge your changes.', code: 'stale'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Push to Umbrel'}))
		await user.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'Push'}))
		expect(await screen.findByText('Installed files changed since retrieval. Retrieve again and merge your changes.')).toBeInTheDocument()
		expect(screen.getByRole('button', {name: 'Push to Umbrel'})).toBeEnabled()
		await user.click(screen.getByRole('button', {name: 'Activity'}))
		expect(screen.getByText(/Failed: Installed files changed since retrieval/)).toBeInTheDocument()
	})

	it('changes the icon through the icon dialog', async () => {
		serve({
			'POST /api/apps/community-gladys/retrieve': () => ({body: viewAt()}),
			'POST /api/package/settings/write': () => ({body: {files: filesAt('v4.48.0')}}),
			'POST /api/icons/auto': () => ({body: {icon: 'https://example.com/gladys.png'}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await openGladys(user)
		await user.click(screen.getByRole('button', {name: 'Change…'}))
		const dialog = await screen.findByRole('dialog', {name: 'Dashboard icon'})
		await user.click(within(dialog).getByRole('button', {name: 'Find a match'}))
		expect(await within(dialog).findByText('Match found. Check the preview before using it.')).toBeInTheDocument()
		expect(within(dialog).getByAltText('Icon preview')).toHaveAttribute('src', 'https://example.com/gladys.png')
		expect(sent('POST', '/api/icons/auto')[0].body.image).toBe('gladysassistant/gladys:v4.48.0')
		await user.click(within(dialog).getByRole('button', {name: 'Use icon'}))
		await user.click(screen.getByRole('button', {name: 'YAML'}))
		expect(sent('POST', '/api/package/settings/write')[0].body.settings.icon).toBe('https://example.com/gladys.png')
	})
})

describe('New app', () => {
	beforeEach(() => setToken('test'))
	afterEach(() => vi.unstubAllGlobals())

	it('derives the ID from the name, generates a package, and installs it with no baseline', async () => {
		const generated = filesAt('1.27')
		serve({
			'POST /api/package/generate': () => ({body: {files: generated}}),
			'POST /api/package/settings': () => ({body: {settings: {...settingsAt('1.27'), appId: 'my-app', name: 'My App', image: 'nginx:1.27'}, error: null}}),
			'POST /api/package/validate': () => ({body: {manifest: {}, warnings: []}}),
			'POST /api/apps/my-app/ports': () => ({body: {conflicts: [], used: {}}}),
			'POST /api/apps/my-app/push': () => ({body: {...viewAt('1.27', 'd'.repeat(64)), appId: 'my-app', backup: null}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await user.click(await screen.findByRole('button', {name: 'New app'}))
		const dialog = await screen.findByRole('dialog', {name: 'New app'})
		await user.type(within(dialog).getByLabelText('Name'), 'My Photo Server!')
		expect(within(dialog).getByLabelText('ID')).toHaveValue('my-photo-server')
		await user.clear(within(dialog).getByLabelText('ID'))
		await user.type(within(dialog).getByLabelText('ID'), 'my-app')
		await user.type(within(dialog).getByLabelText('Name'), ' 2') // the ID no longer follows the name once edited
		expect(within(dialog).getByLabelText('ID')).toHaveValue('my-app')
		await user.type(within(dialog).getByLabelText('Image'), 'nginx:1.27')
		await user.click(within(dialog).getByRole('button', {name: 'Create package'}))

		expect(await screen.findByText('new package, not installed yet')).toBeInTheDocument()
		expect(sent('POST', '/api/package/generate')[0].body).toMatchObject({id: 'my-app', image: 'nginx:1.27', containerPort: 8080, port: 18990})
		await user.click(screen.getByRole('button', {name: 'Push to Umbrel'}))
		expect(await screen.findByText('Push My App to 192.168.1.104?')).toBeInTheDocument()
		expect(screen.getByText('This installs the app on the Umbrel.')).toBeInTheDocument()
		await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Push'}))
		await waitFor(() => expect(sent('POST', '/api/apps/my-app/push')[0].body.baseline).toBeNull())
	})

	it('searches Docker Hub for the image and uses the chosen one', async () => {
		serve({
			'GET /api/images/search': () => ({body: {results: [{name: 'gladysassistant/gladys', official: false, description: 'Gladys Assistant'}, {name: 'nginx', official: true, description: 'Official build of Nginx.'}]}}),
		})
		const user = userEvent.setup()
		render(<App />)
		await user.click(await screen.findByRole('button', {name: 'New app'}))
		await user.click(await screen.findByRole('button', {name: 'Search Docker Hub…'}))
		const hub = await screen.findByRole('dialog', {name: 'Search Docker Hub'})
		await user.type(within(hub).getByLabelText('Public image name'), 'gladys')
		await user.click(within(hub).getByRole('button', {name: 'Search'}))
		const results = await within(hub).findByRole('listbox', {name: 'Search results'})
		expect(within(results).getByText('Docker Official')).toBeInTheDocument()
		await user.click(within(results).getByRole('option', {name: /gladysassistant\/gladys/}))
		await user.click(within(hub).getByRole('button', {name: 'Use selected image'}))
		expect(within(screen.getByRole('dialog', {name: 'New app'})).getByLabelText('Image')).toHaveValue('gladysassistant/gladys:latest')
	})

	it("shows the core's sentence when the package cannot be created", async () => {
		serve({'POST /api/package/generate': () => ({status: 400, body: {error: 'Enter a container image reference, such as nginx:latest.', code: 'invalid'}})})
		const user = userEvent.setup()
		render(<App />)
		await user.click(await screen.findByRole('button', {name: 'New app'}))
		const dialog = await screen.findByRole('dialog', {name: 'New app'})
		await user.type(within(dialog).getByLabelText('Name'), 'Bad')
		await user.type(within(dialog).getByLabelText('Image'), 'bad image')
		await user.click(within(dialog).getByRole('button', {name: 'Create package'}))
		expect(await within(dialog).findByText('Enter a container image reference, such as nginx:latest.')).toBeInTheDocument()
	})
})
