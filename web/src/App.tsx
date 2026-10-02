import {useCallback, useEffect, useRef, useState} from 'react'

import {Sheet, Wallpaper} from '@/components/Sheet'
import {api} from '@/lib/api'
import {describe, lifecycleCopy} from '@/lib/apps'
import type {App as UmbrelApp, Lifecycle, PackageFiles, PackageView, PowerNotice, Session, Usage} from '@/lib/types'
import {AppDialog} from '@/screens/AppDialog'
import {ConnectDialog} from '@/screens/ConnectDialog'
import {Editor} from '@/screens/Editor'
import {Installed} from '@/screens/Installed'
import {NewAppDialog} from '@/screens/NewAppDialog'

/** Memory is cheap to read, so it follows the Umbrel closely; storage is measured by walking folders, so it is read rarely. */
const MEMORY_INTERVAL_MS = 15_000
const STORAGE_INTERVAL_MS = 5 * 60_000

type Editing = {view: PackageView; isNew: boolean; appId: string; title: string}

function message(error: unknown) {
	return error instanceof Error ? error.message : 'Something went wrong.'
}

export default function App() {
	const [session, setSession] = useState<Session | null>(null)
	const [apps, setApps] = useState<UmbrelApp[]>([])
	const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [connecting, setConnecting] = useState(false)
	// Kept by id so the dialog shows the new state after a start, stop or restart refreshes the list
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const selected = apps.find((app) => app.id === selectedId) ?? null
	const connected = Boolean(session?.connected)

	const [usage, setUsage] = useState<Usage | null>(null)
	const [usageStale, setUsageStale] = useState(false)
	const [storage, setStorage] = useState<Usage | null>(null)
	const [storageLoading, setStorageLoading] = useState(false)
	const [storageFailed, setStorageFailed] = useState(false)
	const [working, setWorking] = useState<Record<string, Lifecycle>>({})
	const [notice, setNotice] = useState<PowerNotice | null>(null)
	const [editing, setEditing] = useState<Editing | null>(null)
	const [opening, setOpening] = useState<string | null>(null)
	const [creating, setCreating] = useState(false)
	const memoryBusy = useRef(false)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError('')
		try {
			const result = await api.apps()
			setApps(result.apps)
			setRefreshedAt(result.refreshedAt)
		} catch (failure) {
			setError(message(failure))
		} finally {
			setLoading(false)
		}
	}, [])

	const readMemory = useCallback(async () => {
		if (memoryBusy.current || document.hidden) return
		memoryBusy.current = true
		try {
			setUsage(await api.usage())
			setUsageStale(false)
		} catch {
			setUsageStale(true) // keep the last reading, dimmed, rather than blanking the bars
		} finally {
			memoryBusy.current = false
		}
	}, [])

	const readStorage = useCallback(async (force = false) => {
		setStorageLoading(true)
		try {
			setStorage(await api.storage(force))
			setStorageFailed(false)
		} catch {
			setStorageFailed(true)
		} finally {
			setStorageLoading(false)
		}
	}, [])

	useEffect(() => {
		api
			.state()
			.then((state) => {
				setSession(state)
				if (state.connected) void refresh()
			})
			.catch((failure) => setError(message(failure)))
	}, [refresh])

	// Memory follows the Umbrel while the tab is visible; it pauses when hidden and catches up when shown again
	useEffect(() => {
		if (!connected) {
			setUsage(null)
			setUsageStale(false)
			return
		}
		void readMemory()
		const timer = window.setInterval(() => void readMemory(), MEMORY_INTERVAL_MS)
		const onVisible = () => void readMemory()
		document.addEventListener('visibilitychange', onVisible)
		return () => {
			window.clearInterval(timer)
			document.removeEventListener('visibilitychange', onVisible)
		}
	}, [connected, readMemory])

	useEffect(() => {
		if (!connected) {
			setStorage(null)
			setStorageFailed(false)
			return
		}
		void readStorage()
		const timer = window.setInterval(() => void readStorage(), STORAGE_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [connected, readStorage])

	const onConnected = (state: Session) => {
		setSession(state)
		setConnecting(false)
		void refresh()
	}

	const onDisconnect = async () => {
		try {
			setSession(await api.disconnect())
			setApps([])
			setRefreshedAt(null)
			setError('')
			setNotice(null)
			setEditing(null)
		} catch (failure) {
			setError(message(failure))
		}
		setConnecting(false)
	}

	const onRefresh = () => {
		void refresh()
		void readMemory()
		void readStorage(true)
	}

	const onLifecycle = useCallback(
		async (app: UmbrelApp, action: Lifecycle) => {
			const name = describe(app).name
			setWorking((current) => ({...current, [app.id]: action}))
			setNotice(null)
			try {
				await api.lifecycle(app.id, action)
				await refresh()
				void readMemory()
				setNotice({kind: 'ok', text: `${name} ${lifecycleCopy[action].done}.`, appId: app.id})
			} catch (failure) {
				setNotice({kind: 'error', text: message(failure), appId: app.id})
			} finally {
				setWorking((current) => {
					const next = {...current}
					delete next[app.id]
					return next
				})
			}
		},
		[refresh, readMemory],
	)

	/** Fetch the installed package and open it in the editor */
	const onEdit = async (app: UmbrelApp) => {
		const name = describe(app).name
		setOpening(name)
		setNotice(null)
		try {
			const view = await api.retrieve(app.id)
			setSelectedId(null)
			setEditing({view, isNew: false, appId: app.id, title: name})
		} catch (failure) {
			setNotice({kind: 'error', text: message(failure), appId: app.id})
		} finally {
			setOpening(null)
		}
	}

	const onNewApp = async (id: string, files: PackageFiles) => {
		try {
			const {settings, error: settingsError} = await api.readSettings(files)
			setEditing({view: {appId: id, files, baseline: null, origin: null, images: [], settings, error: settingsError}, isNew: true, appId: id, title: id})
			setCreating(false)
		} catch (failure) {
			setNotice({kind: 'error', text: message(failure), appId: id})
			setCreating(false)
		}
	}

	return (
		<>
			<Wallpaper />
			<Sheet>
				{editing ? (
					<Editor
						key={editing.appId}
						view={editing.view}
						isNew={editing.isNew}
						appId={editing.appId}
						title={editing.title}
						host={session?.host ?? ''}
						connected={connected}
						onBack={() => setEditing(null)}
						onApplied={() => {
							void refresh()
							void readMemory()
						}}
					/>
				) : (
					<Installed
						session={session}
						apps={apps}
						refreshedAt={refreshedAt}
						loading={loading}
						error={error}
						usage={usage}
						usageStale={usageStale}
						storage={storage}
						storageLoading={storageLoading}
						storageFailed={storageFailed}
						working={working}
						opening={opening}
						notice={notice}
						onRefresh={onRefresh}
						onConnect={() => setConnecting(true)}
						onSelect={(app) => setSelectedId(app.id)}
						onLifecycle={(app, action) => void onLifecycle(app, action)}
						onEdit={(app) => void onEdit(app)}
						onNewApp={() => setCreating(true)}
					/>
				)}
			</Sheet>
			{connecting ? (
				<ConnectDialog session={session} onClose={() => setConnecting(false)} onConnected={onConnected} onDisconnect={() => void onDisconnect()} />
			) : null}
			{creating ? <NewAppDialog onClose={() => setCreating(false)} onCreate={(id, files) => void onNewApp(id, files)} /> : null}
			<AppDialog
				app={editing ? null : selected}
				host={session?.host ?? ''}
				working={selected ? (working[selected.id] ?? null) : null}
				notice={notice}
				onClose={() => setSelectedId(null)}
				onLifecycle={(app, action) => void onLifecycle(app, action)}
				onEdit={(app) => void onEdit(app)}
			/>
		</>
	)
}
