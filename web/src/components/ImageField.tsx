import * as Menu from '@radix-ui/react-dropdown-menu'
import {ChevronDown} from 'lucide-react'
import {useState} from 'react'

import {Button} from '@/components/Button'
import {Input} from '@/components/Input'
import {api} from '@/lib/api'
import {joinImage, splitImage, tagName} from '@/lib/apps'
import {cn} from '@/lib/utils'

type Versions =
	| {status: 'idle'}
	| {status: 'loading'}
	| {status: 'error'; message: string}
	| {status: 'ready'; tags: string[]; registry: 'docker-hub' | 'other'}

/**
 * The container image as two boxes, repository and tag, with a Versions menu that lists the tags Docker Hub knows for
 * the repository, newest first. Picking one only fills the tag box; nothing changes on the Umbrel until the edit is
 * reviewed and pushed. Images on other registries have no list, so the tag box takes whatever is typed.
 */
export function ImageField({image, onChange, id}: {image: string; onChange: (image: string) => void; id: string}) {
	const [repository, tag] = splitImage(image)
	const [versions, setVersions] = useState<Versions>({status: 'idle'})

	const load = async () => {
		if (!repository.trim()) {
			setVersions({status: 'error', message: 'Enter an image first.'})
			return
		}
		setVersions({status: 'loading'})
		try {
			const result = await api.tags(repository)
			setVersions({status: 'ready', tags: result.tags, registry: result.registry})
		} catch (error) {
			setVersions({status: 'error', message: error instanceof Error ? error.message : 'The versions could not be listed.'})
		}
	}

	return (
		<div className='flex w-full min-w-0 flex-wrap items-center gap-2'>
			<Input
				id={id}
				aria-label='Image'
				sizeVariant='short'
				className='min-w-[min(220px,100%)] flex-1 font-mono text-12'
				value={repository}
				onChange={(event) => onChange(joinImage(event.target.value, tag))}
				placeholder='organization/image'
				spellCheck={false}
				autoComplete='off'
			/>
			<Input
				aria-label='Tag'
				sizeVariant='short'
				className='w-[150px] shrink-0 font-mono text-12'
				value={tag}
				onChange={(event) => onChange(joinImage(repository, event.target.value))}
				placeholder='tag'
				spellCheck={false}
				autoComplete='off'
			/>
			<Menu.Root onOpenChange={(open) => open && void load()}>
				<Menu.Trigger asChild>
					<Button size='md' className='shrink-0 pr-3'>
						Versions
						<ChevronDown className='size-3.5' aria-hidden='true' />
					</Button>
				</Menu.Trigger>
				<Menu.Portal>
					<Menu.Content
						align='end'
						sideOffset={6}
						className='umbrel-material umbrel-material-dropdown z-50 max-h-[300px] min-w-[260px] overflow-y-auto p-1.5 outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
					>
						{versions.status === 'loading' ? <Note>Listing versions…</Note> : null}
						{versions.status === 'error' ? <Note tone='error'>{versions.message}</Note> : null}
						{versions.status === 'ready' && versions.registry === 'other' ? (
							<Note>Version lists come from Docker Hub only. Type a tag for this registry.</Note>
						) : null}
						{versions.status === 'ready' && versions.registry === 'docker-hub' && versions.tags.length === 0 ? <Note>Docker Hub lists no tags for this image.</Note> : null}
						{versions.status === 'ready'
							? versions.tags.map((name) => (
									<Menu.Item
										key={name}
										onSelect={() => onChange(joinImage(repository, name))}
										className='flex cursor-default items-center justify-between gap-6 rounded-12 px-3 py-2 text-13 outline-hidden select-none data-[highlighted]:bg-white/10'
									>
										<span className='font-mono'>{name}</span>
										{name === tagName(tag) ?<span className='text-12 text-white/45'>Current</span> : null}
									</Menu.Item>
								))
							: null}
						{versions.status === 'ready' && versions.tags.length > 0 ? (
							<p className='px-3 pt-2 pb-1 text-12 text-white/40'>Newest first. Pick one, then review and push.</p>
						) : null}
					</Menu.Content>
				</Menu.Portal>
			</Menu.Root>
		</div>
	)
}

function Note({children, tone}: {children: string; tone?: 'error'}) {
	return <p className={cn('px-3 py-2 text-13', tone === 'error' ? 'text-destructive2-lightest' : 'text-white/50')}>{children}</p>
}
