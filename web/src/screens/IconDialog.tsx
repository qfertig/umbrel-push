import {useRef, useState} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {InputError} from '@/components/Input'
import {api} from '@/lib/api'
import {NO_ICON, usableIcon} from '@/lib/apps'

const MAX_BYTES = 1024 * 1024

/** The dashboard icon: a match from the Dashboard Icons project, an uploaded image embedded in the manifest, or none. */
export function IconDialog({image, current, onUse, onClose}: {image: string; current: string | null; onUse: (icon: string) => void; onClose: () => void}) {
	const [value, setValue] = useState<string>(current || NO_ICON)
	const [status, setStatus] = useState('')
	const [failed, setFailed] = useState(false)
	const [busy, setBusy] = useState(false)
	const picker = useRef<HTMLInputElement>(null)
	const preview = usableIcon({id: 'icon', icon: value})

	const report = (text: string, error = false) => {
		setStatus(text)
		setFailed(error)
	}

	const find = async () => {
		if (!image.trim()) return report('Enter a container image first.', true)
		setBusy(true)
		report('Looking for a matching Dashboard Icons image…')
		try {
			const result = await api.autoIcon(image)
			if (result.icon) {
				setValue(result.icon)
				report('Match found. Check the preview before using it.')
			} else {
				setValue(NO_ICON)
				report('No match found. Upload an image or leave it blank.')
			}
		} catch (error) {
			report(error instanceof Error ? error.message : 'The icon search failed.', true)
		} finally {
			setBusy(false)
		}
	}

	const upload = async (file: File | undefined) => {
		if (!file) return
		if (file.size > MAX_BYTES) return report('Icon must be smaller than 1 MiB.', true)
		setBusy(true)
		try {
			const dataUrl: string = await new Promise((resolve, reject) => {
				const reader = new FileReader()
				reader.onload = () => resolve(String(reader.result))
				reader.onerror = () => reject(new Error('The file could not be read.'))
				reader.readAsDataURL(file)
			})
			setValue((await api.embedIcon(dataUrl.slice(dataUrl.indexOf(',') + 1))).icon)
			report(`${file.name}, embedded in the manifest.`)
		} catch (error) {
			report(error instanceof Error ? error.message : 'The image could not be used.', true)
		} finally {
			setBusy(false)
			if (picker.current) picker.current.value = ''
		}
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent aria-describedby='icon-description'>
				<DialogHeader>
					<DialogTitle>Dashboard icon</DialogTitle>
					<DialogDescription id='icon-description'>Matches come from the Dashboard Icons project; check the preview before using one. Uploads are embedded in the manifest.</DialogDescription>
				</DialogHeader>
				<div className='flex h-[112px] items-center justify-center rounded-24 bg-white/6'>
					{preview ? <img src={preview} alt='Icon preview' referrerPolicy='no-referrer' className='size-[72px] rounded-17 object-cover' /> : <span className='text-13 text-white/45'>No icon</span>}
				</div>
				<div className='flex flex-wrap gap-2'>
					<Button size='md' disabled={busy} onClick={() => void find()}>
						Find a match
					</Button>
					<Button size='md' disabled={busy} onClick={() => picker.current?.click()}>
						Upload…
					</Button>
					<Button
						size='md'
						disabled={busy}
						onClick={() => {
							setValue(NO_ICON)
							report('The dashboard entry will have no icon artwork.')
						}}
					>
						None
					</Button>
					<input ref={picker} type='file' accept='image/png,image/jpeg,image/webp' aria-label='Choose an icon file' className='sr-only' onChange={(event) => void upload(event.target.files?.[0])} />
				</div>
				{status ? failed ? <InputError>{status}</InputError> : <p role='status' className='text-13 text-white/50'>{status}</p> : null}
				<DialogFooter>
					<Button size='dialog' disabled={busy} onClick={onClose}>
						Cancel
					</Button>
					<Button size='dialog' variant='primary' disabled={busy} onClick={() => onUse(value)}>
						Use icon
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
