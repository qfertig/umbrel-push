import {Plus, X} from 'lucide-react'
import {useEffect, useId, useState, type ReactNode} from 'react'

import {Button} from '@/components/Button'
import {FormGroup, FormNote, FormRow} from '@/components/FormRow'
import {ImageField} from '@/components/ImageField'
import {Input} from '@/components/Input'
import {ListIcon} from '@/components/ListRow'
import {Select} from '@/components/Select'
import {Switch} from '@/components/Switch'
import {NO_ICON} from '@/lib/apps'
import type {ContainerImage, Settings} from '@/lib/types'

const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no']
const CPU_SHARES: [string, number][] = [
	['Low', 512],
	['Normal', 1024],
	['High', 2048],
]

/** A whole number from what was typed, or null when the box is empty */
const whole = (text: string): number | null => {
	const digits = text.replace(/\D/g, '').slice(0, 7)
	return digits ? Number(digits) : null
}

const replaceAt = <T,>(list: readonly T[], index: number, next: T): T[] => list.map((item, position) => (position === index ? next : item))
const removeAt = <T,>(list: readonly T[], index: number): T[] => list.filter((_, position) => position !== index)

function iconText(icon: string | null): string {
	if (!icon || icon === NO_ICON) return 'None (transparent placeholder)'
	return icon.startsWith('data:') ? 'Embedded image' : icon
}

function RemoveButton({label, onClick}: {label: string; onClick: () => void}) {
	return (
		<Button size='icon' aria-label={label} title={label} onClick={onClick} className='shrink-0'>
			<X className='size-3.5' aria-hidden='true' />
		</Button>
	)
}

function AddButton({label, onClick}: {label: string; onClick: () => void}) {
	return (
		<Button size='sm' aria-label={label} onClick={onClick}>
			<Plus className='size-3' aria-hidden='true' />
			Add
		</Button>
	)
}

/** A text box for a comma separated list that keeps what is being typed (a trailing comma) while the list underneath stays tidy */
function CommaList({value, onChange, id, placeholder}: {value: string[]; onChange: (value: string[]) => void; id?: string; placeholder?: string}) {
	const parse = (text: string) =>
		text
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
	const [text, setText] = useState(value.join(', '))
	useEffect(() => {
		if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(value.join(', '))
	}, [value, text])
	return (
		<Input
			id={id}
			placeholder={placeholder}
			sizeVariant='short'
			value={text}
			onChange={(event) => {
				setText(event.target.value)
				onChange(parse(event.target.value))
			}}
			spellCheck={false}
		/>
	)
}

/**
 * Every field of the package that people expect to find in a container manager, written into the real
 * umbrel-app.yml and docker-compose.yml when the form is left or pushed. Anything this form does not show is kept.
 */
export function SettingsForm({
	settings,
	images,
	host,
	iconPreview,
	onChange,
	onChangeIcon,
}: {
	settings: Settings
	images: readonly ContainerImage[]
	host: string
	iconPreview: ReactNode
	onChange: (settings: Settings) => void
	onChangeIcon: () => void
}) {
	const id = useId()
	const set = (patch: Partial<Settings>) => onChange({...settings, ...patch})
	const field = (name: string) => `${id}-${name}`
	const link = settings.dashboardPort ? `http://${host || 'umbrel.local'}:${settings.dashboardPort}${settings.path}` : ''
	const knownShares = settings.cpuShares === null || CPU_SHARES.some(([, value]) => value === settings.cpuShares)

	return (
		<div className='flex flex-col gap-6 pb-6'>
			<FormGroup title='App'>
				<FormRow label='Title' htmlFor={field('title')}>
					<Input id={field('title')} sizeVariant='short' value={settings.name} onChange={(e) => set({name: e.target.value})} placeholder='Shown on the Umbrel dashboard' />
				</FormRow>
				<FormRow label='Version' htmlFor={field('version')}>
					<Input id={field('version')} sizeVariant='short' className='w-[160px]' value={settings.version} onChange={(e) => set({version: e.target.value})} />
				</FormRow>
				<FormRow label='Icon'>
					<ListIcon className='size-10 rounded-10 [--settings-row-tone:var(--settings-tone-2)]'>{iconPreview}</ListIcon>
					<span className='min-w-0 flex-1 truncate text-13 text-white/45' title={settings.icon ?? undefined}>
						{iconText(settings.icon)}
					</span>
					<Button size='md' onClick={onChangeIcon}>
						Change…
					</Button>
				</FormRow>
			</FormGroup>

			<FormGroup title='Web UI'>
				<FormRow label='Dashboard' htmlFor={field('port')}>
					<span className='text-13 text-white/45'>port</span>
					<Input
						id={field('port')}
						sizeVariant='short'
						className='w-[100px]'
						inputMode='numeric'
						value={settings.dashboardPort ?? ''}
						onChange={(e) => set({dashboardPort: whole(e.target.value)})}
					/>
					<span className='ml-2 text-13 text-white/45'>path</span>
					<Input aria-label='Dashboard path' sizeVariant='short' className='w-[170px]' value={settings.path} onChange={(e) => set({path: e.target.value})} placeholder='/' />
				</FormRow>
				<FormRow label='Container web port' htmlFor={field('web')} hint={settings.webPort === null ? 'This package has no app_proxy.' : undefined}>
					<Input
						id={field('web')}
						sizeVariant='short'
						className='w-[100px]'
						inputMode='numeric'
						disabled={settings.webPort === null}
						value={settings.webPort ?? ''}
						onChange={(e) => set({webPort: whole(e.target.value)})}
					/>
				</FormRow>
				{link ? (
					<FormNote>
						Dashboard link: <span className='font-mono select-text'>{link}</span>
					</FormNote>
				) : null}
			</FormGroup>

			<FormGroup title='Container'>
				<FormRow label='Image' htmlFor={field('image')}>
					<ImageField id={field('image')} image={settings.image} onChange={(image) => set({image})} />
				</FormRow>
				{images.length > 0 ? (
					<FormRow label='Running' hint='What the containers use right now'>
						<ul className='flex min-w-0 flex-col items-end gap-0.5 text-right font-mono text-12 text-white/50 select-text'>
							{images.map((image) => (
								<li key={image.container} className='max-w-full truncate' title={`${image.container}: ${image.configuredImage}, image ${image.runningImageId}`}>
									{image.container} on {image.runningImageId.replace('sha256:', '').slice(0, 12)}
								</li>
							))}
						</ul>
					</FormRow>
				) : null}
				<FormRow label='Container name' htmlFor={field('container')}>
					<Input id={field('container')} sizeVariant='short' value={settings.containerName} onChange={(e) => set({containerName: e.target.value})} />
				</FormRow>
				<FormRow label='Network' htmlFor={field('network')}>
					<Select className='w-[170px]' id={field('network')} value={settings.network} onChange={(e) => set({network: e.target.value as Settings['network']})}>
						<option value='bridge'>bridge</option>
						<option value='host'>host</option>
					</Select>
				</FormRow>
				<FormRow label='Restart policy' htmlFor={field('restart')}>
					<Select className='w-[170px]' id={field('restart')} value={settings.restart} onChange={(e) => set({restart: e.target.value})}>
						{RESTART_POLICIES.map((policy) => (
							<option key={policy} value={policy}>
								{policy}
							</option>
						))}
					</Select>
				</FormRow>
				<FormRow label='Memory limit' htmlFor={field('memory')}>
					<Input
						id={field('memory')}
						sizeVariant='short'
						className='w-[120px]'
						inputMode='numeric'
						placeholder='No limit'
						value={settings.memoryMb || ''}
						onChange={(e) => set({memoryMb: whole(e.target.value) ?? 0})}
					/>
					<span className='text-13 text-white/45'>MB</span>
				</FormRow>
				<FormRow label='CPU shares' htmlFor={field('cpu')}>
					<Select
						className='w-[170px]'
						id={field('cpu')}
						value={settings.cpuShares === null ? '' : String(settings.cpuShares)}
						onChange={(e) => set({cpuShares: e.target.value === '' ? null : Number(e.target.value)})}
					>
						<option value=''>Default</option>
						{CPU_SHARES.map(([name, value]) => (
							<option key={name} value={value}>
								{name} ({value})
							</option>
						))}
						{knownShares ? null : <option value={String(settings.cpuShares)}>Custom ({settings.cpuShares})</option>}
					</Select>
				</FormRow>
				<FormRow label='Capabilities' htmlFor={field('caps')}>
					<CommaList id={field('caps')} value={settings.capAdd} onChange={(capAdd) => set({capAdd})} placeholder='Comma separated, e.g. NET_ADMIN, SYS_TIME' />
				</FormRow>
				<FormRow label='Command' htmlFor={field('command')}>
					<Input
						id={field('command')}
						sizeVariant='short'
						value={settings.command}
						onChange={(e) => set({command: e.target.value})}
						placeholder="Overrides the image's default command"
						spellCheck={false}
					/>
				</FormRow>
				<FormRow label='Privileged' hint='Full host device access. Avoid unless the image requires it.'>
					<Switch aria-label='Privileged' checked={settings.privileged} onCheckedChange={(privileged) => set({privileged})} />
				</FormRow>
			</FormGroup>

			<FormGroup
				title='Published ports'
				action={<AddButton label='Add a published port' onClick={() => set({ports: [...settings.ports, {host: null, container: null, protocol: 'tcp', ip: null}]})} />}
			>
				{settings.ports.length === 0 ? <FormNote>No extra host ports are published.</FormNote> : null}
				{settings.ports.map((port, index) => (
					<div key={index} className='flex items-center gap-2 px-5 py-2.5'>
						<Input
							aria-label={`Host port ${index + 1}`}
							sizeVariant='square'
							className='w-[130px] font-mono'
							inputMode='numeric'
							placeholder='Host port'
							value={port.host ?? ''}
							onChange={(e) => set({ports: replaceAt(settings.ports, index, {...port, host: whole(e.target.value)})})}
						/>
						<Input
							aria-label={`Container port ${index + 1}`}
							sizeVariant='square'
							className='w-[150px] font-mono'
							inputMode='numeric'
							placeholder='Container port'
							value={port.container ?? ''}
							onChange={(e) => set({ports: replaceAt(settings.ports, index, {...port, container: whole(e.target.value)})})}
						/>
						<Select
							className='w-[100px]'
							aria-label={`Protocol ${index + 1}`}
							value={port.protocol}
							onChange={(e) => set({ports: replaceAt(settings.ports, index, {...port, protocol: e.target.value as 'tcp' | 'udp'})})}
						>
							<option value='tcp'>tcp</option>
							<option value='udp'>udp</option>
						</Select>
						<span className='flex-1' />
						<RemoveButton label={`Remove published port ${index + 1}`} onClick={() => set({ports: removeAt(settings.ports, index)})} />
					</div>
				))}
			</FormGroup>

			<FormGroup
				title='Volumes'
				action={<AddButton label='Add a volume' onClick={() => set({volumes: [...settings.volumes, {host: '', container: '', mode: null}]})} />}
			>
				{settings.volumes.length === 0 ? <FormNote>No volumes are mounted.</FormNote> : null}
				{settings.volumes.map((volume, index) => (
					<div key={index} className='flex items-center gap-2 px-5 py-2.5'>
						<Input
							aria-label={`Host path ${index + 1}`}
							sizeVariant='square'
							className='min-w-0 flex-1 font-mono text-12'
							placeholder='${APP_DATA_DIR}/data'
							value={volume.host}
							spellCheck={false}
							onChange={(e) => set({volumes: replaceAt(settings.volumes, index, {...volume, host: e.target.value})})}
						/>
						<Input
							aria-label={`Container path ${index + 1}`}
							sizeVariant='square'
							className='min-w-0 flex-1 font-mono text-12'
							placeholder='/data'
							value={volume.container}
							spellCheck={false}
							onChange={(e) => set({volumes: replaceAt(settings.volumes, index, {...volume, container: e.target.value})})}
						/>
						<Input
							aria-label={`Mode ${index + 1}`}
							sizeVariant='square'
							className='w-[70px] font-mono text-12'
							placeholder='mode'
							value={volume.mode ?? ''}
							onChange={(e) => set({volumes: replaceAt(settings.volumes, index, {...volume, mode: e.target.value || null})})}
						/>
						<RemoveButton label={`Remove volume ${index + 1}`} onClick={() => set({volumes: removeAt(settings.volumes, index)})} />
					</div>
				))}
			</FormGroup>

			<FormGroup
				title='Environment variables'
				action={<AddButton label='Add an environment variable' onClick={() => set({environment: [...settings.environment, ['', '']]})} />}
			>
				{settings.environment.length === 0 ? <FormNote>No environment variables are set.</FormNote> : null}
				{settings.environment.map(([name, value], index) => (
					<div key={index} className='flex items-center gap-2 px-5 py-2.5'>
						<Input
							aria-label={`Variable ${index + 1}`}
							sizeVariant='square'
							className='w-[220px] font-mono text-12'
							placeholder='NAME'
							value={name}
							spellCheck={false}
							onChange={(e) => set({environment: replaceAt(settings.environment, index, [e.target.value, value])})}
						/>
						<Input
							aria-label={`Value ${index + 1}`}
							sizeVariant='square'
							className='min-w-0 flex-1 font-mono text-12'
							placeholder='value'
							value={value}
							spellCheck={false}
							onChange={(e) => set({environment: replaceAt(settings.environment, index, [name, e.target.value])})}
						/>
						<RemoveButton label={`Remove variable ${index + 1}`} onClick={() => set({environment: removeAt(settings.environment, index)})} />
					</div>
				))}
			</FormGroup>

			<FormGroup title='Devices' action={<AddButton label='Add a device' onClick={() => set({devices: [...settings.devices, '']})} />}>
				{settings.devices.length === 0 ? <FormNote>No host devices are passed through.</FormNote> : null}
				{settings.devices.map((device, index) => (
					<div key={index} className='flex items-center gap-2 px-5 py-2.5'>
						<Input
							aria-label={`Device ${index + 1}`}
							sizeVariant='square'
							className='min-w-0 flex-1 font-mono text-12'
							placeholder='/dev/dri:/dev/dri'
							value={device}
							spellCheck={false}
							onChange={(e) => set({devices: replaceAt(settings.devices, index, e.target.value)})}
						/>
						<RemoveButton label={`Remove device ${index + 1}`} onClick={() => set({devices: removeAt(settings.devices, index)})} />
					</div>
				))}
			</FormGroup>

			<p className='px-1 text-12 leading-snug text-white/40'>
				Published ports are extra host ports besides the dashboard entry, which app_proxy serves. Volumes under{' '}
				<span className='font-mono'>{'${APP_DATA_DIR}'}</span> live in the app's own data directory and survive updates.
			</p>
		</div>
	)
}
