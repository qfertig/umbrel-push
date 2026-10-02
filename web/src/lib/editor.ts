import {useState} from 'react'

import {api} from './api'
import type {ContainerImage, Origin, PackageFiles, PackageView, PortCheck, Settings} from './types'

export type EditorTab = 'settings' | 'yaml' | 'changes' | 'activity'
export type Status = {kind: 'ok' | 'error' | 'info'; text: string} | null
export type ActivityLine = {time: string; text: string}
export type PortChange = {port: number; to: number; owner: string}

const clock = () => new Date().toLocaleTimeString('en-GB')
const reason = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')

/** The compose file is what people edit most, so it opens first */
const firstFile = (files: PackageFiles) => (files['docker-compose.yml'] ? 'docker-compose.yml' : (Object.keys(files).sort()[0] ?? ''))

/**
 * Everything the editor holds while an app is being changed: the package files, the settings view of them, what is
 * installed (the baseline), and a few lines of history. The same steps as the Qt editor, in the same order:
 * edits to the form are written into the YAML before leaving the form, edits to the YAML are read back into the
 * form when returning to it, and a push is validated, checked for port clashes, confirmed, then sent.
 */
export function useEditor(initial: PackageView, isNew: boolean, appId: string, retrievedFrom: string) {
	const [files, setFiles] = useState<PackageFiles>(initial.files)
	const [baseline, setBaseline] = useState<string | null>(initial.baseline)
	const [origin, setOrigin] = useState<Origin | null>(initial.origin)
	const [images, setImages] = useState<ContainerImage[]>(initial.images)
	const [settings, setSettings] = useState<Settings | null>(initial.settings)
	const [settingsError, setSettingsError] = useState<string | null>(initial.error)
	const [formDirty, setFormDirty] = useState(false)
	const [yamlDirty, setYamlDirty] = useState(false)
	const [dirty, setDirty] = useState(isNew)
	const [tab, setTab] = useState<EditorTab>('settings')
	const [file, setFile] = useState(firstFile(initial.files))
	const [diff, setDiff] = useState('')
	const [status, setStatus] = useState<Status>(null)
	const [busy, setBusy] = useState<'review' | 'push' | 'validate' | null>(null)
	const [retrievedAt, setRetrievedAt] = useState(clock())
	const [activity, setActivity] = useState<ActivityLine[]>(() => [
		{time: clock(), text: isNew ? 'Package generated locally. Nothing has been sent to the Umbrel.' : `Retrieved ${appId} from ${retrievedFrom}.`},
		...initial.images.map((image) => ({time: clock(), text: `${image.configuredImage} runs as image ${image.runningImageId}`})),
	])

	const log = (text: string) => setActivity((lines) => [...lines, {time: clock(), text}])
	const fail = (error: unknown) => {
		setStatus({kind: 'error', text: reason(error)})
		log(`Failed: ${reason(error)}`)
	}

	/** Make the files match the form. Returns the current files, or null when the form holds something invalid. */
	const flush = async (): Promise<PackageFiles | null> => {
		if (!formDirty || !settings) return files
		try {
			const next = (await api.writeSettings(files, settings)).files
			setFiles(next)
			setFormDirty(false)
			log('Settings applied to the YAML files.')
			return next
		} catch (error) {
			setStatus({kind: 'error', text: reason(error)})
			return null
		}
	}

	const loadSettings = async (from: PackageFiles) => {
		const result = await api.readSettings(from)
		setSettings(result.settings)
		setSettingsError(result.error)
		setFormDirty(false)
		setYamlDirty(false)
	}

	const adopt = (view: PackageView) => {
		setFiles(view.files)
		setBaseline(view.baseline)
		setOrigin(view.origin)
		setImages(view.images)
		setSettings(view.settings)
		setSettingsError(view.error)
		setFormDirty(false)
		setYamlDirty(false)
		setDirty(false)
		setDiff('')
		setRetrievedAt(clock())
		view.images.forEach((image) => log(`${image.configuredImage} runs as image ${image.runningImageId}`))
	}

	return {
		files, baseline, origin, images, settings, settingsError, dirty, tab, file, diff, status, busy, activity, retrievedAt,
		setFile,
		setStatus,

		editSettings(next: Settings) {
			setSettings(next)
			setFormDirty(true)
			setDirty(true)
		},

		editFile(name: string, content: string) {
			setFiles((current) => ({...current, [name]: {...current[name], content}}))
			setYamlDirty(true)
			setDirty(true)
		},

		async selectTab(next: EditorTab) {
			if (next === tab) return
			if (tab === 'settings' && next !== 'settings' && (await flush()) === null) return // an invalid form stays open
			if (next === 'settings' && yamlDirty) {
				try {
					await loadSettings(files)
				} catch (error) {
					fail(error)
				}
			}
			setTab(next)
		},

		async validate() {
			const current = await flush()
			if (!current) return
			setBusy('validate')
			try {
				const result = await api.validate(current)
				setStatus({kind: 'ok', text: `Valid package.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`})
				result.warnings.forEach((warning) => log(`Notice: ${warning}`))
			} catch (error) {
				fail(error)
			} finally {
				setBusy(null)
			}
		},

		async review() {
			const current = await flush()
			if (!current) return
			setBusy('review')
			try {
				setDiff((await api.review(appId, current, baseline)).diff)
				setTab('changes')
				setStatus({kind: 'ok', text: 'Change preview ready.'})
			} catch (error) {
				fail(error)
			} finally {
				setBusy(null)
			}
		},

		/** Validate, then ask the Umbrel which ports clash. Null means something failed and the status says what. */
		async preparePush(): Promise<PortCheck | null> {
			const current = await flush()
			if (!current) return null
			setBusy('push')
			try {
				await api.validate(current)
				return await api.ports(appId, current)
			} catch (error) {
				fail(error)
				return null
			} finally {
				setBusy(null)
			}
		},

		/** Rewrite the clashing ports in the package, then read the form back from the new files */
		async changePorts(changes: PortChange[]) {
			let next = files
			for (const change of changes) {
				next = (await api.replacePort(next, change.port, change.to)).files
				log(`Port ${change.port} is used by ${change.owner}; changed to ${change.to}.`)
			}
			setFiles(next)
			await loadSettings(next)
			setDirty(true)
		},

		async push(pull: boolean): Promise<PackageView | null> {
			setBusy('push')
			setStatus({kind: 'info', text: 'Applying the app. Image downloads can take several minutes.'})
			try {
				const view = await api.push(appId, files, baseline, pull)
				adopt(view)
				log(`Push complete. Backup: ${view.backup ?? 'none (initial install)'}`)
				setStatus({kind: 'ok', text: 'Applied. The editor now shows the installed copy.'})
				return view
			} catch (error) {
				fail(error)
				return null
			} finally {
				setBusy(null)
			}
		},
	}
}

export type Editor = ReturnType<typeof useEditor>
