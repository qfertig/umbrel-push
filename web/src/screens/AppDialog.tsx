import {useEffect, useState} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {ListIcon} from '@/components/ListRow'
import {SummaryCard} from '@/components/SummaryCard'
import {describe, lifecycleActions, lifecycleCopy, usableIcon} from '@/lib/apps'
import {api} from '@/lib/api'
import type {App, Lifecycle, PowerNotice} from '@/lib/types'
import {cn} from '@/lib/utils'

type Logs = {status: 'idle'} | {status: 'loading'} | {status: 'ready'; text: string} | {status: 'error'; message: string}
/** Facts and the actions for one installed app: start, stop and restart, its logs, and opening it in a browser. */
export function AppDialog({
	app,
	host,
	working,
	notice,
	onClose,
	onLifecycle,
	onEdit,
}: {
	app: App | null
	host: string
	/** The start, stop or restart in progress for this app, if any */
	working: Lifecycle | null
	/** The latest power outcome; shown here only when it is about this app */
	notice: PowerNotice | null
	onClose: () => void
	onLifecycle: (app: App, action: Lifecycle) => void
	onEdit: (app: App) => void
}) {
	const [logs, setLogs] = useState<Logs>({status: 'idle'})
	const [confirming, setConfirming] = useState<Lifecycle | null>(null)

	useEffect(() => {
		setLogs({status: 'idle'})
		setConfirming(null)
	}, [app?.id])

	if (!app) return null
	const info = describe(app)
	const icon = usableIcon(app)
	const actions = lifecycleActions(app)
	const busy = working !== null
	const outcome = notice && notice.appId === app.id ? notice : null

	const showLogs = async () => {
		setLogs({status: 'loading'})
		try {
			setLogs({status: 'ready', text: (await api.logs(app.id)).text})
		} catch (error) {
			setLogs({status: 'error', message: error instanceof Error ? error.message : 'The logs could not be read.'})
		}
	}

	const run = (action: Lifecycle) => {
		setConfirming(null)
		onLifecycle(app, action)
	}

	const choose = (action: Lifecycle) => {
		if (lifecycleCopy[action].confirm(info.name)) setConfirming(action)
		else run(action)
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent className='sm:max-w-[520px]'>
				<DialogHeader>
					<div className='flex items-center gap-3'>
						<ListIcon className='size-10 rounded-10 text-19 [--settings-row-tone:var(--settings-tone-2)]'>
							{icon ? <img src={icon} alt='' referrerPolicy='no-referrer' className='size-full object-cover' /> : info.name.slice(0, 1).toUpperCase()}
						</ListIcon>
						<div className='flex min-w-0 flex-col gap-1'>
							<DialogTitle className='truncate'>{info.name}</DialogTitle>
							<DialogDescription className='font-mono select-text'>{app.id}</DialogDescription>
						</div>
					</div>
				</DialogHeader>
				<SummaryCard
					rows={[
						{label: 'Source', value: info.kind.charAt(0).toUpperCase() + info.kind.slice(1)},
						{label: 'Version', value: <span className='font-mono text-12 select-text'>{app.version ?? '-'}</span>},
						{label: 'Port', value: <span className='font-mono text-12 select-text'>{app.port ?? '-'}</span>},
						{label: 'State', value: info.stateText},
					]}
				/>
				{info.notice ? (
					<p className={cn('text-13 -tracking-2', info.kind === 'custom' ? 'text-white/45' : 'text-amber-300')}>{info.notice}</p>
				) : null}

				<div role='group' aria-label={`Power controls for ${info.name}`} className='flex flex-col gap-2.5'>
					{confirming ? (
						<>
							<p className='text-13 -tracking-2 text-white/80'>{lifecycleCopy[confirming].confirm(info.name)}</p>
							<div className='flex gap-2'>
								<Button size='md' onClick={() => setConfirming(null)}>
									Cancel
								</Button>
								<Button size='md' variant={confirming === 'stop' ? 'destructive' : 'primary'} onClick={() => run(confirming)}>
									{lifecycleCopy[confirming].label}
								</Button>
							</div>
						</>
					) : actions.length > 0 ? (
						<div className='flex gap-2'>
							{actions.map((action) => (
								<Button key={action} size='md' disabled={busy} onClick={() => choose(action)}>
									{lifecycleCopy[action].label}
								</Button>
							))}
						</div>
					) : (
						<p className='text-12 text-white/45'>Start, stop and restart are unavailable while the app is {info.stateText.toLowerCase()}.</p>
					)}
					<p
						aria-live='polite'
						className={cn('min-h-4 text-12 select-text', outcome?.kind === 'error' ? 'text-destructive2-lightest' : 'text-white/55')}
					>
						{working ? `${lifecycleCopy[working].doing} ${info.name}. This can take a minute.` : (outcome?.text ?? '')}
					</p>
				</div>

				{logs.status !== 'idle' ? (
					<div aria-live='polite' className='rounded-12 bg-white/6 p-3'>
						{logs.status === 'loading' ? <p className='text-12 text-white/45'>Reading logs…</p> : null}
						{logs.status === 'error' ? <p className='text-12 text-destructive2-lightest select-text'>{logs.message}</p> : null}
						{logs.status === 'ready' ? (
							<pre className='umbrel-scrollbar max-h-[220px] overflow-auto font-mono text-12 leading-snug whitespace-pre-wrap text-white/70 select-text'>
								{logs.text || 'The app has not logged anything yet.'}
							</pre>
						) : null}
					</div>
				) : null}
				<DialogFooter>
					<Button size='dialog' onClick={showLogs} disabled={logs.status === 'loading' || busy}>
						{logs.status === 'ready' || logs.status === 'error' ? 'Reload logs' : 'Show logs'}
					</Button>
					<Button size='dialog' disabled={busy} onClick={() => onEdit(app)}>
						Open configuration
					</Button>
					<Button
						size='dialog'
						variant='primary'
						disabled={!app.port || busy || info.tone !== 'ok'}
						onClick={() => window.open(`http://${host}:${app.port}/`, '_blank', 'noopener,noreferrer')}
					>
						Open app
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
