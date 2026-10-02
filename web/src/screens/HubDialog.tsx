import {useState, type FormEvent} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {Input, InputError} from '@/components/Input'
import {api} from '@/lib/api'
import type {HubResult} from '@/lib/types'
import {cn} from '@/lib/utils'

/** Search the public Docker Hub for an image to start from. Ports and storage still need the user's review afterwards. */
export function HubDialog({onUse, onClose}: {onUse: (image: string) => void; onClose: () => void}) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<HubResult[] | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')

	const search = async (event: FormEvent) => {
		event.preventDefault()
		if (!query.trim()) return
		setBusy(true)
		setError('')
		setSelected(null)
		try {
			setResults((await api.searchImages(query.trim())).results)
		} catch (failure) {
			setResults(null)
			setError(failure instanceof Error ? failure.message : 'Docker Hub could not be searched.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className='sm:max-w-[640px]' aria-describedby='hub-description'>
				<DialogHeader>
					<DialogTitle>Search Docker Hub</DialogTitle>
					<DialogDescription id='hub-description'>Results come from the public Docker Hub search. Ports and storage still need your review.</DialogDescription>
				</DialogHeader>
				<form onSubmit={(event) => void search(event)} className='flex gap-2'>
					<Input aria-label='Public image name' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Public image name, for example jellyfin' autoFocus spellCheck={false} />
					<Button type='submit' size='lg' disabled={busy || !query.trim()}>
						Search
					</Button>
				</form>
				{error ? <InputError>{error}</InputError> : null}
				{busy ? <p role='status' className='text-13 text-white/50'>Searching Docker Hub…</p> : null}
				{results ? (
					results.length === 0 ? (
						<p role='status' className='text-13 text-white/50'>No images match “{query.trim()}”.</p>
					) : (
						<div role='listbox' aria-label='Search results' className='umbrel-scrollbar max-h-[300px] divide-y divide-white/8 overflow-y-auto rounded-24 bg-white/4'>
							{results.map((hit) => (
								<button
									key={hit.name}
									type='button'
									role='option'
									aria-selected={selected === hit.name}
									onClick={() => setSelected(hit.name)}
									onDoubleClick={() => onUse(`${hit.name}:latest`)}
									className={cn(
										'flex w-full flex-col gap-1 px-5 py-3 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset',
										selected === hit.name ? 'bg-brand/30' : 'hover:bg-white/4',
									)}
								>
									<span className='flex items-baseline justify-between gap-4'>
										<span className='font-mono text-13 font-medium'>{hit.name}</span>
										<span className='shrink-0 text-12 text-white/45'>{hit.official ? 'Docker Official' : 'Community'}</span>
									</span>
									{hit.description ? <span className='line-clamp-2 text-12 text-white/45'>{hit.description}</span> : null}
								</button>
							))}
						</div>
					)
				) : null}
				<DialogFooter>
					<Button size='dialog' onClick={onClose}>
						Cancel
					</Button>
					<Button size='dialog' variant='primary' disabled={!selected} onClick={() => selected && onUse(`${selected}:latest`)}>
						Use selected image
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
