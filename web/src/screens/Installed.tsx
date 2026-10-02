import {ChevronRight, Play, RotateCw, SlidersHorizontal, Square} from 'lucide-react'
import {useMemo, useState} from 'react'

import {Button} from '@/components/Button'
import {ListGroup, ListIcon, ListRow} from '@/components/ListRow'
import {Meter} from '@/components/Meter'
import {FilterPills, SearchField} from '@/components/Pills'
import {SummaryCard} from '@/components/SummaryCard'
import {countBySource, describe, filterApps, lifecycleActions, lifecycleCopy, SOURCES, usableIcon, type SourceId, type Tone} from '@/lib/apps'
import {formatBytes} from '@/lib/format'
import type {App, Lifecycle, PowerNotice, Session, Usage} from '@/lib/types'
import {cn} from '@/lib/utils'

const toneClass: Record<Tone, string> = {
	ok: 'text-success-light',
	muted: 'text-white/45',
	warn: 'text-amber-300',
}

const actionIcon = {start: Play, stop: Square, restart: RotateCw} as const

export type InstalledProps = {
	session: Session | null
	apps: readonly App[]
	refreshedAt: string | null
	loading: boolean
	error: string
	/** Memory per app, read every few seconds; null until the first reading */
	usage: Usage | null
	/** True when the latest memory read failed, so the bars show the last value dimmed */
	usageStale: boolean
	/** Storage per app, measured slowly; null until the first measurement */
	storage: Usage | null
	storageLoading: boolean
	storageFailed: boolean
	/** The action in progress for each app id */
	working: Record<string, Lifecycle>
	/** The app whose package is being retrieved for editing, if any */
	opening: string | null
	notice: PowerNotice | null
	onRefresh: () => void
	onConnect: () => void
	onSelect: (app: App) => void
	onLifecycle: (app: App, action: Lifecycle) => void
	onEdit: (app: App) => void
	onNewApp: () => void
}

/** The installed apps, laid out like umbrelOS's Settings page: facts and actions on the left, filtered rows on the right. */
export function Installed({
	session,
	apps,
	refreshedAt,
	loading,
	error,
	usage,
	usageStale,
	storage,
	storageLoading,
	storageFailed,
	working,
	opening,
	notice,
	onRefresh,
	onConnect,
	onSelect,
	onLifecycle,
	onEdit,
	onNewApp,
}: InstalledProps) {
	const [source, setSource] = useState<SourceId>('all')
	const [query, setQuery] = useState('')
	const connected = Boolean(session?.connected)
	const counts = useMemo(() => countBySource(apps), [apps])
	const shown = useMemo(() => filterApps(apps, source, query), [apps, source, query])
	const running = apps.filter((app) => describe(app).tone === 'ok').length

	const tabs = SOURCES.map(({id, label}) => ({
		id,
		name: connected ? `${label} ${counts[id]}` : label,
		label: (
			<>
				{label}
				{connected ? <span className='text-white/45'>{counts[id]}</span> : null}
			</>
		),
	}))

	const summary = connected
		? [
				{label: 'Running', value: session?.version ? `umbrelOS ${session.version}` : '-'},
				{label: 'Address', value: <span className='font-mono text-12 select-text'>{session?.host}</span>},
				{
					label: 'SSH user',
					value: (
						<span className='font-mono text-12 select-text'>
							{session?.user}
							{session?.port && session.port !== 22 ? `, port ${session.port}` : ''}
						</span>
					),
				},
				{label: 'Installed', value: `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`},
				{label: 'Running now', value: String(running)},
				...(usage ? [{label: 'Memory', value: `${formatBytes(usage.used)} of ${formatBytes(usage.size)}`}] : []),
				...(storage ? [{label: 'Storage', value: `${formatBytes(storage.used)} of ${formatBytes(storage.size)}`}] : []),
				{label: 'Refreshed', value: refreshedAt ?? '-'},
			]
		: [{label: 'Status', value: 'Not connected'}]

	return (
		<div className='flex h-full min-h-0 flex-col px-3 pt-6 md:px-[40px] md:pt-12 xl:px-[60px]'>
			<h1 className='shrink-0 pb-6 text-36 leading-none font-bold -tracking-4 text-white/90 md:pb-8'>Umbrel Push</h1>
			<div className='grid min-h-0 flex-1 items-start gap-[34px] lg:grid-cols-[286px_minmax(0,1fr)]'>
				<aside aria-label='Server' className='umbrel-hide-scrollbar min-h-0 overscroll-contain lg:h-full lg:overflow-y-auto lg:pb-24'>
					<div className='flex flex-col gap-3'>
						<SummaryCard rows={summary} />
						<div className='mt-1.5 flex shrink-0 gap-2'>
							<Button onClick={onConnect} className='min-w-0 flex-1 px-1.5 text-11 whitespace-nowrap'>
								{connected ? 'Connection…' : 'Connect…'}
							</Button>
							<Button onClick={onRefresh} disabled={!connected || loading} className='min-w-0 flex-1 px-1.5 text-11 whitespace-nowrap'>
								Refresh
							</Button>
							<Button
								onClick={() => window.open(`http://${session?.host}/`, '_blank', 'noopener,noreferrer')}
								disabled={!connected}
								aria-label='Open the Umbrel dashboard in a new tab'
								className='min-w-0 flex-1 px-1.5 text-11 whitespace-nowrap'
							>
								Dashboard
							</Button>
						</div>
						<Button variant='primary' size='md' className='w-full' onClick={onNewApp}>
							New app
						</Button>
						<p
							aria-live='polite'
							className={cn('px-1 text-12 select-text', notice?.kind === 'error' ? 'text-destructive2-lightest' : 'text-white/40')}
						>
							{opening
								? `Retrieving ${opening}…`
								: notice
									? notice.text
									: loading
									? 'Reading installed apps…'
									: connected && refreshedAt
										? `${apps.length} installed ${apps.length === 1 ? 'app' : 'apps'} listed.`
										: ''}
						</p>
					</div>
				</aside>

				<div className='flex min-h-0 flex-col lg:h-full'>
					<div className='mb-3 flex shrink-0 items-center justify-between gap-3'>
						<FilterPills value={source} onValueChange={setSource} tabs={tabs} ariaLabel='Filter apps by source' />
						<SearchField value={query} onChange={setQuery} label='Filter by name or ID' disabled={!connected} />
					</div>
					<div className='umbrel-scrollbar min-h-0 flex-1 overscroll-contain pb-24 lg:overflow-y-auto lg:pr-1'>
						{error ? (
							<Notice title='The app list could not be read' text={error} action={connected ? 'Try again' : 'Connect…'} onAction={connected ? onRefresh : onConnect} />
						) : !connected ? (
							<Notice
								title='Not connected'
								text='Connect to an Umbrel to list its installed apps.'
								action='Connect…'
								onAction={onConnect}
								primary
							/>
						) : apps.length === 0 && refreshedAt ? (
							<Notice title='No apps installed' text='This Umbrel has no installed apps.' action='Refresh' onAction={onRefresh} />
						) : shown.length === 0 && apps.length > 0 ? (
							<Notice
								title={query ? `No apps match “${query}”` : 'No apps from this source'}
								text='Clear the filter to see every installed app.'
								action='Clear filter'
								onAction={() => {
									setQuery('')
									setSource('all')
								}}
							/>
						) : (
							<ListGroup label='Installed apps'>
								{shown.map((app) => (
									<AppRow
										key={app.id}
										app={app}
										usage={usage}
										usageStale={usageStale}
										storage={storage}
										storageLoading={storageLoading}
										storageFailed={storageFailed}
										working={working[app.id] ?? null}
										busy={opening !== null}
										onSelect={onSelect}
										onLifecycle={onLifecycle}
										onEdit={onEdit}
									/>
								))}
							</ListGroup>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

function AppRow({
	app,
	usage,
	usageStale,
	storage,
	storageLoading,
	storageFailed,
	working,
	busy,
	onSelect,
	onLifecycle,
	onEdit,
}: {
	app: App
	usage: Usage | null
	usageStale: boolean
	storage: Usage | null
	storageLoading: boolean
	storageFailed: boolean
	working: Lifecycle | null
	busy: boolean
	onSelect: (app: App) => void
	onLifecycle: (app: App, action: Lifecycle) => void
	onEdit: (app: App) => void
}) {
	const [confirming, setConfirming] = useState<Lifecycle | null>(null)
	const info = describe(app)
	const icon = usableIcon(app)
	const actions = lifecycleActions(app)
	const isRunning = info.tone === 'ok'

	const choose = (action: Lifecycle) => {
		if (lifecycleCopy[action].confirm(info.name)) setConfirming(action)
		else onLifecycle(app, action)
	}

	return (
		<ListRow
			onClick={() => onSelect(app)}
			label={`${info.name}, ${info.stateText}. Show details`}
			icon={<ListIcon>{icon ? <img src={icon} alt='' referrerPolicy='no-referrer' className='size-full object-cover' /> : info.name.slice(0, 1).toUpperCase()}</ListIcon>}
			title={info.name}
			description={
				<>
					<span className='font-mono'>{app.id}</span>
					{app.version ? <span className='ml-3 font-mono'>{app.version}</span> : null}
					{info.note ? <span className='ml-3'>{info.note}</span> : null}
				</>
			}
		>
			{confirming ? (
				<div role='group' aria-label={`Confirm ${lifecycleCopy[confirming].label.toLowerCase()} for ${info.name}`} className='pointer-events-auto flex items-center gap-3'>
					<p className='max-w-[280px] text-right text-12 leading-tight -tracking-2 text-white/80'>{lifecycleCopy[confirming].confirm(info.name)}</p>
					<Button size='sm' onClick={() => setConfirming(null)}>
						Cancel
					</Button>
					<Button
						size='sm'
						variant={confirming === 'stop' ? 'destructive' : 'primary'}
						onClick={() => {
							const action = confirming
							setConfirming(null)
							onLifecycle(app, action)
						}}
					>
						{lifecycleCopy[confirming].label}
					</Button>
				</div>
			) : (
				<div className='flex items-center gap-5 text-13 font-medium'>
					<div className='hidden items-center gap-4 xl:flex'>
						<Meter
							label='RAM'
							name={info.name}
							value={isRunning && usage ? (usage.apps[app.id] ?? null) : null}
							total={usage?.size ?? null}
							pending={isRunning && !usage && !usageStale}
							stale={usageStale}
							title={usageStale ? 'The last memory read failed; showing the previous value.' : 'Memory the app is using now'}
						/>
						<Meter
							label='Disk'
							name={info.name}
							value={storage ? (storage.apps[app.id] ?? null) : null}
							total={storage?.size ?? null}
							pending={!storage && storageLoading}
							title={
								storageFailed
									? 'Storage could not be measured. Press Refresh to try again.'
									: "Size of the app's data folder, as Umbrel measures it. Updated every few minutes."
							}
						/>
					</div>
					<span className={cn('w-[74px] text-right', working ? 'text-white/55' : toneClass[info.tone])}>
						{working ? `${lifecycleCopy[working].doing}…` : info.stateText}
					</span>
					<span className='hidden w-12 text-right font-mono text-white/70 sm:block'>{app.port ?? '-'}</span>
					<div className='flex w-[104px] justify-end gap-2'>
						<Button
							size='icon'
							title={`Open configuration for ${info.name}`}
							aria-label={`Open configuration for ${info.name}`}
							disabled={busy || working !== null}
							onClick={() => onEdit(app)}
							className='pointer-events-auto'
						>
							<SlidersHorizontal className='size-3.5' aria-hidden='true' />
						</Button>
						{actions.map((action) => {
							const Icon = actionIcon[action]
							const name = `${lifecycleCopy[action].label} ${info.name}`
							return (
								<Button
									key={action}
									size='icon'
									title={name}
									aria-label={name}
									disabled={working !== null}
									onClick={() => choose(action)}
									className='pointer-events-auto'
								>
									<Icon className={cn('size-3.5', action !== 'restart' && 'fill-current')} aria-hidden='true' />
								</Button>
							)
						})}
					</div>
					<ChevronRight className='size-4 text-white/55' aria-hidden='true' />
				</div>
			)}
		</ListRow>
	)
}

function Notice({
	title,
	text,
	action,
	onAction,
	primary,
}: {
	title: string
	text: string
	action: string
	onAction: () => void
	primary?: boolean
}) {
	return (
		<div role='status' className='settings-edge-material flex flex-col items-center gap-1 rounded-24 px-6 py-14 text-center'>
			<h3 className='text-17 font-semibold -tracking-2 text-white/90'>{title}</h3>
			<p className='max-w-[360px] text-13 text-white/40 select-text'>{text}</p>
			<Button variant={primary ? 'primary' : 'default'} size='md' className='mt-4' onClick={onAction}>
				{action}
			</Button>
		</div>
	)
}
