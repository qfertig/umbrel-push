import {useState, type FormEvent} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {Input, InputError, Labeled} from '@/components/Input'
import {api} from '@/lib/api'
import {NO_ICON, slug} from '@/lib/apps'
import type {PackageFiles} from '@/lib/types'
import {HubDialog} from '@/screens/HubDialog'
import {IconDialog} from '@/screens/IconDialog'

/** Generates an editable package for a web app served from one container. Nothing reaches the Umbrel until it is pushed. */
export function NewAppDialog({onClose, onCreate}: {onClose: () => void; onCreate: (id: string, files: PackageFiles) => void}) {
	const [name, setName] = useState('')
	const [id, setId] = useState('')
	const [idEdited, setIdEdited] = useState(false)
	const [image, setImage] = useState('')
	const [containerPort, setContainerPort] = useState('8080')
	const [port, setPort] = useState('18990')
	const [dataPath, setDataPath] = useState('')
	const [icon, setIcon] = useState<string | null>(null)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [searching, setSearching] = useState(false)
	const [choosingIcon, setChoosingIcon] = useState(false)

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		setBusy(true)
		setError('')
		try {
			const files = (
				await api.generate({id: id.trim(), name: name.trim(), image: image.trim(), containerPort: Number(containerPort), port: Number(port), dataPath: dataPath.trim(), icon})
			).files
			onCreate(id.trim(), files)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'The package could not be created.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
				<DialogContent className='sm:max-w-[560px]' aria-describedby='new-app-description'>
					<form onSubmit={(event) => void submit(event)} className='flex flex-col gap-5'>
						<DialogHeader>
							<DialogTitle>New app</DialogTitle>
							<DialogDescription id='new-app-description'>Generates an editable package for a web app served from one container. Nothing reaches the Umbrel until you push.</DialogDescription>
						</DialogHeader>
						<div className='grid grid-cols-2 gap-3'>
							<Labeled label='Name'>
								<Input
									value={name}
									onChange={(event) => {
										setName(event.target.value)
										if (!idEdited) setId(slug(event.target.value))
									}}
									placeholder='My app'
									autoFocus
								/>
							</Labeled>
							<Labeled label='ID'>
								<Input
									value={id}
									onChange={(event) => {
										setId(event.target.value)
										setIdEdited(true)
									}}
									placeholder='my-app'
									spellCheck={false}
									className='font-mono'
								/>
							</Labeled>
						</div>
						<div className='flex items-end gap-2'>
							<div className='min-w-0 flex-1'>
								<Labeled label='Image'>
									<Input value={image} onChange={(event) => setImage(event.target.value)} placeholder='organization/image:tag' spellCheck={false} className='font-mono' />
								</Labeled>
							</div>
							<Button size='lg' onClick={() => setSearching(true)}>
								Search Docker Hub…
							</Button>
						</div>
						<div className='grid grid-cols-2 gap-3'>
							<Labeled label='Container web port'>
								<Input value={containerPort} onChange={(event) => setContainerPort(event.target.value.replace(/\D/g, ''))} inputMode='numeric' className='font-mono' />
							</Labeled>
							<Labeled label='Dashboard port'>
								<Input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))} inputMode='numeric' className='font-mono' />
							</Labeled>
						</div>
						<Labeled label='Data path in the container (optional)'>
							<Input value={dataPath} onChange={(event) => setDataPath(event.target.value)} placeholder='/config' spellCheck={false} className='font-mono' />
						</Labeled>
						<div className='flex items-center gap-3'>
							<span className='text-13 text-white/50'>Icon</span>
							<Button size='md' onClick={() => setChoosingIcon(true)}>
								{icon && icon !== NO_ICON ? 'Change icon…' : 'Choose icon…'}
							</Button>
						</div>
						{error ? <InputError>{error}</InputError> : null}
						<DialogFooter>
							<Button size='dialog' disabled={busy} onClick={onClose}>
								Cancel
							</Button>
							<Button size='dialog' variant='primary' type='submit' disabled={busy || !name.trim() || !id.trim() || !image.trim()}>
								Create package
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			{searching ? (
				<HubDialog
					onClose={() => setSearching(false)}
					onUse={(chosen) => {
						setImage(chosen)
						setSearching(false)
					}}
				/>
			) : null}
			{choosingIcon ? (
				<IconDialog
					image={image}
					current={icon}
					onClose={() => setChoosingIcon(false)}
					onUse={(chosen) => {
						setIcon(chosen)
						setChoosingIcon(false)
					}}
				/>
			) : null}
		</>
	)
}
