import {ChevronLeft} from 'lucide-react'
import {useEffect, useState} from 'react'

import {Button} from '@/components/Button'
import {CodeEditor} from '@/components/CodeEditor'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {ListIcon} from '@/components/ListRow'
import {FilterPills} from '@/components/Pills'
import {Select} from '@/components/Select'
import {Switch} from '@/components/Switch'
import {usableIcon} from '@/lib/apps'
import {useEditor, type EditorTab} from '@/lib/editor'
import type {PackageView, PortCheck} from '@/lib/types'
import {cn} from '@/lib/utils'
import {IconDialog} from '@/screens/IconDialog'
import {LogsDialog} from '@/screens/LogsDialog'
import {PortsDialog} from '@/screens/PortsDialog'
import {PushDialog} from '@/screens/PushDialog'
import {SettingsForm} from '@/screens/SettingsForm'

const TABS: {id: EditorTab; label: string}[] = [
	{id: 'settings', label: 'Settings'},
	{id: 'yaml', label: 'YAML'},
	{id: 'changes', label: 'Changes'},
	{id: 'activity', label: 'Activity'},
]

/**
 * Change one app's package: its settings, the YAML underneath, what would change on the Umbrel, and what happened so far.
 * Mirrors the Qt editor step for step (Settings, YAML, Changes, Activity; Review changes; Push to Umbrel).
 */
export function Editor({
	view,
	isNew,
	appId,
	title,
	host,
	connected,
	onBack,
	onApplied,
}: {
	view: PackageView
	isNew: boolean
	appId: string
	/** The name the app list shows, used while the package has no settings view to take a title from */
	title: string
	host: string
	connected: boolean
	onBack: () => void
	/** Called after a push succeeds, so the app list shows the new version and state */
	onApplied: () => void
}) {
	const editor = useEditor(view, isNew, appId, host)
	const [pull, setPull] = useState(false)
	const [choosingIcon, setChoosingIcon] = useState(false)
	const [showLogs, setShowLogs] = useState(false)
	const [leaving, setLeaving] = useState(false)
	const [ports, setPorts] = useState<PortCheck | null>(null)
	const [confirming, setConfirming] = useState(false)
	const {settings, status, busy, tab, file, files} = editor
	const name = settings?.name || title || appId
	const icon = settings ? usableIcon({id: appId, icon: settings.icon ?? undefined}) : null
	const isUpdate = editor.baseline !== null
	const kind = editor.origin?.kind
	const warn = kind === 'official' || kind === 'community' || kind === 'existing'
	const notice = editor.origin?.notice || (kind === 'custom' ? 'Custom app managed with Umbrel Push.' : 'New custom app. Review the configuration, then push to install it.')

	useEffect(() => {
		if (!editor.dirty) return
		const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener('beforeunload', warnBeforeLeaving)
		return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
	}, [editor.dirty])

	const back = () => (editor.dirty ? setLeaving(true) : onBack())

	const startPush = async () => {
		if (!connected) {
			editor.setStatus({kind: 'error', text: 'Connect to an Umbrel first.'})
			return
		}
		const check = await editor.preparePush()
		if (!check) return
		if (check.conflicts.length > 0) setPorts(check)
		else setConfirming(true)
	}

	return (
		<div className='flex h-full min-h-0 flex-col px-3 pt-6 md:px-[40px] md:pt-10 xl:px-[60px]'>
			<header className='flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 pb-4'>
				<Button size='md' onClick={back} className='min-w-0 pl-2.5'>
					<ChevronLeft className='size-4' aria-hidden='true' />
					Apps
				</Button>
				<ListIcon className='size-11 rounded-12 text-19 [--settings-row-tone:var(--settings-tone-2)]'>
					{icon ? <img src={icon} alt='' referrerPolicy='no-referrer' className='size-full object-cover' /> : name.slice(0, 1).toUpperCase()}
				</ListIcon>
				<div className='min-w-0 flex-1'>
					<h1 className='truncate text-24 leading-none font-semibold -tracking-4 text-white/90'>{name}</h1>
					<p className='mt-1.5 flex flex-wrap gap-x-4 text-12 text-white/40'>
						<span className='font-mono select-text'>{appId}</span>
						{settings?.version ? <span className='font-mono'>version {settings.version}</span> : null}
						{settings?.dashboardPort ? <span className='font-mono'>port {settings.dashboardPort}</span> : null}
						<span>{isUpdate ? `retrieved ${editor.retrievedAt} from ${host}` : 'new package, not installed yet'}</span>
					</p>
				</div>
				<div className='flex gap-2'>
					{isUpdate ? (
						<Button size='md' disabled={!connected} onClick={() => setShowLogs(true)}>
							Logs
						</Button>
					) : null}
					<Button size='md' disabled={!settings} onClick={() => setChoosingIcon(true)}>
						Icon…
					</Button>
				</div>
			</header>

			<p
				className={cn(
					'mb-4 shrink-0 truncate rounded-12 border-hpx px-4 py-2 text-13 -tracking-2',
					warn ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 bg-white/6 text-white/65',
				)}
			>
				{notice}
			</p>

			<div className='mb-4 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2'>
				<FilterPills value={tab} onValueChange={(next) => void editor.selectTab(next)} tabs={TABS} ariaLabel='Editor sections' />
				<p
					role='status'
					aria-live='polite'
					className={cn(
						'min-w-0 flex-1 text-right text-12 select-text',
						status?.kind === 'error' ? 'text-destructive2-lightest' : status?.kind === 'ok' ? 'text-success-light' : 'text-white/50',
					)}
				>
					{status?.text ?? ''}
				</p>
			</div>

			<div className={cn('min-h-0 flex-1', tab === 'settings' || tab === 'activity' ? 'umbrel-scrollbar overflow-y-auto pr-1' : 'flex flex-col gap-3')}>
				{tab === 'settings' ? (
					settings ? (
						<SettingsForm
							settings={settings}
							images={editor.images}
							host={host}
							onChange={editor.editSettings}
							onChangeIcon={() => setChoosingIcon(true)}
							iconPreview={icon ? <img src={icon} alt='' referrerPolicy='no-referrer' className='size-full object-cover' /> : name.slice(0, 1).toUpperCase()}
						/>
					) : (
						<div role='status' className='settings-edge-material rounded-24 px-6 py-12 text-center'>
							<h2 className='text-17 font-semibold -tracking-2 text-white/90'>The settings view is unavailable</h2>
							<p className='mx-auto mt-1 max-w-[460px] text-13 text-white/45 select-text'>{editor.settingsError ?? 'This package has no settings view.'} The YAML tab still works.</p>
						</div>
					)
				) : null}

				{tab === 'yaml' ? (
					<>
						<div className='flex shrink-0 items-center gap-3'>
							<Select className='w-[240px]' aria-label='Package file' value={file} onChange={(event) => editor.setFile(event.target.value)}>
								{Object.keys(files)
									.sort()
									.map((fileName) => (
										<option key={fileName} value={fileName}>
											{fileName}
										</option>
									))}
							</Select>
							<Button size='md' disabled={busy !== null} onClick={() => void editor.validate()}>
								Validate
							</Button>
							<span className='flex-1' />
							{editor.dirty ? <span className='text-12 text-white/45'>Unsaved changes</span> : null}
						</div>
						<CodeEditor
							key={file}
							label={`Contents of ${file}`}
							value={files[file]?.content ?? ''}
							onChange={(content) => editor.editFile(file, content)}
							className='min-h-0 flex-1 [&_.cm-editor]:h-full'
						/>
					</>
				) : null}

				{tab === 'changes' ? (
					editor.diff ? (
						<>
							<CodeEditor mode='diff' readOnly label='Changes compared with the installed copy' value={editor.diff} className='min-h-0 flex-1 [&_.cm-editor]:h-full' />
							<p className='shrink-0 text-12 text-white/40'>Compared with the copy installed on the Umbrel. YAML can contain passwords or API keys.</p>
						</>
					) : (
						<div role='status' className='settings-edge-material rounded-24 px-6 py-12 text-center'>
							<h2 className='text-17 font-semibold -tracking-2 text-white/90'>No comparison yet</h2>
							<p className='mx-auto mt-1 max-w-[420px] text-13 text-white/45'>Press Review changes to compare your edits with the copy installed on the Umbrel.</p>
						</div>
					)
				) : null}

				{tab === 'activity' ? (
					<ol aria-label='Activity' className='rounded-24 bg-white/4 px-5 py-3 font-mono text-12 leading-relaxed text-white/70 select-text'>
						{editor.activity.map((line, index) => (
							<li key={index} className='flex gap-4'>
								<span className='shrink-0 text-white/35'>{line.time}</span>
								<span className='min-w-0 whitespace-pre-wrap'>{line.text}</span>
							</li>
						))}
					</ol>
				) : null}
			</div>

			<footer className='flex shrink-0 flex-wrap items-center gap-3 border-t-hpx border-white/10 py-3.5 pb-5'>
				<label className='flex items-center gap-2.5 text-13 -tracking-2 text-white/70' title='Download current images for literal tags before applying. Data migrations from a newer image cannot be undone by a configuration restore.'>
					<Switch checked={pull} onCheckedChange={setPull} aria-label='Pull newest images' />
					Pull newest images
				</label>
				<span className='flex-1' />
				<Button size='md' disabled={busy !== null || !connected} onClick={() => void editor.review()}>
					Review changes
				</Button>
				<Button size='md' variant='primary' disabled={busy !== null} onClick={() => void startPush()}>
					{busy === 'push' ? 'Pushing…' : 'Push to Umbrel'}
				</Button>
			</footer>

			{choosingIcon && settings ? (
				<IconDialog
					image={settings.image}
					current={settings.icon}
					onClose={() => setChoosingIcon(false)}
					onUse={(next) => {
						editor.editSettings({...settings, icon: next})
						setChoosingIcon(false)
					}}
				/>
			) : null}
			{showLogs ? <LogsDialog appId={appId} name={name} onClose={() => setShowLogs(false)} /> : null}
			{ports ? (
				<PortsDialog
					check={ports}
					onCancel={() => {
						setPorts(null)
						editor.setStatus({kind: 'info', text: 'Push cancelled; ports unchanged.'})
					}}
					onUse={(changes) => {
						setPorts(null)
						void (async () => {
							try {
								await editor.changePorts(changes)
								setConfirming(true)
							} catch (error) {
								editor.setStatus({kind: 'error', text: error instanceof Error ? error.message : 'The ports could not be changed.'})
							}
						})()
					}}
				/>
			) : null}
			{confirming ? (
				<PushDialog
					name={name}
					host={host}
					isUpdate={isUpdate}
					pull={pull}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false)
						void editor.push(pull).then((result) => result && onApplied())
					}}
				/>
			) : null}
			{leaving ? (
				<Dialog open onOpenChange={(open) => !open && setLeaving(false)}>
					<DialogContent aria-describedby='leave-description'>
						<DialogHeader>
							<DialogTitle>Discard your edits?</DialogTitle>
							<DialogDescription id='leave-description'>The changes you made here have not been pushed to the Umbrel.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button size='dialog' onClick={() => setLeaving(false)}>
								Keep editing
							</Button>
							<Button size='dialog' variant='destructive' onClick={onBack}>
								Discard
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : null}
		</div>
	)
}
