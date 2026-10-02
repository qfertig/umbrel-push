import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import App from './App'
import {setToken} from './lib/api'
import type {App as UmbrelApp, Session} from './lib/types'

const connected: Session = {connected: true, demo: true, host: '192.168.1.104', user: 'umbrel', port: 22, version: '2.0.0', refreshedAt: null}
const disconnected: Session = {...connected, connected: false, demo: false, host: null, user: null, port: null, version: null}

const apps: UmbrelApp[] = [
	{id: 'dockge', name: 'Dockge', version: '1.5.0-2', state: 'ready', port: 5001, origin: {kind: 'official', notice: 'Official app; store updates replace local edits.'}},
	{id: 'immich', name: 'Immich', version: 'v2.4.1', state: 'ready', port: 2283, origin: {kind: 'official'}},
	{id: 'push-smoke', name: 'Umbrel Push Test', version: '1.0.2', state: 'stopped', port: 18991, origin: {kind: 'custom'}},
]

type Handler = (path: string, init?: RequestInit) => {status?: number; body: unknown}

const GIB = 1024 ** 3
let usageStatus = 200
let storageStatus = 200
const usageBody = {size: 16 * GIB, used: 6 * GIB, apps: {dockge: 90e6, immich: 2.1 * GIB, 'push-smoke': 0}, measuredAt: '14:03:40'}
const storageBody = {
	size: 2e12,
	used: 5e11,
	available: 1.5e12,
	apps: {immich: 412e9, dockge: 0.2e9, 'push-smoke': 0.05e9},
	measuredAt: '14:03:41',
}

function mockApi(handler: Handler) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init?: RequestInit) => {
			// memory and storage have their own routes so every test gets sensible readings
			if (path.startsWith('/api/usage')) {
				return {ok: usageStatus < 400, status: usageStatus, json: async () => (usageStatus < 400 ? usageBody : {error: 'Unexpected memory usage response.'})} as Response
			}
			if (path.startsWith('/api/storage')) {
				return {ok: storageStatus < 400, status: storageStatus, json: async () => (storageStatus < 400 ? storageBody : {error: 'Storage could not be read.'})} as Response
			}
			const {status = 200, body} = handler(path, init)
			return {ok: status < 400, status, json: async () => body} as Response
		}),
	)
}

describe('App', () => {
	beforeEach(() => {
		setToken('test')
		usageStatus = 200
		storageStatus = 200
	})
	afterEach(() => vi.unstubAllGlobals())

	it('lists the installed apps with counts, and filters them from the pills', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		const user = userEvent.setup()
		render(<App />)

		await screen.findByText('Dockge')
		expect(screen.getByRole('button', {name: /^All 3$/})).toBeInTheDocument()
		expect(screen.getByText('3 installed apps listed.')).toBeInTheDocument()
		expect(screen.getByText('14:03:35')).toBeInTheDocument()

		await user.click(screen.getByRole('button', {name: /^Custom 1$/}))
		expect(screen.queryByText('Dockge')).not.toBeInTheDocument()
		expect(screen.getByText('Umbrel Push Test')).toBeInTheDocument()

		await user.type(screen.getByRole('textbox', {name: 'Filter by name or ID'}), 'zzz')
		expect(screen.getByText('No apps match “zzz”')).toBeInTheDocument()
		await user.click(screen.getByRole('button', {name: 'Clear filter'}))
		expect(screen.getByText('Dockge')).toBeInTheDocument()
	})

	it('opens an app, shows its facts, and reads its logs on request', async () => {
		mockApi((path) => {
			if (path === '/api/state') return {body: connected}
			if (path === '/api/apps') return {body: {apps, refreshedAt: '14:03:35'}}
			return {body: {appId: 'dockge', text: 'listening on port 5001'}}
		})
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole('button', {name: /Dockge, Running/}))
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByText('1.5.0-2')).toBeInTheDocument()
		expect(within(dialog).getByText('Official app; store updates replace local edits.')).toBeInTheDocument()

		await user.click(within(dialog).getByRole('button', {name: 'Show logs'}))
		expect(await within(dialog).findByText('listening on port 5001')).toBeInTheDocument()
		expect(within(dialog).getByRole('button', {name: 'Reload logs'})).toBeInTheDocument()
	})

	it('puts the address in the server card instead of a heading', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		render(<App />)
		await screen.findByText('Dockge')
		const card = screen.getByRole('complementary', {name: 'Server'})
		expect(within(card).getByText('Address')).toBeInTheDocument()
		expect(within(card).getByText('192.168.1.104')).toBeInTheDocument()
		expect(within(card).getByText('umbrel')).toBeInTheDocument()
		expect(screen.queryByRole('heading', {level: 2})).not.toBeInTheDocument()
	})

	it('shows the state as text with no status circle', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		render(<App />)
		const row = (await screen.findByRole('button', {name: /Dockge, Running/})).parentElement as HTMLElement
		expect(within(row).getByText('Running')).toBeInTheDocument()
		expect(row.querySelector('.size-2')).toBeNull()
	})

	it('shows an app icon when the server sends one, and a letter tile when it does not', async () => {
		const withIcon: UmbrelApp[] = [{...apps[0], icon: 'https://example.com/dockge.png'}, apps[1]]
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps: withIcon, refreshedAt: '14:03:35'}}))
		const {container} = render(<App />)
		await screen.findByText('Dockge')
		expect(container.querySelector('img[src="https://example.com/dockge.png"]')).not.toBeNull()
		expect(container.querySelectorAll('img')).toHaveLength(1)
		expect(screen.getByText('I')).toBeInTheDocument()
	})

	it('stops an app only after confirming, then shows its new state and offers Start', async () => {
		let state = 'ready'
		const posts: string[] = []
		mockApi((path, init) => {
			if (path === '/api/state') return {body: connected}
			if (init?.method === 'POST') {
				posts.push(path)
				state = 'stopped'
				return {body: {appId: 'immich', action: 'stop', state}}
			}
			return {body: {apps: apps.map((app) => (app.id === 'immich' ? {...app, state} : app)), refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole('button', {name: /Immich, Running/}))
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).queryByRole('button', {name: 'Start'})).not.toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', {name: 'Stop'}))
		expect(within(dialog).getByText('Stop Immich? It stays off until you start it.')).toBeInTheDocument()
		expect(posts).toEqual([])

		await user.click(within(dialog).getByRole('button', {name: 'Stop'}))
		expect(await within(dialog).findByText('Immich stopped.')).toBeInTheDocument()
		expect(posts).toEqual(['/api/apps/immich/stop'])
		expect(within(dialog).getByRole('button', {name: 'Start'})).toBeInTheDocument()
		expect(within(dialog).queryByRole('button', {name: 'Restart'})).not.toBeInTheDocument()
		expect(within(dialog).getByText('Stopped')).toBeInTheDocument()
		expect(within(dialog).getByRole('button', {name: 'Open app'})).toBeDisabled()
	})

	it('cancelling the confirmation sends nothing, and Start needs no confirmation', async () => {
		const posts: string[] = []
		const stopped = apps.map((app) => (app.id === 'immich' ? {...app, state: 'stopped'} : app))
		mockApi((path, init) => {
			if (path === '/api/state') return {body: connected}
			if (init?.method === 'POST') {
				posts.push(path)
				return {body: {appId: 'immich', action: 'start', state: 'ready'}}
			}
			return {body: {apps: stopped, refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)
		await user.click(await screen.findByRole('button', {name: /Dockge, Running/}))
		let dialog = await screen.findByRole('dialog')
		await user.click(within(dialog).getByRole('button', {name: 'Restart'}))
		expect(within(dialog).getByText('Restart Dockge? It is unavailable while it restarts.')).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', {name: 'Cancel'}))
		expect(posts).toEqual([])
		expect(within(dialog).getByRole('button', {name: 'Restart'})).toBeInTheDocument()
		await user.keyboard('{Escape}')

		await user.click(await screen.findByRole('button', {name: /Immich, Stopped/}))
		dialog = await screen.findByRole('dialog')
		await user.click(within(dialog).getByRole('button', {name: 'Start'}))
		await waitFor(() => expect(posts).toEqual(['/api/apps/immich/start']))
	})

	it("shows the server's reason when a power action is refused", async () => {
		mockApi((path, init) => {
			if (path === '/api/state') return {body: connected}
			if (init?.method === 'POST') return {status: 409, body: {error: 'Cannot stop immich while it is stopping.', code: 'state'}}
			return {body: {apps, refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)
		await user.click(await screen.findByRole('button', {name: /Immich, Running/}))
		const dialog = await screen.findByRole('dialog')
		await user.click(within(dialog).getByRole('button', {name: 'Restart'}))
		await user.click(within(dialog).getAllByRole('button', {name: 'Restart'})[0])
		expect(await within(dialog).findByText('Cannot stop immich while it is stopping.')).toBeInTheDocument()
		expect(within(dialog).getByRole('button', {name: 'Stop'})).toBeEnabled()
	})

	it('shows memory and disk bars for each app, and a dash where there is no reading', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		render(<App />)
		await screen.findByText('Dockge')

		const ram = await screen.findByRole('meter', {name: 'Immich ram'})
		expect(ram).toHaveAttribute('aria-valuetext', '2.25 GB of 17.2 GB')
		const disk = await screen.findByRole('meter', {name: 'Immich disk'})
		expect(disk).toHaveAttribute('aria-valuetext', '412 GB of 2.00 TB')
		// a stopped app holds no memory but still has data on the disk
		expect(screen.getByRole('img', {name: 'Umbrel Push Test ram'})).toHaveAttribute('aria-valuetext', 'no reading')
		expect(screen.getByRole('meter', {name: 'Umbrel Push Test disk'})).toHaveAttribute('aria-valuetext', '50.0 MB of 2.00 TB')
	})

	it('adds whole-machine memory and storage to the server card', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		render(<App />)
		const card = await screen.findByRole('complementary', {name: 'Server'})
		expect(await within(card).findByText('6.44 GB of 17.2 GB')).toBeInTheDocument()
		expect(await within(card).findByText('500 GB of 2.00 TB')).toBeInTheDocument()
	})

	it('shows a dash and says why when memory or storage cannot be read', async () => {
		usageStatus = 502
		storageStatus = 502
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		const {container} = render(<App />)
		await screen.findByText('Dockge')
		await waitFor(() => expect(container.querySelector('[title^="The last memory read failed"]')).not.toBeNull())
		expect(screen.getByRole('img', {name: 'Immich ram'})).toHaveAttribute('aria-valuetext', 'no reading')
		await waitFor(() => expect(container.querySelector('[title^="Storage could not be measured"]')).not.toBeNull())
		expect(screen.getByRole('img', {name: 'Immich disk'})).toHaveAttribute('aria-valuetext', 'no reading')
	})

	it('puts Start, Stop and Restart on each row according to its state', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		render(<App />)
		await screen.findByText('Dockge')
		expect(screen.getByRole('button', {name: 'Restart Dockge'})).toBeEnabled()
		expect(screen.getByRole('button', {name: 'Stop Dockge'})).toBeEnabled()
		expect(screen.queryByRole('button', {name: 'Start Dockge'})).not.toBeInTheDocument()
		expect(screen.getByRole('button', {name: 'Start Umbrel Push Test'})).toBeEnabled()
		expect(screen.queryByRole('button', {name: 'Stop Umbrel Push Test'})).not.toBeInTheDocument()
	})

	it('stops an app from its row after a confirmation, without opening the details', async () => {
		let state = 'ready'
		const posts: string[] = []
		mockApi((path, init) => {
			if (path === '/api/state') return {body: connected}
			if (init?.method === 'POST') {
				posts.push(path)
				state = 'stopped'
				return {body: {appId: 'immich', action: 'stop', state}}
			}
			return {body: {apps: apps.map((app) => (app.id === 'immich' ? {...app, state} : app)), refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole('button', {name: 'Stop Immich'}))
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		const confirm = screen.getByRole('group', {name: 'Confirm stop for Immich'})
		expect(within(confirm).getByText('Stop Immich? It stays off until you start it.')).toBeInTheDocument()
		expect(posts).toEqual([])
		await user.click(within(confirm).getByRole('button', {name: 'Cancel'}))
		expect(screen.queryByRole('group', {name: 'Confirm stop for Immich'})).not.toBeInTheDocument()
		expect(posts).toEqual([])

		await user.click(screen.getByRole('button', {name: 'Stop Immich'}))
		await user.click(within(screen.getByRole('group', {name: 'Confirm stop for Immich'})).getByRole('button', {name: 'Stop'}))
		const card = screen.getByRole('complementary', {name: 'Server'})
		expect(await within(card).findByText('Immich stopped.')).toBeInTheDocument()
		expect(posts).toEqual(['/api/apps/immich/stop'])
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(await screen.findByRole('button', {name: 'Start Immich'})).toBeInTheDocument()
		expect(screen.queryByRole('button', {name: 'Stop Immich'})).not.toBeInTheDocument()
	})

	it('starts an app from its row at once, and says when an action is refused', async () => {
		const posts: string[] = []
		let refuse = false
		mockApi((path, init) => {
			if (path === '/api/state') return {body: connected}
			if (init?.method === 'POST') {
				posts.push(path)
				return refuse
					? {status: 409, body: {error: 'Cannot start push-smoke while it is starting.', code: 'state'}}
					: {body: {appId: 'push-smoke', action: 'start', state: 'ready'}}
			}
			return {body: {apps, refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole('button', {name: 'Start Umbrel Push Test'}))
		await waitFor(() => expect(posts).toEqual(['/api/apps/push-smoke/start']))
		const card = screen.getByRole('complementary', {name: 'Server'})
		expect(await within(card).findByText('Umbrel Push Test started.')).toBeInTheDocument()

		refuse = true
		await user.click(screen.getByRole('button', {name: 'Start Umbrel Push Test'}))
		expect(await within(card).findByText('Cannot start push-smoke while it is starting.')).toBeInTheDocument()
	})

	it('Refresh also forces a new storage measurement', async () => {
		mockApi((path) => (path === '/api/state' ? {body: connected} : {body: {apps, refreshedAt: '14:03:35'}}))
		const requested = () => vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
		const user = userEvent.setup()
		render(<App />)
		await screen.findByText('Dockge')
		await waitFor(() => expect(requested()).toContain('/api/storage'))
		expect(requested()).not.toContain('/api/storage?refresh=1')
		await user.click(screen.getByRole('button', {name: 'Refresh'}))
		await waitFor(() => expect(requested()).toContain('/api/storage?refresh=1'))
	})

	it('states the fact and offers Connect when there is no connection', async () => {
		mockApi(() => ({body: disconnected}))
		render(<App />)
		expect(await screen.findAllByText('Not connected')).not.toHaveLength(0)
		expect(screen.getByRole('status')).toHaveTextContent('Connect to an Umbrel to list its installed apps.')
		expect(screen.getByRole('textbox', {name: 'Filter by name or ID'})).toBeDisabled()
		expect(screen.getByRole('button', {name: 'Refresh'})).toBeDisabled()
	})

	it('asks for the host key first, then connects only after it is trusted', async () => {
		const calls: unknown[] = []
		mockApi((path, init) => {
			if (path === '/api/state') return {body: disconnected}
			if (path === '/api/connect') {
				const sent = JSON.parse(String(init?.body))
				calls.push(sent)
				return sent.trust
					? {body: {status: 'connected', ...connected}}
					: {body: {status: 'trust', host: '192.168.1.104', keys: [{type: 'ssh-ed25519', fingerprint: 'SHA256:abc'}]}}
			}
			return {body: {apps, refreshedAt: '14:03:35'}}
		})
		const user = userEvent.setup()
		render(<App />)

		await user.click((await screen.findAllByRole('button', {name: 'Connect…'}))[0])
		const dialog = await screen.findByRole('dialog')
		await user.type(within(dialog).getByLabelText('Host'), '192.168.1.104')
		await user.type(within(dialog).getByLabelText('Password'), 'secret')
		await user.click(within(dialog).getByRole('button', {name: 'Connect'}))

		expect(await within(dialog).findByText('SHA256:abc')).toBeInTheDocument()
		expect(calls).toHaveLength(1)
		await user.click(within(dialog).getByRole('button', {name: 'Trust and connect'}))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(calls[1]).toMatchObject({host: '192.168.1.104', trust: true})
		expect(await screen.findByText('Dockge')).toBeInTheDocument()
	})

	it('shows the server\'s sentence when the connection fails', async () => {
		mockApi((path) =>
			path === '/api/state'
				? {body: disconnected}
				: {status: 401, body: {error: "This computer isn't authorized on the Umbrel yet. Enter the Umbrel password once so its key can be added.", code: 'password_required'}},
		)
		const user = userEvent.setup()
		render(<App />)
		await user.click((await screen.findAllByRole('button', {name: 'Connect…'}))[0])
		const dialog = await screen.findByRole('dialog')
		await user.type(within(dialog).getByLabelText('Host'), 'umbrel.local')
		await user.click(within(dialog).getByRole('button', {name: 'Connect'}))
		expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the Umbrel password once')
	})
})
