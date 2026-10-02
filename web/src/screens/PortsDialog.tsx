import {useId, useState} from 'react'

import {Button} from '@/components/Button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/Dialog'
import {Input, InputError} from '@/components/Input'
import type {PortChange} from '@/lib/editor'
import type {PortCheck} from '@/lib/types'

/** Shown before a push when the package wants ports the Umbrel already uses: one free port to pick for each. */
export function PortsDialog({check, onCancel, onUse}: {check: PortCheck; onCancel: () => void; onUse: (changes: PortChange[]) => void}) {
	const id = useId()
	const [choices, setChoices] = useState<Record<number, string>>(() => Object.fromEntries(check.conflicts.map((c) => [c.port, String(c.suggestions[0] ?? '')])))
	const [error, setError] = useState('')
	const count = check.conflicts.length

	const submit = () => {
		const changes: PortChange[] = []
		const chosen = new Set<number>()
		for (const conflict of check.conflicts) {
			const text = (choices[conflict.port] ?? '').trim()
			const port = Number(text)
			if (!/^\d+$/.test(text) || port < 1 || port > 65535) return setError(`'${text}' is not a valid port.`)
			if (check.used[String(port)]) return setError(`Port ${port} is also in use (${check.used[String(port)]}).`)
			if (chosen.has(port)) return setError(`Port ${port} was chosen twice.`)
			chosen.add(port)
			if (port !== conflict.port) changes.push({port: conflict.port, to: port, owner: conflict.owner})
		}
		onUse(changes)
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent className='sm:max-w-[600px]' aria-describedby={`${id}-description`}>
				<DialogHeader>
					<DialogTitle>Ports in use</DialogTitle>
					<DialogDescription id={`${id}-description`}>
						{count} port{count === 1 ? '' : 's'} in this package {count === 1 ? 'is' : 'are'} already in use on the Umbrel. Pick a free port for each, or type one.
					</DialogDescription>
				</DialogHeader>
				<div className='flex flex-col gap-3'>
					{check.conflicts.map((conflict) => (
						<div key={conflict.port} className='flex flex-wrap items-center gap-x-4 gap-y-2'>
							<span className='font-mono text-13'>
								{conflict.kind === 'dashboard' ? 'Dashboard port' : 'Published port'} {conflict.port}
							</span>
							<span className='min-w-0 flex-1 truncate text-13 text-white/45'>used by {conflict.owner}</span>
							<label htmlFor={`${id}-${conflict.port}`} className='text-13 text-white/45'>
								change to
							</label>
							<Input
								id={`${id}-${conflict.port}`}
								sizeVariant='short'
								className='w-[110px] font-mono'
								inputMode='numeric'
								list={`${id}-${conflict.port}-suggestions`}
								value={choices[conflict.port] ?? ''}
								onChange={(event) => {
									setChoices({...choices, [conflict.port]: event.target.value})
									setError('')
								}}
							/>
							<datalist id={`${id}-${conflict.port}-suggestions`}>
								{conflict.suggestions.map((port) => (
									<option key={port} value={port} />
								))}
							</datalist>
						</div>
					))}
				</div>
				{error ? <InputError>{error}</InputError> : null}
				<DialogFooter>
					<Button size='dialog' onClick={onCancel}>
						Cancel
					</Button>
					<Button size='dialog' variant='primary' onClick={submit}>
						Use these ports
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
